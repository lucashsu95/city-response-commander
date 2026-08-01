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
} from '@city-commander/shared-schemas';
import { RouteCandidateRole } from '@city-commander/shared-schemas';
import { TRIGGER_STATUSES, isArticle2Triggered } from './article2.js';

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
