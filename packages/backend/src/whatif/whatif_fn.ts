/**
 * WhatIfFn handler — POST /what-if 專屬 Lambda 進入點 (TASK-136)
 *
 * 職責（§12, §14.5, §17, §10.14, §10.15）：
 * - 接收 API Gateway HTTP event，從 Cognito JWT 確認 operator 身份
 * - 將 `raw_question` 標記為 UNTRUSTED_USER_INPUT，絕不作為指令執行
 * - 串接四階段 What-if 流程（stage 1→2→3→4），回傳 `WhatIfResponse`
 * - **零寫入**任何 decision / narrative / publish / idempotency table
 * - 任何 stage 短路（clarification_required）→ 立即回應，不繼續後續 stages
 *
 * 四階段流程（§14.5）：
 * ```
 * raw_question (UNTRUSTED_USER_INPUT)
 *   ↓ stage 1: parseScenario (Bedrock ScenarioParser)
 *     ↓ clarification_required → HTTP 200 clarification
 *   ↓ stage 2: validateScenario (SchemaValidator + DomainValidator)
 *     ↓ clarification_required → HTTP 200 clarification
 *   ↓ stage 3: recompute (deterministic Rule Engine)
 *   ↓ stage 4: explainWhatIf (Bedrock + SOP citations)
 *   → WhatIfResponse (does_not_mutate_state: true)
 * ```
 *
 * IAM 邊界（WhatIfFnRole, TASK-177）：
 * - Bedrock/KB Retrieve: 允許（stage 1/4）
 * - DecisionCoreTable/DataTable: read-only
 * - 所有 Put/Update/Delete/StartExecution/PostToConnection: **明確 Deny**
 *
 * 本 handler 永遠掛載在專屬 WhatIfFn Lambda（TASK-067），
 * **不**與 RendererFn / ApiReadFn / DecisionFn 共用。
 *
 * @module backend/whatif/whatif_fn
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { WhatIfRequest, WhatIfResponse } from '@city-commander/shared-schemas';
import { SCHEMA_VERSION } from '@city-commander/shared-schemas';
import type { BedrockInvoker, SopRetriever } from '@city-commander/rag';
import { parseScenario } from './scenario_parser.js';
import { validateScenario } from './validators.js';
import { recompute, type RuleEngineWhatIfFacade } from './recompute.js';
import { explainWhatIf } from './explanation.js';

// ─── Handler dependencies (injected for testability) ─────────────────────────

/**
 * WhatIfFn handler 的注入依賴。
 *
 * 生產時由 Lambda 初始化程式碼（handler wrapper）注入；
 * 測試時注入 mock 實作。
 *
 * 不在 handler 內直接 import AWS SDK，確保測試不觸發網路呼叫。
 */
export interface WhatIfFnDependencies {
  /** BedrockInvoker（生產: BedrockAdapter；LOCAL_MOCK: MockBedrockAdapter） */
  readonly bedrockInvoker: BedrockInvoker;
  /** SopRetriever（生產: createSopRetriever()；測試: stub） */
  readonly sopRetriever: SopRetriever;
  /** Member-1-owned single facade for baseline loading and full deterministic reruns. */
  readonly ruleEngineFacade: RuleEngineWhatIfFacade;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

/** HTTP 回應的 Content-Type header */
const JSON_CONTENT_TYPE = 'application/json';

/** schema_version 常數（所有回應均包含） */
const SCHEMA_VER = SCHEMA_VERSION;

/**
 * 組裝成功 HTTP 回應（200）。
 * body 已 JSON.stringify，Content-Type 已設定。
 */
function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': JSON_CONTENT_TYPE },
    body: JSON.stringify(body),
  };
}

/**
 * 組裝錯誤 HTTP 回應。
 * 不暴露內部堆疊，只回傳 error_code 與人可讀訊息。
 */
function errorResponse(
  statusCode: number,
  errorCode: string,
  message: string,
): APIGatewayProxyResultV2 {
  return jsonResponse(statusCode, { error_code: errorCode, message });
}

// ─── Request validation ───────────────────────────────────────────────────────

/**
 * 從 API Gateway event 解析並驗證 WhatIfRequest。
 *
 * - body 必須是合法 JSON
 * - `query` 欄位必須存在且為非空字串
 * - `query` 長度不超過 MAX_QUERY_LENGTH（防止超長 prompt injection）
 *
 * @returns 解析成功回傳 WhatIfRequest；失敗回傳 null（呼叫端回 400）
 */
const MAX_QUERY_LENGTH = 2000;

/**
 * 取出 request body 的 UTF-8 文字。
 *
 * API Gateway 在 `isBase64Encoded=true` 時送來的是 base64 編碼的**位元組**。
 * 必須以 UTF-8 解碼還原——`atob()` 產生的是 latin1 字串，
 * 中文問句（What-if 的主要輸入語言）會整段變成亂碼，
 * 接著 JSON.parse 失敗或解析出錯誤的 query。
 */
function decodeBody(event: APIGatewayProxyEventV2): string {
  const body = event.body ?? '';
  return event.isBase64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body;
}

function parseRequest(event: APIGatewayProxyEventV2): WhatIfRequest | null {
  if (!event.body) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBody(event));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;
  const query = obj['query'];

  if (typeof query !== 'string' || query.trim().length === 0) return null;
  if (query.length > MAX_QUERY_LENGTH) return null;

  return { query: query.trim() };
}

// ─── Cognito operator authorization ──────────────────────────────────────────

/** Cognito group 名稱，擁有此 group 的使用者才可呼叫 What-if */
const OPERATOR_GROUP = 'operators';

/**
 * 確認請求已通過 Cognito operator 身份驗證。
 *
 * API Gateway HTTP API 在 JWT authorizer 驗證後，會將 claims 寫入
 * `event.requestContext.authorizer.jwt.claims`。
 * 若路由未掛 authorizer 或 claims 缺失，視為未授權。
 *
 * 驗證邏輯（§18）：
 * 1. JWT claims 必須存在（authorizer 已設定）
 * 2. `sub`（Cognito user ID）必須非空（token 已通過 JWT 驗證）
 * 3. `cognito:groups` 必須包含 `operators` group
 *    - API Gateway / Cognito 可回傳陣列或逗號分隔字串，兩種格式均支援
 *
 * 注意：WhatIfFnRole 的 IAM Deny 是最終防線；
 * 此處 Cognito group check 是應用層防線。
 */
function isAuthorizedOperator(event: APIGatewayProxyEventV2): boolean {
  // HTTP API Gateway JWT authorizer 型別用 unknown 轉型後嚴格提取
  const ctx = event.requestContext as unknown as {
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };
  const claims = ctx.authorizer?.jwt?.claims;
  if (!claims) return false;

  // 確認 sub（Cognito user ID）非空
  const sub = typeof claims['sub'] === 'string' ? claims['sub'].trim() : '';
  if (sub.length === 0) return false;

  // 確認 cognito:groups 包含 operators
  // Cognito 可能回傳陣列（Lambda authorizer）或空格/逗號分隔字串（JWT authorizer）
  const rawGroups = claims['cognito:groups'];
  if (Array.isArray(rawGroups)) {
    return rawGroups.includes(OPERATOR_GROUP);
  }
  if (typeof rawGroups === 'string') {
    // 支援逗號或空格分隔，如 "operators,viewers" 或 "operators viewers"
    return rawGroups.split(/[\s,]+/).includes(OPERATOR_GROUP);
  }

  return false;
}

// ─── trace_id / request_id helpers ───────────────────────────────────────────

/**
 * 從 API Gateway event 取得或產生 trace_id。
 * 優先使用 API Gateway 注入的 `X-Amzn-Trace-Id` header，
 * 降級時以 requestId 替代。
 */
function extractTraceId(event: APIGatewayProxyEventV2): string {
  return (
    event.headers?.['x-amzn-trace-id'] ??
    event.requestContext.requestId ??
    `whatif-${Date.now()}`
  );
}

/**
 * 以 requestId 作為本次 What-if 的 request_id（回應體欄位）。
 */
function extractRequestId(event: APIGatewayProxyEventV2): string {
  return event.requestContext.requestId ?? `req-${Date.now()}`;
}

// ─── Main handler factory ─────────────────────────────────────────────────────

/**
 * 建立可注入依賴的 WhatIfFn handler。
 *
 * 使用 factory pattern 讓測試可注入 mock 依賴，
 * 而不需要修改 Lambda 進入點。
 *
 * @param deps - WhatIfFnDependencies（bedrockInvoker + sopRetriever）
 * @returns Lambda handler function
 *
 * @example
 * // 生產 Lambda 進入點（與 createWhatIfHandler 分離）
 * export const handler = createWhatIfHandler({ bedrockInvoker, sopRetriever });
 *
 * // 測試
 * const handler = createWhatIfHandler({ bedrockInvoker: mockAdapter, sopRetriever: stubRetriever });
 * const result = await handler(mockEvent, {} as Context);
 */
export function createWhatIfHandler(
  deps: WhatIfFnDependencies,
): (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2> {
  const { bedrockInvoker, sopRetriever, ruleEngineFacade } = deps;

  return async function whatIfHandler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyResultV2> {
    const traceId = extractTraceId(event);
    const requestId = extractRequestId(event);

    try {
      // ── 0. Cognito operator 身份驗證 ─────────────────────────────────────
      if (!isAuthorizedOperator(event)) {
        return errorResponse(401, 'UNAUTHORIZED', '需要 operator 身份驗證。');
      }

      // ── 1. 解析並驗證 HTTP request body ──────────────────────────────────
      const request = parseRequest(event);
      if (request === null) {
        return errorResponse(
          400,
          'INVALID_REQUEST',
          '請求格式錯誤：body 必須包含非空字串欄位 "query"（最長 2000 字元）。',
        );
      }

      // raw_question = UNTRUSTED_USER_INPUT（§17）
      // 後續所有 stage 將其視為純資料，不作為指令執行
      const rawQuestion = request.query;

      // ── Stage 1: ScenarioParser（Bedrock NL → 結構化假設）────────────────
      const parseResult = await parseScenario(rawQuestion, bedrockInvoker);

      if (parseResult.parse_status === 'clarification_required') {
        // stage 1 無法解析 → 立即回應，不進入 stage 2/3/4
        const clarificationResponse: WhatIfResponse = {
          schema_version: SCHEMA_VER,
          trace_id: traceId,
          request_id: requestId,
          status: 'clarification_required',
          triggered_articles: [],
          applied_formula_articles: [],
          expected_actions: [],
          sop_citations: [],
          clarification_prompt: parseResult.clarification_prompt,
          does_not_mutate_state: true,
          provisional: true,
        };
        return jsonResponse(200, clarificationResponse);
      }

      // Load once, then use the same immutable baseline for entity validation
      // and the complete Rule Engine rerun. No production state is modified.
      const baseline = await ruleEngineFacade.loadBaseline(event);

      // ── Stage 2: SchemaValidator + DomainValidator ────────────────────────
      const validateResult = validateScenario(
        parseResult.assumptions,
        baseline.loadedEntities,
      );

      if (validateResult.validation_status === 'clarification_required') {
        // stage 2 驗證失敗 → 立即回應，不進入 stage 3/4
        const clarificationResponse: WhatIfResponse = {
          schema_version: SCHEMA_VER,
          trace_id: traceId,
          request_id: requestId,
          status: 'clarification_required',
          triggered_articles: [],
          applied_formula_articles: [],
          expected_actions: [],
          sop_citations: [],
          clarification_prompt: validateResult.clarification_prompt,
          does_not_mutate_state: true,
          provisional: true,
        };
        return jsonResponse(200, clarificationResponse);
      }

      // ── Stage 3: deterministic recompute（Rule Engine，零寫入）───────────
      const recomputeResult = recompute({
        facade: ruleEngineFacade,
        baseline,
        assumptions: validateResult.validated_assumptions,
      });

      // ── Stage 4: Bedrock explanation + SOP citations（零寫入）───────────
      const explanationResult = await explainWhatIf({
        recomputeResult,
        rawQuestion,
        sopRetriever,
        bedrockInvoker,
      });

      // ── 組裝最終 WhatIfResponse ──────────────────────────────────────────
      // 所有決定性欄位來自 stage 3（LLM-prohibited）
      // explanation_text 來自 stage 4（LLM-writable）
      const response: WhatIfResponse = {
        schema_version: SCHEMA_VER,
        trace_id: traceId,
        request_id: requestId,
        status: 'answered',
        // LLM-prohibited：值均來自決定性 stage 3
        triggered_articles: recomputeResult.triggered_articles,
        applied_formula_articles: recomputeResult.applied_formula_articles,
        expected_actions: recomputeResult.expected_actions,
        // ete_preview 為 optional，僅在 stage 3 有 Saturation_Score 假設時存在
        ...(recomputeResult.ete_preview !== undefined && {
          ete_preview: recomputeResult.ete_preview,
        }),
        // sop_citations：verbatim，來自 stage 4 SopRetriever
        sop_citations: explanationResult.sop_citations.map((c) => ({
          article_no: c.article_no,
          content: c.content,
        })),
        // LLM-writable：stage 4 Bedrock 或 template fallback
        explanation_text: explanationResult.explanation_text,
        // does_not_mutate_state: const true（靜態型別保證）
        does_not_mutate_state: true,
        provisional: true,
      };

      return jsonResponse(200, response);
    } catch {
      // 頂層例外捕捉：防止 Lambda crash 暴露 502
      // 例如 SDK transport 錯誤、credentials 過期等非 Bedrock 邏輯錯誤
      console.error('[WhatIfFn] Unhandled exception', {
        trace_id: traceId,
        error_code: 'WHATIF_UNEXPECTED_ERROR',
      });
      return errorResponse(500, 'INTERNAL_ERROR', '系統發生未預期錯誤，請稍後再試。');
    }
  };
}
