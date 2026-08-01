/**
 * @city-commander/rag — RAG 檢索與 SOP 知識庫整合
 */

// ─── Citation Article Set (TASK-110) ─────────────────────
export { buildCitationArticleSet } from './citation_article_set.js';

// ─── SchemaValidator (TASK-111) ──────────────────────────
export {
  validateBedrockPayload,
  type ValidationResult,
  type ValidatedPayload,
  type RejectedPayload,
  type RejectionReason,
} from './schema_validator.js';

// ─── Bedrock Adapter (TASK-112) ───────────────────────────
export {
  BedrockAdapter,
  type BedrockInvoker,
  type BedrockResult,
  type BedrockSuccess,
  type BedrockFailure,
  type BedrockFailureReason,
  type BedrockInvokeOptions,
} from './bedrock_adapter.js';

export { MockBedrockAdapter, createBedrockAdapter } from './mock_bedrock_adapter.js';

// ─── SOP Retriever (TASK-108) ────────────────────────────
export {
  SopRetriever,
  BedrockKbClient,
  createSopRetriever,
  formatCitationLocation,
  type KbRetrieveClient,
  type SopCitationResult,
  type SopRetrieveResult,
  type SopRetrieveSuccess,
  type SopRetrieveBothFailed,
} from './sop_retriever.js';

// Re-export FALLBACK_DISCLOSURE from shared-schemas for consumers
export { FALLBACK_DISCLOSURE } from '@city-commander/shared-schemas';

// ─── SOP S3 Fallback (TASK-109) ──────────────────────────
export { SopS3Fallback, type SopArticleFetchResult } from './sop_s3_fallback.js';

// ─── Report Composer (TASK-113) ──────────────────────────
export {
  composeReport,
  type ReportComposerInput,
  type ReportComposeResult,
  type ReportComposeSuccess,
  type ReportComposeFailed,
} from './report_composer.js';

// ─── Public Alert Composer (TASK-114) ────────────────────
export {
  composePublicAlert,
  resolveLanguages,
  type PublicAlertComposerInput,
  type PublicAlertComposeResult,
  type PublicAlertComposeSuccess,
  type PublicAlertComposeFailed,
} from './public_alert_composer.js';

// ─── Multilingual Templates (TASK-117) ───────────────────────────────
export {
  renderMultilingualTemplates,
  formatEteForAlert,
  formatEteForLanguage,
  type MultilingualTemplateInput,
} from './multilingual_templates.js';

// ─── Explanation Composer (TASK-115) ─────────────────────
export {
  composeExplanation,
  type ExplanationComposerInput,
  type ExplanationComposeResult,
  type ExplanationComposeSuccess,
  type ExplanationComposeFailed,
} from './explanation_composer.js';

// ─── Narrative Writer (TASK-116) ──────────────────────────
export {
  putNarrative,
  buildReadyEventId,
  type NarrativeTableClient,
  type NarrativeItem,
  type NarrativePutResult,
  type NarrativePutCommitted,
  type NarrativePutBranchAlreadyCompleted,
} from './narrative_writer.js';
