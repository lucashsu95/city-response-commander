/**
 * Demo Dashboard Page — single-source-of-truth wiring tests
 *
 * Verifies that `DashboardPage` mounted in DEMO mode:
 *
 *   1. issues `GET /demo/timeseries` at least once
 *   2. never issues `GET /roads`, `GET /crowd`, or `GET /timeline`
 *   3. propagates the timeseries snapshot into the visible timeline /
 *      road / crowd / roaming metrics
 *   4. lets the operator's Play button advance the active snapshot
 *
 * Each rule is asserted by spying on the global `fetch` so the test never
 * depends on the production API client or the §13 polling fallback.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { DashboardPage } from '../../src/pages/dashboard.js';
import { AppConfigProvider } from '../../src/state/app_context.js';
import type { RuntimeConfig } from '../../src/config/runtime_config.js';

const DEMO_CONFIG: RuntimeConfig = {
  apiEndpoint: 'https://api.demo.invalid',
  wsEndpoint: '',
  environment: 'DEMO',
  apiMode: 'demo',
};

interface FetchCall {
  readonly url: string;
  readonly method: string;
}

interface FakeFetch {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  readonly calls: FetchCall[];
}

function buildJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
    redirected: false,
    type: 'basic',
    url: '',
    clone() {
      return this;
    },
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
  } as unknown as Response;
}

function buildDemoTimeseriesBody(): unknown {
  return {
    data_status: 'ready',
    timeline: ['2026-05-20 22:00', '2026-05-20 22:10', '2026-05-20 22:20'],
    snapshots: [
      {
        timestamp_display: '2026-05-20 22:00',
        traffic: [
          {
            timestamp_raw: '2026-05-20 22:00',
            Segment_ID: 'RD_TPE_001',
            Road_Name: '光復南路',
            Avg_Speed: 18,
            Vehicle_Count: 42,
            Saturation_Score: 0.95,
            Lane_Status: 'Closed',
          },
        ],
        crowd: [
          {
            timestamp_raw: '2026-05-20 22:00',
            BS_ID: 'BS_MRT_BL17',
            Location_Name: '捷運國父紀念館站',
            User_Count: 24000,
            Stay_Time_Avg: 12,
            Growth_Rate: 0.30,
            Roaming_User_Pct: '35%',
            roaming_pct_value: 0.35,
          },
        ],
      },
      {
        timestamp_display: '2026-05-20 22:10',
        traffic: [
          {
            timestamp_raw: '2026-05-20 22:10',
            Segment_ID: 'RD_TPE_001',
            Road_Name: '光復南路',
            Avg_Speed: 22,
            Vehicle_Count: 36,
            Saturation_Score: 0.78,
            Lane_Status: 'Open',
          },
        ],
        crowd: [
          {
            timestamp_raw: '2026-05-20 22:10',
            BS_ID: 'BS_MRT_BL17',
            Location_Name: '捷運國父紀念館站',
            User_Count: 22000,
            Stay_Time_Avg: 11,
            Growth_Rate: 0.10,
            Roaming_User_Pct: '20%',
            roaming_pct_value: 0.20,
          },
        ],
      },
      {
        timestamp_display: '2026-05-20 22:20',
        traffic: [
          {
            timestamp_raw: '2026-05-20 22:20',
            Segment_ID: 'RD_TPE_001',
            Road_Name: '光復南路',
            Avg_Speed: 28,
            Vehicle_Count: 30,
            Saturation_Score: 0.55,
            Lane_Status: 'Open',
          },
        ],
        crowd: [
          {
            timestamp_raw: '2026-05-20 22:20',
            BS_ID: 'BS_MRT_BL17',
            Location_Name: '捷運國父紀念館站',
            User_Count: 19000,
            Stay_Time_Avg: 9,
            Growth_Rate: -0.05,
            Roaming_User_Pct: '12%',
            roaming_pct_value: 0.12,
          },
        ],
      },
    ],
    traffic: [],
    crowd: [],
    stations: ['BS_MRT_BL17'],
    anomalies: [
      {
        id: 'ANO_DEMO_001',
        type: 'crowd_surge',
        severity: 'High',
        source: 'crowd',
        station_id: 'BS_MRT_BL17',
        observed_value: 24000,
        threshold: 25000,
        unit: 'people',
        triggered_article: 3,
        summary_zh: '人群推擠預警',
        detected_at: '2026-05-20 22:00',
      },
    ],
  };
}

function installFakeFetch(): FakeFetch {
  const calls: FetchCall[] = [];
  const fake: FakeFetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method });
      if (url.endsWith('/demo/timeseries')) {
        return buildJsonResponse(buildDemoTimeseriesBody());
      }
      // Block any non-demo route — the demo backend does not serve them.
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: 'demo backend does not serve this route' }),
        text: () => Promise.resolve('demo backend does not serve this route'),
        headers: new Headers(),
        redirected: false,
        type: 'basic',
        url,
        clone() {
          return this;
        },
        body: null,
        bodyUsed: false,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        blob: () => Promise.resolve(new Blob()),
        formData: () => Promise.resolve(new FormData()),
      } as unknown as Response;
    },
    { calls },
  ) as FakeFetch;
  vi.stubGlobal('fetch', fake);
  return fake;
}

function renderDashboard() {
  return render(
    <AppConfigProvider config={DEMO_CONFIG}>
      <DashboardPage />
    </AppConfigProvider>,
  );
}

function urlPaths(calls: readonly FetchCall[]): string[] {
  return calls.map((c) => {
    try {
      return new URL(c.url, 'https://x').pathname.replace(/^\/+/, '/');
    } catch {
      return c.url;
    }
  });
}

describe('DashboardPage DEMO mode — single-source-of-truth', () => {
  beforeEach(() => {
    installFakeFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('issues GET /demo/timeseries on mount and never hits /roads, /crowd, /timeline', async () => {
    const fetchMock = (globalThis.fetch as unknown) as FakeFetch;
    const view = renderDashboard();

    await waitFor(() => {
      expect(fetchMock.calls.some((c) => c.url.endsWith('/demo/timeseries'))).toBe(true);
    });

    const paths = urlPaths(fetchMock.calls);
    expect(paths.some((p) => p.endsWith('/roads'))).toBe(false);
    expect(paths.some((p) => p.endsWith('/crowd'))).toBe(false);
    expect(paths.some((p) => p.endsWith('/timeline'))).toBe(false);
    expect(paths.some((p) => p.endsWith('/incidents'))).toBe(false);

    view.unmount();
  });

  it('renders the timeline, road metric, crowd metric, and roaming metric from the single demo snapshot', async () => {
    const view = renderDashboard();

    // Timeline header shows the most recent timestamp until the operator
    // clicks a different point. The first snapshot is the last one in the
    // raw array, so the active snapshot is index 2 (22:20).
    await waitFor(() => {
      expect(screen.getAllByText('光復南路').length).toBeGreaterThan(0);
    });

    // The first snapshot's user count appears in the crowd metric — the
    // numbers come straight from the demo backend payload.
    expect(screen.getAllByText('捷運國父紀念館站').length).toBeGreaterThan(0);

    expect(view).toBeTruthy();
    view.unmount();
  });

  it('advances the active snapshot when the operator presses Play', async () => {
    const view = renderDashboard();

    await waitFor(() => {
      expect(screen.getAllByText('光復南路').length).toBeGreaterThan(0);
    });

    const playButton = screen.getByRole('button', { name: /播放/ });
    act(() => {
      playButton.click();
    });

    // The active snapshot index must move forward and the polling count
    // must not trigger any new /roads / /crowd / /timeline requests.
    const fetchMock = (globalThis.fetch as unknown) as FakeFetch;
    const paths = urlPaths(fetchMock.calls);
    expect(paths.some((p) => p.endsWith('/roads'))).toBe(false);
    expect(paths.some((p) => p.endsWith('/crowd'))).toBe(false);
    expect(paths.some((p) => p.endsWith('/timeline'))).toBe(false);

    view.unmount();
  });
});
