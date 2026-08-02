/**
 * Demo API Handler — focused tests for deprecation behavior + UTF-8.
 *
 * Validates that:
 * 1. The deprecated /demo/what-if route now returns 410 Gone with the
 *    migration message pointing operators to /what-if.
 * 2. The Bedrock service is no longer called from the demo route — the
 *    production What-if pipeline lives on the dedicated WhatIfFn Lambda.
 * 3. JSON responses on retained routes still include charset=utf-8.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock Bedrock service BEFORE the handler is imported ──
// The demo route no longer uses Bedrock. The mock is here purely so
// stale references in the now-retired module don't surface at runtime.
const mockGenerate = vi.hoisted(() => vi.fn());

vi.mock('../../src/demo/bedrock_explanation_service.js', () => ({
  generateExplanation: mockGenerate,
  BedrockExplanationError: class extends Error {
    code: string;
    aws_request_id: string | null;
    constructor(code: string, message: string, aws_request_id: string | null = null) {
      super(message);
      this.name = 'BedrockExplanationError';
      this.code = code;
      this.aws_request_id = aws_request_id;
    }
  },
}));

// ── Required env so the service doesn't CONFIG-fail by accident ──
process.env['BEDROCK_REGION'] = 'us-west-2';
process.env['BEDROCK_MODEL_ID'] = 'us.anthropic.claude-sonnet-4-6';

// ── Import SUT ──
import {
  setDemoData,
  createDemoApiHandler,
  type DemoDataSet,
} from '../../src/demo/demo_api_handler.js';

const handler = createDemoApiHandler();

function makeDataSet(): DemoDataSet {
  return {
    traffic: [],
    trafficTimestamps: [],
    crowd: [],
    crowdTimestamps: [],
    roadNetwork: { getAllSegments: () => [] } as unknown as DemoDataSet['roadNetwork'],
    sopArticles: {
      articles: [],
    } as unknown as DemoDataSet['sopArticles'],
    incidents: [],
  };
}

function deprecatedWhatIfEvent(query: string) {
  return {
    rawPath: '/demo/what-if',
    requestContext: { http: { method: 'POST', path: '/demo/what-if' } },
    body: JSON.stringify({ query }),
  };
}

describe('Demo API Handler — POST /demo/what-if is deprecated (returns 410)', () => {
  beforeEach(() => {
    setDemoData(makeDataSet());
    mockGenerate.mockReset();
  });

  it('returns HTTP 410 Gone with migration_target=/what-if', async () => {
    const result = await handler(deprecatedWhatIfEvent('若 BL17 人數增至 40000 人'));

    expect(result.statusCode).toBe(410);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body.error_code).toBe('GONE');
    expect(body.migration_target).toBe('/what-if');
    expect((body.message as string).length).toBeGreaterThan(0);
  });

  it('does not invoke Bedrock on the deprecated route', async () => {
    await handler(deprecatedWhatIfEvent('任何 query'));
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('returns JSON with charset=utf-8 on the deprecated route', async () => {
    const result = await handler(deprecatedWhatIfEvent('若 BL17 人數增至 40000 人'));
    expect(result.headers['Content-Type']).toBe('application/json; charset=utf-8');
  });

  it('returns 410 for /demo/whatif alias path too', async () => {
    const result = await handler({
      rawPath: '/demo/whatif',
      requestContext: { http: { method: 'POST', path: '/demo/whatif' } },
      body: JSON.stringify({ query: 'x' }),
    });
    expect(result.statusCode).toBe(410);
  });

  it('/health still emits charset=utf-8', async () => {
    const result = await handler({
      rawPath: '/health',
      requestContext: { http: { method: 'GET', path: '/health' } },
    });
    expect(result.statusCode).toBe(200);
    expect(result.headers['Content-Type']).toBe('application/json; charset=utf-8');
  });
});