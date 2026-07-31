/**
 * TASK-093 support — DecisionCoreReader / DecisionNarrativeReader unit tests.
 *
 * The two properties these readers exist to guarantee:
 *  1. every read sets `ConsistentRead: true` (§10.11e);
 *  2. the narrative query never touches an index (`IndexName` absent) — a GSI is
 *     eventually consistent and would let recovery see a false gap.
 */

import { describe, it, expect, vi } from 'vitest';
import { NarrativeType } from '@city-commander/shared-schemas';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  DecisionCoreReader,
  DecisionNarrativeReader,
  ReaderUsageError,
  TableReadError,
} from '../../src/index.js';

const CORE_TABLE = 'city-commander-LOCAL_MOCK-DecisionCoreTable';
const NARRATIVE_TABLE = 'city-commander-LOCAL_MOCK-DecisionNarrativeTable';
const DECISION = 'DEC_ACC_001';

type SendMock = ReturnType<typeof vi.fn>;

function createMockDocumentClient(): { client: DynamoDBDocumentClient; send: SendMock } {
  const send = vi.fn();
  return { client: { send } as unknown as DynamoDBDocumentClient, send };
}

function inputOf(send: SendMock, callIndex = 0): Record<string, unknown> {
  return send.mock.calls[callIndex][0].input as Record<string, unknown>;
}

describe('DecisionCoreReader', () => {
  it('requires a table name', () => {
    const { client } = createMockDocumentClient();

    expect(() => new DecisionCoreReader({ tableName: '', documentClient: client })).toThrow(
      ReaderUsageError,
    );
  });

  it('reads with ConsistentRead: true', async () => {
    const { client, send } = createMockDocumentClient();
    send.mockResolvedValue({ Item: { decision_id: DECISION } });
    const reader = new DecisionCoreReader({ tableName: CORE_TABLE, documentClient: client });

    await reader.getConsistent(DECISION);

    const input = inputOf(send);
    expect(input.ConsistentRead).toBe(true);
    expect(input.TableName).toBe(CORE_TABLE);
    expect(input.Key).toEqual({ decision_id: DECISION });
  });

  it('returns the committed core', async () => {
    const { client, send } = createMockDocumentClient();
    send.mockResolvedValue({ Item: { decision_id: DECISION, core_hash: 'abc' } });
    const reader = new DecisionCoreReader({ tableName: CORE_TABLE, documentClient: client });

    const result = await reader.getConsistent(DECISION);

    expect(result?.decision_id).toBe(DECISION);
  });

  it('returns null when the core is absent', async () => {
    const { client, send } = createMockDocumentClient();
    send.mockResolvedValue({});
    const reader = new DecisionCoreReader({ tableName: CORE_TABLE, documentClient: client });

    expect(await reader.getConsistent(DECISION)).toBeNull();
  });

  it('exists() reflects presence and absence', async () => {
    const { client, send } = createMockDocumentClient();
    const reader = new DecisionCoreReader({ tableName: CORE_TABLE, documentClient: client });

    send.mockResolvedValueOnce({ Item: { decision_id: DECISION } });
    expect(await reader.exists(DECISION)).toBe(true);

    send.mockResolvedValueOnce({});
    expect(await reader.exists(DECISION)).toBe(false);
  });

  it('throws TableReadError instead of reporting absence on failure', async () => {
    const { client, send } = createMockDocumentClient();
    send.mockRejectedValue(new Error('Throughput exceeded'));
    const reader = new DecisionCoreReader({ tableName: CORE_TABLE, documentClient: client });

    const error = await reader.getConsistent(DECISION).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TableReadError);
    expect((error as TableReadError).table).toBe('DecisionCoreTable');
    expect((error as TableReadError).operation).toBe('GetItem');
  });

  it('rejects an empty decisionId', async () => {
    const { client, send } = createMockDocumentClient();
    const reader = new DecisionCoreReader({ tableName: CORE_TABLE, documentClient: client });

    await expect(reader.getConsistent('')).rejects.toBeInstanceOf(ReaderUsageError);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('DecisionNarrativeReader', () => {
  it('requires a table name', () => {
    const { client } = createMockDocumentClient();

    expect(() => new DecisionNarrativeReader({ tableName: '', documentClient: client })).toThrow(
      ReaderUsageError,
    );
  });

  it('queries the base table with ConsistentRead and no IndexName', async () => {
    const { client, send } = createMockDocumentClient();
    send.mockResolvedValue({ Items: [] });
    const reader = new DecisionNarrativeReader({
      tableName: NARRATIVE_TABLE,
      documentClient: client,
    });

    await reader.queryConsistent(DECISION);

    const input = inputOf(send);
    expect(input.ConsistentRead).toBe(true);
    expect(input.TableName).toBe(NARRATIVE_TABLE);
    expect(input.IndexName).toBeUndefined();
    expect(input.KeyConditionExpression).toBe('#pk = :pk');
    expect(input.ExpressionAttributeNames).toEqual({ '#pk': 'decision_id' });
    expect(input.ExpressionAttributeValues).toEqual({ ':pk': DECISION });
  });

  it('returns every narrative item', async () => {
    const { client, send } = createMockDocumentClient();
    send.mockResolvedValue({
      Items: [
        { decision_id: DECISION, narrative_type: NarrativeType.REPORT },
        { decision_id: DECISION, narrative_type: NarrativeType.EXPLANATION },
      ],
    });
    const reader = new DecisionNarrativeReader({
      tableName: NARRATIVE_TABLE,
      documentClient: client,
    });

    const items = await reader.queryConsistent(DECISION);

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.narrative_type)).toEqual([
      NarrativeType.REPORT,
      NarrativeType.EXPLANATION,
    ]);
  });

  it('follows pagination to completion', async () => {
    const { client, send } = createMockDocumentClient();
    send
      .mockResolvedValueOnce({
        Items: [{ decision_id: DECISION, narrative_type: NarrativeType.REPORT }],
        LastEvaluatedKey: { decision_id: DECISION, narrative_type: NarrativeType.REPORT },
      })
      .mockResolvedValueOnce({
        Items: [{ decision_id: DECISION, narrative_type: NarrativeType.PUBLIC_ALERT }],
      });
    const reader = new DecisionNarrativeReader({
      tableName: NARRATIVE_TABLE,
      documentClient: client,
    });

    const items = await reader.queryConsistent(DECISION);

    expect(send).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(2);
    expect(inputOf(send, 1).ExclusiveStartKey).toEqual({
      decision_id: DECISION,
      narrative_type: NarrativeType.REPORT,
    });
  });

  it('returns an empty list when no narratives exist', async () => {
    const { client, send } = createMockDocumentClient();
    send.mockResolvedValue({});
    const reader = new DecisionNarrativeReader({
      tableName: NARRATIVE_TABLE,
      documentClient: client,
    });

    expect(await reader.queryConsistent(DECISION)).toEqual([]);
  });

  it('throws TableReadError instead of reporting an empty result on failure', async () => {
    const { client, send } = createMockDocumentClient();
    send.mockRejectedValue(new Error('Network unreachable'));
    const reader = new DecisionNarrativeReader({
      tableName: NARRATIVE_TABLE,
      documentClient: client,
    });

    const error = await reader.queryConsistent(DECISION).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TableReadError);
    expect((error as TableReadError).table).toBe('DecisionNarrativeTable');
    expect((error as TableReadError).operation).toBe('Query');
  });

  it('rejects an empty decisionId', async () => {
    const { client, send } = createMockDocumentClient();
    const reader = new DecisionNarrativeReader({
      tableName: NARRATIVE_TABLE,
      documentClient: client,
    });

    await expect(reader.queryConsistent('')).rejects.toBeInstanceOf(ReaderUsageError);
    expect(send).not.toHaveBeenCalled();
  });
});
