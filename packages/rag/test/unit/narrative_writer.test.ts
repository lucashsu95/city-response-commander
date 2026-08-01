/**
 * narrative_writer — unit tests (TASK-116)
 *
 * 驗證：
 * - putNarrative 首次寫入 → committed
 * - putNarrative 重複寫入（already_exists）→ branch_already_completed
 * - putNarrative 底層拋出 → 上拋例外（呼叫端捕捉）
 * - buildReadyEventId 格式：{decision_id}|{event_type}|{version}
 * - 三個 NarrativeType 各自對應正確的 event_type
 * - 三個並行 branch 各自只寫自己的 SK（互不覆寫）
 */

import { describe, it, expect, vi } from 'vitest';
import {
  putNarrative,
  buildReadyEventId,
  type NarrativeTableClient,
  type NarrativeItem,
} from '../../src/narrative_writer.js';
import { NarrativeType } from '@city-commander/shared-schemas';

// ─── Stub helpers ──────────────────────────────────────────────────────────

function makeClient(
  result: 'committed' | 'already_exists' | Error,
): NarrativeTableClient {
  return {
    conditionalPut: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

const REPORT_PAYLOAD = { type: 'REPORT' as const, report_text: '建議書' };
const PUBLIC_ALERT_PAYLOAD = {
  type: 'PUBLIC_ALERT' as const,
  public_alert_text: { zh: '警示' },
};
const EXPLANATION_PAYLOAD = {
  type: 'EXPLANATION' as const,
  explanation_text: '解釋',
};

// ─── putNarrative ──────────────────────────────────────────────────────────

describe('putNarrative', () => {
  it('returns committed on first write', async () => {
    const client = makeClient('committed');
    const result = await putNarrative(
      client,
      'dec-001',
      NarrativeType.REPORT,
      1,
      REPORT_PAYLOAD,
    );
    expect(result.outcome).toBe('committed');
  });

  it('returns branch_already_completed when already_exists', async () => {
    const client = makeClient('already_exists');
    const result = await putNarrative(
      client,
      'dec-001',
      NarrativeType.REPORT,
      1,
      REPORT_PAYLOAD,
    );
    expect(result.outcome).toBe('branch_already_completed');
  });

  it('propagates DDB error (non-conditional-check) to caller', async () => {
    const client = makeClient(new Error('DynamoDB error'));
    await expect(
      putNarrative(client, 'dec-001', NarrativeType.REPORT, 1, REPORT_PAYLOAD),
    ).rejects.toThrow('DynamoDB error');
  });

  it('passes correct item shape to conditionalPut', async () => {
    const client = makeClient('committed');
    await putNarrative(client, 'dec-abc', NarrativeType.PUBLIC_ALERT, 3, PUBLIC_ALERT_PAYLOAD);

    const call = (client.conditionalPut as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as NarrativeItem;
    expect(call.decision_id).toBe('dec-abc');
    expect(call.narrative_type).toBe(NarrativeType.PUBLIC_ALERT);
    expect(call.core_version_ref).toBe(3);
    expect(call.payload).toEqual(PUBLIC_ALERT_PAYLOAD);
    expect(typeof call.created_at).toBe('string');
  });

  it('three parallel branches write to distinct SK — no collision', async () => {
    const writtenItems: NarrativeItem[] = [];
    const client: NarrativeTableClient = {
      conditionalPut: vi.fn(async (item: NarrativeItem) => {
        writtenItems.push(item);
        return 'committed';
      }),
    };

    await Promise.all([
      putNarrative(client, 'dec-x', NarrativeType.REPORT, 1, REPORT_PAYLOAD),
      putNarrative(client, 'dec-x', NarrativeType.PUBLIC_ALERT, 1, PUBLIC_ALERT_PAYLOAD),
      putNarrative(client, 'dec-x', NarrativeType.EXPLANATION, 1, EXPLANATION_PAYLOAD),
    ]);

    const types = writtenItems.map((i) => i.narrative_type);
    expect(new Set(types).size).toBe(3);
  });
});

// ─── buildReadyEventId ─────────────────────────────────────────────────────

describe('buildReadyEventId', () => {
  it('REPORT → report.ready', () => {
    expect(buildReadyEventId('dec-1', NarrativeType.REPORT, 1)).toBe(
      'dec-1|report.ready|1',
    );
  });

  it('PUBLIC_ALERT → public_alert.ready', () => {
    expect(buildReadyEventId('dec-2', NarrativeType.PUBLIC_ALERT, 2)).toBe(
      'dec-2|public_alert.ready|2',
    );
  });

  it('EXPLANATION → decision.enriched (no standalone explanation.ready)', () => {
    expect(buildReadyEventId('dec-3', NarrativeType.EXPLANATION, 5)).toBe(
      'dec-3|decision.enriched|5',
    );
  });

  it('format is {decision_id}|{event_type}|{version}', () => {
    const id = buildReadyEventId('my-dec', NarrativeType.REPORT, 99);
    const parts = id.split('|');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('my-dec');
    expect(parts[2]).toBe('99');
  });

  it('ready_event_id in item matches buildReadyEventId', async () => {
    const client = makeClient('committed');
    await putNarrative(client, 'dec-match', NarrativeType.EXPLANATION, 7, EXPLANATION_PAYLOAD);

    const item = (client.conditionalPut as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as NarrativeItem;
    expect(item.ready_event_id).toBe(
      buildReadyEventId('dec-match', NarrativeType.EXPLANATION, 7),
    );
  });
});
