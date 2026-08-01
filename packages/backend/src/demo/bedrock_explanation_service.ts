/**
 * Bedrock Explanation Service — generates Traditional Chinese
 * explanation text from deterministic rule-engine results.
 *
 * IMPORTANT: This service NEVER decides or modifies the deterministic
 * results (triggered_articles, expected_actions, SOP citations,
 * data_status). It only generates a human-readable explanation of
 * results that have already been computed.
 *
 * @module backend/demo/bedrock_explanation_service
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';

// ─── Types ──────────────────────────────────────────────────────────────

/** Compact SOP citation fragment safe to send to the model. */
export interface BedrockSopCitation {
  readonly article_no: number;
  /** Truncated excerpt of the article text — never the full source. */
  readonly content_excerpt: string;
}

export interface BedrockExplanationRequest {
  readonly user_query: string;
  readonly triggered_articles: readonly number[];
  readonly expected_actions: readonly string[];
  readonly sop_citations: readonly BedrockSopCitation[];
  readonly data_status: string;
}

export interface BedrockExplanationResult {
  readonly explanation_text: string;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly latency_ms: number;
  readonly aws_request_id: string | null;
}

/** Thrown when the model returns no usable text content. */
export class BedrockExplanationError extends Error {
  public readonly code: string;
  public readonly aws_request_id: string | null;
  public readonly cause?: unknown;
  constructor(code: string, message: string, aws_request_id: string | null = null, cause?: unknown) {
    super(message);
    this.name = 'BedrockExplanationError';
    this.code = code;
    this.aws_request_id = aws_request_id;
    if (cause !== undefined) this.cause = cause;
  }
}

// ─── System prompt (Traditional Chinese) ───────────────────────────────

const SYSTEM_PROMPT = `你是「城市應變指揮系統」的說明助手。
系統會提供已由確定性規則引擎計算完成的結果。
你只能解釋這些結果，不得修改、增加或刪除觸發條款、建議行動、事件事實、數值、公式或引用來源。
不得虛構資料。
請使用清楚、專業、精簡的繁體中文，說明：
1. 為何觸發這些 SOP 條款；
2. 建議採取哪些行動；
3. 這些行動與提供的 SOP 引用有何關係。
若資料不足，必須明確指出資料不足，不可自行補造。`;

// ─── Constants ─────────────────────────────────────────────────────────

const MAX_CONTENT_EXCERPT_CHARS = 240; // keep the payload compact
const REQUEST_TIMEOUT_MS = 20_000;

// ─── Reusable client (singleton, region from env) ───────────────────────

let _client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (_client) return _client;
  const region = process.env['BEDROCK_REGION'] ?? 'us-west-2';
  _client = new BedrockRuntimeClient({ region });
  return _client;
}

/** Test-only: override the client. */
export function __setBedrockClientForTests(client: BedrockRuntimeClient | null): void {
  _client = client;
}

// ─── Public entry point ────────────────────────────────────────────────

/**
 * Invoke Bedrock to generate a Traditional Chinese explanation.
 *
 * The function never logs the full prompt or full SOP source content.
 * It returns only the explanation text and minimal telemetry.
 *
 * Throws BedrockExplanationError on any failure (network, IAM,
 * model rejection, empty response). Callers must catch and fall back.
 */
export async function generateExplanation(
  request: BedrockExplanationRequest,
): Promise<BedrockExplanationResult> {
  const modelId = process.env['BEDROCK_MODEL_ID'];
  if (!modelId) {
    throw new BedrockExplanationError('CONFIG_ERROR', 'BEDROCK_MODEL_ID is not set');
  }

  // Build a compact evidence object — no full source content.
  const sopPayload = request.sop_citations.map((c) => ({
    article_no: c.article_no,
    content_excerpt: truncate(c.content_excerpt, MAX_CONTENT_EXCERPT_CHARS),
  }));

  const evidence = {
    user_query: request.user_query,
    triggered_articles: [...request.triggered_articles],
    expected_actions: [...request.expected_actions],
    sop_citations: sopPayload,
    data_status: request.data_status,
  };

  const userMessage = `以下是規則引擎已計算完成的結果，請依系統指令產生繁體中文解釋：\n${JSON.stringify(evidence)}`;

  const input: ConverseCommandInput = {
    modelId,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: [{ text: userMessage }] }],
    inferenceConfig: {
      maxTokens: 800,
      temperature: 0.2,
    },
  };

  const client = getClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const t0 = Date.now();
  let response: ConverseCommandOutput;
  try {
    response = await client.send(new ConverseCommand(input), {
      abortSignal: controller.signal,
    });
  } catch (e) {
    const latency = Date.now() - t0;
    const code = (e as { name?: string; $metadata?: { requestId?: string } }).name ?? 'CLIENT_ERROR';
    const awsReqId = (e as { $metadata?: { requestId?: string } }).$metadata?.requestId ?? null;
    throw new BedrockExplanationError(code, `Bedrock invoke failed: ${(e as Error).message ?? code}`, awsReqId, e);
  } finally {
    clearTimeout(timer);
  }

  const latency = Date.now() - t0;
  const awsRequestId = response.$metadata?.requestId ?? null;

  // Extract first valid text content block safely
  const text = extractFirstText(response);
  if (!text) {
    throw new BedrockExplanationError('EMPTY_RESPONSE', 'Bedrock returned no usable text content', awsRequestId);
  }

  const usage = (response.usage ?? {}) as { inputTokens?: number; outputTokens?: number };
  return {
    explanation_text: text.trim(),
    input_tokens: usage.inputTokens ?? null,
    output_tokens: usage.outputTokens ?? null,
    latency_ms: latency,
    aws_request_id: awsRequestId,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────

function extractFirstText(response: ConverseCommandOutput): string | null {
  const blocks = response.output?.message?.content ?? [];
  for (const block of blocks) {
    if (typeof block === 'object' && block !== null && 'text' in block) {
      const text = (block as { text?: unknown }).text;
      if (typeof text === 'string' && text.trim().length > 0) {
        return text;
      }
    }
  }
  return null;
}

function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - 1) + '…';
}