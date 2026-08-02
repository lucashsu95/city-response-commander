/**
 * Demo API Handler — single Lambda for all demo endpoints
 *
 * Routes HTTP API v2 requests using rawPath and method.
 * Data is set at Lambda cold-start via setDemoData().
 *
 * Features implemented:
 *  - GET /demo/timeseries        → anomalies[] (SOP Art.1/3/4/6)
 *  - POST /demo/incidents        → control_center_recommendation + public_alerts
 *  - POST /demo/alerts           → multilingual alerts (SOP Art.6 roaming)
 *  - POST /decisions/{id}/publish → publish state machine + audit trail
 *
 * @module backend/demo/demo_api_handler
 */

import { IncidentStatus, IncidentType, Severity, Language, PublishStatus } from '@city-commander/shared-schemas';
import type {
  RawTrafficRecord,
  RawCrowdRecord,
  Incident,
  DecisionCore,
  DemoTimeseriesAnomaly,
  DemoControlCenterRecommendation,
  DemoPublicAlerts,
  DemoAlertResponse,
  PublishRecord,
  RagTrace,
  EteCalculationTrace,
  RouteReasoningTrace,
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
  SnapshotSelector,
  type SnapshotSelectorConfigProvider,
} from '@city-commander/domain';
// GZAE (Grey-Zone Arbitration Engine): same rule-engine module
// decision_pipeline.ts uses internally, re-exported from @city-commander/domain
// so this hand-assembled demo route can surface the same additive annotations
// (R1 self-blocked exclusion, R2 threshold-boundary trend pre-warning —
// including the SOP-3/4/6 crowd_pre_warnings extension, R3 signal conflicts,
// R4 cascading risk) instead of silently dropping them.
import {
  excludeSelfBlockedCandidates,
  diffSelfBlockedExclusions,
  detectPreWarning,
  detectSignalConflicts,
  buildAdjacencyGraph,
  detectCascadingRisk,
  detectSop3UserCountPreWarning,
  detectSop3GrowthRatePreWarning,
  detectSop4GrowthRatePreWarning,
  detectSop6RoamingPreWarning,
  type SaturationHistoryPoint,
  type NumericHistoryPoint,
} from '@city-commander/domain';
import type { CrowdPreWarning, SignalConflict, CascadingRisk } from '@city-commander/shared-schemas';
import {
  buildRagTrace,
  computeEte,
  buildRetrievalContext,
  buildRouteReasoningTrace,
} from '../reasoning/index.js';

// ─── SOP thresholds (from emergency_traffic_sop.txt) ───────────────────────────

const SOP_ART1_B_THRESHOLD = 0.85;
const SOP_ART1_A_THRESHOLD = 0.95;
const SOP_ART3_BL17_GROWTH_THRESHOLD = 0.30;
const SOP_ART3_BL17_USER_THRESHOLD = 25_000;
const SOP_ART4_DOME_PEAK_THRESHOLD = 30_000;
const SOP_ART4_DOME_GROWTH_THRESHOLD = -0.20;
const SOP_ART6_ROAMING_THRESHOLD = 0.30;

const SOP_ART7_BASE_CLEARANCE: Record<string, number> = {
  Critical: 60,
  High: 40,
  Medium: 20,
};

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

// ─── In-memory publish store (demo only, survives Lambda warm invocations) ───

interface InMemoryPublishRecord extends PublishRecord {
  readonly decision_id: string;
  readonly publish_state: PublishStatus;
  readonly channels: readonly string[];
  readonly approved_by?: string;
  readonly published_by?: string;
  readonly audit_trail: readonly {
    readonly actor: string;
    readonly action: string;
    readonly from_state: PublishStatus | null;
    readonly to_state: PublishStatus;
    readonly at: string;
  }[];
  readonly failure_reason?: string;
  readonly version: number;
  readonly updated_at: string;
}

const _publishStore = new Map<string, InMemoryPublishRecord>();

function formatAuditTs(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const min = String(now.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function createPublishRecord(
  decisionId: string,
  targetState: PublishStatus,
  actor: string,
  existing: InMemoryPublishRecord | null,
  channels: readonly string[],
  failureReason?: string,
): InMemoryPublishRecord {
  const version = (existing?.version ?? 0) + 1;
  const now = formatAuditTs();
  const action = targetState === PublishStatus.approved ? 'approved' : targetState === PublishStatus.published ? 'published' : 'mark_failed';
  const entry = {
    actor,
    action,
    from_state: existing?.publish_state ?? null,
    to_state: targetState,
    at: now,
  } as const;
  return {
    decision_id: decisionId,
    publish_state: targetState,
    channels,
    ...(targetState === PublishStatus.approved ? { approved_by: actor } : {}),
    ...(targetState === PublishStatus.published ? { published_by: actor } : {}),
    audit_trail: [...(existing?.audit_trail ?? []), entry],
    ...(failureReason ? { failure_reason: failureReason } : {}),
    version,
    updated_at: now,
  };
}

// ─── API Gateway v2 types ─────────────────────────────────────────────────────

export interface APIGatewayProxyEvent {
  requestContext?: {
    http?: { method?: string; path?: string };
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };
  rawPath?: string;
  pathParameters?: Record<string, string> | null;
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

// ─── CORS headers ─────────────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type,authorization',
};

const JSON_CONTENT_TYPE = { 'Content-Type': 'application/json; charset=utf-8' };

// ─── JSON helper ─────────────────────────────────────────────────────────────

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { ...JSON_CONTENT_TYPE, ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}

function notFound(path: string): APIGatewayProxyResult {
  return jsonResponse(404, { error: 'Not found', path });
}

// ─── Anomaly Analysis (GET /demo/timeseries) ─────────────────────────────────

/**
 * Analyzes the full traffic and crowd datasets for SOP threshold violations.
 *
 * SOP thresholds (from emergency_traffic_sop.txt):
 *   Art.1 — road saturation >= 0.85 (B級) or >= 0.95 (A級)
 *   Art.3 — BS_MRT_BL17 Growth_Rate > 0.30 or User_Count > 25,000
 *   Art.4 — BS_TPE_DOME historical peak >= 30,000 且 Growth_Rate <= -0.20
 *   Art.6 — any station Roaming_User_Pct >= 0.30
 *
 * Returns empty array when no anomalies are detected.
 * Does not mutate original traffic/crowd data.
 */
function analyzeAnomalies(
  traffic: readonly RawTrafficRecord[],
  crowd: readonly RawCrowdRecord[],
): DemoTimeseriesAnomaly[] {
  const anomalies: DemoTimeseriesAnomaly[] = [];
  const now = new Date().toISOString();

  // ── Article 1: Road saturation anomalies ────────────────────────────────
  for (const rec of traffic) {
    if (rec.Saturation_Score >= SOP_ART1_A_THRESHOLD) {
      anomalies.push({
        id: `art1-${rec.Segment_ID}-${rec.timestamp_raw ?? now}`,
        type: 'article1_saturation',
        severity: 'high',
        source: 'traffic',
        segment_id: rec.Segment_ID,
        observed_value: rec.Saturation_Score,
        threshold: SOP_ART1_A_THRESHOLD,
        unit: 'saturation_score',
        triggered_article: 1,
        summary_zh: `【SOP第1條】${rec.Road_Name}（${rec.Segment_ID}）飽和度達 ${rec.Saturation_Score}，超過A級門檻 ${SOP_ART1_A_THRESHOLD}，已達癱瘓等級，須啟動長綠燈時制。`,
        detected_at: rec.timestamp_raw ?? now,
      });
    } else if (rec.Saturation_Score >= SOP_ART1_B_THRESHOLD) {
      anomalies.push({
        id: `art1-${rec.Segment_ID}-${rec.timestamp_raw ?? now}`,
        type: 'article1_saturation',
        severity: 'medium',
        source: 'traffic',
        segment_id: rec.Segment_ID,
        observed_value: rec.Saturation_Score,
        threshold: SOP_ART1_B_THRESHOLD,
        unit: 'saturation_score',
        triggered_article: 1,
        summary_zh: `【SOP第1條】${rec.Road_Name}（${rec.Segment_ID}）飽和度達 ${rec.Saturation_Score}，超過B級門檻 ${SOP_ART1_B_THRESHOLD}，已達壅擠等級。`,
        detected_at: rec.timestamp_raw ?? now,
      });
    }
  }

  // ── Article 3: BL17 surge ───────────────────────────────────────────────
  const bl17Records = crowd.filter((r) => r.BS_ID === 'BS_MRT_BL17');
  if (bl17Records.length > 0) {
    const latest = bl17Records[bl17Records.length - 1];
    if (
      latest.Growth_Rate > SOP_ART3_BL17_GROWTH_THRESHOLD ||
      latest.User_Count > SOP_ART3_BL17_USER_THRESHOLD
    ) {
      const reason =
        latest.Growth_Rate > SOP_ART3_BL17_GROWTH_THRESHOLD && latest.User_Count > SOP_ART3_BL17_USER_THRESHOLD
          ? `成長率 ${latest.Growth_Rate}（門檻 >${SOP_ART3_BL17_GROWTH_THRESHOLD}）且人數 ${latest.User_Count}（門檻 >${SOP_ART3_BL17_USER_THRESHOLD}）`
          : latest.Growth_Rate > SOP_ART3_BL17_GROWTH_THRESHOLD
            ? `成長率 ${latest.Growth_Rate}（門檻 >${SOP_ART3_BL17_GROWTH_THRESHOLD}）`
            : `人數 ${latest.User_Count}（門檻 >${SOP_ART3_BL17_USER_THRESHOLD}）`;
      anomalies.push({
        id: `art3-bl17-${latest.timestamp_raw ?? now}`,
        type: 'article3_bl17_surge',
        severity: 'high',
        source: 'crowd',
        station_id: 'BS_MRT_BL17',
        observed_value: latest.Growth_Rate > SOP_ART3_BL17_GROWTH_THRESHOLD ? latest.Growth_Rate : latest.User_Count,
        threshold: latest.Growth_Rate > SOP_ART3_BL17_GROWTH_THRESHOLD ? SOP_ART3_BL17_GROWTH_THRESHOLD : SOP_ART3_BL17_USER_THRESHOLD,
        unit: latest.Growth_Rate > SOP_ART3_BL17_GROWTH_THRESHOLD ? 'growth_rate' : 'user_count',
        triggered_article: 3,
        summary_zh: `【SOP第3條】捷運國父紀念館站（BS_MRT_BL17）${reason}，已達捷運分流標準。建議北捷「過站不停」並調度接駁專車。`,
        detected_at: latest.timestamp_raw ?? now,
      });
    }
  }

  // ── Article 4: DOME dissipation ─────────────────────────────────────────
  const domeRecords = crowd.filter((r) => r.BS_ID === 'BS_TPE_DOME');
  if (domeRecords.length > 0) {
    const maxUserCount = Math.max(...domeRecords.map((r) => r.User_Count));
    const latest = domeRecords[domeRecords.length - 1];
    if (
      maxUserCount >= SOP_ART4_DOME_PEAK_THRESHOLD &&
      latest.Growth_Rate <= SOP_ART4_DOME_GROWTH_THRESHOLD
    ) {
      anomalies.push({
        id: `art4-dome-${latest.timestamp_raw ?? now}`,
        type: 'article4_dome_dissipation',
        severity: 'high',
        source: 'crowd',
        station_id: 'BS_TPE_DOME',
        observed_value: latest.Growth_Rate,
        threshold: SOP_ART4_DOME_GROWTH_THRESHOLD,
        unit: 'growth_rate',
        triggered_article: 4,
        summary_zh: `【SOP第4條】大巨蛋（BS_TPE_DOME）歷史峰值 ${maxUserCount} >= ${SOP_ART4_DOME_PEAK_THRESHOLD} 且當前成長率 ${latest.Growth_Rate} <= ${SOP_ART4_DOME_GROWTH_THRESHOLD}，判定為散場啟動。建議提前連動第3條接駁機制。`,
        detected_at: latest.timestamp_raw ?? now,
      });
    }
  }

  // ── Article 6: Roaming anomalies ───────────────────────────────────────
  for (const rec of crowd) {
    const roamingPct = rec.roaming_pct_value;
    if (roamingPct >= SOP_ART6_ROAMING_THRESHOLD) {
      anomalies.push({
        id: `art6-${rec.BS_ID}-${rec.timestamp_raw ?? now}`,
        type: 'article6_roaming',
        severity: 'high',
        source: 'crowd',
        station_id: rec.BS_ID,
        observed_value: roamingPct,
        threshold: SOP_ART6_ROAMING_THRESHOLD,
        unit: 'roaming_pct',
        triggered_article: 6,
        summary_zh: `【SOP第6條】${rec.Location_Name}（${rec.BS_ID}）漫遊率 ${(roamingPct * 100).toFixed(1)}%，超過 ${(SOP_ART6_ROAMING_THRESHOLD * 100).toFixed(0)}% 門檻。須同時發布多國語言簡訊及CMS看板訊息。`,
        detected_at: rec.timestamp_raw ?? now,
      });
    }
  }

  return anomalies;
}

// ─── Multilingual alert generation ────────────────────────────────────────────

/**
 * Generates multilingual public alert messages deterministically.
 * Called when Roaming_User_Pct >= 0.30 (SOP Art.6).
 */
function generateMultilingualAlert(params: {
  stationId: string;
  roamingPct: number;
  locationName?: string;
  languages?: readonly string[];
}): { messages: Record<string, string>; multilingual_required: boolean } {
  const langs = params.languages ?? ['zh', 'en'];
  const pct = (params.roamingPct * 100).toFixed(1);
  const messages: Record<string, string> = {};

  if (langs.includes('zh')) {
    messages.zh =
      `【緊急通知】${params.stationId} 站（${params.locationName ?? '園區'}) 目前漫遊旅客比例已達 ${pct}%，超過SOP第6條門檻 30%。` +
      `請旅客注意安全，配合現場引導或前往相鄰站點搭乘。`;
  }
  if (langs.includes('en')) {
    messages.en =
      `[URGENT] ${params.stationId} station has a roaming user ratio of ${pct}%, exceeding SOP Article 6 threshold of 30%. ` +
      `Please follow on-site guidance and consider adjacent stations.`;
  }
  if (langs.includes('ja')) {
    messages.ja =
      `【緊急通知】${params.stationId}駅(${params.locationName ?? '会場'})のローミングユーザー比率が${pct}%に達しました（SOP第6条閾値30%超過）。` +
      `現場誘導に従い，近隣駅の利用をご検討ください。`;
  }
  if (langs.includes('ko')) {
    messages.ko =
      `[긴급] ${params.stationId}역의 로밍 이용자 비율이 ${pct}%에 도달했습니다(SOP 제6조 기준 30% 초과). ` +
      `현장 안내에 따라 인접 역 이용을 고려해 주세요.`;
  }

  return {
    messages,
    multilingual_required: Object.keys(messages).length > 0,
  };
}

// ─── Public alerts for incident response ─────────────────────────────────────

function buildPublicAlerts(params: {
  incident: Incident;
  art3Triggered: boolean;
  art6Triggered: boolean;
  primaryEvacuation: string | null;
  eteMinutes?: number;
}): DemoPublicAlerts {
  const eteStr = params.eteMinutes !== undefined ? `${params.eteMinutes}` : '待評估';
  const location = params.incident.location ?? params.incident.affected_segment;

  // SOP Art.3: crowd surge → multilingual
  // SOP Art.6: roaming >= 30% → multilingual
  const multilingualRequired = params.art3Triggered || params.art6Triggered;
  const languages: readonly string[] = multilingualRequired ? ['zh', 'en', 'ja', 'ko'] : ['zh', 'en'];

  const msgs: Record<string, string> = {};
  if (multilingualRequired) {
    msgs.zh =
      `【交通應變】「${location}」發生${params.incident.type === 'Road_Collapse_Accident' ? '道路事故' : params.incident.type === 'Crowd_Surge_Injury' ? '人群意外' : '突發事件'}，` +
      `建議改道至${params.primaryEvacuation ?? '相鄰路段'}，預計延誤${eteStr}分鐘，請配合現場警力引導。`;
    msgs.en =
      `[TRAFFIC ALERT] ${params.incident.severity} incident at ${location}. ` +
      `Please use alternative route via ${params.primaryEvacuation ?? 'adjacent roads'}. ` +
      `Expected delay: ${eteStr} minutes. Follow on-site police guidance.`;
    msgs.ja =
      `【交通應変】${location}で${params.incident.severity}インシデントが発生しました。` +
      `${params.primaryEvacuation ?? '隣接道路'}への迂回をご検討ください。` +
      `予想遅延:${eteStr}分。現場警察の誘導に従ってください。`;
    msgs.ko =
      `[교통 대응] ${location}에서 ${params.incident.severity} 사고가 발생했습니다. ` +
      `${params.primaryEvacuation ?? '인접 도로'}로 우회해 주세요. 예상 지연: ${eteStr}분. 현장 경찰 안내에 따라 주세요.`;
  } else {
    msgs.zh = `【交通應變】「${location}」發生事件，請配合現場引導。`;
    msgs.en = `[TRAFFIC ALERT] Incident at ${location}. Please follow on-site guidance.`;
  }

  return {
    multilingual_required: multilingualRequired,
    languages: languages as readonly Language[],
    messages: msgs as DemoPublicAlerts['messages'],
    triggered_article: multilingualRequired ? (params.art3Triggered ? 3 : 6) : null,
    text_source: 'deterministic',
  };
}

// ─── Control Center Recommendation ─────────────────────────────────────────────

function buildControlCenterRecommendation(params: {
  incident: Incident;
  satScore: number;
  level: 'A' | 'B' | null;
  art1Triggered: boolean;
  art2Triggered: boolean;
  art3Triggered: boolean;
  art5Triggered: boolean;
  triggeredArticles: readonly number[];
  primaryEvacuation: string | null;
  secondaryEvacuation: readonly string[];
  excludedCandidates: readonly string[];
  eteMinutes?: number;
  roadNetwork: RoadNetworkModel;
  traffic: readonly RawTrafficRecord[];
}): DemoControlCenterRecommendation {
  const inc = params.incident;
  const now = new Date().toISOString();
  const incidentSummary =
    `${inc.type === 'Road_Collapse_Accident' ? '道路坍塌/車禍' : inc.type === 'Crowd_Surge_Injury' ? '人群推擠受傷' : '號誌故障'}事件，` +
    `發生於 ${inc.location ?? inc.affected_segment}，` +
    `嚴重程度 ${inc.severity}，` +
    `影響路段飽和度 ${params.satScore}（${params.level === 'A' ? 'A級癱瘓' : params.level === 'B' ? 'B級壅擠' : '正常'}），` +
    `觸發SOP第 ${params.triggeredArticles.join('、')} 條。`;

  const primarySegId = params.primaryEvacuation ?? '';
  const primarySeg = params.roadNetwork.getAllSegments().find((s) => s.segment_id === primarySegId);
  const primaryName = primarySeg?.name ?? primarySegId;

  const secondaryNames = params.secondaryEvacuation.map((sid) => {
    const seg = params.roadNetwork.getAllSegments().find((s) => s.segment_id === sid);
    return seg?.name ?? sid;
  });

  const eteStr = params.eteMinutes !== undefined ? `${params.eteMinutes}` : '待評估';

  const cmsZh =
    `${inc.location ?? inc.affected_segment}封閉，請改道 ${primaryName}，` +
    (params.eteMinutes !== undefined ? `預計延誤 ${eteStr} 分鐘` : '請配合現場指引') + '。';

  const cmsEn =
    `${inc.location ?? inc.affected_segment} closed. Use alternate route via ${primaryName}.` +
    (params.eteMinutes !== undefined ? ` Expected delay: ${eteStr} minutes.` : '');

  const technicalActions: Array<{
    system: string;
    target: string;
    action: string;
    parameter: string;
    value: number | null;
    unit: string;
    time_window: string;
    rationale: string;
    source_article: number;
    parameter_status: 'sop_specific' | 'sop_not_specific';
  }> = [];

  // Art.1: Signal control
  if (params.art1Triggered) {
    const affectedSeg = params.roadNetwork.getAllSegments().find((s) => s.segment_id === inc.affected_segment);
    const affectedName = affectedSeg?.name ?? inc.affected_segment;

    if (params.level === 'A') {
      // A級: full green extension
      technicalActions.push({
        system: '號誌控制',
        target: affectedName,
        action: '長綠燈時制擴展',
        parameter: 'green_extension_pct',
        value: 25,
        unit: 'pct',
        time_window: '持續至事件解除',
        rationale: `SOP第1條：A級癱瘠（飽和度${params.satScore}>=${SOP_ART1_A_THRESHOLD}），啟動長綠燈時制，並將替代道路綠燈配時+25%。`,
        source_article: 1,
        parameter_status: 'sop_specific',
      });
      // Alternative road green +25%
      if (params.primaryEvacuation) {
        const altSeg = params.roadNetwork.getAllSegments().find((s) => s.segment_id === params.primaryEvacuation);
        if (altSeg) {
          technicalActions.push({
            system: '號誌控制',
            target: altSeg.name,
            action: '替代道路綠燈配時增加',
            parameter: 'green_phase_pct',
            value: 25,
            unit: 'pct',
            time_window: '持續至事件解除',
            rationale: `SOP第1條：替代道路 ${altSeg.name} 同步增加綠燈配時25%以容納分流車流。`,
            source_article: 1,
            parameter_status: 'sop_specific',
          });
        }
      }
    } else if (params.level === 'B') {
      // B級: activate coordinated green
      technicalActions.push({
        system: '號誌控制',
        target: affectedName,
        action: '長綠燈時制啟動',
        parameter: 'signal_mode',
        value: null,
        unit: 'mode',
        time_window: '持續至事件解除',
        rationale: `SOP第1條：B級壅擠（飽和度${params.satScore}>=${SOP_ART1_B_THRESHOLD}），啟動長綠燈時制。`,
        source_article: 1,
        parameter_status: 'sop_not_specific',
      });
    }
  }

  // Art.2: Route guidance
  if (params.art2Triggered) {
    technicalActions.push({
      system: '路線引導',
      target: primaryName,
      action: '主要疏散路徑啟用',
      parameter: 'route_priority',
      value: 1,
      unit: 'rank',
      time_window: '事件期間',
      rationale: `SOP第2條：${inc.location ?? inc.affected_segment}（${inc.severity}）事故，主疏散路徑 ${primaryName} 容量足夠，已列為第一優先。`,
      source_article: 2,
      parameter_status: 'sop_specific',
    });
    for (const sr of params.secondaryEvacuation.slice(0, 2)) {
      const srSeg = params.roadNetwork.getAllSegments().find((s) => s.segment_id === sr);
      if (srSeg) {
        technicalActions.push({
          system: '路線引導',
          target: srSeg.name,
          action: '次要疏散路徑待命',
          parameter: 'route_priority',
          value: 2,
          unit: 'rank',
          time_window: '主路徑失效時啟用',
          rationale: `SOP第2條：${srSeg.name} 列為次要疏散路徑（下游相交道路）。`,
          source_article: 2,
          parameter_status: 'sop_specific',
        });
      }
    }
  }

  // Art.3: MRT surge
  if (params.art3Triggered) {
    technicalActions.push({
      system: '大眾運輸協調',
      target: 'BS_MRT_BL17 (捷運國父紀念館站)',
      action: '建議北捷過站不停',
      parameter: 'skip_stop',
      value: null,
      unit: 'mode',
      time_window: '人流緩解前',
      rationale: 'SOP第3條：BL17 Growth_Rate或User_Count超標，建議捷運過站不停以加速疏解。',
      source_article: 3,
      parameter_status: 'sop_not_specific',
    });
    technicalActions.push({
      system: '接駁調度',
      target: 'BS_MRT_BL18 (捷運市政府站)',
      action: '調度接駁專車',
      parameter: 'shuttle_count',
      value: null,
      unit: 'vehicles',
      time_window: '散場期間',
      rationale: 'SOP第3條：引導群眾步行至相鄰站點，並通知公車處調度接駁專車。',
      source_article: 3,
      parameter_status: 'sop_not_specific',
    });
  }

  // Art.5: Signal failure
  if (params.art5Triggered) {
    const affectedSeg = params.roadNetwork.getAllSegments().find((s) => s.segment_id === inc.affected_segment);
    const affectedName = affectedSeg?.name ?? inc.affected_segment;
    technicalActions.push({
      system: '號誌控制',
      target: affectedName,
      action: '人工指揮派遣',
      parameter: 'police_per_intersection',
      value: 2,
      unit: 'officers',
      time_window: '號誌修復前',
      rationale: 'SOP第5條：號誌故障，派遣警力至受影響路口，每路口2人指揮。',
      source_article: 5,
      parameter_status: 'sop_specific',
    });
  }

  const coordinationActions: string[] = [];
  if (params.art1Triggered) {
    coordinationActions.push(
      `通知交控中心啟動「${params.level === 'A' ? 'A級' : 'B級'}交通應變」，` +
      `協調警力淨空 ${inc.location ?? inc.affected_segment} 路口。`,
    );
  }
  if (params.art2Triggered) {
    coordinationActions.push(
      `協調交通警察於 ${primaryName} 沿線重要路口執行定點疏導，` +
      `確保主疏散路徑暢通。`,
    );
  }
  if (params.art3Triggered) {
    coordinationActions.push('聯繫北捷啟動BL17過站措施；通知公車處調度接駁專車。');
  }

  return {
    title: `${inc.type === 'Road_Collapse_Accident' ? '道路事故' : inc.type === 'Crowd_Surge_Injury' ? '人群意外' : '號誌故障'}應變建議書`,
    incident_summary: incidentSummary,
    classification: params.level === 'A' ? 'A級癱瘓' : params.level === 'B' ? 'B級壅擠' : '一般事件',
    triggered_articles: [...params.triggeredArticles],
    technical_actions: technicalActions,
    route_actions: {
      primary_route: primaryName,
      primary_route_segment_id: primarySegId,
      secondary_routes: secondaryNames,
      excluded_routes: params.excludedCandidates.map((sid) => {
        const seg = params.roadNetwork.getAllSegments().find((s) => s.segment_id === sid);
        return { segment_id: sid, reason: seg ? `${seg.name} 容量不足或位於事故下游` : '容量不足' };
      }),
      cms_message_zh: cmsZh,
      cms_message_en: cmsEn,
    },
    coordination_actions: coordinationActions,
    public_guidance: {
      zh: `【交通應變】「${inc.location ?? inc.affected_segment}」${inc.severity}事件，` +
        `建議改道至${primaryName}，` +
        (params.eteMinutes !== undefined ? `預計延誤${eteStr}分鐘` : '請配合現場指引') + '。',
      en: `[ALERT] ${inc.severity} incident at ${inc.location ?? inc.affected_segment}. ` +
        `Use alternate route via ${primaryName}.` +
        (params.eteMinutes !== undefined ? ` Est. delay: ${eteStr} min.` : ''),
      ja: `【交通應変】${inc.location ?? inc.affected_segment}で${inc.severity}インシデントが発生しました。` +
        `${primaryName}へ迂回してください。` +
        (params.eteMinutes !== undefined ? ` 予想遅延:${eteStr}分。` : ''),
      ko: `【교통 대응】${inc.location ?? inc.affected_segment}에서 ${inc.severity} 사고가 발생했습니다. ` +
        `${primaryName}으로 우회해 주세요.` +
        (params.eteMinutes !== undefined ? ` 예상 지연: ${eteStr}분.` : ''),
    },
    generated_at: now,
  };
}

// ─── GET /test page ───────────────────────────────────────────────────────────

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
.btn-publish{background:#fdd835;color:#0f1923}
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
<p class="subtitle">AWS Demo Backend | Region: us-west-2 | Multi-source Anomaly + Control Center Recommendation</p>

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
<button class="btn-primary" onclick="loadTimeSeries()">Load Time-Series (with Anomalies)</button>
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
<label>Custom JSON Query</label>
<textarea id="whatifQuery" placeholder='{"query":"若 BS_MRT_BL17 的 User_Count 增至 40000"}'>{"query":"若 BS_MRT_BL17 的 User_Count 增至 40000"}</textarea>
<button class="btn-whatif" onclick="postCustomWhatIf()" style="margin-top:4px">Execute Custom</button>
</div>
</div>

<div class="section">
<div class="section-title">Multilingual Alert (SOP Art.6 Roaming)</div>
<div class="row">
<button class="btn-alert" onclick="postAlert('BS_XY_ATT', 0.30)">BS_XY_ATT Roaming=0.30 (trigger)</button>
<button class="btn-alert" onclick="postAlert('BS_XY_ATT', 0.299)">BS_XY_ATT Roaming=0.299 (no trigger)</button>
</div>
<div class="row" style="margin-top:8px">
<button class="btn-alert" onclick="postAlertFull()">Full Alert (decision_id + event_id)</button>
</div>
</div>

<div class="section">
<div class="section-title">Publish Decision</div>
<button class="btn-publish" onclick="postPublish()">Publish demo-ACC_001</button>
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
  if (raw.length === 0) { alert('請輸入 What-if 假設問題。'); return; }
  try {
    const body = JSON.parse(raw);
    document.getElementById('reqBody').value = JSON.stringify(body);
    const t0 = Date.now();
    const r = await fetch(API + '/what-if', {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(body)});
    const d = await r.json();
    showResponse(d, Date.now() - t0, d.text_source || 'system');
  } catch(e) { alert('Invalid JSON: ' + e.message); }
}

async function postAlert(stationId, roamingPct) {
  const body = {station_id: stationId, roaming_user_pct: roamingPct, languages:['zh','en','ja','ko']};
  document.getElementById('reqBody').value = JSON.stringify(body);
  const t0 = Date.now();
  const r = await fetch(API + '/demo/alerts', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  const d = await r.json();
  showResponse(d, Date.now() - t0, d.text_source || 'system');
}

async function postAlertFull() {
  const body = {decision_id:'demo-ACC_001', event_id:'ACC_001', station_id:'BS_XY_ATT', roaming_user_pct:0.30, severity:'High', route:'忠孝東路', languages:['zh','en','ja','ko']};
  document.getElementById('reqBody').value = JSON.stringify(body);
  const t0 = Date.now();
  const r = await fetch(API + '/demo/alerts', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  const d = await r.json();
  showResponse(d, Date.now() - t0, d.text_source || 'system');
}

async function postPublish() {
  const body = {channels:['cms','sms'], approved_by:'demo-commander', languages:['zh','en','ja','ko']};
  document.getElementById('reqBody').value = JSON.stringify(body);
  const t0 = Date.now();
  const r = await fetch(API + '/decisions/demo-ACC_001/publish', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  const d = await r.json();
  showResponse(d, Date.now() - t0, 'system');
}

testHealth();
</script>
</body>
</html>`;
}

// ─── Route: GET /health ───────────────────────────────────────────────────────

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

// ─── Route: GET /demo/timeseries ─────────────────────────────────────────────

function handleTimeSeries(): APIGatewayProxyResult {
  const data = _data;
  if (!data) return jsonResponse(500, { error: 'Data not loaded' });

  const anomalies = analyzeAnomalies(data.traffic, data.crowd);

  // Group traffic and crowd records by timestamp into up to 10 snapshots.
  // Each snapshot contains only the records for that specific timestamp.
  // This allows the frontend to derive the active snapshot from timelineIndex.
  const timestampMap = new Map<string, { traffic: RawTrafficRecord[]; crowd: RawCrowdRecord[] }>();

  for (const rec of data.traffic) {
    const ts = rec.timestamp_raw;
    if (!timestampMap.has(ts)) {
      timestampMap.set(ts, { traffic: [], crowd: [] });
    }
    timestampMap.get(ts)!.traffic.push(rec);
  }

  for (const rec of data.crowd) {
    const ts = rec.timestamp_raw;
    if (!timestampMap.has(ts)) {
      timestampMap.set(ts, { traffic: [], crowd: [] });
    }
    timestampMap.get(ts)!.crowd.push(rec);
  }

  // Build ordered snapshot list matching the timeline order (first 10 timestamps)
  const orderedTimestamps = data.trafficTimestamps.slice(0, 10);
  const snapshots = orderedTimestamps.map((ts) => {
    const entry = timestampMap.get(ts.timestamp_raw);
    return {
      timestamp_display: ts.timestamp_display,
      traffic: (entry?.traffic ?? []).slice(0, 15),
      crowd: (entry?.crowd ?? []).slice(0, 15),
    };
  });

  return jsonResponse(200, {
    data_status: 'ready',
    timeline: orderedTimestamps.map((ts) => ts.timestamp_display),
    stations: [...new Set(data.crowd.map((r) => r.BS_ID))].slice(0, 10),
    anomalies,
    // snapshots are ordered by timeline; frontend uses timelineIndex to select
    snapshots,
  });
}

// ─── Route: POST /demo/incidents ─────────────────────────────────────────────

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

/** Most recent 3 raw observations at or before `cutoff`, time-ascending (GZAE §GZAE-R2). */
function recentHistoryBefore(
  timestamps: readonly Date[],
  values: readonly number[],
  cutoff: Date,
): readonly NumericHistoryPoint[] {
  return values
    .map((value, i) => ({ value, at: timestamps[i] }))
    .filter((point): point is { value: number; at: Date } => point.at !== undefined)
    .filter((point) => point.at.getTime() <= cutoff.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(-3)
    .map((point) => ({ value: point.value }));
}

function handleIncident(body: string | null | undefined): APIGatewayProxyResult {
  const startedAt = Date.now();
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
  // Shared cutoff for both art.3's SnapshotSelector and every GZAE recent-history
  // window below — previously each call site derived its own copy of this.
  const targetTime = incident.timestamp
    ? new Date(incident.timestamp.replace(' ', 'T'))
    : new Date();
  const otherActiveIncidents = data.incidents.filter((i) => i.event_id !== incident.event_id);

  // Traffic classification — RawTrafficRecord uses Segment_ID and Saturation_Score
  const primaryTraffic = data.traffic.filter((r) => r.Segment_ID === incident.affected_segment);
  const satScore =
    primaryTraffic.length > 0 ? primaryTraffic[primaryTraffic.length - 1].Saturation_Score : 0;
  const classifications = classifySegments([
    { segment_id: incident.affected_segment, saturation_score: satScore },
  ]);
  const level = classifications[0]?.level as 'A' | 'B' | null;

  // Article evaluations
  const art1 = evaluateArticle1(classifications);
  const art1Triggered = art1.triggered;
  const art2Trig = isArticle2Triggered(incident);

  let art3Trig = false;
  let art3Adds: number[] = [];
  if (incident.type === IncidentType.Crowd_Surge_Injury) {
    const selector = new SnapshotSelector(config as SnapshotSelectorConfigProvider);
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

  // Art.5: signal failure
  const art5Trig =
    incident.type === IncidentType.Power_Failure ||
    (incident.description ?? '').includes('號誌失效') ||
    (incident.description ?? '').includes('號誌故障');

  // Art.6: check roaming thresholds from crowd data for nearby stations
  const incidentNearbyStations = data.roadNetwork
    .getAllSegments()
    .filter((s) => s.segment_id === incident.affected_segment)
    .flatMap((s) => s.nearby_stations);
  let art6Trig = false;
  const roamingTriggeredStationIds = new Set<string>();
  for (const bsId of incidentNearbyStations) {
    const bsRecords = data.crowd.filter((r) => r.BS_ID === bsId);
    if (bsRecords.length > 0) {
      const latestPct = bsRecords[bsRecords.length - 1].roaming_pct_value;
      if (latestPct >= SOP_ART6_ROAMING_THRESHOLD) {
        art6Trig = true;
        roamingTriggeredStationIds.add(bsId);
      }
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
  const candidatesBeforeGzae = qualifyCandidates(
    incident.affected_segment,
    anchor.anchor_intersection,
    data.roadNetwork,
    candidateScores,
  );
  // GZAE §GZAE-R1: exclude candidates that are themselves blocked by another
  // active incident. Runs strictly after the existing 3-AND qualification
  // above and never upgrades an already-excluded candidate.
  const candidates = excludeSelfBlockedCandidates(
    candidatesBeforeGzae,
    incident.event_id,
    otherActiveIncidents,
  );
  const selfBlockedExclusions = diffSelfBlockedExclusions(candidatesBeforeGzae, candidates);
  const evacuation = selectEvacuation(candidates);

  // Article aggregation
  const triggeredArticles: number[] = [1];
  const invokedProcedures: string[] = [];
  if (art1Triggered) invokedProcedures.push('article1_signal_control');
  if (art2Trig) {
    triggeredArticles.push(2);
    invokedProcedures.push('article2_alternative_route_guidance');
  }
  if (art3Trig) {
    art3Adds.forEach((a) => {
      if (!triggeredArticles.includes(a)) triggeredArticles.push(a);
    });
    invokedProcedures.push('article3_mrt_surge_diversion');
  }
  if (art5Trig) {
    triggeredArticles.push(5);
    invokedProcedures.push('article5_signal_failure_response');
  }
  if (art6Trig) {
    triggeredArticles.push(6);
    invokedProcedures.push('article6_multilingual_alert');
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

  const eteMinutes = ete?.ete_minutes;

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

  // ── GZAE §GZAE-R2/R3/R4: additive-only annotations ──────────────────────────
  // Same rule-engine module decision_pipeline.ts uses internally. R2 is
  // extended here beyond SOP-1's saturation threshold to also cover SOP-3
  // (User_Count/Growth_Rate), SOP-4 (Growth_Rate) and SOP-6 (Roaming_User_Pct)
  // — none of these change `classifications.level` or `triggered_articles`.
  const crowdSeriesFor = (bsId: string) =>
    data.crowd
      .map((r, i) => ({ r, at: data.crowdTimestamps[i]?.timestamp_normalized }))
      .filter((x): x is { r: RawCrowdRecord; at: Date } => x.at !== undefined && x.r.BS_ID === bsId)
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .filter((x) => x.at.getTime() <= targetTime.getTime());

  const preWarningSegments: string[] = [];
  {
    const ownSegmentTraffic = data.traffic
      .map((r, i) => ({ r, at: data.trafficTimestamps[i]?.timestamp_normalized }))
      .filter(
        (x): x is { r: RawTrafficRecord; at: Date } =>
          x.at !== undefined && x.r.Segment_ID === incident.affected_segment,
      )
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    const satHistory: SaturationHistoryPoint[] = recentHistoryBefore(
      ownSegmentTraffic.map((x) => x.at),
      ownSegmentTraffic.map((x) => x.r.Saturation_Score),
      targetTime,
    ).map((p) => ({ saturation_score: p.value }));
    if (detectPreWarning(satScore, satHistory)) {
      preWarningSegments.push(incident.affected_segment);
    }
  }

  const crowdPreWarnings: CrowdPreWarning[] = [];
  {
    const bl17 = crowdSeriesFor('BS_MRT_BL17');
    const current = bl17[bl17.length - 1];
    if (current !== undefined) {
      const userCountWarning = detectSop3UserCountPreWarning(
        'BS_MRT_BL17',
        current.r.User_Count,
        recentHistoryBefore(bl17.map((x) => x.at), bl17.map((x) => x.r.User_Count), targetTime),
      );
      if (userCountWarning !== null) crowdPreWarnings.push(userCountWarning);

      const growthRateWarning = detectSop3GrowthRatePreWarning(
        'BS_MRT_BL17',
        current.r.Growth_Rate,
        recentHistoryBefore(bl17.map((x) => x.at), bl17.map((x) => x.r.Growth_Rate), targetTime),
      );
      if (growthRateWarning !== null) crowdPreWarnings.push(growthRateWarning);
    }

    const dome = crowdSeriesFor('BS_TPE_DOME');
    const domeCurrent = dome[dome.length - 1];
    if (domeCurrent !== undefined) {
      const historicalPeak = Math.max(...dome.map((x) => x.r.User_Count));
      const growthRateWarning = detectSop4GrowthRatePreWarning(
        'BS_TPE_DOME',
        historicalPeak >= SOP_ART4_DOME_PEAK_THRESHOLD,
        domeCurrent.r.Growth_Rate,
        recentHistoryBefore(dome.map((x) => x.at), dome.map((x) => x.r.Growth_Rate), targetTime),
      );
      if (growthRateWarning !== null) crowdPreWarnings.push(growthRateWarning);
    }

    for (const bsId of incidentNearbyStations) {
      const series = crowdSeriesFor(bsId);
      const stationCurrent = series[series.length - 1];
      if (stationCurrent === undefined) continue;
      const roamingWarning = detectSop6RoamingPreWarning(
        bsId,
        stationCurrent.r.roaming_pct_value,
        recentHistoryBefore(series.map((x) => x.at), series.map((x) => x.r.roaming_pct_value), targetTime),
      );
      if (roamingWarning !== null) crowdPreWarnings.push(roamingWarning);
    }
  }

  const crowdTriggeredStationIds = new Set<string>(roamingTriggeredStationIds);
  if (art3Trig) crowdTriggeredStationIds.add('BS_MRT_BL17');
  const signalConflicts: readonly SignalConflict[] = detectSignalConflicts(
    classifications,
    (segmentId) => data.roadNetwork.nearbyStations(segmentId),
    crowdTriggeredStationIds,
  );
  const cascadingRisk: CascadingRisk | null = detectCascadingRisk(
    [incident, ...otherActiveIncidents],
    buildAdjacencyGraph(data.roadNetwork.getAllSegments()),
  );

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
    multilingual_required: art3Trig || art6Trig,
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
    cms_core_text: `${incident.affected_segment} — primary: ${evacuation.primary_evacuation ?? 'N/A'}`,
    pre_warning_segments: preWarningSegments,
    crowd_pre_warnings: crowdPreWarnings,
    signal_conflicts: signalConflicts,
    cascading_risk: cascadingRisk,
    self_blocked_exclusions: selfBlockedExclusions,
    provisional: true,
    schema_version: '1.0.0',
  });

  // Build control center recommendation
  const recommendation = buildControlCenterRecommendation({
    incident,
    satScore,
    level,
    art1Triggered,
    art2Triggered: art2Trig,
    art3Triggered: art3Trig,
    art5Triggered: art5Trig,
    triggeredArticles: core.triggered_articles,
    primaryEvacuation: evacuation.primary_evacuation,
    secondaryEvacuation: evacuation.secondary_evacuation,
    excludedCandidates: evacuation.excluded_candidates.map((c) => c.segment_id) as readonly string[],
    eteMinutes: ete?.ete_minutes ?? undefined as number | undefined,
    roadNetwork: data.roadNetwork,
    traffic: data.traffic,
  });

  // Build public alerts
  const publicAlerts = buildPublicAlerts({
    incident,
    art3Triggered: art3Trig,
    art6Triggered: art6Trig,
    primaryEvacuation: evacuation.primary_evacuation,
    eteMinutes: ete?.ete_minutes ?? undefined,
  });

  // ── Wire 1: retrieveSopEvidence() → rag_trace ─────────────────────────────────
  // Build SOP citations from the already-loaded sopArticles (LocalSopRetriever pattern)
  const citationSet = [...new Set([...articles.triggered_articles, ...articles.applied_formula_articles])].sort(
    (a, b) => a - b,
  );
  const sopCitations = citationSet
    .map((articleNo) => {
      const chunk = data.sopArticles.getByArticleNo(articleNo);
      if (!chunk) return null;
      return {
        article_no: articleNo,
        content: chunk.text,
        source_location: `emergency_traffic_sop.txt#article-${articleNo}`,
        relevancy_score: null as number | null,
        source: 'kb' as const,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const retrievalContext = buildRetrievalContext(
    articles.triggered_articles,
    articles.applied_formula_articles,
    ete?.ete_minutes ?? undefined,
    articles.invoked_procedures.slice(0, 3),
  );
  const ragTrace: RagTrace = buildRagTrace(
    sopCitations,
    retrievalContext,
    'local_sop_knowledge_base',
    'emergency_traffic_sop.txt',
  );

  // ── Wire 2: route_reasoning_trace ──────────────────────────────────────────
  // Build route segment evidence from road network + traffic data
  const routeCandidateSegments = allSegments
    .filter((seg) => seg.segment_id !== incident.affected_segment)
    .map((seg) => {
      const rec = data.traffic.find((r) => r.Segment_ID === seg.segment_id);
      return {
        segment_id: seg.segment_id,
        capacity_vph: seg.capacity_vph,
        saturation_score: rec?.Saturation_Score ?? 0.5,
        intersections: seg.intersections,
        flow_direction: seg.flow_direction,
        incident_segment: incident.affected_segment,
      };
    });

  const routeReasoningTrace: RouteReasoningTrace = buildRouteReasoningTrace(
    incident.affected_segment,
    evacuation.primary_evacuation,
    routeCandidateSegments,
    satScore,
  );

  // ── Wire 3: ete_calculation (SOP-7 formula trace) ───────────────────────────
  const eteCalculationTrace: EteCalculationTrace | null = (() => {
    if (!articles.applied_formula_articles.includes(7)) return null;
    return computeEte({
      severity: incident.severity ?? null,
      avgSaturation: satScore,
      baseTimestamp: baseTime,
      timezone: 'Asia/Taipei',
    });
  })();

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
    excluded_routes: evacuation.excluded_candidates.map((c) => c.segment_id) as readonly string[],
    exclusion_reasons: evacuation.excluded_candidates.map((c) => ({
      segment_id: c.segment_id,
      reason: c.exclusion_reason ?? '後端未提供排除原因',
      source_article: 2,
    })) as readonly { segment_id: string; reason: string; source_article: number }[],
    ete: eteMinutes !== undefined ? { ete_minutes: eteMinutes, severity: (ete?.severity ?? incident.severity) as Severity } : null,
    evidence_trace: evidence,
    cms_core_text: core.cms_core_text,
    control_center_recommendation: recommendation,
    public_alerts: publicAlerts,
    rag_trace: ragTrace,
    route_reasoning_trace: routeReasoningTrace,
    ...(eteCalculationTrace !== null && { ete_calculation: eteCalculationTrace }),
<<<<<<< HEAD
    elapsed_ms: Date.now() - startedAt,
=======
    pre_warning_segments: core.pre_warning_segments ?? [],
    crowd_pre_warnings: core.crowd_pre_warnings ?? [],
    signal_conflicts: core.signal_conflicts ?? [],
    cascading_risk: core.cascading_risk ?? null,
    self_blocked_exclusions: core.self_blocked_exclusions ?? [],
>>>>>>> 7323faf6c1d42bacb8c471e400a92c9db42ab1cc
    data_status: 'ready',
    text_source: 'deterministic',
  });
}

// ─── Route: POST /demo/what-if (DEPRECATED — returns 410) ────────────────────

function handleDeprecatedWhatIf(): APIGatewayProxyResult {
  return jsonResponse(410, {
    error_code: 'GONE',
    message:
      'POST /demo/what-if has been retired. Use POST /what-if on the production ' +
      'four-stage What-if pipeline (deterministic Rule Engine + Bedrock explanation).',
    migration_target: '/what-if',
  });
}

// ─── Route: POST /demo/alerts ─────────────────────────────────────────────────

function handleAlert(body: string | null | undefined): APIGatewayProxyResult {
  let parsed: {
    station_id?: unknown;
    roaming_user_pct?: unknown;
    decision_id?: unknown;
    event_id?: unknown;
    severity?: unknown;
    route?: unknown;
    languages?: unknown;
  };
  try {
    parsed = JSON.parse(body ?? '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }
  if (!parsed.station_id) return jsonResponse(400, { error: 'Missing station_id' });

  const stationId = String(parsed.station_id);
  const roamingUserPct = Number(parsed.roaming_user_pct ?? 0);
  const languages: string[] = Array.isArray(parsed.languages) ? parsed.languages : ['zh', 'en'];
  const triggered = roamingUserPct >= SOP_ART6_ROAMING_THRESHOLD;

  // Look up station location name if data is available
  const locationName = _data?.crowd.find((r) => r.BS_ID === stationId)?.Location_Name ?? stationId;

  let messages: Record<string, string> = {};
  let textSource = 'none';
  let multilingualRequired = false;

  if (triggered) {
    const alertResult = generateMultilingualAlert({
      stationId,
      roamingPct: roamingUserPct,
      locationName,
      languages,
    });
    messages = alertResult.messages;
    textSource = 'deterministic';
    multilingualRequired = alertResult.multilingual_required;
  }

  const response = {
    triggered,
    roaming_user_pct: Math.round(roamingUserPct * 1000) / 1000,
    roaming_threshold: SOP_ART6_ROAMING_THRESHOLD,
    station_id: stationId,
    messages: {
      zh: messages.zh ?? '',
      en: messages.en ?? '',
      ...(messages.ja ? { ja: messages.ja } : {}),
      ...(messages.ko ? { ko: messages.ko } : {}),
    } as DemoAlertResponse['messages'],
    text_source: textSource as 'deterministic' | 'none',
    triggered_article: triggered ? 6 : null,
    multilingual_required: multilingualRequired,
  };

  return jsonResponse(200, response);
}

// ─── Route: POST /decisions/{id}/publish ───────────────────────────────────────

function handlePublish(event: APIGatewayProxyEvent): APIGatewayProxyResult {
  const path = event.rawPath ?? event.requestContext?.http?.path ?? '/';

  // Extract decision_id from /decisions/{id}/publish
  const match = path.match(/^\/decisions\/([^/]+)\/publish$/);
  if (!match) return notFound(path);

  const decisionId = match[1];

  // For demo: accept any decision_id, no Cognito auth required
  // (production PublishFn would require commander group membership)
  const actor = 'demo-commander';

  let parsedBody: { channels?: unknown; approved_by?: unknown; languages?: unknown } = {};
  try {
    if (event.body) parsedBody = JSON.parse(event.body);
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const channels: readonly string[] = Array.isArray(parsedBody.channels)
    ? parsedBody.channels.map(String)
    : ['cms'];
  const approvedBy = String(parsedBody.approved_by ?? actor);
  const languages: readonly string[] = Array.isArray(parsedBody.languages)
    ? parsedBody.languages.map(String)
    : ['zh', 'en'];

  // Get existing record
  const existing = _publishStore.get(decisionId) ?? null;
  const currentState = existing?.publish_state ?? PublishStatus.draft;

  // State machine: draft → approved → published (or publish_failed)
  let nextState: PublishStatus;
  if (currentState === PublishStatus.draft) {
    nextState = PublishStatus.approved;
  } else if (currentState === PublishStatus.approved) {
    nextState = PublishStatus.published;
  } else if (currentState === PublishStatus.publish_failed) {
    // Can retry from failed → approved
    nextState = PublishStatus.approved;
  } else {
    // Already published — idempotent, return current record
    return jsonResponse(200, {
      decision_id: decisionId,
      publish_state: currentState,
      channels: existing?.channels ?? [],
      languages: [...languages],
      approved_by: existing?.approved_by,
      published_by: existing?.published_by,
      published_at: existing?.updated_at,
      audit_trail: existing?.audit_trail ?? [],
      delivery_mode: 'competition_demo_dispatch',
      idempotent: true,
    });
  }

  // Dispatch channels (mock: just record the channel intent)
  const dispatchChannels = channels.map((ch) => ({
    channel: ch,
    dispatched_at: formatAuditTs(),
    status: 'dispatched' as const,
  }));

  // Build new record
  const newRecord = createPublishRecord(
    decisionId,
    nextState,
    approvedBy,
    existing,
    channels,
  );

  // Store in memory
  _publishStore.set(decisionId, newRecord);

  return jsonResponse(200, {
    decision_id: decisionId,
    publish_state: newRecord.publish_state,
    channels: [...newRecord.channels],
    languages: [...languages],
    approved_by: newRecord.approved_by,
    published_by: newRecord.published_by,
    published_at: newRecord.updated_at,
    audit_trail: newRecord.audit_trail,
    delivery_mode: 'competition_demo_dispatch',
    audit: dispatchChannels,
  });
}

// ─── Main handler factory ─────────────────────────────────────────────────────

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

      // Publish endpoint
      if (method === 'POST' && /^\/decisions\/[^/]+\/publish$/.test(path)) {
        return handlePublish(event);
      }

      return notFound(path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Handler error:', message);
      return jsonResponse(500, { error: 'Internal error', message });
    }
  };
}
