/**
 * Production BedrockInvoker for the What-if Lambda.
 *
 * Wraps `@aws-sdk/client-bedrock-runtime` ConverseCommand behind the
 * `BedrockInvoker` interface already consumed by the four-stage
 * `whatif_fn.ts` pipeline.
 *
 * Configuration is read from environment variables (CDK-side wiring):
 *  - `BEDROCK_REGION`     — defaults to 'us-west-2'
 *  - `BEDROCK_MODEL_ID`   — defaults to 'us.anthropic.claude-sonnet-4-6'
 *
 * Conservative generation settings:
 *  - temperature 0.1 (deterministic explanations)
 *  - maxTokens   800
 *  - abortSignal timeout 15 s (What-if is interactive; longer than this is
 *    a sign of model trouble, not helpful)
 *
 * Logging:
 *  - `bedrock_invocation_succeeded` with model_id, aws_request_id,
 *    input_tokens, output_tokens, latency_ms
 *  - `bedrock_invocation_failed` with error name, aws_request_id, latency_ms
 *
 * Failure mode:
 *  - The wrapper NEVER throws. It returns
 *    `{ outcome: 'use_template', ... }` so the calling pipeline (explanation)
 *    can fall back to a deterministic template; deterministic facts are
 *    always preserved regardless of Bedrock availability.
 *
 * @module backend/whatif/production_bedrock_invoker
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';

import type {
  BedrockInvoker,
  BedrockResult,
  BedrockInvokeOptions,
} from '@city-commander/rag';

const DEFAULT_REGION = 'us-west-2';
const DEFAULT_MODEL_ID = 'us.anthropic.claude-sonnet-4-6';
const REQUEST_TIMEOUT_MS = 15_000;

let _client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (_client) return _client;
  const region = process.env['BEDROCK_REGION'] ?? DEFAULT_REGION;
  _client = new BedrockRuntimeClient({ region });
  return _client;
}

function getModelId(): string {
  return process.env['BEDROCK_MODEL_ID'] ?? DEFAULT_MODEL_ID;
}

/** Test-only: reset the singleton between tests. */
export function __resetBedrockClientForTests(): void {
  _client = null;
}

export class ProductionBedrockInvoker implements BedrockInvoker {
  async invoke(prompt: string, opts: BedrockInvokeOptions = {}): Promise<BedrockResult> {
    const modelId = getModelId();
    const perCallTimeoutMs = Math.min(opts.timeoutMs ?? REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS);

    const client = getClient();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perCallTimeoutMs);

    const t0 = Date.now();
    let response: ConverseCommandOutput;
    try {
      response = await client.send(
        new ConverseCommand({
          modelId,
          messages: [{ role: 'user', content: [{ text: prompt }] }],
          inferenceConfig: {
            maxTokens: 800,
            temperature: 0.1,
          },
        }),
        { abortSignal: controller.signal },
      );
    } catch (err) {
      const latency = Date.now() - t0;
      const errorName = (err as { name?: string })?.name ?? 'BedrockError';
      const awsReqId =
        (err as { $metadata?: { requestId?: string } })?.$metadata?.requestId ?? null;
      clearTimeout(timer);
      console.error('bedrock_invocation_failed', {
        model_id: modelId,
        error_name: errorName,
        aws_request_id: awsReqId,
        latency_ms: latency,
      });
      return {
        outcome: 'use_template',
        reason: classifyErrorReason(errorName),
        message: `Bedrock invoke failed: ${(err as Error)?.message ?? errorName}`,
      };
    }
    clearTimeout(timer);

    const latency = Date.now() - t0;
    const awsRequestId = response.$metadata?.requestId ?? null;

    const text = extractFirstText(response);
    if (text === null || text.trim().length === 0) {
      console.error('bedrock_invocation_failed', {
        model_id: modelId,
        error_name: 'EMPTY_RESPONSE',
        aws_request_id: awsRequestId,
        latency_ms: latency,
      });
      return {
        outcome: 'use_template',
        reason: 'unexpected_error',
        message: 'Bedrock returned no usable text content',
      };
    }

    const usage = (response.usage ?? {}) as {
      inputTokens?: number;
      outputTokens?: number;
    };
    const cleaned = stripMarkdownCodeFences(text.trim());

    console.log('bedrock_invocation_succeeded', {
      model_id: modelId,
      aws_request_id: awsRequestId,
      latency_ms: latency,
      input_tokens: usage.inputTokens ?? null,
      output_tokens: usage.outputTokens ?? null,
    });

    return {
      outcome: 'success',
      text: cleaned,
      usedModelId: modelId,
    };
  }
}

function classifyErrorReason(
  errorName: string,
): 'timeout' | 'model_not_supported' | 'throttled' | 'unexpected_error' {
  switch (errorName) {
    case 'TimeoutError':
    case 'AbortError':
      return 'timeout';
    case 'ValidationException':
    case 'AccessDeniedException':
      return 'model_not_supported';
    case 'ThrottlingException':
    case 'ServiceUnavailableException':
      return 'throttled';
    default:
      return 'unexpected_error';
  }
}

function extractFirstText(response: ConverseCommandOutput): string | null {
  const blocks = response?.output?.message?.content;
  if (!Array.isArray(blocks)) return null;
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

/**
 * Strip Markdown code fences around JSON payload.
 *
 * Anthropic Claude models frequently wrap JSON responses in ```json ... ```
 * fences. Downstream `JSON.parse()` would otherwise fail and the Stage 1
 * ScenarioParser would fall into the non-JSON clarification path even when
 * the underlying payload is structurally valid JSON.
 *
 * Strip rules:
 *  - Remove a single leading ```` ```json ```` (or ```` ``` ````) fence line
 *  - Remove a single trailing ```` ``` ```` fence line
 *  - Preserve everything else (including internal whitespace)
 *
 * If no fences are present, the input is returned unchanged.
 *
 * This is a wiring fix, not prompt-tuning. We do not inspect the JSON itself.
 */
function stripMarkdownCodeFences(input: string): string {
  let s = input;
  // Trim leading whitespace lines
  const leadingFence = /^\s*```(?:json)?\s*\n/;
  if (leadingFence.test(s)) {
    s = s.replace(leadingFence, '');
  }
  // Trim trailing ``` line
  const trailingFence = /\n```\s*$/;
  if (trailingFence.test(s)) {
    s = s.replace(trailingFence, '');
  }
  return s.trim();
}