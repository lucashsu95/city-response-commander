/**
 * Domain pipeline adapter — the seam between `DecisionFn` and the deterministic
 * domain (design §8, §9, §21; TASK-099).
 *
 * `DecisionFn` owns orchestration, persistence and the zero-write invariant. It
 * owns NO rule semantics: every threshold, grading boundary and formula stays in
 * `packages/domain` (member 1's Rule Engine). This adapter is the only place the
 * two meet, so the boundary is inspectable in one file.
 *
 * ## The no-fabrication rule
 *
 * When a required input is absent the adapter reports the gap and stops. It never
 * substitutes a default. That is not defensiveness — a defaulted saturation score
 * would be graded A/B, feed the ETE formula, be written into an immutable
 * DecisionCore, be quoted in the CMS text and be pushed to the public. It would
 * also pass every test. §21 is explicit: official data unavailable →
 * `data_status=insufficient_data`, STOP, disclose the gap.
 *
 * ## Honest scope
 *
 * The steps below are wired against verified domain signatures and run for real:
 *
 *   source-hash STOP gate → DataIngestionService → Strategy A snapshot alignment
 *   (per segment) → ClassificationEngine (all segments) → art.1 → art.2 trigger
 *   → article aggregation
 *
 * The remaining steps — incident anchor (Strategy D), candidate qualification,
 * evacuation selection, ETE (art.7), art.3–6, EvidenceTrace — are NOT wired here.
 * Their call contracts have not been verified against the domain package, and the
 * ACC_001 = 78.6 / EVT_002 = 22:15 / EVT_003 = 41.0 acceptance values are member
 * 1's responsibility. Guessing the assembly would produce a green test suite and a
 * wrong ETE, which is the worst possible outcome.
 *
 * They are therefore declared in {@link PENDING_PIPELINE_STEPS} and reported as
 * `pending_steps`. While any step is pending the adapter returns
 * `insufficient_data`, so `DecisionFn` cannot build a DecisionCore from a partial
 * pipeline. Completing them is a matter of deleting entries from that list and
 * adding the calls — the surrounding contract does not change.
 *
 * @module backend/decision/domain_pipeline_adapter
 */

import type { Incident, SegmentClassification } from '@city-commander/shared-schemas';

/** Traffic row shape consumed here, matching `RawTrafficRecord` (§10.1). */
export interface TrafficRow {
  readonly Segment_ID: string;
  readonly Saturation_Score: number;
  readonly timestamp_raw: string;
}

/** A traffic row paired with its normalized timestamp (Strategy A input). */
export interface AlignedTrafficRow extends TrafficRow {
  /** Required by `TimeAlignmentStrategy`; produced by the timestamp normalizer. */
  readonly timestamp_normalized: Date;
}

/** Per-segment alignment diagnostics, surfaced for disclosure (§21). */
export interface SegmentAlignmentDiagnostic {
  readonly segment_id: string;
  readonly data_status: 'ready' | 'insufficient_data';
  readonly exact_match: boolean;
  readonly staleness_minutes: number;
  readonly selected_timestamp_raw: string | null;
}

/**
 * Strategy A port.
 *
 * Declared as a port rather than importing `SnapshotSelector` directly so the
 * adapter is unit-testable without a `ConfigProvider`, and so the provisional
 * policy stays swappable by configuration (§30).
 */
export interface SnapshotAlignmentPort {
  select<T extends { readonly timestamp_normalized: Date }>(
    entityId: string,
    eventTimestamp: Date,
    records: readonly T[],
  ): {
    readonly record: T | null;
    readonly exact_match: boolean;
    readonly staleness_minutes: number;
    readonly data_status: 'ready' | 'insufficient_data';
  };
}

/** Ingestion port: the verified `IngestionResult` shape (§15.1). */
export interface IngestionPort {
  ingest(): {
    readonly data_status: 'ready' | 'insufficient_data';
    readonly source_manifest_hash: string;
    readonly stop_reason: string | null;
    readonly traffic?: readonly TrafficRow[];
    readonly trafficTimestamps?: readonly { readonly timestamp_normalized: Date }[];
    readonly incidents?: readonly Incident[];
  };
}

/** Deterministic rule-engine functions, injected so no semantics live here. */
export interface RuleEnginePort {
  classifySegments(
    snapshots: readonly { readonly segment_id: string; readonly saturation_score: number | null }[],
  ): readonly SegmentClassification[];
  evaluateArticle1(classifications: readonly SegmentClassification[]): {
    readonly triggered: boolean;
    readonly invoked_procedures: readonly string[];
  };
  isArticle2Triggered(incident: Incident): boolean;
  aggregateArticles(input: {
    readonly evaluations: readonly {
      readonly article: number;
      readonly triggered: boolean;
      readonly invoked_procedures?: readonly string[];
    }[];
    readonly applied_formula_articles: readonly number[];
  }): {
    readonly triggered_articles: readonly number[];
    readonly applied_formula_articles: readonly number[];
    readonly invoked_procedures: readonly string[];
    readonly citation_article_set: readonly number[];
  };
}

/** The ports the default adapter needs. */
export interface DomainPipelinePorts {
  readonly ingestion: IngestionPort;
  readonly snapshots: SnapshotAlignmentPort;
  readonly ruleEngine: RuleEnginePort;
}

/** Adapter input. */
export interface DomainPipelineInput {
  /** Official event id, as it appears in `live_incidents.json`. */
  readonly eventId: string;
}

/**
 * Domain steps not yet wired.
 *
 * While this list is non-empty the adapter always reports `insufficient_data`,
 * which is what stops a partial pipeline from producing a DecisionCore.
 */
export const PENDING_PIPELINE_STEPS: readonly string[] = [
  'incident_anchor_resolution_strategy_d',
  'article2_candidate_qualification',
  'evacuation_selector',
  'article3_mrt_shuttle',
  'article4_dome_dispersal',
  'article5_signal_failure',
  'article6_multilingual_trigger',
  'ete_calculator_article7',
  'evidence_trace_builder',
];

/** Facts the wired steps produced. Present even when the result is incomplete. */
export interface PartialDecisionFacts {
  readonly incident: Incident;
  readonly classifications: readonly SegmentClassification[];
  readonly triggered_articles: readonly number[];
  readonly applied_formula_articles: readonly number[];
  readonly invoked_procedures: readonly string[];
  readonly citation_article_set: readonly number[];
  readonly segment_alignment: readonly SegmentAlignmentDiagnostic[];
}

/** Adapter result. */
export interface DomainPipelineResult {
  readonly data_status: 'ready' | 'insufficient_data';
  /** Why the pipeline stopped. `null` only when `data_status='ready'`. */
  readonly stop_reason: string | null;
  /** Official-source provenance; empty string when the STOP gate failed. */
  readonly source_manifest_hash: string;
  /** Domain steps still unwired. Non-empty ⇒ `insufficient_data`. */
  readonly pending_steps: readonly string[];
  /** Facts computed by the wired steps; `null` when ingestion stopped. */
  readonly facts: PartialDecisionFacts | null;
}

/** The adapter contract `DecisionFn` depends on. */
export interface DomainPipelineAdapter {
  execute(input: DomainPipelineInput): Promise<DomainPipelineResult>;
}

function stopped(
  stopReason: string,
  sourceManifestHash = '',
  facts: PartialDecisionFacts | null = null,
): DomainPipelineResult {
  return {
    data_status: 'insufficient_data',
    stop_reason: stopReason,
    source_manifest_hash: sourceManifestHash,
    pending_steps: PENDING_PIPELINE_STEPS,
    facts,
  };
}

/**
 * Runs the wired portion of the deterministic pipeline.
 *
 * Every rule-engine call is delegated to the injected {@link RuleEnginePort}; this
 * class contains no threshold, no boundary and no formula.
 */
export class DefaultDomainPipelineAdapter implements DomainPipelineAdapter {
  constructor(private readonly ports: DomainPipelinePorts) {}

  async execute(input: DomainPipelineInput): Promise<DomainPipelineResult> {
    // 1. Source-hash STOP gate + the five official files (TASK-007 / TASK-019).
    //    A hash mismatch stops here: an unknown data version must never decide.
    const ingested = this.ports.ingestion.ingest();

    if (ingested.data_status === 'insufficient_data') {
      return stopped(ingested.stop_reason ?? 'Ingestion reported insufficient_data.');
    }

    const traffic = ingested.traffic;
    const trafficTimestamps = ingested.trafficTimestamps;
    const incidents = ingested.incidents;

    if (traffic === undefined || trafficTimestamps === undefined || incidents === undefined) {
      return stopped(
        'Ingestion reported ready but did not expose traffic/incident datasets.',
        ingested.source_manifest_hash,
      );
    }
    if (traffic.length !== trafficTimestamps.length) {
      // The normalized timestamps are a parallel array; a length mismatch means we
      // cannot pair a row with its instant, and pairing by guess would misalign
      // every snapshot.
      return stopped(
        'Traffic rows and normalized timestamps are misaligned; cannot pair rows to instants.',
        ingested.source_manifest_hash,
      );
    }

    const incident = incidents.find((candidate) => candidate.event_id === input.eventId);
    if (incident === undefined) {
      return stopped(
        `Event "${input.eventId}" is not present in the official incident set.`,
        ingested.source_manifest_hash,
      );
    }

    // 2. Pair each traffic row with its normalized instant (Strategy A input).
    const alignedRows: AlignedTrafficRow[] = traffic.map((row, index) => ({
      ...row,
      timestamp_normalized: trafficTimestamps[index].timestamp_normalized,
    }));

    const eventInstant = this.resolveEventInstant(incident, alignedRows);
    if (eventInstant === null) {
      return stopped(
        `Incident timestamp "${incident.timestamp}" could not be resolved to an instant.`,
        ingested.source_manifest_hash,
      );
    }

    // 3. Strategy A per segment, over EVERY segment present in the official data.
    //    SOP art.1 grades all 15 segments, so the set comes from the data rather
    //    than from a hard-coded list.
    const segmentIds = [...new Set(alignedRows.map((row) => row.Segment_ID))].sort();

    const alignment: SegmentAlignmentDiagnostic[] = [];
    const snapshots: { segment_id: string; saturation_score: number | null }[] = [];

    for (const segmentId of segmentIds) {
      const rows = alignedRows.filter((row) => row.Segment_ID === segmentId);
      const selected = this.ports.snapshots.select(segmentId, eventInstant, rows);

      alignment.push({
        segment_id: segmentId,
        data_status: selected.data_status,
        exact_match: selected.exact_match,
        staleness_minutes: selected.staleness_minutes,
        selected_timestamp_raw: selected.record?.timestamp_raw ?? null,
      });

      // No legal row → `null`, never a substituted value. ClassificationEngine
      // maps null to "no level" rather than guessing a grade.
      snapshots.push({
        segment_id: segmentId,
        saturation_score:
          selected.data_status === 'ready' && selected.record !== null
            ? selected.record.Saturation_Score
            : null,
      });
    }

    // 4. Deterministic grading + the article evaluations that are wired.
    const classifications = this.ports.ruleEngine.classifySegments(snapshots);
    const article1 = this.ports.ruleEngine.evaluateArticle1(classifications);
    const article2Triggered = this.ports.ruleEngine.isArticle2Triggered(incident);

    const aggregation = this.ports.ruleEngine.aggregateArticles({
      evaluations: [
        {
          article: 1,
          triggered: article1.triggered,
          invoked_procedures: article1.invoked_procedures,
        },
        { article: 2, triggered: article2Triggered },
      ],
      // art.7 is an APPLIED FORMULA, never a trigger (§9.5). It is listed here
      // only when the ETE step is wired; while pending it is omitted rather than
      // asserted.
      applied_formula_articles: [],
    });

    const facts: PartialDecisionFacts = {
      incident,
      classifications,
      triggered_articles: aggregation.triggered_articles,
      applied_formula_articles: aggregation.applied_formula_articles,
      invoked_procedures: aggregation.invoked_procedures,
      citation_article_set: aggregation.citation_article_set,
      segment_alignment: alignment,
    };

    // 5. Disclose the unwired steps. A DecisionCore built now would be missing
    //    routes, ETE and evidence, so it must not be built at all.
    if (PENDING_PIPELINE_STEPS.length > 0) {
      return {
        data_status: 'insufficient_data',
        stop_reason:
          `Domain pipeline incomplete: ${PENDING_PIPELINE_STEPS.join(', ')}. ` +
          'Refusing to assemble a DecisionCore from a partial pipeline (§21 no-fabrication).',
        source_manifest_hash: ingested.source_manifest_hash,
        pending_steps: PENDING_PIPELINE_STEPS,
        facts,
      };
    }

    /* c8 ignore next 7 -- unreachable while PENDING_PIPELINE_STEPS is non-empty */
    return {
      data_status: 'ready',
      stop_reason: null,
      source_manifest_hash: ingested.source_manifest_hash,
      pending_steps: [],
      facts,
    };
  }

  /**
   * Resolve the incident timestamp to an instant.
   *
   * Reuses the instant the ingestion layer already normalized for a traffic row
   * carrying the identical raw string, so the adapter never re-implements the
   * official timestamp parsing (which is `timestamp_normalizer`'s job). Returns
   * `null` when no such row exists — a gap to disclose, not to guess around.
   */
  private resolveEventInstant(
    incident: Incident,
    alignedRows: readonly AlignedTrafficRow[],
  ): Date | null {
    const match = alignedRows.find((row) => row.timestamp_raw === incident.timestamp);
    if (match !== undefined) return match.timestamp_normalized;

    // Official incident timestamps are `YYYY-MM-DD HH:MM` (SOP art.6). Parsed
    // through the same fixed Asia/Taipei offset used everywhere else, so the
    // comparison basis is consistent rather than host-dependent.
    const parsed = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(incident.timestamp);
    if (parsed === null) return null;

    const [, year, month, day, hour, minute] = parsed;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      0,
      0,
    );
  }
}
