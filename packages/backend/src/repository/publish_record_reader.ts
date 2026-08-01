/**
 * PublishRecordReader — READ-ONLY access to PublishRecordTable (TASK-149).
 *
 * `ApiReadFn` merges publish state into the read model but must never write it:
 * `PublishFn` is the sole writer (§18 / TASK-082), and `publish_state` is never
 * written back to the immutable DecisionCore (§10.11d). This type exposes reads
 * only, so the software layer mirrors that split.
 *
 * Publish state is mutable, so unlike the recovery path this read does not need
 * strong consistency — but it uses it anyway, because the read model shows
 * publish state next to a just-committed decision and an eventually-consistent
 * read would make the Dashboard flicker between draft and published.
 *
 * @module backend/repository/publish_record_reader
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { PublishRecord } from '@city-commander/shared-schemas';
import { ReaderUsageError } from './read_errors.js';

/** Construction options. The table name always comes from config. */
export interface PublishRecordReaderOptions {
  readonly tableName: string;
  readonly documentClient?: DynamoDBDocumentClient;
  readonly dynamoDbClient?: DynamoDBClient;
  readonly region?: string;
}

/** Read-only view of PublishRecordTable. */
export interface PublishRecordReadPort {
  /** `null` when the decision has never entered the publish flow. */
  getConsistent(decisionId: string): Promise<PublishRecord | null>;
}

/** A publish-state read failed. */
export class PublishRecordReadError extends Error {
  constructor(
    message: string,
    public readonly decisionId: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PublishRecordReadError';
  }
}

/** DynamoDB-backed read-only PublishRecordTable accessor. */
export class PublishRecordReader implements PublishRecordReadPort {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(options: PublishRecordReaderOptions) {
    if (!options.tableName) {
      throw new ReaderUsageError(
        'PublishRecordReader requires a "tableName" (resolved via ConfigProvider).',
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
   * @returns the publish record, or `null` when the decision is unpublished
   * @throws PublishRecordReadError on any DynamoDB failure (never reported as absent)
   */
  async getConsistent(decisionId: string): Promise<PublishRecord | null> {
    if (!decisionId) {
      throw new ReaderUsageError('PublishRecordReader requires a non-empty "decisionId".');
    }

    try {
      const result = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { decision_id: decisionId },
          ConsistentRead: true,
        }),
      );
      return (result.Item as PublishRecord | undefined) ?? null;
    } catch (error: unknown) {
      throw new PublishRecordReadError(
        `PublishRecord GetItem failed for "${decisionId}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        decisionId,
        { cause: error },
      );
    }
  }
}
