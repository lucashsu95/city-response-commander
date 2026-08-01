/**
 * Demo API Handler — single Lambda for all demo endpoints
 *
 * Routes HTTP API v2 requests using rawPath and method.
 * Data is set at Lambda cold-start via setDemoData().
 *
 * @module backend/demo/demo_api_handler
 */

import { IncidentStatus, IncidentType, Severity, Language } from '@city-commander/shared-schemas';
import type {
  RawTrafficRecord,
  RawCrowdRecord,
  Incident,
  DecisionCore,
  PublicAlertPayload,
} from '@city-commander/shared-schemas';
import type { RoadNetworkModel, SOPLoadResult } from '@city-commander/domain';
import type { NormalizedTimestamp } from '@city-commander/domain';
import {
  classifySegments,
  evaluateArticle1,
  isArticle2Triggered,
  evaluateArticle3,
  aggregateArticles,
  calculateEte,
  selectLatestCommonExactSnapshot,
  incidentPrimaryAndSelectedSecondary,
  displayOnlyAffectedRoadStrategy,
  incidentAnchorFromLocationText,
  qualifyCandidates,
  selectEvacuation,
  buildEvidenceTrace,
  buildDecisionCore,
} from '@city-commander/domain';
import { SnapshotSelector, type SnapshotSelectorConfigProvider } from '@city-commander/domain';
// NOTE: The Bedrock invocation for the demo `/what-if` route now lives in
// `packages/backend/src/whatif/production_bedrock_invoker.ts`, wired by
// `production_handler.ts`. The demo Lambda no longer calls Bedrock directly.

// ─── Data container ───────────────────────────────────────────────────────────

export interface DemoDataSet {
  traffic: readonly RawTrafficRecord[];
  trafficTimestamps: readonly NormalizedTimestamp[];
  crowd: readonly RawCrowdRecord[];
  crowdTimestamps: readonly NormalizedTimestamp[];
  roadNetwork: RoadNetworkModel;
  sopArticles: SOPLoadResult;
  incidents: readonly Incident[];
}

// ─── Module-level singleton (populated by Lambda cold-start) ─────────────────

let _data: DemoDataSet | null = null;

export function setDemoData(data: DemoDataSet): void {
  _data = data;
}

// ─── API Gateway v2 types ─────────────────────────────────────────────────

export interface APIGatewayProxyEvent {
  requestContext?: { http?: { method?: string; path?: string } };
  rawPath?: string;
  body?: string | null;
  queryStringParameters?: Record<string, string> | null;
  headers?: Record<string, string> | null;
  isBase64Encoded?: boolean;
}

export interface APIGatewayProxyResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

// ─── CORS headers ───────────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

// ─── JSON helper ───────────────────────────────────────────────────────────

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}

function notFound(path: string): APIGatewayProxyResult {
  return jsonResponse(404, { error: 'Not found', path });
}

// ─── GET /test page ───────────────────────────────────────────────────────

function buildTestPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>City Response Commander — Backend Test Console</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f1923;color:#e8eaed;min-height:100vh;padding:20px}
h1{color:#00d4ff;font-size:1.5rem;margin-bottom:6px}
.subtitle{color:#8ab4f8;font-size:.85rem;margin-bottom:24px}
.section{background:#1c2a38;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #2d4a5e}
.section-title{color:#00d4ff;font-size:.9rem;margin-bottom:12px;font-weight:600}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
button{background:#00d4ff;color:#0f1923;border:none;border-radius:6px;padding:8px 16px;font-size:.85rem;cursor:pointer;font-weight:600;transition:opacity .2s}
button:hover{opacity:.85}
.btn-primary{background:#00d4ff}
.btn-incident{background:#ff7043}
.btn-whatif{background:#ab47bc}
.btn-alert{background:#66bb6a}
textarea{width:100%;background:#0d1b26;border:1px solid #2d4a5e;border-radius:6px;color:#e8eaed;padding:10px;font-size:.8rem;font-family:monospace;resize:vertical;min-height:80px}
label{color:#8ab4f8;font-size:.75rem;margin-bottom:4px;display:block}
#response{background:#0d1b26;border:1px solid #2d4a5e;border-radius:6px;padding:12px;min-height:120px;white-space:pre-wrap;font-size:.8rem;font-family:monospace;overflow:auto;max-height:400px}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.7rem;margin-left:8px}
.badge-success{background:#2e7d32;color:#fff}
.badge-fallback{background:#f57c00;color:#fff}
pre{white-space:pre-wrap;word-break:break-all}
</style>
</head>
<body>
<h1>City Response Commander — Backend Test Console</h1>
<p class="subtitle">AWS Demo Backend | Region: us-west-2 | Deterministic Rule Engine + Bedrock NL Generation</p>

<div class="section">
<div class="section-title">API Status</div>
<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
<span id="statusDot" style="width:10px;height:10px;border-radius:50%;background:#c62828"></span>
<span id="statusText">Checking...</span>
<button onclick="testHealth()" style="margin-left:auto">Refresh Status</button>
</div>
</div>

<div class="section">
<div class="section-title">Data Loader</div>
<button class="btn-primary" onclick="loadTimeSeries()">Load Time-Series</button>
</div>

<div class="section">
<div class="section-title">Incident Processing</div>
<div class="row">
<button class="btn-incident" onclick="postIncident('ACC_001')">ACC_001 — Road Collapse</button>
<button class="btn-incident" onclick="postIncident('EVT_002')">EVT_002 — Crowd Surge</button>
</div>
</div>

<div class="section">
<div class="section-title">What-If Analysis (POST /what-if)</div>
<button class="btn-whatif" onclick="postWhatIf()">BL17 User_Count = 40,000</button>
<div style="margin-top:8px">
<label>Custom JSON Query（請輸入完整 WhatIfRequest）</label>
<textarea id="whatifQuery" placeholder='{"query":"若 BS_MRT_BL17 的 User_Count 增至 40000"}'>{"query":"若 BS_MRT_BL17 的 User_Count 增至 40000"}</textarea>
<button class="btn-whatif" onclick="postCustomWhatIf()" style="margin-top:4px">Execute Custom</button>
</div>
</div>

<div class="section">
<div class="section-title">Multilingual Alert</div>
<button class="btn-alert" onclick="postAlert()">BL17 Roaming Alert (zh/en/ja/ko)</button>
</div>

<div class="section">
<div class="section-title">Request / Response</div>
<label>Request Body (JSON)</label>
<textarea id="reqBody" placeholder='{"event_id":"ACC_001"}'></textarea>
<label>Response Output</label>
<div id="response">Waiting for request...</div>
</div>

<script>
const API = window.location.origin;

function showResponse(data, latency, source) {
  const div = document.getElementById('response');
  let badge = '';
  if (source === 'bedrock') badge = '<span class="badge badge-success">Bedrock</span>';
  else if (source === 'template_fallback' || source === 'deterministic') badge = '<span class="badge badge-fallback">Deterministic</span>';
  div.innerHTML = '<span style="color:#8ab4f8">Latency: ' + latency.toFixed(0) + 'ms</span> ' + badge + '<hr style="border-color:#2d4a5e;margin:8px 0"><pre>' + JSON.stringify(data, null, 2) + '</pre>';
}

async function testHealth() {
  const t0 = Date.now();
  try {
    const r = await fetch(API + '/health');
    const d = await r.json();
    document.getElementById('statusDot').style.background = '#2e7d32';
    document.getElementById('statusText').textContent = 'Online — ' + d.timestamp;
    showResponse(d, Date.now() - t0, 'system');
  } catch(e) {
    document.getElementById('statusText').textContent = 'Error: ' + e.message;
  }
}

async function loadTimeSeries() {
  const t0 = Date.now();
  const r = await fetch(API + '/demo/timeseries');
  const d = await r.json();
  showResponse(d, Date.now() - t0, 'system');
}

async function postIncident(id) {
  document.getElementById('reqBody').value = JSON.stringify({event_id:id});
  const t0 = Date.now();
  const r = await fetch(API + '/demo/incidents', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({event_id:id})});
  const d = await r.json();
  showResponse(d, Date.now() - t0, d.text_source || 'system');
}

async function postWhatIf() {
  const q = '{"query":"若 BS_MRT_BL17 的 User_Count 增至 40000"}';
  document.getElementById('reqBody').value = q;
  document.getElementById('whatifQuery').value = q;
  const t0 = Date.now();
  const r = await fetch(API + '/what-if', {method:'POST', headers:{'Content-Type':'application/json'}, body:q});
  const d = await r.json();
  showResponse(d, Date.now() - t0, d.text_source || 'system');
}

async function postCustomWhatIf() {
  const raw = (document.getElementById('whatifQuery').value || '').trim();
  if (raw.length === 0) {
    alert('請輸入 What-if 假設問題。');
    return;
  }
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body.query !== 'string' || body.query.trim().length === 0) {
      alert('Body 必須包含非空字串欄位 "query"。');
      return;
    }
    document.getElementById('reqBody').value = JSON.stringify(body);
    const t0 = Date.now();
    const r = await fetch(API + '/what-if', {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(body)});
    const d = await r.json();
    showResponse(d, Date.now() - t0, d.text_source || 'system');
  } catch(e) { alert('Invalid JSON: ' + e.message); }
}

async function postAlert() {
  const body = {station_id:'BL17', roaming_users:3000, station_capacity:10000, languages:['zh','en','ja','ko']};
  document.getElementById('reqBody').value = JSON.stringify(body);
  const t0 = Date.now();
  const r = await fetch(API + '/demo/alerts', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  const d = await r.json();
  showResponse(d, Date.now() - t0, d.text_source || 'system');
}

testHealth();
</script>
</body>
</html>`;
}

// ─── Route: GET /health ────────────────────────────────────────────────────

function handleHealth(): APIGatewayProxyResult {
  return jsonResponse(200, {
    status: 'online',
    service: 'city-response-commander-demo-backend',
    region: 'us-west-2',
    demo_mode: process.env['DEMO_MODE'] ?? 'true',
    data_loaded: _data !== null,
    timestamp: new Date().toISOString(),
  });
}

// ─── Route: GET /demo/timeseries ───────────────────────────────────────────

function handleTimeSeries(): APIGatewayProxyResult {
  const data = _data;
  if (!data) return jsonResponse(500, { error: 'Data not loaded' });

  return jsonResponse(200, {
    data_status: 'ready',
    timeline: data.trafficTimestamps.slice(0, 10).map((ts) => ts.timestamp_display),
    traffic: data.traffic.slice(0, 5),
    crowd: data.crowd.slice(0, 5),
    stations: [...new Set(data.crowd.map((r) => r.BS_ID))].slice(0, 10),
  });
}

// ─── Route: POST /demo/incidents ──────────────────────────────────────────

// Minimal config for SnapshotSelector
interface DemoConfig {
  get(key: string): string | number;
}
const DEMO_CONFIG_DEFAULTS: Record<string, string | number> = {
  'policy.time_alignment.mode': 'exact_or_latest_prior_per_entity',
  'policy.time_alignment.max_staleness_minutes': 30,
  'policy.affected_road.role': 'display_only',
  'policy.ete.affected_set': 'incident_primary_and_selected_secondary',
  'policy.incident_anchor.mode': 'incident_anchor_from_location_text',
  'policy.affected_intersection_scope.mode': 'unresolved_manual_confirmation',
  'policy.multilingual_scope.mode': 'current_snapshot_all_available_stations',
};
function makeConfig(): DemoConfig {
  return {
    get: (key: string) =>
      DEMO_CONFIG_DEFAULTS[key] ??
      (() => {
        throw new Error(`missing ${key}`);
      })(),
  };
}

function findIncident(incidents: readonly Incident[], eventId: string): Incident {
  const exact = incidents.find((i) => i.event_id === eventId);
  if (exact) return exact;
  const lower = eventId.toLowerCase();
  const partial = incidents.find(
    (i) => i.event_id.toLowerCase().includes(lower) || lower.includes(i.event_id.toLowerCase()),
  );
  if (partial) return partial;
  throw new Error(`Incident not found: ${eventId}`);
}

function handleIncident(body: string | null | undefined): APIGatewayProxyResult {
  const data = _data;
  if (!data) return jsonResponse(500, { error: 'Data not loaded' });

  let parsed: { event_id?: unknown };
  try {
    parsed = JSON.parse(body ?? '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }
  if (!parsed.event_id) return jsonResponse(400, { error: 'Missing event_id' });

  const eventId = String(parsed.event_id).trim();
  let incident: Incident;
  try {
    incident = findIncident(data.incidents, eventId);
  } catch (e) {
    return jsonResponse(404, { error: (e as Error).message });
  }

  const config = makeConfig();

  // Traffic classification — RawTrafficRecord uses Segment_ID and Saturation_Score
  const primaryTraffic = data.traffic.filter((r) => r.Segment_ID === incident.affected_segment);
  const satScore =
    primaryTraffic.length > 0 ? primaryTraffic[primaryTraffic.length - 1].Saturation_Score : 0;
  const classifications = classifySegments([
    { segment_id: incident.affected_segment, saturation_score: satScore },
  ]);

  // Article evaluations
  const art1 = evaluateArticle1(classifications);
  const art2Trig = isArticle2Triggered(incident);

  let art3Trig = false;
  let art3Adds: number[] = [];
  if (incident.type === IncidentType.Crowd_Surge_Injury) {
    const selector = new SnapshotSelector(config as SnapshotSelectorConfigProvider);
    const targetTime = incident.timestamp
      ? new Date(incident.timestamp.replace(' ', 'T'))
      : new Date();
    // RawCrowdRecord uses BS_ID, User_Count, Growth_Rate
    const crowdRecords = data.crowd
      .filter((r) => r.BS_ID === incident.affected_segment)
      .map((r) => ({
        timestamp_normalized: new Date(r.timestamp_raw.replace(/\//g, '-')),
        user_count: r.User_Count,
        growth_rate: r.Growth_Rate,
      }))
      .sort((a, b) => b.timestamp_normalized.getTime() - a.timestamp_normalized.getTime());
    const selected = selector.select(incident.affected_segment, targetTime, crowdRecords);
    if (selected.record) {
      const art3 = evaluateArticle3({
        bs_id: incident.affected_segment,
        user_count: selected.record.user_count,
        growth_rate: selected.record.growth_rate,
      });
      art3Trig = art3.triggered;
      art3Adds = [...(art3.adds_to_triggered_articles ?? [])];
    }
  }

  // Evacuation
  const anchor = incidentAnchorFromLocationText.resolve(incident, data.roadNetwork, {
    mode: 'incident_anchor_from_location_text',
  });
  const candidateScores = new Map<string, number>();
  const allSegments = data.roadNetwork.getAllSegments();
  for (const seg of allSegments) {
    if (seg.segment_id !== incident.affected_segment) {
      const rec = data.traffic.find((r) => r.Segment_ID === seg.segment_id);
      if (rec) candidateScores.set(seg.segment_id, rec.Saturation_Score);
    }
  }
  const candidates = qualifyCandidates(
    incident.affected_segment,
    anchor.anchor_intersection,
    data.roadNetwork,
    candidateScores,
  );
  const evacuation = selectEvacuation(candidates);

  // Article aggregation
  const triggeredArticles: number[] = [1];
  const invokedProcedures: string[] = [];
  if (art1.triggered) invokedProcedures.push('article1_signal_control');
  if (art2Trig) {
    triggeredArticles.push(2);
    invokedProcedures.push('article2_alternative_route_guidance');
  }
  if (art3Trig) {
    art3Adds.forEach((a) => {
      if (!triggeredArticles.includes(a)) triggeredArticles.push(a);
    });
  }

  const articles = aggregateArticles({
    evaluations: triggeredArticles.map((a) => ({
      article: a,
      triggered: true,
      invoked_procedures: invokedProcedures,
    })),
    applied_formula_articles: [7] as const,
  });

  // ETE
  const affectedRoad = displayOnlyAffectedRoadStrategy.resolve(incident);
  const affectedSet = incidentPrimaryAndSelectedSecondary.resolve({
    incident,
    affected_road: affectedRoad,
    selected_primary_evacuation: evacuation.primary_evacuation,
    selected_secondary_evacuation: evacuation.secondary_evacuation,
  });
  const trafficReadings = affectedSet.affected_set.map((roadId) => {
    const rec = data.traffic.find((r) => r.Segment_ID === roadId);
    return {
      road_id: roadId,
      observation_timestamp: incident.timestamp ?? new Date().toISOString().slice(0, 16),
      saturation_score: rec?.Saturation_Score ?? 0.5,
    };
  });
  const snapshot = selectLatestCommonExactSnapshot({
    affected_set: affectedSet.affected_set,
    event_timestamp: incident.timestamp ?? new Date().toISOString().slice(0, 16),
    traffic_readings: trafficReadings,
  });
  const ete = calculateEte({
    severity: incident.severity ?? Severity.Critical,
    affected_set: affectedSet,
    snapshot_provenance: snapshot,
  });

  // Evidence trace
  const evidence = buildEvidenceTrace({
    decision_id: `demo-${incident.event_id}`,
    classification_reasoning: classifications.map((c) => ({
      segment_id: c.segment_id,
      value: satScore,
      threshold: '0.95',
      conclusion: c.level ?? 'NORMAL',
    })),
    excluded_candidates: evacuation.excluded_candidates,
    citation_article_set: articles.citation_article_set,
    sop_citations: articles.citation_article_set.map((n) => {
      const article = data.sopArticles.articles.find((a) => a.article_no === n);
      return {
        article_no: n,
        source_location: 'sop_kb',
        content: article?.text ?? `SOP Article ${n}`,
        score: 1.0,
      };
    }),
    data_points: [],
  });

  // Decision core
  const baseTime = incident.timestamp ?? new Date().toISOString().slice(0, 16);
  const core = buildDecisionCore({
    decision_id: `demo-${incident.event_id}`,
    idempotency_key: `demo|${incident.event_id}|${baseTime}|deterministic`,
    injection_run_id: `demo-run-${incident.event_id}`,
    workflow_execution_name: 'demo-execution',
    version: 1,
    source_manifest_hash: 'demo-hash',
    event_id: incident.event_id,
    occurred_at: baseTime,
    event_facts: {
      type: incident.type,
      location: incident.location ?? '',
      affected_segment: incident.affected_segment,
      affected_road: incident.affected_road ?? '',
      status: incident.status,
      severity: incident.severity,
      description: incident.description ?? '',
      timestamp: baseTime,
    },
    triggered_articles: articles.triggered_articles,
    applied_formula_articles: articles.applied_formula_articles,
    invoked_procedures: articles.invoked_procedures,
    classifications,
    incident_anchor: anchor,
    primary_evacuation: evacuation.primary_evacuation,
    secondary_evacuation: evacuation.secondary_evacuation,
    excluded_candidates: evacuation.excluded_candidates,
    multilingual_required: art3Trig,
    ete,
    evidence,
    policy: {
      classification: 'PROVISIONAL_TEAM_POLICY',
      status: 'AWAITING_HOST_REPLY',
      is_official: false,
      guidance_id: 'HG-001',
      official_golden_answer: false,
      time_alignment: {
        mode: 'exact_or_latest_prior_per_entity',
        max_staleness_minutes: 30,
        on_insufficient: 'insufficient_data',
      },
      affected_road: { role: 'display_only' },
      ete: { affected_set: 'incident_primary_and_selected_secondary' },
      incident_anchor: { mode: 'incident_anchor_from_location_text' },
      affected_intersection_scope: { mode: 'unresolved_manual_confirmation' },
      multilingual_scope: { mode: 'current_snapshot_all_available_stations' },
      saturated_vs_congested: 'PARTIALLY_DEFINED',
    },
    cms_core_text: `${incident.affected_segment} — primary: ${evacuation.primary_evacuation}`,
    provisional: true,
    schema_version: '1.0.0',
  });

  return jsonResponse(200, {
    decision_id: core.decision_id,
    event_id: incident.event_id,
    incident_type: incident.type,
    location: incident.location,
    severity: incident.severity,
    triggered_articles: core.triggered_articles,
    invoked_procedures: core.invoked_procedures,
    primary_evacuation: core.primary_evacuation,
    secondary_evacuation: core.secondary_evacuation,
    ete: core.ete ? { ete_minutes: core.ete.ete_minutes, severity: core.ete.severity } : null,
    evidence_trace: evidence,
    cms_core_text: core.cms_core_text,
    data_status: 'ready',
    text_source: 'deterministic',
  });
}

// ─── Route: POST /demo/what-if (DEPRECATED — returns 410) ────────────────────

/**
 * The simplified keyword-based demo What-if handler has been retired.
 * The production What-if pipeline (four-stage Bedrock-backed handler) now
 * lives at `POST /what-if` on a dedicated Lambda. The old route returns
 * 410 Gone so callers that still POST here get an explicit migration
 * signal instead of silently receiving the simplified results.
 */
function handleDeprecatedWhatIf(): APIGatewayProxyResult {
  return jsonResponse(410, {
    error_code: 'GONE',
    message:
      'POST /demo/what-if has been retired. Use POST /what-if on the production ' +
      'four-stage What-if pipeline (deterministic Rule Engine + Bedrock explanation).',
    migration_target: '/what-if',
  });
}

// ─── Route: POST /demo/alerts ─────────────────────────────────────────────

function handleAlert(body: string | null | undefined): APIGatewayProxyResult {
  let parsed: {
    station_id?: unknown;
    roaming_users?: unknown;
    station_capacity?: unknown;
    languages?: unknown;
  };
  try {
    parsed = JSON.parse(body ?? '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }
  if (!parsed.station_id) return jsonResponse(400, { error: 'Missing station_id' });

  const station_id = String(parsed.station_id);
  const roaming_users = Number(parsed.roaming_users ?? 0);
  const station_capacity = Number(parsed.station_capacity ?? 1);
  const languages: string[] = Array.isArray(parsed.languages) ? parsed.languages : ['zh'];

  const roaming_ratio = station_capacity > 0 ? roaming_users / station_capacity : 0;
  const THRESHOLD = 0.3;
  const triggered = roaming_ratio >= THRESHOLD;

  const messages: Record<string, string> = {};
  if (triggered) {
    const ratioPct = (roaming_ratio * 100).toFixed(1);
    if (languages.includes('zh'))
      messages['zh'] =
        `【緊急通知】${station_id} 站目前人數已達容量的 ${ratioPct}%，請旅客注意安全，建議改至相鄰站點搭乘。`;
    if (languages.includes('en'))
      messages['en'] =
        `[URGENT] ${station_id} station is at ${ratioPct}% capacity. Please use caution and consider adjacent stations.`;
    if (languages.includes('ja'))
      messages['ja'] =
        `【緊急通知】${station_id}駅は現在:${ratioPct}%の容量に達しています。ホームの安全にご注意いただき，近隣駅の利用をご検討ください。`;
    if (languages.includes('ko'))
      messages['ko'] =
        `[긴급] ${station_id}역이 현재 수용량의 ${ratioPct}%에 도달했습니다. 플랫폼에서 안전에 주의하고 인접 역 이용을 고려해 주세요.`;
  }

  return jsonResponse(200, {
    triggered,
    roaming_ratio: Math.round(roaming_ratio * 1000) / 1000,
    threshold: THRESHOLD,
    station_id,
    roaming_users,
    station_capacity,
    messages,
    text_source: triggered ? 'template' : 'none',
  });
}

// ─── Main handler factory ───────────────────────────────────────────────────

export function createDemoApiHandler(): (
  event: APIGatewayProxyEvent,
) => Promise<APIGatewayProxyResult> {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const path = event.rawPath ?? event.requestContext?.http?.path ?? '/';
      const method = event.requestContext?.http?.method ?? 'GET';

      if (method === 'OPTIONS') {
        return { statusCode: 204, headers: CORS_HEADERS, body: '' };
      }

      if (method === 'GET' && (path === '/test' || path === '/' || path === '')) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS },
          body: buildTestPage(),
        };
      }

      if (method === 'GET' && path === '/health') {
        return handleHealth();
      }

      if (method === 'GET' && path === '/demo/timeseries') {
        return handleTimeSeries();
      }

      if (method === 'POST' && path === '/demo/incidents') {
        return handleIncident(event.body);
      }

      if (method === 'POST' && (path === '/demo/what-if' || path === '/demo/whatif')) {
        return handleDeprecatedWhatIf();
      }

      if (method === 'POST' && path === '/demo/alerts') {
        return handleAlert(event.body);
      }

      return notFound(path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Handler error:', message);
      return jsonResponse(500, { error: 'Internal error', message });
    }
  };
}
