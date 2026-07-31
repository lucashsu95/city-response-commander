/**
 * DecisionNarrativeReader — strongly-consistent READ-ONLY access to
 * DecisionNarrativeTable (PK `decision_id` + SK `narrative_type`).
 *
 * Two hard constraints from design §10.11e / §18:
 *
 *  1. **Base table only.** `IndexName` is never set. A GSI is eventually
 *     consistent and `ConsistentRead` is not even supported on one, so using an
 *     index here could report a narrative as missing and trigger a duplicate
 *     Bedrock branch. This module has no way to express an index query.
 *  2. **Read-only.** `RecoveryGateFn` has zero DynamoDB write permission
 *     (TASK-080); `RendererFn` is the only writer, one conditional Put per
 *     `narrative_type` item (TASK-116).
 *
 * @module backend/repository/decision_narrative_reader
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { NarrativeType } from '@city-commander/shared-schemas';
import type { DecisionNarrative } from '@city-commander/shared-schemas';
import { ReaderUsageError, TableReadError } from './read_errors.js';

/**
 * The required narrative set, in a stable order.
 *
 * `decision.enriched` is emitted only once all three are committed (§10.11b,
 * TASK-119), so this set defines completeness for enrichment recovery.
 */
export const REQUIRED_NARRATIVE_TYPES: readonly NarrativeType[] = [
  NarrativeType.REPORT,
  NarrativeType.PUBLIC_ALERT,
  NarrativeType.EXPLANATION,
];

/** Construction options. The table name always comes from config. */
export interface DecisionNarrativeReaderOptions {
  /** DynamoDB table name, resolved via `ConfigProvider` — never hard-coded. */
  readonly tableName: string;
  /** Pre-built DocumentClient. Injected in tests; built on demand otherwise. */
  readonly documentClient?: DynamoDBDocumentClient;
  /** Low-level client used only when `documentClient` is absent. */
  readonly dynamoDbClient?: DynamoDBClient;
  /** Region for an on-demand client. Ignored when a client is supplied. */
  readonly region?: string;
}

/** Read-only view of DecisionNarrativeTable. */
export interface DecisionNarrativeReadPort {
  /** All narrative items for a decision, strongly consistent, base table only. */
  queryConsistent(decisionId: string): Promise<readonly DecisionNarrative[]>;
}

/**
 * DynamoDB-backed read-only DecisionNarrativeTable accessor.
 *
 * Pagination is followed to completion: a truncated page would understate the
 * narratives present and cause a redundant Bedrock branch on recovery.
 */
export class DecisionNarrativeReader implements DecisionNarrativeReadPort {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(options: DecisionNarrativeReaderOptions) {
    if (!options.tableName) {
      throw new ReaderUsageError(
        'DecisionNarrativeReader requires a "tableName" (resolved via ConfigProvider).',
      );
    }
    this.tableName = options.tableName;
    this.client =
      options.documentClient ??
      DynamoDBDocumentClient.from(
        options.dynamoDbClient ??
          new DynamoDBClient(options.region ? { region: options.region } : {}),
        { marshallOptions: { removeUndefinedValues: true } },
      );
  }

  /**
   * Query every `narrative_type` item for a decision.
   *
   * @returns the items present (possibly empty); never `null`
   * @throws TableReadError on any DynamoDB failure (never reported as empty)
   */
  async queryConsistent(decisionId: string): Promise<readonly DecisionNarrative[]> {
    if (!decisionId) {
      throw new ReaderUsageError('DecisionNarrativeReader requires a non-empty "decisionId".');
    }

    const items: DecisionNarrative[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    try {
      do {
        const result = await this.client.send(
          new QueryCommand({
            TableName: this.tableName,
            // No IndexName: base table only (§10.11e).
            KeyConditionExpression: '#pk = :pk',
            ExpressionAttributeNames: { '#pk': 'decision_id' },
            ExpressionAttributeValues: { ':pk': decisionId },
            ConsistentRead: true,
            ExclusiveStartKey: exclusiveStartKey,
          }),
        );

        for (const item of result.Items ?? []) {
          items.push(item as DecisionNarrative);
        }
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey !== undefined);
    } catch (error: unknown) {
      throw new TableReadError(
        `DecisionNarrative Query failed for "${decisionId}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        'DecisionNarrativeTable',
        'Query',
        decisionId,
        { cause: error },
      );
    }

    return items;
  }
}

/**
 * Split the required narrative set into what exists and what is still missing.
 *
 * Both lists follow {@link REQUIRED_NARRATIVE_TYPES} order, so results are
 * deterministic regardless of DynamoDB item order. Unknown `narrative_type`
 * values are ignored rather than treated as satisfying a requirement.
 */
export function splitNarrativeTypes(narratives: readonly DecisionNarrative[]): {
  readonly existing: readonly NarrativeType[];
  readonly missing: readonly NarrativeType[];
} {
  const present = new Set(narratives.map((narrative) => narrative.narrative_type));
  return {
    existing: REQUIRED_NARRATIVE_TYPES.filter((type) => present.has(type)),
    missing: REQUIRED_NARRATIVE_TYPES.filter((type) => !present.has(type)),
  };
}
