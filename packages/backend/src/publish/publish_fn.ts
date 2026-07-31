/**
 * PublishFn handler — POST /decisions/{id}/publish (TASK-144)
 *
 * 職責（§12, §17, §10.11d）：
 * - 接收 API Gateway HTTP event，從 Cognito JWT 確認 commander 身份
 * - 唯讀讀取 DecisionCore / DecisionNarrative（不寫入）
 * - 驗證 decision 是否處於可發布狀態（core_committed）
 * - 委派狀態轉移給 publish state machine（TASK-145）
 * - **零寫入** DecisionCoreTable / DecisionNarrativeTable / IdempotencyTable
 * - non-commander → fail-closed 403
 *
 * IAM 邊界（PublishFnRole, §18）：
 * - 唯讀：DecisionCoreTable、DecisionNarrativeTable
 * - 寫入：PublishRecordTable（sole writer）
 * - 明確 Deny：對 DecisionCoreTable 任何寫入（PutItem/UpdateItem/DeleteItem）
 *
 * 本 handler 永遠掛載在專屬 PublishFn Lambda；
 * **不**與 RendererFn / ApiReadFn / DecisionFn / WhatIfFn 共用。
 *
 * @module backend/publish/publish_fn
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { PublishRecord } from '@city-commander/shared-schemas';
import { PublishStatus, SCHEMA_VERSION } from '@city-commander/shared-schemas';
import {
  isLegalPublishTransition,
  inferNextPublishState,
  allowedNextStates,
} from './publish_transitions.js';
import { appendAuditEntry } from './audit_trail.js';
import { checkPublishIdempotency, shouldEmitPublicAlertReady } from './publish_idempotency.js';

// ─── Publish result type ──────────────────────────────────────────────────────

/**
 * PublishFn 的 handler 依賴注入介面。
 *
 * 生產時由 Lambda 初始化程式碼注入 AWS SDK 實作；
 * 測試時注入 stub 實作，完全不觸碰 DynamoDB。
 */
export interface PublishFnDependencies {
  /**
   * 以 decision_id 讀取 DecisionCore，確認 core_committed 狀態。
   * **只能讀取，不可寫入。**
   *
   * @returns `{ core_committed: boolean; exists: boolean }` 或 null（item 不存在）
   */
  readonly readDecisionCoreStatus: (decisionId: string) => Promise<{
    readonly exists: boolean;
    readonly core_committed: boolean;
  }>;

  /**
   * 讀取現有 PublishRecord（如果存在）。
   * 用於取得 optimistic lock version 和目前 publish_state。
   *
   * @returns PublishRecord 或 null（尚未建立 publish record）
   */
  readonly readPublishRecord: (decisionId: string) => Promise<PublishRecord | null>;

  /**
   * 寫入（新建或更新）PublishRecord。
   * 委派實作 publish state machine（TASK-145 的邏輯）。
   *
   * **此函式為 PublishFn 對 PublishRecordTable 的唯一寫入路徑。**
   *
   * @param record - 要寫入的 PublishRecord（含完整 audit_trail）
   * @param expectedVersion - 樂觀鎖版本（0 表示首次建立）
   * @returns 寫入結果
   */
  readonly writePublishRecord: (
    record: PublishRecord,
    expectedVersion: number,
  ) => Promise<WritePublishRecordResult>;
}

/** writePublishRecord 的回傳結果 */
export type WritePublishRecordResult =
  | { readonly success: true; readonly record: PublishRecord }
  | { readonly success: false; readonly reason: 'VERSION_CONFLICT' | 'ILLEGAL_TRANSITION' | 'INTERNAL_ERROR'; readonly message: string };

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

const JSON_CONTENT_TYPE = 'application/json';

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': JSON_CONTENT_TYPE },
    body: JSON.stringify(body),
  };
}

function errorResponse(
  statusCode: number,
  errorCode: string,
  message: string,
): APIGatewayProxyResultV2 {
  return jsonResponse(statusCode, { error_code: errorCode, message });
}

// ─── Cognito commander authorization ──────────────────────────────────────────

/**
 * 指揮官 Cognito group 名稱。
 * 只有此 group 的使用者才能執行一鍵發布。
 */
const COMMANDER_GROUP = 'commanders';

/**
 * 從 Cognito JWT claims 確認 commander 身份（§17, §18）。
 *
 * 驗證邏輯：
 * 1. JWT claims 必須存在（API Gateway authorizer 已設定）
 * 2. `sub` 必須非空（token 已通過 JWT 驗證）
 * 3. `cognito:groups` 必須包含 `commanders` group
 *
 * @returns `{ authorized: true; actor: string }` 或 `{ authorized: false }`
 */
function authorizeCommander(event: APIGatewayProxyEventV2):
  | { readonly authorized: true; readonly actor: string }
  | { readonly authorized: false } {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return { authorized: false };

  const sub = typeof claims['sub'] === 'string' ? claims['sub'].trim() : '';
  if (sub.length === 0) return { authorized: false };

  const rawGroups = claims['cognito:groups'];
  let inCommanderGroup = false;

  if (Array.isArray(rawGroups)) {
    inCommanderGroup = rawGroups.includes(COMMANDER_GROUP);
  } else if (typeof rawGroups === 'string') {
    inCommanderGroup = rawGroups.split(/[\s,]+/).includes(COMMANDER_GROUP);
  }

  if (!inCommanderGroup) return { authorized: false };

  // actor identity = sub（Cognito user ID）
  return { authorized: true, actor: sub };
}

// ─── Path parameter extraction ────────────────────────────────────────────────

/**
 * 從 API Gateway event 取得 path parameter `id`（decision_id）。
 *
 * 支援兩種格式：
 * - `event.pathParameters?.id`（HTTP API / REST API）
 * - `event.pathParameters?.decision_id`（某些 CDK 設定）
 *
 * @returns decision_id 字串，或 null（path parameter 缺失）
 */
function extractDecisionId(event: APIGatewayProxyEventV2): string | null {
  const params = event.pathParameters;
  if (!params) return null;

  const id = params['id'] ?? params['decision_id'];
  if (typeof id !== 'string' || id.trim().length === 0) return null;

  return id.trim();
}

// ─── timestamp helper ─────────────────────────────────────────────────────────
// nowTimestamp 已移至 audit_trail.ts（formatAuditTimestamp），此處不重複定義。

// ─── State transition logic ───────────────────────────────────────────────────
// 轉移規則定義集中在 publish_transitions.ts（SINGLE SOURCE OF TRUTH）

/**
 * 解析後的 request body 欄位。
 */
interface ParsedPublishBody {
  readonly target_state: PublishStatus | null;
  /** failure_reason（publish_failed 狀態時必填） */
  readonly failure_reason: string | null;
}

/**
 * 解析 POST /decisions/{id}/publish 的 request body。
 *
 * 支援欄位：
 * - `target_state`：目標狀態（可選，無時按當前狀態推斷）
 * - `failure_reason`：失敗原因（target_state=publish_failed 時建議提供）
 *
 * @returns ParsedPublishBody
 */
function parsePublishBody(body: string | null | undefined): ParsedPublishBody {
  if (!body) {
    return { target_state: null, failure_reason: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { target_state: null, failure_reason: null };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { target_state: null, failure_reason: null };
  }

  const obj = parsed as Record<string, unknown>;

  const ts = obj['target_state'];
  const target_state =
    typeof ts === 'string' && ts in PublishStatus ? (ts as PublishStatus) : null;

  const fr = obj['failure_reason'];
  const failure_reason = typeof fr === 'string' && fr.trim().length > 0 ? fr.trim() : null;

  return { target_state, failure_reason };
}

/**
 * 從當前狀態推斷下一個合法目標狀態（委派 publish_transitions.ts）。
 */
// inferNextState 已移除 — 直接呼叫 inferNextPublishState（publish_transitions.ts）

// ─── Main handler factory ─────────────────────────────────────────────────────

/**
 * 建立可注入依賴的 PublishFn handler。
 *
 * 使用 factory pattern 確保測試可注入 stub DynamoDB 操作，
 * 不需要設定 AWS credentials。
 *
 * @param deps - PublishFnDependencies（readDecisionCoreStatus, readPublishRecord, writePublishRecord）
 * @returns Lambda handler function
 *
 * @example
 * // 生產 Lambda 進入點
 * export const handler = createPublishHandler({ ... });
 *
 * // 測試
 * const handler = createPublishHandler({
 *   readDecisionCoreStatus: async (id) => ({ exists: true, core_committed: true }),
 *   readPublishRecord: async () => null,
 *   writePublishRecord: async (r) => ({ success: true, record: r }),
 * });
 */
export function createPublishHandler(
  deps: PublishFnDependencies,
): (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2> {
  const { readDecisionCoreStatus, readPublishRecord, writePublishRecord } = deps;

  return async function publishHandler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyResultV2> {
    // ── 0. Cognito commander 身份驗證 ──────────────────────────────────────
    const authResult = authorizeCommander(event);
    if (!authResult.authorized) {
      return errorResponse(
        403,
        'FORBIDDEN',
        '需要 commander 身份才能執行發布操作。',
      );
    }
    const actor = authResult.actor;

    // ── 1. 取得 decision_id（path parameter）──────────────────────────────
    const decisionId = extractDecisionId(event);
    if (decisionId === null) {
      return errorResponse(
        400,
        'INVALID_REQUEST',
        '缺少路徑參數 id（decision_id）。',
      );
    }

    try {
      // ── 2. 讀取 DecisionCore（唯讀）——確認 core_committed ────────────────
      const coreStatus = await readDecisionCoreStatus(decisionId);

      if (!coreStatus.exists) {
        return errorResponse(
          404,
          'DECISION_NOT_FOUND',
          `找不到 decision_id=${decisionId} 的決策核心。`,
        );
      }

      if (!coreStatus.core_committed) {
        return errorResponse(
          409,
          'DECISION_NOT_READY',
          `decision_id=${decisionId} 的決策核心尚未完成（core_committed=false），無法發布。`,
        );
      }

      // ── 3. 讀取現有 PublishRecord（唯讀）——取得 version 和 current state ─
      const existing = await readPublishRecord(decisionId);
      const currentState = existing?.publish_state ?? null;
      const currentVersion = existing?.version ?? 0;

      // ── 4. 解析 request body（target_state + failure_reason）────────────
      const parsedBody = parsePublishBody(event.body);
      const targetState = parsedBody.target_state ?? inferNextPublishState(currentState);

      if (targetState === null) {
        return errorResponse(
          400,
          'INVALID_TARGET_STATE',
          `無法從當前狀態「${currentState ?? 'null'}」推斷下一個合法轉移狀態。請在 body 中指定 "target_state"。`,
        );
      }

      // ── 5. 冪等檢查（§15.2）—— retry 不重複發布 ─────────────────────────
      const idempotencyResult = checkPublishIdempotency(existing, targetState, currentVersion);

      if (idempotencyResult.kind === 'ALREADY_PUBLISHED') {
        // 完全相同的 retry，直接回傳現有 record，不觸發任何副作用
        return jsonResponse(200, {
          schema_version: SCHEMA_VERSION,
          decision_id: decisionId,
          publish_state: idempotencyResult.record.publish_state,
          audit_trail: idempotencyResult.record.audit_trail,
          version: idempotencyResult.record.version,
          updated_at: idempotencyResult.record.updated_at,
          idempotent: true,
        });
      }

      if (idempotencyResult.kind === 'VERSION_DRIFT') {
        // 目標狀態已達成但 version 偏移（另一個請求搶先達成同一目標狀態）。
        // 目標已達成 → 回 200 帶目前的狀態資訊，不視為錯誤（非客戶端錯誤）
        return jsonResponse(200, {
          schema_version: SCHEMA_VERSION,
          decision_id: decisionId,
          publish_state: idempotencyResult.currentState,
          current_version: idempotencyResult.currentVersion,
          idempotent: true,
          note: '目標狀態已達成，version 已由並發請求更新，請重新讀取以取得最新 audit_trail。',
        });
      }

      // ── 6. publish_failed 必須提供 failure_reason ────────────────────────
      if (targetState === PublishStatus.publish_failed && parsedBody.failure_reason === null) {
        return errorResponse(
          400,
          'MISSING_FAILURE_REASON',
          '轉移至 publish_failed 狀態時必須在 body 中提供 "failure_reason" 欄位。',
        );
      }

      // ── 7. 驗證狀態轉移合法性 ────────────────────────────────────────────
      if (!isLegalPublishTransition(currentState, targetState)) {
        return errorResponse(
          409,
          'ILLEGAL_TRANSITION',
          `狀態轉移 ${currentState ?? 'null'} → ${targetState} 不合法。` +
            `合法的後續狀態為：${allowedNextStates(currentState).join('、') || '（無）'}。`,
        );
      }

      // ── 8. 組裝新的 PublishRecord（含 append-only audit trail）─────────
      // audit_trail entry 建立與 approved_by/published_by/failure_reason 填寫
      // 集中在 audit_trail.ts（TASK-147 SINGLE SOURCE OF TRUTH）
      const newRecord: PublishRecord = appendAuditEntry({
        decisionId,
        actor,
        existing,
        targetState,
        failureReason: parsedBody.failure_reason,
      });

      // ── 9. 委派狀態機寫入（TASK-145）────────────────────────────────────
      const writeResult = await writePublishRecord(newRecord, currentVersion);

      if (!writeResult.success) {
        if (writeResult.reason === 'VERSION_CONFLICT') {
          return errorResponse(
            409,
            'VERSION_CONFLICT',
            '發布操作與其他請求發生版本衝突，請重新讀取後再試。',
          );
        }
        if (writeResult.reason === 'ILLEGAL_TRANSITION') {
          return errorResponse(
            409,
            'ILLEGAL_TRANSITION',
            writeResult.message,
          );
        }
        return errorResponse(
          500,
          'INTERNAL_ERROR',
          '寫入發布記錄時發生內部錯誤。',
        );
      }

      // ── 10. 回傳成功結果（§15.2：只有 PROCEED 才可能觸發 alert）─────────
      // shouldEmitPublicAlertReady 為 TASK-148 的觸發點（WebSocket 推送）
      // 實際推送邏輯在 publish_status_changed.ts，此處僅計算 flag
      const _shouldEmitAlert = shouldEmitPublicAlertReady(idempotencyResult, targetState);
      // TODO(TASK-148): if (_shouldEmitAlert) await realtimePublisher.emitPublishStatusChanged(...)

      return jsonResponse(200, {
        schema_version: SCHEMA_VERSION,
        decision_id: decisionId,
        publish_state: writeResult.record.publish_state,
        audit_trail: writeResult.record.audit_trail,
        version: writeResult.record.version,
        updated_at: writeResult.record.updated_at,
      });
    } catch (err) {
      // 頂層例外捕捉：防止 Lambda crash 暴露 502
      const message = err instanceof Error ? err.message : String(err);
      console.error('[PublishFn] Unhandled exception', {
        decision_id: decisionId,
        error: message,
      });
      return errorResponse(500, 'INTERNAL_ERROR', '系統發生未預期錯誤，請稍後再試。');
    }
  };
}
