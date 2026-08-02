/**
 * Grey-Zone Arbitration Engine (GZAE) — §GZAE-R1, R2, R3, R4.
 *
 * Post-arbitration layer sitting on top of the existing, unmodified article
 * 1–6 evaluations. Orthogonal to UARE (which handles `triggered_articles`
 * being empty): GZAE handles cases where articles DID trigger but the
 * judgment sits at a numeric boundary, contradicts another article's
 * signal, compounds with a nearby low-severity incident, or (R1 only)
 * recommends a candidate that is itself blocked by another active incident.
 *
 * R1 is the only function here that corrects an existing `RouteCandidate`
 * value; R2–R4 are strictly additive annotations.
 *
 * @module domain/rule_engine/grey_zone_arbitration
 */

import type {
  Incident,
  RoadSegment,
  RouteCandidate,
  SegmentClassification,
  SignalConflict,
  CascadingRisk,
  CrowdPreWarning,
} from '@city-commander/shared-schemas';
import { RouteCandidateRole } from '@city-commander/shared-schemas';
import { TRIGGER_STATUSES, isArticle2Triggered } from './article2.js';
import { USER_COUNT_THRESHOLD, GROWTH_RATE_THRESHOLD } from './article3.js';
import { DOME_GROWTH_THRESHOLD } from './article4.js';
import { ROAMING_THRESHOLD } from './multilingual_trigger.js';

// ─── R1: Self-Blocked Candidate Exclusion ─────────────────────────────────

/**
 * Post-filter applied AFTER the existing 3-AND qualification
 * (`article2.ts` `determineRole`). Excludes any candidate whose
 * `segment_id` is itself the `affected_segment` of another currently
 * active, blocking incident (requirements.md R1 AC1–AC6).
 *
 * Pure function: never mutates `candidates`, never upgrades an
 * already-`excluded` role, never compares an incident against itself.
 */
export function excludeSelfBlockedCandidates(
  candidates: readonly RouteCandidate[],
  currentIncidentEventId: string,
  otherActiveIncidents: readonly Incident[],
): readonly RouteCandidate[] {
  const blockedSegments = new Map<string, Incident>();
  for (const incident of otherActiveIncidents) {
    if (incident.event_id === currentIncidentEventId) continue;
    if (!TRIGGER_STATUSES.has(incident.status)) continue;
    if (!blockedSegments.has(incident.affected_segment)) {
      blockedSegments.set(incident.affected_segment, incident);
    }
  }

  return candidates.map((candidate) => {
    if (candidate.role === RouteCandidateRole.excluded) return candidate;

    const blocker = blockedSegments.get(candidate.segment_id);
    if (!blocker) return candidate;

    return {
      ...candidate,
      role: RouteCandidateRole.excluded,
      exclusion_reason: `候選路段本身正被事件 ${blocker.event_id} 封鎖（status: ${blocker.status}）`,
    };
  });
}

/**
 * Derives `self_blocked_exclusions` (requirements.md R5 AC1): the
 * `segment_id`s newly excluded by `excludeSelfBlockedCandidates`, as
 * opposed to candidates already excluded by the pre-existing 3-AND check.
 */
export function diffSelfBlockedExclusions(
  before: readonly RouteCandidate[],
  after: readonly RouteCandidate[],
): readonly string[] {
  const beforeExcluded = new Set(
    before.filter((c) => c.role === RouteCandidateRole.excluded).map((c) => c.segment_id),
  );
  return after
    .filter((c) => c.role === RouteCandidateRole.excluded && !beforeExcluded.has(c.segment_id))
    .map((c) => c.segment_id);
}

// ─── R2: Threshold-Boundary Trend Pre-Warning ─────────────────────────────

/** Grey-zone band lower bound: fixed 0.05 below the B-level threshold (0.85). */
export const GREY_ZONE_LOWER_BOUND = 0.8;
const B_LEVEL_THRESHOLD = 0.85;

export interface SaturationHistoryPoint {
  readonly saturation_score: number;
}

/**
 * `true` when `currentSaturation` is in `[0.80, 0.85)` AND the most recent
 * history points (time-ascending, cutoff-bounded, at least 2 required) are
 * strictly monotonically increasing (requirements.md R2 AC1–AC8).
 *
 * Pure function. Never mutates `recentHistory`.
 */
export function detectPreWarning(
  currentSaturation: number,
  recentHistory: readonly SaturationHistoryPoint[],
): boolean {
  const inGreyZone = currentSaturation >= GREY_ZONE_LOWER_BOUND && currentSaturation < B_LEVEL_THRESHOLD;
  if (!inGreyZone) return false;
  if (recentHistory.length < 2) return false;

  for (let i = 1; i < recentHistory.length; i++) {
    if (recentHistory[i].saturation_score <= recentHistory[i - 1].saturation_score) return false;
  }
  return true;
}

/**
 * Runs `detectPreWarning` over every segment classification, returning the
 * `segment_id`s to record in `DecisionCore.pre_warning_segments`. Only
 * segments at `level === null` (not yet B-level) are eligible, per R2 AC2.
 */
export function collectPreWarningSegments(
  classifications: readonly SegmentClassification[],
  currentSaturationOf: (segmentId: string) => number | undefined,
  recentHistoryOf: (segmentId: string) => readonly SaturationHistoryPoint[],
): readonly string[] {
  const result: string[] = [];
  for (const c of classifications) {
    if (c.level !== null) continue;
    const current = currentSaturationOf(c.segment_id);
    if (current === undefined) continue;
    if (detectPreWarning(current, recentHistoryOf(c.segment_id))) {
      result.push(c.segment_id);
    }
  }
  return result;
}

// ─── R3: Cross-Article Signal Contradiction ───────────────────────────────

const CROWD_HEAVY_TRAFFIC_LIGHT_TEXT = '車道彈性縮減並限速，優先保障行人通行';
const TRAFFIC_HEAVY_CROWD_LIGHT_TEXT = '維持既有車流疏導措施，暫緩人流相關資源調度';

function makeSignalConflict(
  segmentId: string,
  conflictType: SignalConflict['conflict_type'],
): SignalConflict {
  return {
    segment_id: segmentId,
    conflict_type: conflictType,
    advisory_text:
      conflictType === 'crowd_heavy_traffic_light'
        ? CROWD_HEAVY_TRAFFIC_LIGHT_TEXT
        : TRAFFIC_HEAVY_CROWD_LIGHT_TEXT,
  };
}

/**
 * Flags traffic (art.1) vs crowd (art.3/4) contradictions for the same
 * area, keyed by `road_network_geometry.json`'s existing `nearby_stations`
 * field (requirements.md R3 AC1–AC7). Additive-only: never changes any
 * article's own trigger determination.
 *
 * Pure function.
 */
export function detectSignalConflicts(
  classifications: readonly SegmentClassification[],
  nearbyStationsOf: (segmentId: string) => readonly string[],
  crowdTriggeredStationIds: ReadonlySet<string>,
): readonly SignalConflict[] {
  const conflicts: SignalConflict[] = [];
  for (const c of classifications) {
    const stations = nearbyStationsOf(c.segment_id);
    if (stations.length === 0) continue;

    const anyStationTriggered = stations.some((s) => crowdTriggeredStationIds.has(s));
    const allStationsQuiet = stations.every((s) => !crowdTriggeredStationIds.has(s));

    if (c.level === null && anyStationTriggered) {
      conflicts.push(makeSignalConflict(c.segment_id, 'crowd_heavy_traffic_light'));
    } else if (c.level === 'A' && allStationsQuiet) {
      conflicts.push(makeSignalConflict(c.segment_id, 'traffic_heavy_crowd_light'));
    }
  }
  return conflicts;
}

// ─── R4: Cascading Micro-Incident Risk Detection ──────────────────────────

/**
 * Builds a road-network adjacency map from the existing `intersections`
 * and `alternatives` fields as a topology-based proxy for spatial
 * proximity (this dataset has no lat/lng). Two segments are adjacent when
 * either is listed in the other's `alternatives`, or when one's
 * `intersections` list contains the other's `name` (requirements.md R4 AC1).
 *
 * Pure function.
 */
export function buildAdjacencyGraph(
  segments: readonly RoadSegment[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const byId = new Map(segments.map((s) => [s.segment_id, s] as const));
  const byName = new Map(segments.map((s) => [s.name, s] as const));
  const adjacency = new Map<string, Set<string>>();

  const addEdge = (a: string, b: string) => {
    if (a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };

  for (const segment of segments) {
    for (const altId of segment.alternatives) {
      if (byId.has(altId)) addEdge(segment.segment_id, altId);
    }
    for (const intersectionName of segment.intersections) {
      const other = byName.get(intersectionName);
      if (other) addEdge(segment.segment_id, other.segment_id);
    }
  }

  return adjacency;
}

/**
 * Flags cascading risk when >= 2 currently active incidents, none of which
 * individually trigger art.2, have `affected_segment`s that are adjacent
 * on the `Adjacency_Graph` (requirements.md R4 AC1–AC6). Additive-only:
 * never changes any incident's `triggered_articles`.
 *
 * Pure function.
 */
export function detectCascadingRisk(
  activeIncidents: readonly Incident[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): CascadingRisk | null {
  const nonEscalated = activeIncidents.filter((i) => !isArticle2Triggered(i));

  const involved = nonEscalated.filter((a) =>
    nonEscalated.some(
      (b) =>
        b.event_id !== a.event_id &&
        (a.affected_segment === b.affected_segment ||
          (adjacency.get(a.affected_segment)?.has(b.affected_segment) ?? false)),
    ),
  );

  if (involved.length < 2) return null;

  return {
    event_ids: involved.map((i) => i.event_id),
    advisory_text: `偵測到 ${involved.length} 起鄰近未達 SOP 第 2 條門檻之事件，建議依通用防禦性原則提升為區域協調應變等級，儘速人工複核`,
  };
}

// ─── R2 extension: Crowd (SOP-3/4/6) Threshold-Boundary Trend Pre-Warning ──

/**
 * Direction-aware generalization of R2's `detectPreWarning`. SOP-1's grey
 * zone is entered from below (rising toward the 0.85 B-level threshold);
 * SOP-4's dispersal grey zone is entered from above (falling toward the
 * -0.20 threshold). `bandWidth` mirrors R2's fixed 0.05 for decimal-scale
 * rate fields (Growth_Rate, Roaming_User_Pct); for User_Count — a large
 * integer count, not a decimal rate — a proportional 5% of the threshold is
 * used instead so the band stays the same order of magnitude relative to
 * its threshold as R2's 0.05/0.85 (~5.9%) ratio.
 *
 * None of these bands are official SOP text — same as R2, any resulting
 * `CrowdPreWarning` carries no `sop_authority` of its own (the field does
 * not exist on this additive-only annotation type); callers surfacing it
 * alongside SOP citations must not represent it as OFFICIAL_SOP.
 */
export type GreyZoneDirection = 'rising' | 'falling';

export interface GreyZoneBandSpec {
  readonly threshold: number;
  readonly bandWidth: number;
  readonly direction: GreyZoneDirection;
}

export interface NumericHistoryPoint {
  readonly value: number;
}

/**
 * `true` when `currentValue` sits in the band adjacent to `spec.threshold`
 * (on the not-yet-triggered side) AND the recent history (time-ascending,
 * at least 2 points required) moves strictly monotonically toward the
 * threshold. Pure function; never interpolates missing history.
 */
export function detectGreyZonePreWarning(
  currentValue: number,
  recentHistory: readonly NumericHistoryPoint[],
  spec: GreyZoneBandSpec,
): boolean {
  const inGreyZone =
    spec.direction === 'rising'
      ? currentValue >= spec.threshold - spec.bandWidth && currentValue < spec.threshold
      : currentValue > spec.threshold && currentValue <= spec.threshold + spec.bandWidth;
  if (!inGreyZone) return false;
  if (recentHistory.length < 2) return false;

  for (let i = 1; i < recentHistory.length; i++) {
    const prev = recentHistory[i - 1]?.value;
    const curr = recentHistory[i]?.value;
    if (prev === undefined || curr === undefined) return false;
    const movingTowardThreshold = spec.direction === 'rising' ? curr > prev : curr < prev;
    if (!movingTowardThreshold) return false;
  }
  return true;
}

/** SOP-3 (art.3): User_Count grey zone below 25,000 (5% proportional band). */
export const SOP3_USER_COUNT_GREY_ZONE: GreyZoneBandSpec = {
  threshold: USER_COUNT_THRESHOLD,
  bandWidth: USER_COUNT_THRESHOLD * 0.05,
  direction: 'rising',
};

/** SOP-3 (art.3): Growth_Rate grey zone below 0.30. */
export const SOP3_GROWTH_RATE_GREY_ZONE: GreyZoneBandSpec = {
  threshold: GROWTH_RATE_THRESHOLD,
  bandWidth: 0.05,
  direction: 'rising',
};

/** SOP-4 (art.4): Growth_Rate grey zone above -0.20, falling toward dispersal. */
export const SOP4_GROWTH_RATE_GREY_ZONE: GreyZoneBandSpec = {
  threshold: DOME_GROWTH_THRESHOLD,
  bandWidth: 0.05,
  direction: 'falling',
};

/** SOP-6 (art.6): Roaming_User_Pct grey zone below 0.30, evaluated per in-scope station. */
export const SOP6_ROAMING_GREY_ZONE: GreyZoneBandSpec = {
  threshold: ROAMING_THRESHOLD,
  bandWidth: 0.05,
  direction: 'rising',
};

const SOP3_USER_COUNT_PRE_WARNING_TEXT =
  '該基地台人數正朝 SOP 第 3 條門檻（25,000 人）持續上升，建議提前準備接駁資源，尚未達正式觸發標準';
const SOP3_GROWTH_RATE_PRE_WARNING_TEXT =
  '該基地台成長率正朝 SOP 第 3 條門檻（0.30）持續上升，建議提前準備接駁資源，尚未達正式觸發標準';
const SOP4_GROWTH_RATE_PRE_WARNING_TEXT =
  '巨蛋基地台成長率正朝 SOP 第 4 條疏散門檻（-0.20）持續下降，建議提前準備散場疏運資源，尚未達正式觸發標準';
const SOP6_ROAMING_PRE_WARNING_TEXT =
  '該基地台漫遊用戶比例正朝 SOP 第 6 條門檻（30%）持續上升，建議提前準備多語言廣播資源，尚未達正式觸發標準';

/** SOP-3 User_Count pre-warning for a single station's current reading + history. */
export function detectSop3UserCountPreWarning(
  bsId: string,
  currentUserCount: number,
  recentHistory: readonly NumericHistoryPoint[],
): CrowdPreWarning | null {
  if (!detectGreyZonePreWarning(currentUserCount, recentHistory, SOP3_USER_COUNT_GREY_ZONE)) {
    return null;
  }
  return {
    bs_id: bsId,
    article: 3,
    field: 'User_Count',
    advisory_text: SOP3_USER_COUNT_PRE_WARNING_TEXT,
  };
}

/** SOP-3 Growth_Rate pre-warning for a single station's current reading + history. */
export function detectSop3GrowthRatePreWarning(
  bsId: string,
  currentGrowthRate: number,
  recentHistory: readonly NumericHistoryPoint[],
): CrowdPreWarning | null {
  if (!detectGreyZonePreWarning(currentGrowthRate, recentHistory, SOP3_GROWTH_RATE_GREY_ZONE)) {
    return null;
  }
  return {
    bs_id: bsId,
    article: 3,
    field: 'Growth_Rate',
    advisory_text: SOP3_GROWTH_RATE_PRE_WARNING_TEXT,
  };
}

/**
 * SOP-4 Growth_Rate pre-warning. Only meaningful once the historical-peak
 * precondition (`historical_peak >= DOME_PEAK_THRESHOLD`, art.4's other AND
 * condition) already holds — otherwise the station isn't "waiting on
 * Growth_Rate" at all, regardless of where Growth_Rate sits.
 */
export function detectSop4GrowthRatePreWarning(
  bsId: string,
  historicalPeakMet: boolean,
  currentGrowthRate: number,
  recentHistory: readonly NumericHistoryPoint[],
): CrowdPreWarning | null {
  if (!historicalPeakMet) return null;
  if (!detectGreyZonePreWarning(currentGrowthRate, recentHistory, SOP4_GROWTH_RATE_GREY_ZONE)) {
    return null;
  }
  return {
    bs_id: bsId,
    article: 4,
    field: 'Growth_Rate',
    advisory_text: SOP4_GROWTH_RATE_PRE_WARNING_TEXT,
  };
}

/** SOP-6 Roaming_User_Pct pre-warning for a single in-scope station. */
export function detectSop6RoamingPreWarning(
  bsId: string,
  currentRoamingPct: number,
  recentHistory: readonly NumericHistoryPoint[],
): CrowdPreWarning | null {
  if (!detectGreyZonePreWarning(currentRoamingPct, recentHistory, SOP6_ROAMING_GREY_ZONE)) {
    return null;
  }
  return {
    bs_id: bsId,
    article: 6,
    field: 'Roaming_User_Pct',
    advisory_text: SOP6_ROAMING_PRE_WARNING_TEXT,
  };
}
