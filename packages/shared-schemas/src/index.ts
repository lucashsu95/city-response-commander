/**
 * @city-commander/shared-schemas
 *
 * 城市交通應變 AI 指揮台 — 共用型別與列舉
 *
 * @packageDocumentation
 */

// ─── Enums ─────────────────────────────────────────────────
export {
  TrafficGrade,
  LaneStatus,
  IncidentType,
  IncidentStatus,
  IncidentSeverity,
  DecisionStatus,
  NarrativeType,
  Language,
  OfficialSourceType,
  ValidationStatus,
  SOPArticle,
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

// ─── Decision Core ─────────────────────────────────────────
export type {
  TimestampTriplet,
  SegmentClassification,
  RouteCandidate,
  ETEResult,
  SOPTrigger,
  DecisionCore,
  DecisionNarrative,
  Disclosure,
  RecommendationTemplate,
} from './decision-core.js';

// ─── API Contracts ─────────────────────────────────────────
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
export type {
  EnvironmentProfile,
  ConfigSchema,
  StrategyConfig,
} from './config.js';
