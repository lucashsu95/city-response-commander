/**
 * Dashboard read queries backing the four public GET routes
 * (design §12, §16.1; TASK-150).
 *
 * `/timeline`, `/roads`, `/crowd` and `/incidents` all answer the same underlying
 * question — "what does the official data say at the current replay position?" —
 * so the ingestion and selection plumbing lives here once and each handler stays a
 * thin HTTP shell.
 *
 * ## Three boundaries this file respects
 *
 * **No rule semantics.** A/B grading comes from `classifySegments`; the SOP-3 /
 * SOP-4 / SOP-6 station flags come from `evaluateArticle3` / `evaluateArticle4` /
 * `evaluateArticle6`. No threshold is written here. `/roads` needs `level` and
 * `/crowd` needs `flags` (§12), and re-deriving either from a literal would put a
 * second, unvalidated copy of the SOP next to member 1's.
 *
 * **No fabrication.** A station or segment with no legal row at the replay
 * position is reported with `null` values, never a substituted number. The
 * dashboard is allowed to show a gap; it is not allowed to show an invented
 * saturation score that the operator might act on (§21).
 *
 * **No client-side derivation.** Everything the Dashboard has to *render* is
 * decided here: the A/B `level`, the station `flags`, whether a row is `stale`,
 * and whether an entity has usable data at all. The frontend re-deriving any of
 * these from `Saturation_Score` / `User_Count` / `roaming_pct_value` would create a
 * second implementation of an official threshold in a layer nobody property-tests
 * (§9). Hence `stale`, `data_status` and `flags` are backend truth, not hints.
 *
 * ## Selection is injected, not re-implemented
 *
 * "Latest row at or before the cutoff" is Strategy A (§30). It is taken as a port
 * so the real `SnapshotSelector` is used in production and no second alignment
 * implementation can drift from the one the decision path uses.
 * {@link createDashboardPortsFromConfig} builds both ports from a
 * `ConfigProvider`, so production and LOCAL_MOCK share one construction path.
 *
 * @module backend/handlers/dashboard_query
 */

import {
  ARTICLE3_STATION_ID,
  ARTICLE4_STATION_ID,
  classifySegments,
  createPolicyStrategyBundle,
  evaluateArticle3,
  evaluateArticle4,
  evaluateArticle6,
} from '@city-commander/domain';
import type {
  CurrentStationSnapshot,
  IngestionResult,
  MultilingualScopeMode,
  MultilingualScopeResult,
  PolicyStrategyConfigProvider,
} from '@city-commander/domain';
import { SCHEMA_VERSION } from '@city-commander/shared-schemas';
import type { Incident, PolicyMetadata } from '@city-commander/shared-schemas';

/** Ingestion port (TASK-019). Synchronous, matching `ingestData`. */
export interface DashboardIngestionPort {
  ingest(): IngestionResult;
}

/**
 * Strategy A port: latest row at or before the cutoff, per entity (§30).
 *
 * Mirrors `SelectedSnapshot` exactly, including `exact_match` and
 * `staleness_minutes`. An earlier revision narrowed this to `{record, data_status}`
 * and threw the timing evidence away — which forced the Dashboard to guess whether
 * a value was current. HG-001 requires that evidence to be displayed, so it is
 * carried through instead.
 */
export interface DashboardSnapshotPort {
  select<T extends { readonly timestamp_normalized: Date }>(
    entityId: string,
    cutoff: Date,
    records: readonly T[],
  ): {
    readonly record: T | null;
    readonly exact_match: boolean;
    /** May be `Infinity` when no legal row exists; normalized before serialization. */
    readonly staleness_minutes: number;
    readonly data_status: 'ready' | 'insufficient_data';
  };
}

/**
 * Provisional-policy port (§30, OQ-005).
 *
 * `metadata` is surfaced verbatim as the `policy` envelope field so the Dashboard
 * can show the provisional badge without knowing which strategies exist.
 */
export interface DashboardPolicyPort {
  readonly metadata: PolicyMetadata;
  /** Strategy F: which current station snapshots may trigger SOP-6. */
  stationsInMultilingualScope(current: readonly CurrentStationSnapshot[]): MultilingualScopeResult;
}

/** Ports the dashboard queries need. */
export interface DashboardPorts {
  readonly ingestion: DashboardIngestionPort;
  readonly snapshots: DashboardSnapshotPort;
  readonly policy: DashboardPolicyPort;
}

/**
 * Build both policy-dependent ports from a `ConfigProvider`.
 *
 * One construction path for production and LOCAL_MOCK: the same
 * `createPolicyStrategyBundle` the decision path uses, so the dashboard cannot
 * align snapshots differently from the decision it is displaying.
 *
 * Strategy F's non-default modes (`incident_area_nearby_stations`,
 * `explicit_host_policy`) need host-provided station ids that OQ-005 has not
 * defined and that the config schema therefore does not carry. Under those modes
 * the scope resolves EMPTY, and `evaluateMultilingualTrigger` reports
 * `insufficient_data` rather than `triggered:false` — the honest answer for an open
 * question, and never a silent "all stations".
 *
 * @example
 * ```ts
 * const ports = createDashboardPortsFromConfig({
 *   ingestion: { ingest: () => ingestData(sourceProvider) },
 *   config: configProvider,
 * });
 * export const handler = createGetRoadsHandler(ports);
 * ```
 */
export function createDashboardPortsFromConfig(input: {
  readonly ingestion: DashboardIngestionPort;
  readonly config: PolicyStrategyConfigProvider;
}): DashboardPorts {
  const bundle = createPolicyStrategyBundle(input.config);
  const mode: MultilingualScopeMode = bundle.metadata.multilingual_scope.mode;

  return {
    ingestion: input.ingestion,
    snapshots: {
      select: (entityId, cutoff, records) => bundle.timeAlignment.select(entityId, cutoff, records),
    },
    policy: {
      metadata: bundle.metadata,
      stationsInMultilingualScope: (current) =>
        bundle.multilingualScope.stationsInScope(current, { mode }),
    },
  };
}

/** Fields every §12 response carries. */
export interface ResponseEnvelope {
  readonly schema_version: string;
  readonly trace_id: string;
  /** `insufficient_data` when the source-hash STOP gate failed (§10.0, §21). */
  readonly data_status: 'ready' | 'insufficient_data';
  /** Present only when `data_status='insufficient_data'`. */
  readonly stop_reason?: string;
  /**
   * The replay position every `staleness_minutes` on this response is measured
   * against, in the raw official format. `null` when there is nothing to replay.
   */
  readonly decision_cutoff_timestamp: string | null;
  /** Active provisional Strategy modes (§10.6). Drives the provisional badge. */
  readonly policy: PolicyMetadata;
  /** `true` while any policy on this response is provisional rather than official. */
  readonly provisional: boolean;
}

/**
 * Per-entity snapshot evidence (HG-001; TASK-125/126).
 *
 * `stale` is computed here on purpose. The window that makes a row too old is
 * `policy.time_alignment.max_staleness_minutes` — configuration, not a constant —
 * so a frontend comparing `staleness_minutes` to a literal would silently disagree
 * with the engine the moment that key changes.
 */
export interface SnapshotProvenance {
  /** Raw official timestamp of the SELECTED row. `null` when none was usable. */
  readonly observation_timestamp: string | null;
  /** Whether the selected row sits exactly on the replay position. */
  readonly exact_match: boolean;
  /** Minutes between the selected row and the cutoff. `null` when no row exists. */
  readonly staleness_minutes: number | null;
  /** Backend staleness truth: usable, but older than the replay position. */
  readonly stale: boolean;
  /** Per-entity status. `insufficient_data` ⇒ every value on this row is `null`. */
  readonly data_status: 'ready' | 'insufficient_data';
}

/** `GET /timeline` — `{timestamps[], current}` (§12). */
export interface TimelineResponse extends ResponseEnvelope {
  /** Distinct official instants, ascending, in the raw official format. */
  readonly timestamps: readonly string[];
  /** Current replay position: the latest available instant. `null` when empty. */
  readonly current: string | null;
}

/** One row of `GET /roads`. */
export interface RoadSegmentView extends SnapshotProvenance {
  readonly Segment_ID: string;
  /** Official road name, for labelling. `null` when no legal row exists. */
  readonly Road_Name: string | null;
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
  | 'SOP4_DOME_DISPERSAL'
  /** SOP-6 multilingual triggered by THIS station (`evaluateArticle6`). */
  | 'SOP6_MULTILINGUAL';

/** One row of `GET /crowd`. */
export interface CrowdStationView extends SnapshotProvenance {
  readonly BS_ID: string;
  /** Official location name, for labelling. `null` when no legal row exists. */
  readonly Location_Name: string | null;
  readonly User_Count: number | null;
  readonly Growth_Rate: number | null;
  readonly roaming_pct_value: number | null;
  /** Official raw percent string, so the UI never reformats a normalized value. */
  readonly Roaming_User_Pct: string | null;
  readonly flags: readonly StationFlag[];
  /** Whether Strategy F admitted this station into the SOP-6 scope (OQ-005). */
  readonly in_multilingual_scope: boolean;
}

/**
 * Scope-level SOP-6 truth (§9.4 art.6, §11.8).
 *
 * `multilingual_required` is the deterministic, LLM-prohibited trigger the alert
 * composer consumes. It is exposed here so the anomaly-popup polling fallback
 * (REQ-002) can react to art.6 without recomputing the 30% threshold.
 */
export interface MultilingualScopeView {
  readonly triggered: boolean;
  readonly multilingual_required: boolean;
  readonly triggering_station_ids: readonly string[];
  /** `insufficient_data` when an in-scope reading is missing or the scope is empty. */
  readonly data_status: 'ready' | 'insufficient_data';
  /** Active Strategy F mode (OQ-005, still open). */
  readonly scope_mode: string;
  readonly stations_in_scope: readonly string[];
}

/** `GET /crowd` — `{stations:[...]}` (§12) plus the scope-level art.6 result. */
export interface CrowdResponse extends ResponseEnvelope {
  readonly stations: readonly CrowdStationView[];
  readonly multilingual: MultilingualScopeView;
}

/** `GET /incidents` — `{incidents:[Incident]}` (§12). */
export interface IncidentsResponse extends ResponseEnvelope {
  readonly incidents: readonly Incident[];
}

/** Traffic rows paired with the instant the ingestion layer normalized. */
interface AlignedTraffic {
  readonly Segment_ID: string;
  readonly Road_Name: string;
  readonly Saturation_Score: number;
  readonly Lane_Status: string;
  readonly timestamp_raw: string;
  readonly timestamp_normalized: Date;
}

interface AlignedCrowd {
  readonly BS_ID: string;
  readonly Location_Name: string;
  readonly User_Count: number;
  readonly Growth_Rate: number;
  readonly roaming_pct_value: number;
  readonly Roaming_User_Pct: string;
  readonly timestamp_raw: string;
  readonly timestamp_normalized: Date;
}

/** A selection result carrying a row that knows its own raw timestamp. */
interface Selection<T extends { readonly timestamp_raw: string }> {
  readonly record: T | null;
  readonly exact_match: boolean;
  readonly staleness_minutes: number;
  readonly data_status: 'ready' | 'insufficient_data';
}

/**
 * Turn a Strategy A result into wire-safe provenance.
 *
 * `staleness_minutes` arrives as `Infinity` when no legal row exists at all.
 * `JSON.stringify` would silently coerce that to `null`, so it is mapped
 * explicitly here rather than left to the serializer.
 */
function provenanceOf<T extends { readonly timestamp_raw: string }>(
  selected: Selection<T>,
): SnapshotProvenance {
  const usable = selected.data_status === 'ready' && selected.record !== null;

  return {
    observation_timestamp:
      usable && selected.record !== null ? selected.record.timestamp_raw : null,
    exact_match: usable && selected.exact_match,
    staleness_minutes: Number.isFinite(selected.staleness_minutes)
      ? selected.staleness_minutes
      : null,
    stale: usable && !selected.exact_match,
    data_status: usable ? 'ready' : 'insufficient_data',
  };
}

function envelope(
  traceId: string,
  ingested: IngestionResult,
  policy: PolicyMetadata,
  cutoffRaw: string | null,
): ResponseEnvelope {
  const shared = {
    schema_version: SCHEMA_VERSION,
    trace_id: traceId,
    decision_cutoff_timestamp: cutoffRaw,
    policy,
    provisional: policy.is_official === false,
  } as const;

  return ingested.data_status === 'ready'
    ? { ...shared, data_status: 'ready' }
    : {
        ...shared,
        data_status: 'insufficient_data',
        stop_reason: ingested.stop_reason ?? 'Ingestion reported insufficient_data.',
      };
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
      Road_Name: String(row.Road_Name ?? ''),
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
      Location_Name: String(row.Location_Name ?? ''),
      User_Count: row.User_Count,
      Growth_Rate: row.Growth_Rate,
      roaming_pct_value: row.roaming_pct_value,
      Roaming_User_Pct: String(row.Roaming_User_Pct ?? ''),
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

/** Ingest once, align once, resolve the replay position once. */
function load(ports: DashboardPorts): {
  readonly ingested: IngestionResult;
  readonly traffic: readonly AlignedTraffic[];
  readonly crowd: readonly AlignedCrowd[];
  readonly cutoff: Date | null;
  readonly cutoffRaw: string | null;
} {
  const ingested = ports.ingestion.ingest();
  if (ingested.data_status !== 'ready') {
    return { ingested, traffic: [], crowd: [], cutoff: null, cutoffRaw: null };
  }

  const traffic = alignTraffic(ingested);
  const crowd = alignCrowd(ingested);
  const { cutoff, raw } = resolveCutoff(traffic, crowd);
  return { ingested, traffic, crowd, cutoff, cutoffRaw: raw };
}

/**
 * `GET /timeline` (R1.5, R4.1).
 *
 * Timestamps are returned in the raw official format, never reformatted: §10.1
 * requires the official string to be preserved verbatim, and the Dashboard uses
 * them as opaque replay keys.
 */
export function queryTimeline(ports: DashboardPorts, traceId: string): TimelineResponse {
  const { ingested, traffic, crowd, cutoffRaw } = load(ports);
  const base = envelope(traceId, ingested, ports.policy.metadata, cutoffRaw);
  if (base.data_status !== 'ready') return { ...base, timestamps: [], current: null };

  const byInstant = new Map<number, string>();
  for (const row of [...traffic, ...crowd]) {
    byInstant.set(row.timestamp_normalized.getTime(), row.timestamp_raw);
  }
  const timestamps = [...byInstant.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, raw]) => raw);

  return { ...base, timestamps, current: cutoffRaw };
}

/**
 * `GET /roads` (R2, R4.3).
 *
 * Grades every segment present in the official data rather than a hard-coded list,
 * so a change in the source cannot silently drop a segment from the view.
 */
export function queryRoads(ports: DashboardPorts, traceId: string): RoadsResponse {
  const { ingested, traffic, cutoff, cutoffRaw } = load(ports);
  const base = envelope(traceId, ingested, ports.policy.metadata, cutoffRaw);
  if (base.data_status !== 'ready' || cutoff === null) return { ...base, segments: [] };

  const segmentIds = [...new Set(traffic.map((row) => row.Segment_ID))].sort();

  const selected = segmentIds.map((segmentId) => {
    const rows = traffic.filter((row) => row.Segment_ID === segmentId);
    return { segmentId, result: ports.snapshots.select(segmentId, cutoff, rows) };
  });

  // Grading is delegated in ONE call, so the engine sees the same population it
  // would see on the decision path.
  const classifications = classifySegments(
    selected.map(({ segmentId, result }) => ({
      segment_id: segmentId,
      saturation_score:
        result.data_status === 'ready' ? (result.record?.Saturation_Score ?? null) : null,
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
    segments: selected.map(({ segmentId, result }) => {
      const provenance = provenanceOf(result);
      const row = provenance.data_status === 'ready' ? result.record : null;

      return {
        ...provenance,
        Segment_ID: segmentId,
        Road_Name: row?.Road_Name ?? null,
        Saturation_Score: row?.Saturation_Score ?? null,
        level: levelBySegment.get(segmentId) ?? null,
        Lane_Status: row?.Lane_Status ?? null,
      };
    }),
  };
}

/**
 * `GET /crowd` (R8, R9, R11).
 *
 * SOP-3 and SOP-4 are evaluated only for the stations the SOP names; every other
 * station gets an empty flag array, because there is no official rule to evaluate
 * for it and inventing one would be fabrication. SOP-6 is different: it is a
 * SCOPE-level trigger over Strategy F's station set, so it is evaluated once and
 * then attributed back to the stations that actually crossed the threshold.
 */
export function queryCrowd(ports: DashboardPorts, traceId: string): CrowdResponse {
  const { ingested, crowd, cutoff, cutoffRaw } = load(ports);
  const base = envelope(traceId, ingested, ports.policy.metadata, cutoffRaw);

  if (base.data_status !== 'ready' || cutoff === null) {
    const scope = ports.policy.stationsInMultilingualScope([]);
    return {
      ...base,
      stations: [],
      multilingual: multilingualViewOf(scope),
    };
  }

  const stationIds = [...new Set(crowd.map((row) => row.BS_ID))].sort();

  const selected = stationIds.map((stationId) => {
    const rows = crowd.filter((row) => row.BS_ID === stationId);
    const result = ports.snapshots.select(stationId, cutoff, rows);
    const provenance = provenanceOf(result);
    const current = provenance.data_status === 'ready' ? result.record : null;
    return { stationId, rows, current, provenance };
  });

  // Strategy F decides the SOP-6 scope from CURRENT readings only; a station with
  // no legal row contributes `null`, which `evaluateMultilingualTrigger` treats as
  // "not conclusive" rather than "below threshold".
  const scope = ports.policy.stationsInMultilingualScope(
    selected.map(({ stationId, current }) => ({
      bs_id: stationId,
      roaming_pct_value: current?.roaming_pct_value ?? null,
    })),
  );
  const article6 = evaluateArticle6(scope);
  const triggering = new Set(article6.triggering_station_ids);
  const inScope = new Set(scope.stations_in_scope.map((station) => station.bs_id));

  return {
    ...base,
    stations: selected.map(({ stationId, rows, current, provenance }) => ({
      ...provenance,
      BS_ID: stationId,
      Location_Name: current?.Location_Name ?? null,
      User_Count: current?.User_Count ?? null,
      Growth_Rate: current?.Growth_Rate ?? null,
      roaming_pct_value: current?.roaming_pct_value ?? null,
      Roaming_User_Pct: current?.Roaming_User_Pct ?? null,
      in_multilingual_scope: inScope.has(stationId),
      flags: stationFlags(stationId, current, rows, cutoff, triggering.has(stationId)),
    })),
    multilingual: {
      triggered: article6.triggered,
      multilingual_required: article6.multilingual_required,
      triggering_station_ids: article6.triggering_station_ids,
      data_status: article6.data_status,
      scope_mode: article6.multilingual_scope.mode,
      stations_in_scope: article6.multilingual_scope.stations_in_scope,
    },
  };
}

function multilingualViewOf(scope: MultilingualScopeResult): MultilingualScopeView {
  const article6 = evaluateArticle6(scope);
  return {
    triggered: article6.triggered,
    multilingual_required: article6.multilingual_required,
    triggering_station_ids: article6.triggering_station_ids,
    data_status: article6.data_status,
    scope_mode: article6.multilingual_scope.mode,
    stations_in_scope: article6.multilingual_scope.stations_in_scope,
  };
}

/** Delegate every flag to a domain evaluator. No threshold lives here. */
function stationFlags(
  stationId: string,
  current: AlignedCrowd | null,
  rows: readonly AlignedCrowd[],
  cutoff: Date,
  multilingualTriggeredByThisStation: boolean,
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

  // Attributed from the scope-level art.6 evaluation, not recomputed per station.
  if (multilingualTriggeredByThisStation) flags.push('SOP6_MULTILINGUAL');

  return flags;
}

/** `GET /incidents` (R5.1). */
export function queryIncidents(ports: DashboardPorts, traceId: string): IncidentsResponse {
  const { ingested, cutoffRaw } = load(ports);
  const base = envelope(traceId, ingested, ports.policy.metadata, cutoffRaw);
  if (base.data_status !== 'ready') return { ...base, incidents: [] };

  return { ...base, incidents: ingested.incidents ?? [] };
}
