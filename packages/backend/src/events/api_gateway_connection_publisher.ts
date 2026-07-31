/**
 * API Gateway WebSocket transport for realtime pushes (§4.5, §13; TASK-103).
 *
 * Implements {@link ConnectionPublisherPort} with the AWS reference pattern:
 * connection ids live in a DynamoDB `connections` table (PK `connectionId`,
 * TTL), and each push is an `ApiGatewayManagementApi.PostToConnection`.
 *
 * `PostToConnection` is granted only to the Ws roles (§18 / TASK-083); every
 * other role is explicitly denied, which is why realtime push lives in its own
 * module rather than inside `DecisionFn`.
 *
 * @module backend/events/api_gateway_connection_publisher
 */

import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ReaderUsageError } from '../repository/read_errors.js';
import type { ConnectionPublisherPort } from './publish_fast_path_ready.js';

/** Construction options. Endpoint and table name always come from config. */
export interface ApiGatewayConnectionPublisherOptions {
  /** `connections` table name (§4.5). From `ConfigProvider`, never hard-coded. */
  readonly connectionsTableName: string;
  /** `ws.endpoint` management endpoint. From `ConfigProvider`. */
  readonly managementEndpoint: string;
  readonly documentClient?: DynamoDBDocumentClient;
  readonly dynamoDbClient?: DynamoDBClient;
  readonly managementClient?: ApiGatewayManagementApiClient;
  readonly region?: string;
}

/**
 * DynamoDB + API Gateway Management implementation of the publisher port.
 *
 * The connection list is a `Scan`, which is correct here and only here: the table
 * holds one row per live Dashboard connection (single digits in a demo), the
 * access pattern is genuinely "all of them", and there is no partition key to
 * query by. Pagination is followed so a broadcast never silently reaches a subset.
 */
export class ApiGatewayConnectionPublisher implements ConnectionPublisherPort {
  private readonly connectionsTableName: string;
  private readonly documentClient: DynamoDBDocumentClient;
  private readonly managementClient: ApiGatewayManagementApiClient;

  constructor(options: ApiGatewayConnectionPublisherOptions) {
    if (!options.connectionsTableName) {
      throw new ReaderUsageError(
        'ApiGatewayConnectionPublisher requires a "connectionsTableName" (via ConfigProvider).',
      );
    }
    if (!options.managementEndpoint && options.managementClient === undefined) {
      throw new ReaderUsageError(
        'ApiGatewayConnectionPublisher requires a "managementEndpoint" (via ConfigProvider).',
      );
    }

    this.connectionsTableName = options.connectionsTableName;
    this.documentClient =
      options.documentClient ??
      DynamoDBDocumentClient.from(
        options.dynamoDbClient ??
          new DynamoDBClient(options.region ? { region: options.region } : {}),
        { marshallOptions: { removeUndefinedValues: true } },
      );
    this.managementClient =
      options.managementClient ??
      new ApiGatewayManagementApiClient({
        endpoint: options.managementEndpoint,
        ...(options.region ? { region: options.region } : {}),
      });
  }

  async listConnectionIds(): Promise<readonly string[]> {
    const ids: string[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.documentClient.send(
        new ScanCommand({
          TableName: this.connectionsTableName,
          ProjectionExpression: '#id',
          ExpressionAttributeNames: { '#id': 'connectionId' },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      for (const item of result.Items ?? []) {
        const id = (item as { connectionId?: unknown }).connectionId;
        if (typeof id === 'string' && id.length > 0) ids.push(id);
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey !== undefined);

    return ids;
  }

  async postToConnection(connectionId: string, payload: string): Promise<void> {
    await this.managementClient.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: new TextEncoder().encode(payload),
      }),
    );
  }
}
