/**
 * Configuration Schema Definition
 *
 * Enumerates ALL configurable keys (endpoints, model IDs, buckets, feature flags,
 * and all `policy.*` Strategy/OQ knobs) so provisional policies stay switchable
 * without touching the Rule Engine (design doc §30).
 *
 * This is the central registry keeping OQ-001..005/010 (Strategies A-F) and
 * OQ-006/007/008/009/011 configurable. No default is presented as official.
 *
 * @module config/config_schema
 */

// ─── Strategy Mode Enums (§11 Strategies A-F) ───────────────────────────────

/**
 * Strategy A: Time alignment modes (OQ-001)
 * At least 2 allowed values per requirement.
 */
export const TimeAlignmentModes = [
  'exact_or_latest_prior_per_entity',
  'last_known_value_with_visible_staleness',
] as const;
export type TimeAlignmentMode = (typeof TimeAlignmentModes)[number];

/**
 * Strategy B: Affected road role (OQ-002)
 */
export const AffectedRoadRoles = [
  'display_only',
  'context_and_ete',
  'parallel_road_impact_explicit_host',
] as const;
export type AffectedRoadRole = (typeof AffectedRoadRoles)[number];

/**
 * Strategy C: ETE affected set (OQ-003)
 */
export const EteAffectedSets = [
  'incident_primary_and_selected_secondary',
  'directly_affected_roads_at_event_snapshot',
  'incident_plus_alternatives',
  'all_classified_roads',
] as const;
export type EteAffectedSet = (typeof EteAffectedSets)[number];

/**
 * Strategy C: ETE snapshot mode — how the common exact timestamp
 * for ETE Saturation_Score inputs is selected (§11.3 Common Exact
 * Timestamp Requirement). PROVISIONAL / configurable; HG-001 active
 * value is COMMON_EXACT_TIMESTAMP but this remains a switchable
 * policy knob, never the sole official rule.
 */
export const EteSnapshotModes = [
  'COMMON_EXACT_TIMESTAMP',
  'PER_ROAD_LATEST_PRIOR',
] as const;
export type EteSnapshotMode = (typeof EteSnapshotModes)[number];

/**
 * Strategy D: Incident anchor mode (OQ-004)
 */
export const IncidentAnchorModes = [
  'incident_anchor_from_location_text',
  'explicit_host_mapping',
] as const;
export type IncidentAnchorMode = (typeof IncidentAnchorModes)[number];

/**
 * Strategy E: Affected intersection scope (OQ-010)
 */
export const AffectedIntersectionScopeModes = [
  'unresolved_manual_confirmation',
  'all_segment_intersections',
  'explicit_host_set',
] as const;
export type AffectedIntersectionScopeMode = (typeof AffectedIntersectionScopeModes)[number];

/**
 * Strategy F: Multilingual scope (OQ-005)
 */
export const MultilingualScopeModes = [
  'current_snapshot_all_available_stations',
  'incident_area_nearby_stations',
  'explicit_host_policy',
] as const;
export type MultilingualScopeMode = (typeof MultilingualScopeModes)[number];

// ─── Infra Enums ─────────────────────────────────────────────────────────────

export const OrchestrationModes = ['stepfunctions', 'lambda_direct'] as const;
export type OrchestrationMode = (typeof OrchestrationModes)[number];

export const EnrichmentFanoutModes = ['stepfunctions', 'eventbridge'] as const;
export type EnrichmentFanoutMode = (typeof EnrichmentFanoutModes)[number];

export const FrontendHostingModes = ['amplify', 's3_cloudfront'] as const;
export type FrontendHostingMode = (typeof FrontendHostingModes)[number];

export const ConfigProviderTypes = ['local_file', 'ssm'] as const;
export type ConfigProviderType = (typeof ConfigProviderTypes)[number];

export const EnvironmentProfiles = ['LOCAL_MOCK', 'PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as const;
export type EnvironmentProfile = (typeof EnvironmentProfiles)[number];

// ─── Schema Key Definition ───────────────────────────────────────────────────

export type ConfigValueType = 'string' | 'number' | 'boolean' | 'string[]';

export interface ConfigKeyDefinition {
  /** Dot-notation key name */
  readonly key: string;
  /** Expected value type */
  readonly type: ConfigValueType;
  /** Whether the key must be present */
  readonly required: boolean;
  /** Allowed enum values (if applicable) */
  readonly allowedValues?: readonly string[];
  /** Provisional default value (PROVISIONAL_TEAM_POLICY, never presented as official) */
  readonly provisionalDefault?: string | number | boolean | readonly string[];
  /** Description of the key's purpose */
  readonly description: string;
  /** Whether this key is a provisional policy knob */
  readonly isProvisionalPolicy: boolean;
}

// ─── Full Configuration Schema Registry (§23.1) ─────────────────────────────

/**
 * The authoritative registry of ALL configurable keys.
 * Every key in design §23.1 is present and typed.
 * Strategy A-F each has a mode key with >=2 allowed values.
 * Defaults are marked provisional.
 */
export const CONFIG_SCHEMA: readonly ConfigKeyDefinition[] = [
  // ── Environment ──
  {
    key: 'env',
    type: 'string',
    required: true,
    allowedValues: [...EnvironmentProfiles],
    provisionalDefault: 'LOCAL_MOCK',
    description: 'Active environment profile',
    isProvisionalPolicy: false,
  },

  // ── Bedrock ──
  {
    key: 'bedrock.region',
    type: 'string',
    required: true,
    provisionalDefault: 'ap-northeast-1',
    description: 'AWS region for Bedrock calls',
    isProvisionalPolicy: false,
  },
  {
    key: 'bedrock.model_id',
    type: 'string',
    required: true,
    provisionalDefault: 'anthropic.claude-3-sonnet-20240229-v1:0',
    description: 'Primary Bedrock model ID for text generation',
    isProvisionalPolicy: false,
  },
  {
    key: 'bedrock.model_id_fallbacks',
    type: 'string[]',
    required: true,
    provisionalDefault: ['anthropic.claude-3-haiku-20240307-v1:0', 'amazon.titan-text-express-v1'],
    description: 'Fallback model IDs when primary is unavailable',
    isProvisionalPolicy: false,
  },
  {
    key: 'bedrock.embedding_model_id',
    type: 'string',
    required: true,
    provisionalDefault: 'amazon.titan-embed-text-v1',
    description: 'Embedding model ID for Knowledge Base',
    isProvisionalPolicy: false,
  },

  // ── Knowledge Base ──
  {
    key: 'kb.knowledge_base_id',
    type: 'string',
    required: true,
    provisionalDefault: 'local-mock-kb',
    description: 'Bedrock Knowledge Base ID',
    isProvisionalPolicy: false,
  },

  // ── S3 ──
  {
    key: 's3.raw_bucket',
    type: 'string',
    required: true,
    provisionalDefault: 'local-raw-data',
    description: 'S3 bucket for official raw data (read-only)',
    isProvisionalPolicy: false,
  },
  {
    key: 's3.sop_source_bucket',
    type: 'string',
    required: true,
    provisionalDefault: 'local-sop-source',
    description: 'S3 bucket for SOP KB source documents',
    isProvisionalPolicy: false,
  },
  {
    key: 's3.artifact_bucket',
    type: 'string',
    required: true,
    provisionalDefault: 'local-artifacts',
    description: 'S3 bucket for generated report artifacts',
    isProvisionalPolicy: false,
  },

  // ── API ──
  {
    key: 'api.endpoint',
    type: 'string',
    required: true,
    provisionalDefault: 'http://localhost:3000',
    description: 'HTTP API endpoint URL',
    isProvisionalPolicy: false,
  },

  // ── WebSocket ──
  {
    key: 'ws.endpoint',
    type: 'string',
    required: true,
    provisionalDefault: 'ws://localhost:3001',
    description: 'WebSocket API endpoint URL',
    isProvisionalPolicy: false,
  },

  // ── Auth ──
  {
    key: 'auth.user_pool_id',
    type: 'string',
    required: true,
    provisionalDefault: 'local-mock-pool',
    description: 'Cognito user pool ID',
    isProvisionalPolicy: false,
  },
  {
    key: 'auth.app_client_id',
    type: 'string',
    required: true,
    provisionalDefault: 'local-mock-client',
    description: 'Cognito App Client ID / API Gateway JWT audience',
    isProvisionalPolicy: false,
  },

  // ── Observability ──
  {
    key: 'observability.xray_enabled',
    type: 'boolean',
    required: true,
    provisionalDefault: false,
    description: 'Toggle X-Ray distributed tracing',
    isProvisionalPolicy: false,
  },

  // ── Orchestration ──
  {
    key: 'orchestration.mode',
    type: 'string',
    required: true,
    allowedValues: [...OrchestrationModes],
    provisionalDefault: 'lambda_direct',
    description: 'Orchestration engine (deployment-time choice)',
    isProvisionalPolicy: false,
  },

  // ── Enrichment ──
  {
    key: 'enrichment.fanout',
    type: 'string',
    required: true,
    allowedValues: [...EnrichmentFanoutModes],
    provisionalDefault: 'stepfunctions',
    description: 'Enrichment fan-out mechanism',
    isProvisionalPolicy: false,
  },

  // ── Frontend ──
  {
    key: 'frontend.hosting',
    type: 'string',
    required: true,
    allowedValues: [...FrontendHostingModes],
    provisionalDefault: 'amplify',
    description: 'Frontend hosting mode',
    isProvisionalPolicy: false,
  },

  // ── Config Provider ──
  {
    key: 'config.provider',
    type: 'string',
    required: true,
    allowedValues: [...ConfigProviderTypes],
    provisionalDefault: 'local_file',
    description: 'Configuration provider type',
    isProvisionalPolicy: false,
  },

  // ══════════════════════════════════════════════════════════════════
  // Policy knobs — PROVISIONAL_TEAM_POLICY / AWAITING_HOST_REPLY
  // Each Strategy A-F has a mode key with >=2 allowed values.
  // Defaults are PROVISIONAL and overridable.
  // Switching a strategy is a config change only (§30).
  // ══════════════════════════════════════════════════════════════════

  // ── Strategy A: Time Alignment (OQ-001) ──
  {
    key: 'policy.time_alignment.mode',
    type: 'string',
    required: true,
    allowedValues: [...TimeAlignmentModes],
    provisionalDefault: 'exact_or_latest_prior_per_entity',
    description: 'Strategy A: event time alignment mode (OQ-001, PROVISIONAL)',
    isProvisionalPolicy: true,
  },
  {
    key: 'policy.time_alignment.max_staleness_minutes',
    type: 'number',
    required: true,
    provisionalDefault: 30,
    description: 'Strategy A: max allowed staleness in minutes before insufficient_data',
    isProvisionalPolicy: true,
  },

  // ── Strategy B: Affected Road Role (OQ-002) ──
  {
    key: 'policy.affected_road.role',
    type: 'string',
    required: true,
    allowedValues: [...AffectedRoadRoles],
    provisionalDefault: 'display_only',
    description: 'Strategy B: role of affected_road field in BS_ events (OQ-002, PROVISIONAL)',
    isProvisionalPolicy: true,
  },

  // ── Strategy C: ETE Affected Set (OQ-003) ──
  {
    key: 'policy.ete.affected_set',
    type: 'string',
    required: true,
    allowedValues: [...EteAffectedSets],
    provisionalDefault: 'incident_primary_and_selected_secondary',
    description:
      'Strategy C: incident plus selected primary and secondary roads for ETE (HG-001 organizer guidance)',
    isProvisionalPolicy: true,
  },
  {
    key: 'policy.ete.snapshot_mode',
    type: 'string',
    required: true,
    allowedValues: [...EteSnapshotModes],
    provisionalDefault: 'COMMON_EXACT_TIMESTAMP',
    description:
      'Strategy C: how the common exact timestamp for ETE Saturation_Score inputs is selected (§11.3, HG-001 organizer guidance, remains configurable)',
    isProvisionalPolicy: true,
  },

  // ── Strategy D: Incident Anchor Mode (OQ-004) ──
  {
    key: 'policy.incident_anchor.mode',
    type: 'string',
    required: true,
    allowedValues: [...IncidentAnchorModes],
    provisionalDefault: 'incident_anchor_from_location_text',
    description: 'Strategy D: how incident location text maps to anchor (OQ-004, PROVISIONAL)',
    isProvisionalPolicy: true,
  },

  // ── Strategy E: Affected Intersection Scope (OQ-010) ──
  {
    key: 'policy.affected_intersection_scope.mode',
    type: 'string',
    required: true,
    allowedValues: [...AffectedIntersectionScopeModes],
    provisionalDefault: 'unresolved_manual_confirmation',
    description:
      'Strategy E: which intersections count as affected for SOP5 police (OQ-010, PROVISIONAL)',
    isProvisionalPolicy: true,
  },

  // ── Strategy F: Multilingual Scope (OQ-005) ──
  {
    key: 'policy.multilingual_scope.mode',
    type: 'string',
    required: true,
    allowedValues: [...MultilingualScopeModes],
    provisionalDefault: 'current_snapshot_all_available_stations',
    description:
      'Strategy F: station set and time snapshot for SOP6 roaming check (OQ-005, PROVISIONAL)',
    isProvisionalPolicy: true,
  },
] as const;

// ─── Derived Helpers ─────────────────────────────────────────────────────────

/** All config key names (the authoritative key list for §23.1 cross-check) */
export const ALL_CONFIG_KEYS: readonly string[] = CONFIG_SCHEMA.map((def) => def.key);

/** All required config keys */
export const REQUIRED_CONFIG_KEYS: readonly string[] = CONFIG_SCHEMA.filter(
  (def) => def.required,
).map((def) => def.key);

/** All policy knob keys (provisional) */
export const POLICY_KNOB_KEYS: readonly string[] = CONFIG_SCHEMA.filter(
  (def) => def.isProvisionalPolicy,
).map((def) => def.key);

/** Strategy mode keys (must each have >=2 allowed values) */
export const STRATEGY_MODE_KEYS: readonly string[] = CONFIG_SCHEMA.filter(
  (def) => def.isProvisionalPolicy && def.allowedValues && def.allowedValues.length >= 2,
).map((def) => def.key);

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ConfigValidationError {
  readonly key: string;
  readonly error: string;
}

export interface ConfigValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ConfigValidationError[];
}

/**
 * Validate a configuration map against the schema.
 *
 * Checks:
 * 1. All required keys exist
 * 2. Values match declared type
 * 3. Enum-constrained keys have allowed values
 *
 * @param config - Flat key-value map (as returned by ConfigProvider.getAll or loaded from YAML)
 * @returns Validation result with any errors found
 */
export function validateConfig(config: Record<string, unknown>): ConfigValidationResult {
  const errors: ConfigValidationError[] = [];

  for (const def of CONFIG_SCHEMA) {
    const value = config[def.key];

    // Check required key presence
    if (value === undefined || value === null) {
      if (def.required) {
        errors.push({ key: def.key, error: 'Required key missing' });
      }
      continue;
    }

    // Check type
    switch (def.type) {
      case 'string':
        if (typeof value !== 'string') {
          errors.push({
            key: def.key,
            error: `Expected type "string", got "${typeof value}"`,
          });
          continue;
        }
        break;
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          errors.push({
            key: def.key,
            error: `Expected type "number", got "${typeof value}"`,
          });
          continue;
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push({
            key: def.key,
            error: `Expected type "boolean", got "${typeof value}"`,
          });
          continue;
        }
        break;
      case 'string[]':
        if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
          errors.push({
            key: def.key,
            error: `Expected type "string[]", got "${typeof value}"`,
          });
          continue;
        }
        break;
    }

    // Check enum bounds (for string type with allowedValues)
    if (def.allowedValues && def.type === 'string') {
      if (!def.allowedValues.includes(value as string)) {
        errors.push({
          key: def.key,
          error: `Value "${value}" not in allowed values: [${def.allowedValues.join(', ')}]`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get the schema definition for a specific key.
 */
export function getKeyDefinition(key: string): ConfigKeyDefinition | undefined {
  return CONFIG_SCHEMA.find((def) => def.key === key);
}

/**
 * Get all provisional default values as a flat config map.
 * Useful for populating a local config file with all required keys.
 */
export function getProvisionalDefaults(): Record<
  string,
  string | number | boolean | readonly string[]
> {
  const defaults: Record<string, string | number | boolean | readonly string[]> = {};
  for (const def of CONFIG_SCHEMA) {
    if (def.provisionalDefault !== undefined) {
      defaults[def.key] = def.provisionalDefault;
    }
  }
  return defaults;
}
