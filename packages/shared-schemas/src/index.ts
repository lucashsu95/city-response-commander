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

// ─── Boundary Snapping & Containment (spec: boundary-snapping-containment) ──
export type {
  LocationCoverageStatus,
  DataScopeStatus,
  EntityScopeResult,
  PerimeterAnchor,
  SnapResult,
  AnchorGazetteerEntry,
  BoundarySnapperConfig,
  BoundarySnapperConfigError,
} from './boundary_snapping.js';

export type {
  SopCoverageStatus,
  SopAuthority,
  UniversalPrincipleId,
  UniversalPrinciple,
  SopCoverageResult,
} from './sop_coverage.js';
export { DEFAULT_UNIVERSAL_SOP } from './sop_coverage.js';

export type {
  MappedAnchorNode,
  PerimeterControl,
  WhitelistViolation,
  ContainmentDecision,
  ContainmentDisclosure,
} from './containment_disclosure.js';
export { CONTAINMENT_PROHIBITED_KEYS, CONTAINMENT_PROHIBITED_PATHS } from './containment_disclosure.js';

export type { WhitelistPartition } from './whitelist_guard.js';
