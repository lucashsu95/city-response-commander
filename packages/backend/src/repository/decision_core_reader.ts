/**
 * DecisionCoreReader — strongly-consistent READ-ONLY access to DecisionCoreTable.
 *
 * Used by `RecoveryGateFn` (TASK-093) to establish `core_exists`, and by
 * `ApiReadFn` (TASK-149) to serve the read model. Both roles are read-only in
 * IAM (§18 / TASK-080, TASK-081); this type mirrors that at the software layer —
 * there is no write method to call.
 *
 * `DecisionFn` is the sole writer of this table (TASK-100) and does not use this
 * module.
 *
 * @module backend/repository/decision_core_reader
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { DecisionCore } from '@city-commander/shared-schemas';
import { ReaderUsageError, TableReadError } from './read_errors.js';

/** Construction options. The table name always comes from config. */
export interface DecisionCoreReaderOptions {
  /** DynamoDB table name, resolved via `ConfigProvider` — never hard-coded. */
  readonly tableName: string;
  /** Pre-built DocumentClient. Injected in tests; built on demand otherwise. */
  readonly documentClient?: DynamoDBDocumentClient;
  /** Low-level client used only when `documentClient` is absent. */
  readonly dynamoDbClient?: DynamoDBClient;
  /** Region for an on-demand client. Ignored when a client is supplied. */
  readonly region?: string;
}

/** Read-only view of DecisionCoreTable. */
export interface DecisionCoreReadPort {
  /** Strongly-consistent read. `null` when the core has never been committed. */
  getConsistent(decisionId: string): Promise<DecisionCore | null>;
  /** Convenience predicate for `core_exists` (§10.11e). */
  exists(decisionId: string): Promise<boolean>;
}

/**
 * DynamoDB-backed read-only DecisionCoreTable accessor.
 *
 * Every read sets `ConsistentRead: true`. Recovery decides whether to re-run
 * `DecisionFn`, so an eventually-consistent read here could rewrite an
 * immutable core (§10.11e).
 */
export class DecisionCoreReader implements DecisionCoreReadPort {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(options: DecisionCoreReaderOptions) {
    if (!options.tableName) {
      throw new ReaderUsageError(
        'DecisionCoreReader requires a "tableName" (resolved via ConfigProvider).',
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
   * @returns the committed core, or `null` when it provably does not exist
   * @throws TableReadError on any DynamoDB failure (never reported as absent)
   */
  async getConsistent(decisionId: string): Promise<DecisionCore | null> {
    if (!decisionId) {
      throw new ReaderUsageError('DecisionCoreReader requires a non-empty "decisionId".');
    }

    try {
      const result = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { decision_id: decisionId },
          ConsistentRead: true,
        }),
      );
      return (result.Item as DecisionCore | undefined) ?? null;
    } catch (error: unknown) {
      throw new TableReadError(
        `DecisionCore GetItem failed for "${decisionId}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        'DecisionCoreTable',
        'GetItem',
        decisionId,
        { cause: error },
      );
    }
  }

  /** `true` iff a DecisionCore is committed for this `decision_id`. */
  async exists(decisionId: string): Promise<boolean> {
    return (await this.getConsistent(decisionId)) !== null;
  }
}
