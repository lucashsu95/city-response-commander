/**
 * In-memory IdempotencyTable that enforces real DynamoDB conditional-write
 * semantics, for tests that must exercise the guards rather than trust them.
 *
 * Not a `.test.ts` file, so vitest does not collect it as a suite.
 *
 * ## Why it evaluates the expressions instead of stubbing the port
 *
 * Every guarantee under test is expressed as a `ConditionExpression` that
 * `IdempotencyRepository` GENERATES. A stubbed port would let a repository with a
 * dropped guard clause pass. This table parses and evaluates the real
 * `UpdateExpression` / `ConditionExpression` — `attribute_exists`, `IN`, `=`, `<`,
 * `REMOVE`, and the `attempt_count = attempt_count + :n` increment — so the guards
 * are verified through the actual command path.
 *
 * @module backend/test/support/in_memory_idempotency_table
 */

import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

type AttributeValues = Record<string, unknown>;

function resolveName(token: string, names: Record<string, string> | undefined): string {
  const attribute = names?.[token];
  if (attribute === undefined) throw new Error(`Unmapped name placeholder "${token}".`);
  return attribute;
}

function resolveValue(token: string, values: AttributeValues | undefined): unknown {
  if (values === undefined || !(token in values)) {
    throw new Error(`Unmapped value placeholder "${token}".`);
  }
  return values[token];
}

/** Evaluate an ANDed `ConditionExpression` against a stored item. */
export function evaluateCondition(
  expression: string,
  names: Record<string, string> | undefined,
  values: AttributeValues | undefined,
  item: Record<string, unknown> | undefined,
): boolean {
  for (const rawTerm of expression.split(' AND ')) {
    const term = rawTerm.trim();

    const exists = /^attribute_exists\((#\w+)\)$/.exec(term);
    if (exists?.[1] !== undefined) {
      if (item?.[resolveName(exists[1], names)] === undefined) return false;
      continue;
    }

    const notExists = /^attribute_not_exists\((#\w+)\)$/.exec(term);
    if (notExists?.[1] !== undefined) {
      if (item?.[resolveName(notExists[1], names)] !== undefined) return false;
      continue;
    }

    const inList = /^(#\w+) IN \(([^)]*)\)$/.exec(term);
    if (inList?.[1] !== undefined && inList[2] !== undefined) {
      const actual = item?.[resolveName(inList[1], names)];
      const candidates = inList[2].split(',').map((token) => resolveValue(token.trim(), values));
      if (!candidates.includes(actual)) return false;
      continue;
    }

    const comparison = /^(#\w+) (=|<) (:\w+)$/.exec(term);
    if (
      comparison?.[1] !== undefined &&
      comparison[2] !== undefined &&
      comparison[3] !== undefined
    ) {
      const actual = item?.[resolveName(comparison[1], names)];
      const expected = resolveValue(comparison[3], values);
      if (comparison[2] === '=') {
        if (actual !== expected) return false;
      } else if (
        typeof actual !== 'number' ||
        typeof expected !== 'number' ||
        !(actual < expected)
      ) {
        return false;
      }
      continue;
    }

    throw new Error(`Unsupported condition term: "${term}".`);
  }
  return true;
}

/** Apply a real `UpdateExpression` (`SET ... REMOVE ...`) to an item copy. */
export function applyUpdate(
  expression: string,
  names: Record<string, string> | undefined,
  values: AttributeValues | undefined,
  item: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...item };
  const removeIndex = expression.indexOf('REMOVE ');

  const setPart = expression.startsWith('SET ')
    ? expression.slice(4, removeIndex >= 0 ? removeIndex : undefined).trim()
    : '';
  const removePart =
    removeIndex >= 0 ? expression.slice(removeIndex + 'REMOVE '.length).trim() : '';

  if (setPart.length > 0) {
    for (const rawClause of setPart.split(', ')) {
      const clause = rawClause.trim();

      const increment = /^(#\w+) = (#\w+) \+ (:\w+)$/.exec(clause);
      if (
        increment?.[1] !== undefined &&
        increment[2] !== undefined &&
        increment[3] !== undefined
      ) {
        const target = resolveName(increment[1], names);
        const source = resolveName(increment[2], names);
        const delta = resolveValue(increment[3], values);
        if (typeof next[source] !== 'number' || typeof delta !== 'number') {
          throw new Error(`Cannot increment non-numeric "${source}".`);
        }
        next[target] = next[source] + delta;
        continue;
      }

      const assign = /^(#\w+) = (:\w+)$/.exec(clause);
      if (assign?.[1] !== undefined && assign[2] !== undefined) {
        next[resolveName(assign[1], names)] = resolveValue(assign[2], values);
        continue;
      }

      throw new Error(`Unsupported SET clause: "${clause}".`);
    }
  }

  if (removePart.length > 0) {
    for (const token of removePart.split(', ')) {
      // REMOVE leaves the attribute ABSENT, not null. normalizeIdempotencyRecord
      // is what restores the declared `| null` on read.
      delete next[resolveName(token.trim(), names)];
    }
  }

  return next;
}

/** Construction options. */
export interface InMemoryTableOptions {
  readonly tableName: string;
  /**
   * Called before every command. Return an `Error` to inject a transient fault,
   * or `null` to let the command proceed. Used by the P33 failure-injection suite.
   */
  readonly injectFault?: (operation: 'put' | 'update' | 'get') => Error | null;
}

/** IdempotencyTable fake with real conditional-write semantics. */
export class InMemoryIdempotencyTable {
  private readonly items = new Map<string, string>();
  readonly documentClient: DynamoDBDocumentClient;

  putAttempts = 0;
  updateAttempts = 0;
  rejectedWrites = 0;
  injectedFaults = 0;
  /** Every ConditionExpression the repository generated, for guard assertions. */
  readonly conditionExpressions: string[] = [];

  constructor(private readonly options: InMemoryTableOptions) {
    this.documentClient = {
      send: (command: unknown): Promise<unknown> => this.send(command),
    } as unknown as DynamoDBDocumentClient;
  }

  item(key: string): Record<string, unknown> | null {
    const raw = this.items.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as Record<string, unknown>);
  }

  /** Force a state the happy path cannot reach, e.g. a terminal conflict. */
  patch(key: string, overrides: Record<string, unknown>): void {
    const current = this.item(key);
    if (current === null) throw new Error(`No record for "${key}".`);
    this.items.set(key, JSON.stringify({ ...current, ...overrides }));
  }

  private fault(operation: 'put' | 'update' | 'get'): void {
    const error = this.options.injectFault?.(operation) ?? null;
    if (error !== null) {
      this.injectedFaults += 1;
      throw error;
    }
  }

  private async send(command: unknown): Promise<unknown> {
    if (command instanceof PutCommand) return this.put(command);
    if (command instanceof UpdateCommand) return this.update(command);
    if (command instanceof GetCommand) return this.get(command);
    throw new Error('InMemoryIdempotencyTable received an unsupported command.');
  }

  private put(command: PutCommand): Record<string, never> {
    this.putAttempts += 1;
    this.fault('put');

    const input = command.input;
    if (input.TableName !== this.options.tableName) {
      throw new Error(`Unexpected table "${String(input.TableName)}".`);
    }
    if (input.ConditionExpression === undefined) {
      throw new Error('Unguarded Put on IdempotencyTable: every write must be conditional.');
    }
    this.conditionExpressions.push(input.ConditionExpression);

    const item = input.Item as Record<string, unknown>;
    const key = item.idempotency_key as string;

    if (
      !evaluateCondition(
        input.ConditionExpression,
        input.ExpressionAttributeNames,
        input.ExpressionAttributeValues,
        this.item(key) ?? undefined,
      )
    ) {
      this.rejectedWrites += 1;
      throw new ConditionalCheckFailedException({
        $metadata: {},
        message: 'The conditional request failed',
      });
    }

    this.items.set(key, JSON.stringify(item));
    return {};
  }

  private update(command: UpdateCommand): { Attributes: Record<string, unknown> } {
    this.updateAttempts += 1;
    this.fault('update');

    const input = command.input;
    if (input.ConditionExpression === undefined) {
      throw new Error('Unguarded Update on IdempotencyTable (§10.11e).');
    }
    this.conditionExpressions.push(input.ConditionExpression);

    const key = (input.Key as { idempotency_key: string }).idempotency_key;
    const current = this.item(key);

    if (
      !evaluateCondition(
        input.ConditionExpression,
        input.ExpressionAttributeNames,
        input.ExpressionAttributeValues,
        current ?? undefined,
      )
    ) {
      this.rejectedWrites += 1;
      throw new ConditionalCheckFailedException({
        $metadata: {},
        message: 'The conditional request failed',
      });
    }

    const updated = applyUpdate(
      input.UpdateExpression ?? '',
      input.ExpressionAttributeNames,
      input.ExpressionAttributeValues,
      current ?? {},
    );
    this.items.set(key, JSON.stringify(updated));
    return { Attributes: updated };
  }

  private get(command: GetCommand): { Item?: Record<string, unknown> } {
    this.fault('get');

    const input = command.input;
    if (input.ConsistentRead !== true) {
      // Every guard-confirmation read must be strongly consistent, or it could
      // miss the very write that just failed.
      throw new Error('IdempotencyTable read without ConsistentRead.');
    }
    const key = (input.Key as { idempotency_key: string }).idempotency_key;
    const item = this.item(key);
    return item === null ? {} : { Item: item };
  }
}
