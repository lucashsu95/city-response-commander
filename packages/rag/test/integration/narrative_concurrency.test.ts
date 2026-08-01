/**
 * Narrative concurrency integration test (TASK-120, step 3)
 *
 * 驗證：
 * - 三個 branch（REPORT / PUBLIC_ALERT / EXPLANATION）並行執行不互相覆寫
 * - 重複 put（re-put）→ branch_already_completed（at-least-once 安全）
 * - enriched gate：{REPORT, PUBLIC_ALERT, EXPLANATION} 全部 committed/already_completed
 *   才算 enriched
 * - 使用 InMemoryNarrativeStore（無實際 DDB 呼叫）
 */

import { describe, it, expect, vi } from 'vitest';
import {
  putNarrative,
  buildReadyEventId,
  type NarrativeTableClient,
  type NarrativeItem,
} from '../../src/narrative_writer.js';
import { composeReport } from '../../src/report_composer.js';
import { composePublicAlert } from '../../src/public_alert_composer.js';
import { composeExplanation } from '../../src/explanation_composer.js';
import { NarrativeType } from '@city-commander/shared-schemas';
import type { BedrockInvoker, BedrockResult } from '../../src/bedrock_adapter.js';
import type { DecisionCore } from '@city-commander/shared-schemas';
import type { SopCitationResult } from '../../src/sop_retriever.js';

// ─── InMemoryNarrativeStore ────────────────────────────────────────────────

/**
 * 輕量 in-memory store，模擬 DynamoDB 的 conditional Put 語意：
 * - 同 (decision_id, narrative_type) 只允許寫入一次
 * - 重複 put → 'already_exists'
 * - 不同 narrative_type 互不干擾（模擬複合主鍵）
 */
class InMemoryNarrativeStore implements NarrativeTableClient {
  private readonly store = new Map<string, NarrativeItem>();

  conditionalPut(item: NarrativeItem): Promise<'committed' | 'already_exists'> {
    const key = `${item.decision_id}|${item.narrative_type}`;
    if (this.store.has(key)) {
      return Promise.resolve('already_exists');
    }
    this.store.set(key, item);
    return Promise.resolve('committed');
  }

  getItem(decisionId: string, narrativeType: NarrativeType): NarrativeItem | undefined {
    return this.store.get(`${decisionId}|${narrativeType}`);
  }

  allItems(): NarrativeItem[] {
    return [...this.store.values()];
  }
}

// ─── Enriched gate helper ─────────────────────────────────────────────────

/**
 * 模擬 TASK-119 decision.enriched gate 邏輯：
 * 三個 narrative item 都必須存在（committed 或 already_completed）才算 enriched。
 *
 * 注意：TASK-119 的完整後端實作在 packages/backend/src/realtime/，
 * 此處 inline 實作其核心判斷邏輯，用於驗證 enriched gate 的正確性。
 */
function isEnriched(
  store: InMemoryNarrativeStore,
  decisionId: string,
): boolean {
  const required = [NarrativeType.REPORT, NarrativeType.PUBLIC_ALERT, NarrativeType.EXPLANATION];
  return required.every((t) => store.getItem(decisionId, t) !== undefined);
}

// ─── Stub helpers ──────────────────────────────────────────────────────────

function makeCore(decisionId = 'dec-conc-001'): DecisionCore {
  return {
    decision_id: decisionId,
    version: 1,
    event_id: 'ACC_001',
    occurred_at: '2026-05-20 22:10',
    primary_evacuation: 'RD_TPE_004',
    secondary_evacuation: [],
    triggered_articles: [1, 2],
    applied_formula_articles: [7],
    invoked_procedures: [],
    classifications: [],
    excluded_candidates: [],
    multilingual_required: true,
    ete: undefined,
    evidence: {
      decision_id: decisionId,
      classification_reasoning: [],
      excluded_routes: [],
      sop_citations: [],
      data_points: [],
    },
    idempotency_key: 'k',
    injection_run_id: 'inj',
    core_hash: 'h',
    source_manifest_hash: 'sh',
    immutable_after_commit: true,
    cms_core_text: '光復南路封閉，請改道 市民大道四段，預計延誤 78 分鐘',
    provisional: false,
    schema_version: '1.0.0',
    policy: {} as DecisionCore['policy'],
  } as unknown as DecisionCore;
}

const CITATIONS: readonly SopCitationResult[] = [
  { article_no: 2, content: 'SOP 2', source_location: 's3://b/sop/article-2.json', relevancy_score: null, source: 's3_fallback' },
];

function makeBedrockFailure(): BedrockInvoker {
  return {
    invoke: vi.fn(async (): Promise<BedrockResult> => ({
      outcome: 'use_template', reason: 'timeout', message: 'timed out',
    })),
  };
}

// ─── Three branches concurrent, no cross-overwrite ───────────────────────

describe('Narrative concurrency — three parallel branches', () => {
  it('three concurrent branches commit to distinct SK, no overwrite', async () => {
    const store = new InMemoryNarrativeStore();
    const core = makeCore();
    const bedrock = makeBedrockFailure();

    // 三個 branch 並行
    await Promise.all([
      composeReport({ core, citations: CITATIONS, narrativeClient: store, bedrockInvoker: bedrock }),
      composePublicAlert({ core, bonusLanguagesEnabled: false, narrativeClient: store, bedrockInvoker: bedrock }),
      composeExplanation({ core, citations: CITATIONS, narrativeClient: store, bedrockInvoker: bedrock }),
    ]);

    const items = store.allItems();
    expect(items).toHaveLength(3);

    const types = items.map((i) => i.narrative_type);
    expect(types).toContain(NarrativeType.REPORT);
    expect(types).toContain(NarrativeType.PUBLIC_ALERT);
    expect(types).toContain(NarrativeType.EXPLANATION);

    // 每個 narrative_type 只有一筆（無重複覆寫）
    expect(new Set(types).size).toBe(3);
  });

  it('all three share same decision_id', async () => {
    const store = new InMemoryNarrativeStore();
    const core = makeCore('dec-shared');
    const bedrock = makeBedrockFailure();

    await Promise.all([
      composeReport({ core, citations: [], narrativeClient: store, bedrockInvoker: bedrock }),
      composePublicAlert({ core, bonusLanguagesEnabled: false, narrativeClient: store, bedrockInvoker: bedrock }),
      composeExplanation({ core, citations: [], narrativeClient: store, bedrockInvoker: bedrock }),
    ]);

    for (const item of store.allItems()) {
      expect(item.decision_id).toBe('dec-shared');
    }
  });
});

// ─── Re-put → branch_already_completed ───────────────────────────────────

describe('Narrative concurrency — re-put idempotency', () => {
  it('re-put REPORT → branch_already_completed, not overwrite', async () => {
    const store = new InMemoryNarrativeStore();
    const core = makeCore();
    const bedrock = makeBedrockFailure();
    const input = { core, citations: [], narrativeClient: store, bedrockInvoker: bedrock };

    const first = await composeReport(input);
    const second = await composeReport(input);

    expect(first.outcome).toBe('committed');
    expect(second.outcome).toBe('branch_already_completed');
    // 只寫了一筆
    expect(store.allItems().filter((i) => i.narrative_type === NarrativeType.REPORT)).toHaveLength(1);
  });

  it('re-put all three branches → each returns branch_already_completed', async () => {
    const store = new InMemoryNarrativeStore();
    const core = makeCore();
    const bedrock = makeBedrockFailure();

    // 第一輪
    await Promise.all([
      composeReport({ core, citations: [], narrativeClient: store, bedrockInvoker: bedrock }),
      composePublicAlert({ core, bonusLanguagesEnabled: false, narrativeClient: store, bedrockInvoker: bedrock }),
      composeExplanation({ core, citations: [], narrativeClient: store, bedrockInvoker: bedrock }),
    ]);

    // 第二輪（模擬 Lambda 重試）
    const [r2, pa2, ex2] = await Promise.all([
      composeReport({ core, citations: [], narrativeClient: store, bedrockInvoker: bedrock }),
      composePublicAlert({ core, bonusLanguagesEnabled: false, narrativeClient: store, bedrockInvoker: bedrock }),
      composeExplanation({ core, citations: [], narrativeClient: store, bedrockInvoker: bedrock }),
    ]);

    expect(r2.outcome).toBe('branch_already_completed');
    expect(pa2.outcome).toBe('branch_already_completed');
    expect(ex2.outcome).toBe('branch_already_completed');
    // 仍然只有 3 筆
    expect(store.allItems()).toHaveLength(3);
  });

  it('putNarrative directly: re-put same (decision_id, narrative_type) → branch_already_completed', async () => {
    const store = new InMemoryNarrativeStore();
    const payload = { type: 'REPORT' as const, report_text: '建議書' };

    const r1 = await putNarrative(store, 'dec-1', NarrativeType.REPORT, 1, payload);
    const r2 = await putNarrative(store, 'dec-1', NarrativeType.REPORT, 1, payload);

    expect(r1.outcome).toBe('committed');
    expect(r2.outcome).toBe('branch_already_completed');
  });

  it('different decision_id → each gets its own item (no collision)', async () => {
    const store = new InMemoryNarrativeStore();
    const payload = { type: 'REPORT' as const, report_text: '建議書' };

    await putNarrative(store, 'dec-A', NarrativeType.REPORT, 1, payload);
    await putNarrative(store, 'dec-B', NarrativeType.REPORT, 1, payload);

    expect(store.allItems()).toHaveLength(2);
  });
});

// ─── Enriched gate ────────────────────────────────────────────────────────

describe('Enriched gate — decision.enriched only after all three committed', () => {
  it('not enriched before all three branches complete', async () => {
    const store = new InMemoryNarrativeStore();
    const core = makeCore();
    const bedrock = makeBedrockFailure();

    // 只寫 REPORT
    await composeReport({ core, citations: [], narrativeClient: store, bedrockInvoker: bedrock });
    expect(isEnriched(store, core.decision_id)).toBe(false);

    // 加 PUBLIC_ALERT
    await composePublicAlert({ core, bonusLanguagesEnabled: false, narrativeClient: store, bedrockInvoker: bedrock });
    expect(isEnriched(store, core.decision_id)).toBe(false);

    // 加 EXPLANATION → 全部完成
    await composeExplanation({ core, citations: [], narrativeClient: store, bedrockInvoker: bedrock });
    expect(isEnriched(store, core.decision_id)).toBe(true);
  });

  it('ready_event_id for EXPLANATION contains decision.enriched', async () => {
    const store = new InMemoryNarrativeStore();
    const core = makeCore();
    const bedrock = makeBedrockFailure();

    const result = await composeExplanation({
      core,
      citations: [],
      narrativeClient: store,
      bedrockInvoker: bedrock,
    });

    // composeExplanation 在 DDB 正常時不會回傳 'failed'
    expect(result.outcome).not.toBe('failed');
    expect(result.ready_event_id).toContain('decision.enriched');
    expect(result.ready_event_id).not.toContain('explanation.ready');
  });

  it('enriched gate uses ready_event_id dedup', async () => {
    const store = new InMemoryNarrativeStore();
    const core = makeCore('dec-dedup');
    const bedrock = makeBedrockFailure();

    const [r, pa, ex] = await Promise.all([
      composeReport({ core, citations: [], narrativeClient: store, bedrockInvoker: bedrock }),
      composePublicAlert({ core, bonusLanguagesEnabled: false, narrativeClient: store, bedrockInvoker: bedrock }),
      composeExplanation({ core, citations: [], narrativeClient: store, bedrockInvoker: bedrock }),
    ]);

    // 每個 item 的 ready_event_id 包含 decision_id 保證 dedup
    expect(r.outcome).not.toBe('failed');
    expect(pa.outcome).not.toBe('failed');
    expect(ex.outcome).not.toBe('failed');

    if (r.outcome !== 'failed') expect(r.ready_event_id).toContain('dec-dedup');
    if (pa.outcome !== 'failed') expect(pa.ready_event_id).toContain('dec-dedup');

    // EXPLANATION 的 ready_event_id 透過 decision.enriched 發出
    if (ex.outcome !== 'failed') {
      expect(ex.ready_event_id).toBe(
        buildReadyEventId('dec-dedup', NarrativeType.EXPLANATION, core.version),
      );
      expect(ex.ready_event_id).toContain('decision.enriched');
    }
  });
});
