/**
 * @city-commander/shared-schemas
 *
 * 城市交通應變 AI 指揮台 — 共用型別與列舉
 *
 * Canonical types shared across domain, backend, and frontend.
 * Contracts (§10, §12, §13) defined once.
 *
 * @packageDocumentation
 */

// ─── Schema Version ────────────────────────────────────────
export { SCHEMA_VERSION } from './enums.js';

// ─── Enums ─────────────────────────────────────────────────
export {
  TrafficGrade,
  LaneStatus,
  IncidentType,
  IncidentStatus,
  Severity,
  IncidentSeverity,
  NarrativeType,
  IdempotencyStatus,
  RecoveryStage,
  RecoveryMode,
  EvidenceSource,
  CoreWriteStatus,
  StatusActionResult,
  CongestionLevel,
  PublishStatus,
  DecisionStatus,
  Language,
  OfficialSourceType,
  ValidationStatus,
  SOPArticle,
  RouteCandidateRole,
  UpstreamDownstream,
  ROAD_SEGMENT_PREFIX,
  BASE_STATION_PREFIX,
} from './enums.js';

// ─── Raw Data ──────────────────────────────────────────────
export type {
  RawTrafficRecord,
  RawCrowdRecord,
  RoadSegment,
  Incident,
  SOPArticleChunk,
} from './raw-data.js';

// ─── Decision Core (§10.11a) ───────────────────────────────
export type {
  DecisionCore,
  SegmentClassification,
  Art1Measures,
  IncidentAnchor,
  AffectedIntersectionScope,
} from './decision_core.js';

// ─── LLM Boundary (§9) ──────────────────────────────────────
export { LLM_PROHIBITED_FIELDS } from './llm_boundary.js';

// ─── Unified Adaptive Reasoning Engine (UARE) ───────────────
export type {
  UniversalPrincipleId,
  UniversalPrinciple,
  GroundingCandidate,
  SopMatchResult,
} from './universal_defense.js';

// ─── Grey-Zone Arbitration Engine (GZAE) ────────────────────
export type { SignalConflict, CascadingRisk, CrowdPreWarning } from './grey_zone.js';

// ─── Decision Narrative (§10.11b) ──────────────────────────
export type {
  DecisionNarrative,
  ReportPayload,
  PublicAlertPayload,
  ExplanationPayload,
} from './decision_narrative.js';

// ─── Publish Record (§10.11d) ──────────────────────────────
export type { PublishRecord, AuditTrailEntry } from './publish_record.js';

// ─── Idempotency Table (§10.11e) ───────────────────────────
export type { IdempotencyRecord } from './idempotency.js';

// ─── Route Candidate (§10.8) ───────────────────────────────
export type { RouteCandidate } from './route_candidate.js';

// ─── HG-001 Shared Literal Types ───────────────────────────
export type { SelectionMode, GuidanceId } from './hg001_literals.js';

// ─── Selected Snapshot (§10.5, Strategy A) ─────────────────
export type { SelectedSnapshot } from './selected_snapshot.js';
export { createSelectedSnapshot } from './selected_snapshot.js';

// ─── Affected Road Context (§11.2, Strategy B) ─────────────
export type { AffectedRoadContext } from './affected_road_context.js';
export { displayAndContextOnlyAffectedRoadContext } from './affected_road_context.js';

// ─── ETE Result (§10.9) ────────────────────────────────────
export type {
  ETEResult,
  EteSnapshotRoadReading,
  CommonExactEteSnapshot,
  InsufficientCommonEteSnapshot,
  EteSnapshotProvenance,
} from './ete.js';

// ─── Evidence Trace (§10.10) ───────────────────────────────
export type {
  EvidenceTrace,
  SopCitation,
  DataPoint,
  ClassificationReasoning,
  ExcludedRouteReason,
} from './evidence.js';

// ─── Policy Metadata (§10.6) ───────────────────────────────
export type { PolicyMetadata } from './policy_metadata.js';

// ─── API Contracts (§12) ───────────────────────────────────
export type {
  ApiDataStatus,
  ObservationStalenessState,
  ObservationMetadata,
  ResponseProvenance,
  StationScopeMode,
  StationScopePolicy,
  CrowdFlag,
  RoadPanelSegment,
  CrowdPanelStation,
  DecisionExecutionStatus,
  DecisionReadModel,
  InjectIncidentRequest,
  InjectIncidentResponse,
  GetDecisionResponse,
  GetRoadsResponse,
  GetCrowdResponse,
  WhatIfRequest,
  WhatIfResponse,
  MultilingualAlert,
} from './api-contracts.js';

// ─── Config ────────────────────────────────────────────────
export type { EnvironmentProfile, ConfigSchema, StrategyConfig } from './config.js';

// ─── Citation Formatting (§14.1, §21) ──────────────────────
export {
  formatCitationLocation,
  FALLBACK_DISCLOSURE,
  ensureFallbackDisclosure,
  type CitationLocationInput,
} from './citation_formatting.js';

// ─── Discriminated union for API/event payloads (§12/§13) ──
export type {
  WebSocketEvent,
  TimelineUpdatedEvent,
  AnomalyDetectedEvent,
  DecisionFastPathReadyEvent,
  DecisionEnrichedEvent,
  PublicAlertReadyEvent,
  ReportReadyEvent,
  PublishStatusChangedEvent,
  ProcessingFailedEvent,
} from './events.js';
