/**
 * Bedrock Explanation Service — focused unit tests.
 *
 * Validates that:
 * 1. Successful Converse invocation returns a parsed text result.
 * 2. Missing BEDROCK_MODEL_ID throws a CONFIG_ERROR.
 * 3. Empty response from Bedrock throws EMPTY_RESPONSE.
 * 4. AWS error throws a typed BedrockExplanationError carrying request id.
 * 5. System prompt is Traditional Chinese.
 * 6. User message payload never includes the full SOP source content
 *    (only excerpts).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// We mock the @aws-sdk/client-bedrock-runtime module BEFORE importing
// the service module so its client getter is replaced.
const sendMock = vi.fn();

vi.mock('@aws-sdk/client-bedrock-runtime', async () => {
  return {
    BedrockRuntimeClient: class {
      send = sendMock;
      config = { region: 'us-west-2' };
    },
    ConverseCommand: class {
      input: unknown;
      constructor(input: unknown) { this.input = input; }
    },
  };
});

// Required env for the service
process.env['BEDROCK_REGION'] = 'us-west-2';
process.env['BEDROCK_MODEL_ID'] = 'us.anthropic.claude-sonnet-4-6';

import {
  generateExplanation,
  BedrockExplanationError,
} from '../../src/demo/bedrock_explanation_service.js';

const sampleRequest = {
  user_query: '捷運站人潮突然增加',
  triggered_articles: [3, 6],
  expected_actions: ['啟動群眾疏散程序', '發布多語言廣播'],
  sop_citations: [
    { article_no: 3, content_excerpt: '當人潮聚集量超過容量 70%，啟動疏散程序' },
    { article_no: 6, content_excerpt: '提供多語言警報，降低資訊落差' },
  ],
  data_status: 'ready',
};

describe('bedrock_explanation_service', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('returns parsed text and telemetry on successful Converse invocation', async () => {
    sendMock.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: '依據 SOP 3 與 6，建議啟動疏散並發布多語言廣播。' }],
        },
      },
      usage: { inputTokens: 200, outputTokens: 80 },
      $metadata: { requestId: 'aws-req-123' },
    });

    const result = await generateExplanation(sampleRequest);
    expect(result.explanation_text).toContain('SOP 3');
    expect(result.input_tokens).toBe(200);
    expect(result.output_tokens).toBe(80);
    expect(result.aws_request_id).toBe('aws-req-123');
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('uses modelId from env and Conservative inference config', async () => {
    sendMock.mockResolvedValueOnce({
      output: { message: { content: [{ text: '測試' }] } },
      usage: {},
      $metadata: { requestId: 'r1' },
    });
    await generateExplanation(sampleRequest);
    expect(sendMock).toHaveBeenCalledOnce();
    const callArg = sendMock.mock.calls[0][0] as { input: { modelId: string; inferenceConfig: unknown; system: unknown; messages: unknown } };
    expect(callArg.input.modelId).toBe('us.anthropic.claude-sonnet-4-6');
    expect(callArg.input.inferenceConfig).toMatchObject({
      maxTokens: 800,
      temperature: 0.2,
    });
    expect(callArg.input.system[0].text).toContain('繁體中文');
    expect(callArg.input.system[0].text).toContain('不得虛構資料');
  });

  it('throws EMPTY_RESPONSE when model returns no usable text', async () => {
    sendMock.mockResolvedValueOnce({
      output: { message: { content: [{ text: '   ' }] } },
      usage: {},
      $metadata: { requestId: 'r2' },
    });
    let caught: BedrockExplanationError | null = null;
    try {
      await generateExplanation(sampleRequest);
    } catch (e) {
      caught = e as BedrockExplanationError;
    }
    expect(caught).toBeInstanceOf(BedrockExplanationError);
    expect(caught?.code).toBe('EMPTY_RESPONSE');
  });

  it('throws typed error carrying AWS request id on AWS failure', async () => {
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error('AccessDeniedException'), {
        name: 'AccessDeniedException',
        $metadata: { requestId: 'aws-req-AccessDenied' },
      }),
    );

    try {
      await generateExplanation(sampleRequest);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BedrockExplanationError);
      const err = e as BedrockExplanationError;
      expect(err.code).toBe('AccessDeniedException');
      expect(err.aws_request_id).toBe('aws-req-AccessDenied');
    }
  });

  it('payload contains compact excerpts only (no full SOP source)', async () => {
    sendMock.mockResolvedValueOnce({
      output: { message: { content: [{ text: 'ok' }] } },
      usage: {},
      $metadata: { requestId: 'r3' },
    });
    await generateExplanation(sampleRequest);
    const cmdInput = (sendMock.mock.calls[0][0] as { input: { messages: { content: { text: string }[] }[] } }).input;
    const userText = cmdInput.messages[0].content[0].text;
    // Full action sentences (like 啟動群眾疏散程序) appear as expected_actions,
    // but the SOP citation content_excerpt is the short form (啟動疏散程序),
    // never the full SOP source. The compact payload structure is JSON.
    const jsonMatch = userText.match(/\{[\s\S]*\}/);
    expect(jsonMatch).not.toBeNull();
    const evidence = JSON.parse(jsonMatch![0]) as {
      sop_citations: { content_excerpt: string }[];
    };
    // Each excerpt is at most MAX_CONTENT_EXCERPT_CHARS
    for (const c of evidence.sop_citations) {
      expect(c.content_excerpt.length).toBeLessThanOrEqual(240);
    }
    // The excerpt for article 3 is present and matches the test fixture
    expect(evidence.sop_citations[0].content_excerpt).toContain('啟動疏散程序');
  });

  it('throws CONFIG_ERROR when BEDROCK_MODEL_ID is missing', async () => {
    const prev = process.env['BEDROCK_MODEL_ID'];
    delete process.env['BEDROCK_MODEL_ID'];
    try {
      let caught: BedrockExplanationError | null = null;
      try {
        await generateExplanation(sampleRequest);
      } catch (e) {
        caught = e as BedrockExplanationError;
      }
      expect(caught).toBeInstanceOf(BedrockExplanationError);
      expect(caught?.code).toBe('CONFIG_ERROR');
    } finally {
      process.env['BEDROCK_MODEL_ID'] = prev;
    }
  });
});