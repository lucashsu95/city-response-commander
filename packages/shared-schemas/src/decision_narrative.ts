/**
 * DecisionNarrative — LLM-generated text items (§10.11b)
 *
 * Stored in DecisionNarrativeTable with PK decision_id + SK narrative_type.
 * Each narrative_type is an independent item written by its own RendererFn branch.
 * Written via attribute_not_exists(decision_id) conditional Put.
 *
 * Field markers:
 * - @LLM-writable — Bedrock CAN write this field
 * - @derived — deterministically derived
 *
 * @module shared-schemas/decision_narrative
 */

import type { NarrativeType, Language } from './enums.js';

/**
 * DecisionNarrative — a single narrative item in the table.
 *
 * PK: decision_id, SK: narrative_type
 * Required set: {REPORT, PUBLIC_ALERT, EXPLANATION}
 */
export interface DecisionNarrative {
  /** PK - corresponds to DecisionCore.decision_id */
  readonly decision_id: string;
  /** SK - one of REPORT | PUBLIC_ALERT | EXPLANATION */
  readonly narrative_type: NarrativeType;
  /** @derived corresponds to DecisionCore.version */
  readonly core_version_ref: number;
  /**
   * Dashboard dedup key: decision_id | event_type | core_version_ref
   * @derived
   */
  readonly ready_event_id: string;
  /**
   * Payload varies by narrative_type
   * @LLM-writable
   */
  readonly payload: ReportPayload | PublicAlertPayload | ExplanationPayload;
}

/**
 * REPORT narrative payload (ReportComposer branch)
 * @LLM-writable
 */
export interface ReportPayload {
  readonly type: 'REPORT';
  /** @LLM-writable report text */
  readonly report_text: string;
  /**
   * Optional supplementary explanation (LLM-writable).
   * MUST NOT alter cms_core_text (road/ETE/official directives).
   * @LLM-writable
   */
  readonly cms_explanation_text?: string;
  /** @LLM-writable citation presentation formatting */
  readonly citations_presentation?: string;
}

/**
 * PUBLIC_ALERT narrative payload (PublicAlertComposer branch)
 * @LLM-writable
 */
export interface PublicAlertPayload {
  readonly type: 'PUBLIC_ALERT';
  /**
   * Map of language code to alert text.
   * Languages determined by deterministic trigger (LLM-prohibited decision).
   * @LLM-writable (text content only)
   */
  readonly public_alert_text: Partial<Record<Language, string>>;
}

/**
 * EXPLANATION narrative payload (ExplanationComposer / RendererFn mode=EXPLANATION)
 * No independent explanation.ready event; readiness signaled via decision.enriched.
 * @LLM-writable
 */
export interface ExplanationPayload {
  readonly type: 'EXPLANATION';
  /** @LLM-writable explanation text from EvidenceTrace + citations */
  readonly explanation_text: string;
}
