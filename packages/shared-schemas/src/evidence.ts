/**
 * EvidenceTrace — deterministic explanation-chain facts (§10.10, R15)
 *
 * Records classification reasoning, excluded routes with reasons,
 * SOP citations, and data points. All fields are deterministic (LLM-prohibited facts).
 *
 * @module shared-schemas/evidence
 */

/** SOP citation from KB Retrieve or S3 fallback */
export interface SopCitation {
  /** Article number (1-7) */
  readonly article_no: number;
  /** Source location (verbatim from KB or S3 path) */
  readonly source_location: string;
  /** Relevant content snippet */
  readonly content: string;
  /** Relevancy score (from KB Retrieve) */
  readonly score?: number;
}

/** A single data point used in the decision */
export interface DataPoint {
  /** Source file (e.g. city_traffic_flow.csv) */
  readonly source: string;
  /** Field name */
  readonly field: string;
  /** Value used */
  readonly value: string | number | boolean;
  /** Timestamp of the data point */
  readonly timestamp: string;
}

/** Classification reasoning for a single segment */
export interface ClassificationReasoning {
  /** The segment that was classified */
  readonly segment_id: string;
  /** The saturation value used */
  readonly value: number;
  /** The threshold applied */
  readonly threshold: string;
  /** Conclusion (A/B/normal) */
  readonly conclusion: string;
}

/** Excluded route with its reason */
export interface ExcludedRouteReason {
  /** The excluded segment ID */
  readonly segment_id: string;
  /** Non-empty exclusion reason (required by design) */
  readonly reason: string;
}

/**
 * Deterministic per-article trigger grounding: which entity's value actually
 * satisfied the article's condition. Distinct from `ClassificationReasoning`
 * (art.1 only) — covers the crowd-scoped articles (3/4/6), each of which is
 * hard-bound to one specific station regardless of which entity a What-if
 * assumption targeted. Without this, an explanation composer has no
 * grounded way to know whether a triggered article's cause matches the
 * entity a caller asked about, or is unrelated pre-existing baseline data.
 */
export interface ArticleTriggerGrounding {
  /** SOP article number (3, 4, or 6) */
  readonly article: number;
  /** The entity whose value(s) actually satisfied the condition */
  readonly entity_id: string;
  /** Deterministic, non-empty reason string (e.g. "Growth_Rate 0.5 > 0.3") */
  readonly reason: string;
}

/**
 * EvidenceTrace — complete decision explanation chain
 *
 * Every excluded route MUST have a non-empty reason.
 * All facts are deterministic — no LLM authorship of facts.
 */
export interface EvidenceTrace {
  /** @derived decision identifier */
  readonly decision_id: string;
  /** @derived classification reasoning (value + threshold + conclusion) */
  readonly classification_reasoning: readonly ClassificationReasoning[];
  /** @derived each excluded route has a non-empty reason */
  readonly excluded_routes: readonly ExcludedRouteReason[];
  /** @derived SOP citations referencing citation_article_set */
  readonly sop_citations: readonly SopCitation[];
  /** @derived data points used in the decision */
  readonly data_points: readonly DataPoint[];
}
