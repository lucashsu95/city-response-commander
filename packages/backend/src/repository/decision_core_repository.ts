/**
 * DecisionCoreRepository — the write side of DecisionCoreTable (TASK-100).
 *
 * `DecisionFn` is the SOLE writer of this table (§18 / TASK-077), and the record
 * is `immutable_after_commit` (§10.11a). Immutability is enforced by the write
 * shape itself: the only write available here is a conditional Put guarded by
 * `attribute_not_exists(decision_id)`. There is no update and no delete, so no
 * caller can overwrite a committed decision even by mistake.
 *
 * @module backend/repository/decision_core_repository
 */

import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { DecisionCore } from '@city-commander/shared-schemas';
import { DecisionCoreReader } from './decision_core_reader.js';
import type { DecisionCoreReadPort, DecisionCoreReaderOptions } from './decision_core_reader.js';
import { ReaderUsageError, TableReadError } from './read_errors.js';

/** A conditional Put on DecisionCoreTable failed because the key already exists. */
export class DecisionCoreAlreadyExistsError extends Error {
  constructor(
    public readonly decisionId: string,
    options?: { cause?: unknown },
  ) {
    super(
      `DecisionCore already exists for "${decisionId}". Classify the identity before continuing ` +
        '(ALREADY_COMMITTED_SAME_DECISION vs CORE_IDENTITY_CONFLICT, §15.2).',
      options,
    );
    this.name = 'DecisionCoreAlreadyExistsError';
  }
}

/** Read + conditional-write access to DecisionCoreTable. */
export interface DecisionCorePort extends DecisionCoreReadPort {
  /**
   * Immutable first write.
   *
   * @throws DecisionCoreAlreadyExistsError when a core already exists for the key
   * @throws TableReadError on any other DynamoDB failure
   */
  conditionalPutNew(core: DecisionCore): Promise<DecisionCore>;
}

/**
 * DynamoDB-backed DecisionCoreTable repository.
 *
 * Extends the read-only reader so a single instance serves both the write and
 * the strongly-consistent identity re-read that follows a failed Put.
 */
export class DecisionCoreRepository extends DecisionCoreReader implements DecisionCorePort {
  private readonly table: string;
  private readonly documentClient: DynamoDBDocumentClient;

  constructor(options: DecisionCoreReaderOptions) {
    super(options);
    this.table = options.tableName;
    this.documentClient =
      options.documentClient ??
      DynamoDBDocumentClient.from(
        options.dynamoDbClient ??
          new DynamoDBClient(options.region ? { region: options.region } : {}),
        { marshallOptions: { removeUndefinedValues: true } },
      );
  }

  async conditionalPutNew(core: DecisionCore): Promise<DecisionCore> {
    if (!core.decision_id) {
      throw new ReaderUsageError('DecisionCore requires a non-empty "decision_id".');
    }

    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.table,
          Item: core,
          // Single-argument form only. This is the immutability guarantee.
          ConditionExpression: 'attribute_not_exists(#pk)',
          ExpressionAttributeNames: { '#pk': 'decision_id' },
        }),
      );
      return core;
    } catch (error: unknown) {
      const name = (error as { name?: unknown } | null)?.name;
      if (
        error instanceof ConditionalCheckFailedException ||
        name === 'ConditionalCheckFailedException'
      ) {
        throw new DecisionCoreAlreadyExistsError(core.decision_id, { cause: error });
      }
      throw new TableReadError(
        `DecisionCore Put failed for "${core.decision_id}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        'DecisionCoreTable',
        'GetItem',
        core.decision_id,
        { cause: error },
      );
    }
  }
}
