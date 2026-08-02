import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoApiClient } from '../../src/api/demo_api_adapter.js';

const fetchMock = vi.fn();

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function criticalIncidentWithoutMultilingualAlert(): Record<string, unknown> {
  return {
    decision_id: 'demo-TPE_2026_ACC_001',
    event_id: 'TPE_2026_ACC_001',
    incident_type: 'Road_Collapse_Accident',
    location: '光復南路與忠孝東路口南側',
    severity: 'Critical',
    triggered_articles: [1, 2],
    invoked_procedures: [],
    primary_evacuation: 'RD_TPE_004',
    secondary_evacuation: [],
    ete: {
      ete_minutes: 64.4,
      severity: 'Critical',
      recovery_at: null,
      base_timestamp: null,
      timezone: null,
    },
    evidence_trace: {},
    cms_core_text: 'RD_TPE_002 — primary: RD_TPE_004',
    data_status: 'ready',
    text_source: 'deterministic',
    public_alerts: {
      multilingual_required: false,
      languages: ['zh', 'en'],
      messages: {
        zh: '中文警示',
        en: 'English alert',
      },
    },
  };
}

describe('Demo API adapter multilingual trigger projection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('honors public_alerts.multilingual_required=false for a Critical incident', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse(criticalIncidentWithoutMultilingualAlert()));

    const client = createDemoApiClient({ baseEndpoint: 'https://api.example.com' });
    const result = await client.postInject('TPE_2026_ACC_001', {});

    expect(result.ok).toBe(true);
    const view = client.getDemoDecisionView('TPE_2026_ACC_001');
    expect(view?.publicAlerts?.multilingual_required).toBe(false);
    expect(view?.multilingualRequired).toBe(false);
  });

  it('preserves Japanese and Korean messages from a triggered backend alert', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...criticalIncidentWithoutMultilingualAlert(),
        decision_id: 'demo-TPE_2026_EVT_002',
        event_id: 'TPE_2026_EVT_002',
        severity: 'High',
        public_alerts: {
          multilingual_required: true,
          languages: ['zh', 'en', 'ja', 'ko'],
          messages: {
            zh: '中文警示',
            en: 'English alert',
            ja: '日本語の警告',
            ko: '한국어 경고',
          },
        },
      }),
    );

    const client = createDemoApiClient({ baseEndpoint: 'https://api.example.com' });
    const result = await client.postInject('TPE_2026_EVT_002', {});

    expect(result.ok).toBe(true);
    const view = client.getDemoDecisionView('TPE_2026_EVT_002');
    expect(view?.publicAlerts?.messages.ja).toBe('日本語の警告');
    expect(view?.publicAlerts?.messages.ko).toBe('한국어 경고');
    expect(view?.multilingualRequired).toBe(true);
  });
});
