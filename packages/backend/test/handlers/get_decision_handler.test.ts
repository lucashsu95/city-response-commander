/**
 * TASK-150 — GET handler unit tests.
 *
 * Locks the §12 contract: `200` even for `insufficient_data` (never a 404, never
 * fabricated), `400` on a missing path parameter, unified error envelope from
 * TASK-156, and numbers echoed only from DecisionCore.
 */

import { describe, it, expect, vi } from 'vitest';
import { NarrativeType, PublishStatus } from '@city-commander/shared-schemas';
import type {
  DecisionCore,
  DecisionNarrative,
  PublishRecord,
} from '@city-commander/shared-schemas';
import {
  createGetDecisionHandler,
  createGetReportHandler,
  TableReadError,
} from '../../src/index.js';
import type {
  DecisionReadModel,
  GetReportResponseBody,
  HttpGetEvent,
  ReadModelPorts,
} from '../../src/index.js';

const DECISION = 'DEC_TPE_2026_ACC_001_abcdef123456';
const KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a';
const REQUEST_ID = 'apigw-request-1';

function core(overrides: Partial<DecisionCore> = {}): DecisionCore {
  return {
    decision_id: DECISION,
    idempotency_key: KEY,
    source_manifest_hash: 'sha256:AAAA',
    core_hash: 'sha256:CORE-1',
    schema_version: '1.0.0',
    provisional: true,
    event_id: 'TPE_2026_ACC_001',
    triggered_articles: [1, 2],
    applied_formula_articles: [7],
    invoked_procedures: ['article2_alternative_route_guidance'],
    primary_evacuation: 'RD_TPE_004',
    secondary_evacuation: ['RD_TPE_005'],
    ete: { ete_minutes: 78.6 },
    cms_core_text: '光復南路封閉，請改道 市民大道四段，預計延誤 78.6 分鐘',
    multilingual_required: true,
    ...overrides,
  } as unknown as DecisionCore;
}

function reportNarrative(): DecisionNarrative {
  return {
    decision_id: DECISION,
    narrative_type: NarrativeType.REPORT,
    payload: { type: 'REPORT', report_text: '建議書內文' },
  } as unknown as DecisionNarrative;
}

function alertNarrative(): DecisionNarrative {
  return {
    decision_id: DECISION,
    narrative_type: NarrativeType.PUBLIC_ALERT,
    payload: { type: 'PUBLIC_ALERT', public_alert_text: { zh: '請改道', en: 'Please detour' } },
  } as unknown as DecisionNarrative;
}

function publishRecord(): PublishRecord {
  return {
    decision_id: DECISION,
    publish_state: PublishStatus.published,
    channels: ['CMS'],
    audit_trail: [],
    version: 1,
    updated_at: '2026-05-20 22:15',
  };
}

interface Ports extends ReadModelPorts {
  readonly readCore: ReturnType<typeof vi.fn>;
  readonly readNarratives: ReturnType<typeof vi.fn>;
  readonly readPublish: ReturnType<typeof vi.fn>;
  readonly readIdempotency: ReturnType<typeof vi.fn>;
}

function createPorts(options?: {
  core?: DecisionCore | null;
  narratives?: readonly DecisionNarrative[];
  publish?: PublishRecord | null;
}): Ports {
  const readCore = vi.fn().mockResolvedValue(options?.core ?? null);
  const readNarratives = vi.fn().mockResolvedValue(options?.narratives ?? []);
  const readPublish = vi.fn().mockResolvedValue(options?.publish ?? null);
  const readIdempotency = vi.fn().mockResolvedValue(null);

  return {
    readCore,
    readNarratives,
    readPublish,
    readIdempotency,
    decisionCore: {
      getConsistent: readCore,
      exists: async (id: string) => (await readCore(id)) !== null,
    },
    decisionNarrative: { queryConsistent: readNarratives },
    publishRecord: { getConsistent: readPublish },
    idempotency: { getConsistent: readIdempotency },
  } as unknown as Ports;
}

function event(overrides: Partial<HttpGetEvent> = {}): HttpGetEvent {
  return {
    pathParameters: { decision_id: DECISION },
    requestContext: { requestId: REQUEST_ID },
    ...overrides,
  };
}

function bodyOf<T>(result: { body: string }): T {
  return JSON.parse(result.body) as T;
}

// ─── GET /decisions/{decision_id} ──────────────────────────

describe('GET /decisions/{decision_id}', () => {
  it('returns 200 with the merged read model', async () => {
    const handler = createGetDecisionHandler(
      createPorts({
        core: core(),
        narratives: [reportNarrative(), alertNarrative()],
        publish: publishRecord(),
      }),
    );

    const result = await handler(event());

    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toBe('application/json');
    const body = bodyOf<DecisionReadModel>(result);
    expect(body.decision_id).toBe(DECISION);
    expect(body.core?.primary_evacuation).toBe('RD_TPE_004');
    expect(body.publish?.publish_state).toBe(PublishStatus.published);
  });

  it('echoes the API Gateway request id as trace_id', async () => {
    const handler = createGetDecisionHandler(createPorts({ core: core() }));

    const result = await handler(event());

    expect(bodyOf<DecisionReadModel>(result).trace_id).toBe(REQUEST_ID);
  });

  it('returns 200 with insufficient_data when no core is committed (not 404)', async () => {
    const handler = createGetDecisionHandler(createPorts({ core: null }));

    const result = await handler(event());

    expect(result.statusCode).toBe(200);
    expect(result.statusCode).not.toBe(404);
    const body = bodyOf<DecisionReadModel>(result);
    expect(body.data_status).toBe('insufficient_data');
    expect(body.core).toBeNull();
  });

  it('returns 200 with partial while narrative text is still pending', async () => {
    const handler = createGetDecisionHandler(
      createPorts({ core: core(), narratives: [reportNarrative()] }),
    );

    const result = await handler(event());

    const body = bodyOf<DecisionReadModel>(result);
    expect(body.data_status).toBe('partial');
    expect(body.missing_narrative_types).toEqual([
      NarrativeType.PUBLIC_ALERT,
      NarrativeType.EXPLANATION,
    ]);
  });

  it('includes the execution projection when an idempotency key is supplied', async () => {
    const ports = createPorts({ core: core() });
    const handler = createGetDecisionHandler(ports);

    await handler(event({ queryStringParameters: { idempotency_key: KEY } }));

    expect(ports.readIdempotency).toHaveBeenCalledWith(KEY);
  });

  it('omits the execution projection when no key is supplied', async () => {
    const ports = createPorts({ core: core() });
    const handler = createGetDecisionHandler(ports);

    const result = await handler(event());

    expect(ports.readIdempotency).not.toHaveBeenCalled();
    expect(bodyOf<DecisionReadModel>(result).execution).toBeNull();
  });

  it('returns 400 with the unified envelope when the path parameter is missing', async () => {
    const handler = createGetDecisionHandler(createPorts({ core: core() }));

    const result = await handler(event({ pathParameters: {} }));

    expect(result.statusCode).toBe(400);
    const body = bodyOf<{ error_code: string; trace_id: string; retryable: boolean }>(result);
    expect(body.error_code).toBe('VALIDATION_FAILED');
    expect(body.trace_id).toBe(REQUEST_ID);
    expect(body.retryable).toBe(false);
  });

  it('returns 400 for a blank path parameter', async () => {
    const handler = createGetDecisionHandler(createPorts({ core: core() }));

    const result = await handler(event({ pathParameters: { decision_id: '   ' } }));

    expect(result.statusCode).toBe(400);
  });

  it('maps a downstream read failure to 500, not to insufficient_data', async () => {
    const ports = createPorts({ core: core() });
    ports.readCore.mockRejectedValue(
      new TableReadError('boom', 'DecisionCoreTable', 'GetItem', DECISION),
    );
    const handler = createGetDecisionHandler(ports);

    const result = await handler(event());

    expect(result.statusCode).toBe(500);
    expect(bodyOf<{ error_code: string }>(result).error_code).toBe('INTERNAL_ERROR');
  });

  it('maps throttling to 429 retryable', async () => {
    const ports = createPorts({ core: core() });
    ports.readCore.mockRejectedValue(
      Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' }),
    );
    const handler = createGetDecisionHandler(ports);

    const result = await handler(event());

    expect(result.statusCode).toBe(429);
    expect(bodyOf<{ retryable: boolean }>(result).retryable).toBe(true);
  });

  it('never leaks internal detail into the error body', async () => {
    const ports = createPorts({ core: core() });
    ports.readCore.mockRejectedValue(new Error('SECRET table arn detail'));
    const handler = createGetDecisionHandler(ports);

    const result = await handler(event());

    expect(result.body).not.toContain('stack');
    expect(JSON.parse(result.body)).not.toHaveProperty('cause');
  });

  it('still produces a trace id when the request context is absent', async () => {
    const handler = createGetDecisionHandler(createPorts({ core: core() }));

    const result = await handler(event({ requestContext: undefined }));

    expect(bodyOf<DecisionReadModel>(result).trace_id).toMatch(/^trace-unavailable-/);
  });
});

// ─── GET /reports/{decision_id} ────────────────────────────

describe('GET /reports/{decision_id}', () => {
  it('returns the report and alert payloads with deterministic facts', async () => {
    const handler = createGetReportHandler(
      createPorts({ core: core(), narratives: [reportNarrative(), alertNarrative()] }),
    );

    const result = await handler(event());

    expect(result.statusCode).toBe(200);
    const body = bodyOf<GetReportResponseBody>(result);
    expect(body.report?.report_text).toBe('建議書內文');
    expect(body.alert?.public_alert_text).toEqual({ zh: '請改道', en: 'Please detour' });
  });

  it('echoes numbers from DecisionCore, not from narrative text (§9)', async () => {
    const handler = createGetReportHandler(
      createPorts({ core: core(), narratives: [reportNarrative()] }),
    );

    const result = await handler(event());

    expect(bodyOf<GetReportResponseBody>(result).facts).toMatchObject({
      event_id: 'TPE_2026_ACC_001',
      triggered_articles: [1, 2],
      applied_formula_articles: [7],
      primary_evacuation: 'RD_TPE_004',
      secondary_evacuation: ['RD_TPE_005'],
      ete_minutes: 78.6,
      multilingual_required: true,
    });
  });

  it('carries the LLM-prohibited cms_core_text from the core', async () => {
    const handler = createGetReportHandler(createPorts({ core: core() }));

    const result = await handler(event());

    expect(bodyOf<GetReportResponseBody>(result).facts.cms_core_text).toContain(
      '預計延誤 78.6 分鐘',
    );
  });

  it('returns null text (never invented wording) before the composer has run', async () => {
    const handler = createGetReportHandler(createPorts({ core: core(), narratives: [] }));

    const result = await handler(event());

    const body = bodyOf<GetReportResponseBody>(result);
    expect(body.report).toBeNull();
    expect(body.alert).toBeNull();
    // Facts are already available: the Fast Path does not wait for Bedrock.
    expect(body.facts.ete_minutes).toBe(78.6);
    expect(body.data_status).toBe('partial');
  });

  it('returns 200 with empty facts when no core is committed', async () => {
    const handler = createGetReportHandler(createPorts({ core: null }));

    const result = await handler(event());

    expect(result.statusCode).toBe(200);
    const body = bodyOf<GetReportResponseBody>(result);
    expect(body.data_status).toBe('insufficient_data');
    expect(body.facts).toMatchObject({
      event_id: null,
      triggered_articles: [],
      ete_minutes: null,
      cms_core_text: null,
    });
  });

  it('returns 400 when the path parameter is missing', async () => {
    const handler = createGetReportHandler(createPorts({ core: core() }));

    const result = await handler(event({ pathParameters: null }));

    expect(result.statusCode).toBe(400);
  });

  it('maps a downstream failure through the unified envelope', async () => {
    const ports = createPorts({ core: core() });
    ports.readNarratives.mockRejectedValue(
      new TableReadError('boom', 'DecisionNarrativeTable', 'Query', DECISION),
    );
    const handler = createGetReportHandler(ports);

    const result = await handler(event());

    expect(result.statusCode).toBe(500);
    expect(bodyOf<{ trace_id: string }>(result).trace_id).toBe(REQUEST_ID);
  });
});
