/**
 * Dashboard read queries backing the four public GET routes
 * (design §12, §16.1; TASK-150).
 *
 * `/timeline`, `/roads`, `/crowd` and `/incidents` all answer the same underlying
 * question — "what does the official data say at the current replay position?" —
 * so the ingestion and selection plumbing lives here once and each handler stays a
 * thin HTTP shell.
 *
 * ## Two boundaries this file respects
 *
 * **No rule semantics.** A/B grading comes from `classifySegments`, and the SOP-3 /
 * SOP-4 station flags come from `evaluateArticle3` / `evaluateArticle4`. No
 * threshold is written here. `/roads` needs `level` and `/crowd` needs `flags`
 * (§12), and re-deriving either from a literal would put a second, unvalidated
 * copy of the SOP next to member 1's.
 *
 * **No fabrication.** A station or segment with no legal row at or before the
 * replay position is reported with `null` values, never a substituted number. The
 * dashboard is allowed to show a gap; it is not allowed to show an invented
 * saturation score that the operator might act on (§21).
 *
 * ## Selection is injected, not re-implemented
 *
 * "Latest row at or before the cutoff" is Strategy A (§30). It is taken as a port
 * so the real `SnapshotSelector` is used in production and no second alignment
 * implementation can drift from the one the decision path uses.
 *
 * @module backend/handlers/dashboard_query
 */

import {
  ARTICLE3_STATION_ID,
  ARTICLE4_STATION_ID,
  classifySegments,
  evaluateArticle3,
  evaluateArticle4,
} from '@city-commander/domain';
import type { IngestionResult } from '@city-commander/domain';
import { SCHEMA_VERSION } from '@city-commander/shared-schemas';
import type { Incident } from '@city-commander/shared-schemas';

/** Ingestion port (TASK-019). Synchronous, matching `ingestData`. */
export interface DashboardIngestionPort {
  ingest(): IngestionResult;
}

/** Strategy A port: latest row at or before the cutoff, per entity (§30). */
export interface DashboardSnapshotPort {
  select<T extends { readonly timestamp_normalized: Date }>(
    entityId: string,
    cutoff: Date,
    records: readonly T[],
  ): {
    readonly record: T | null;
    readonly data_status: 'ready' | 'insufficient_data';
  };
}

/** Ports the dashboard queries need. */
export interface DashboardPorts {
  readonly ingestion: DashboardIngestionPort;
  readonly snapshots: DashboardSnapshotPort;
}

/** Fields every §12 response carries. */
export interface ResponseEnvelope {
  readonly schema_version: string;
  readonly trace_id: string;
  /** `insufficient_data` when the source-hash STOP gate failed (§10.0, §21). */
  readonly data_status: 'ready' | 'insufficient_data';
  /** Present only when `data_status='insufficient_data'`. */
  readonly stop_reason?: string;
}

/** `GET /timeline` — `{timestamps[], current}` (§12). */
export interface TimelineResponse extends ResponseEnvelope {
  /** Distinct official instants, ascending, in the raw official format. */
  readonly timestamps: readonly string[];
  /** Current replay position: the latest available instant. `null` when empty. */
  readonly current: string | null;
}

/** One row of `GET /roads`. */
export interface RoadSegmentView {
  readonly Segment_ID: string;
  /** `null` when no legal row exists at the cutoff — never a default. */
  readonly Saturation_Score: number | null;
  /** A/B grading from `classifySegments`. `null` means "no level", not "normal". */
  readonly level: string | null;
  readonly Lane_Status: string | null;
}

/** `GET /roads` — `{segments:[...]}` (§12). */
export interface RoadsResponse extends ResponseEnvelope {
  readonly segments: readonly RoadSegmentView[];
}

/**
 * Station flag names.
 *
 * §12 specifies the field but not its vocabulary, so it is declared here and each
 * value maps to exactly one domain evaluator. Adding a value without a
 * corresponding evaluator would be inventing a threshold.
 */
export type StationFlag =
  /** SOP-3 triggered for BL17 (`evaluateArticle3`). */
  | 'SOP3_MRT_SHUTTLE'
  /** SOP-4 dome dispersal triggered (`evaluateArticle4`). */
  | 'SOP4_DOME_DISPERSAL';

/** One row of `GET /crowd`. */
export interface CrowdStationView {
  readonly BS_ID: string;
  readonly User_Count: number | null;
  readonly Growth_Rate: number | null;
  readonly roaming_pct_value: number | null;
  readonly flags: readonly StationFlag[];
}

/** `GET /crowd` — `{stations:[...]}` (§12). */
export interface CrowdResponse extends ResponseEnvelope {
  readonly stations: readonly CrowdStationView[];
}

/** `GET /incidents` — `{incidents:[Incident]}` (§12). */
export interface IncidentsResponse extends ResponseEnvelope {
  readonly incidents: readonly Incident[];
}

function envelope(traceId: string, ingested: IngestionResult): ResponseEnvelope {
  return ingested.data_status === 'ready'
    ? { schema_version: SCHEMA_VERSION, trace_id: traceId, data_status: 'ready' }
    : {
        schema_version: SCHEMA_VERSION,
        trace_id: traceId,
        data_status: 'insufficient_data',
        stop_reason: ingested.stop_reason ?? 'Ingestion reported insufficient_data.',
      };
}

/** Traffic rows paired with the instant the ingestion layer normalized. */
interface AlignedTraffic {
  readonly Segment_ID: string;
  readonly Saturation_Score: number;
  readonly Lane_Status: string;
  readonly timestamp_raw: string;
  readonly timestamp_normalized: Date;
}

interface AlignedCrowd {
  readonly BS_ID: string;
  readonly User_Count: number;
  readonly Growth_Rate: number;
  readonly roaming_pct_value: number;
  readonly timestamp_raw: string;
  readonly timestamp_normalized: Date;
}

/**
 * Pair rows with their normalized instants.
 *
 * The normalized timestamps are a PARALLEL array. A length mismatch means a row
 * cannot be tied to its instant, and pairing by index anyway would silently
 * misalign every subsequent row — so the shorter length wins and the surplus is
 * dropped rather than guessed.
 */
function alignTraffic(ingested: IngestionResult): readonly AlignedTraffic[] {
  const rows = ingested.traffic ?? [];
  const instants = ingested.trafficTimestamps ?? [];
  const usable = Math.min(rows.length, instants.length);

  const aligned: AlignedTraffic[] = [];
  for (let index = 0; index < usable; index += 1) {
    const row = rows[index];
    const instant = instants[index];
    if (row === undefined || instant === undefined) continue;
    aligned.push({
      Segment_ID: row.Segment_ID,
      Saturation_Score: row.Saturation_Score,
      Lane_Status: String(row.Lane_Status),
      timestamp_raw: row.timestamp_raw,
      timestamp_normalized: instant.timestamp_normalized,
    });
  }
  return aligned;
}

function alignCrowd(ingested: IngestionResult): readonly AlignedCrowd[] {
  const rows = ingested.crowd ?? [];
  const instants = ingested.crowdTimestamps ?? [];
  const usable = Math.min(rows.length, instants.length);

  const aligned: AlignedCrowd[] = [];
  for (let index = 0; index < usable; index += 1) {
    const row = rows[index];
    const instant = instants[index];
    if (row === undefined || instant === undefined) continue;
    aligned.push({
      BS_ID: row.BS_ID,
      User_Count: row.User_Count,
      Growth_Rate: row.Growth_Rate,
      roaming_pct_value: row.roaming_pct_value,
      timestamp_raw: row.timestamp_raw,
      timestamp_normalized: instant.timestamp_normalized,
    });
  }
  return aligned;
}

/** Latest instant across both datasets — the current replay position. */
function resolveCutoff(
  traffic: readonly AlignedTraffic[],
  crowd: readonly AlignedCrowd[],
): { readonly cutoff: Date | null; readonly raw: string | null } {
  let cutoff: Date | null = null;
  let raw: string | null = null;

  for (const row of [...traffic, ...crowd]) {
    if (cutoff === null || row.timestamp_normalized.getTime() > cutoff.getTime()) {
      cutoff = row.timestamp_normalized;
      raw = row.timestamp_raw;
    }
  }
  return { cutoff, raw };
}

/**
 * `GET /timeline` (R1.5, R4.1).
 *
 * Timestamps are returned in the raw official format, never reformatted: §10.1
 * requires the official string to be preserved verbatim, and the Dashboard uses
 * them as opaque replay keys.
 */
export function queryTimeline(ports: DashboardPorts, traceId: string): TimelineResponse {
  const ingested = ports.ingestion.ingest();
  const base = envelope(traceId, ingested);
  if (base.data_status !== 'ready') return { ...base, timestamps: [], current: null };

  const traffic = alignTraffic(ingested);
  const crowd = alignCrowd(ingested);

  const byInstant = new Map<number, string>();
  for (const row of [...traffic, ...crowd]) {
    byInstant.set(row.timestamp_normalized.getTime(), row.timestamp_raw);
  }
  const timestamps = [...byInstant.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, raw]) => raw);

  return { ...base, timestamps, current: resolveCutoff(traffic, crowd).raw };
}

/**
 * `GET /roads` (R2, R4.3).
 *
 * Grades every segment present in the official data rather than a hard-coded list,
 * so a change in the source cannot silently drop a segment from the view.
 */
export function queryRoads(ports: DashboardPorts, traceId: string): RoadsResponse {
  const ingested = ports.ingestion.ingest();
  const base = envelope(traceId, ingested);
  if (base.data_status !== 'ready') return { ...base, segments: [] };

  const traffic = alignTraffic(ingested);
  const { cutoff } = resolveCutoff(traffic, alignCrowd(ingested));
  if (cutoff === null) return { ...base, segments: [] };

  const segmentIds = [...new Set(traffic.map((row) => row.Segment_ID))].sort();

  const selected = segmentIds.map((segmentId) => {
    const rows = traffic.filter((row) => row.Segment_ID === segmentId);
    const result = ports.snapshots.select(segmentId, cutoff, rows);
    const usable = result.data_status === 'ready' ? result.record : null;
    return { segmentId, row: usable };
  });

  // Grading is delegated in ONE call, so the engine sees the same population it
  // would see on the decision path.
  const classifications = classifySegments(
    selected.map(({ segmentId, row }) => ({
      segment_id: segmentId,
      saturation_score: row?.Saturation_Score ?? null,
    })),
  );
  const levelBySegment = new Map(
    classifications.map((classification) => [
      classification.segment_id,
      classification.level === null ? null : String(classification.level),
    ]),
  );

  return {
    ...base,
    segments: selected.map(({ segmentId, row }) => ({
      Segment_ID: segmentId,
      Saturation_Score: row?.Saturation_Score ?? null,
      level: levelBySegment.get(segmentId) ?? null,
      Lane_Status: row?.Lane_Status ?? null,
    })),
  };
}

/**
 * `GET /crowd` (R8, R9, R11).
 *
 * Flags are evaluated only for the stations the SOP names — BL17 for SOP-3 and the
 * dome for SOP-4. Every other station gets an empty array, because there is no
 * official rule to evaluate for it and inventing one would be fabrication.
 */
export function queryCrowd(ports: DashboardPorts, traceId: string): CrowdResponse {
  const ingested = ports.ingestion.ingest();
  const base = envelope(traceId, ingested);
  if (base.data_status !== 'ready') return { ...base, stations: [] };

  const crowd = alignCrowd(ingested);
  const { cutoff } = resolveCutoff(alignTraffic(ingested), crowd);
  if (cutoff === null) return { ...base, stations: [] };

  const stationIds = [...new Set(crowd.map((row) => row.BS_ID))].sort();

  return {
    ...base,
    stations: stationIds.map((stationId) => {
      const rows = crowd.filter((row) => row.BS_ID === stationId);
      const result = ports.snapshots.select(stationId, cutoff, rows);
      const current = result.data_status === 'ready' ? result.record : null;

      return {
        BS_ID: stationId,
        User_Count: current?.User_Count ?? null,
        Growth_Rate: current?.Growth_Rate ?? null,
        roaming_pct_value: current?.roaming_pct_value ?? null,
        flags: evaluateStationFlags(stationId, current, rows, cutoff),
      };
    }),
  };
}

/** Delegate every flag to a domain evaluator. No threshold lives here. */
function evaluateStationFlags(
  stationId: string,
  current: AlignedCrowd | null,
  rows: readonly AlignedCrowd[],
  cutoff: Date,
): readonly StationFlag[] {
  const flags: StationFlag[] = [];

  if (stationId === ARTICLE3_STATION_ID) {
    const article3 = evaluateArticle3({
      bs_id: stationId,
      user_count: current?.User_Count ?? null,
      growth_rate: current?.Growth_Rate ?? null,
    });
    if (article3.triggered) flags.push('SOP3_MRT_SHUTTLE');
  }

  if (stationId === ARTICLE4_STATION_ID) {
    const article4 = evaluateArticle4({
      bs_id: stationId,
      current_observed_at: current?.timestamp_normalized ?? cutoff,
      // SOP-4 compares against the historical peak, so it needs the series, not
      // just the current row.
      historical_observations: rows.map((row) => ({
        observed_at: row.timestamp_normalized,
        user_count: row.User_Count,
      })),
      current_growth_rate: current?.Growth_Rate ?? null,
    });
    if (article4.triggered) flags.push('SOP4_DOME_DISPERSAL');
  }

  return flags;
}

/** `GET /incidents` (R5.1). */
export function queryIncidents(ports: DashboardPorts, traceId: string): IncidentsResponse {
  const ingested = ports.ingestion.ingest();
  const base = envelope(traceId, ingested);
  if (base.data_status !== 'ready') return { ...base, incidents: [] };

  return { ...base, incidents: ingested.incidents ?? [] };
}
