/**
 * Config Schema Tests
 *
 * Validates:
 * 1. Schema completeness — every key in §23.1 is present and typed
 * 2. Strategy A-F each has a mode key with >=2 allowed values
 * 3. Enum bounds validation — out-of-enum values are rejected
 * 4. Type validation — mistyped values are rejected
 * 5. Required key validation — missing required keys are flagged
 */

import { describe, it, expect } from 'vitest';
import {
  CONFIG_SCHEMA,
  ALL_CONFIG_KEYS,
  REQUIRED_CONFIG_KEYS,
  POLICY_KNOB_KEYS,
  STRATEGY_MODE_KEYS,
  validateConfig,
  getKeyDefinition,
  getProvisionalDefaults,
  TimeAlignmentModes,
  AffectedRoadRoles,
  EteAffectedSets,
  IncidentAnchorModes,
  AffectedIntersectionScopeModes,
  MultilingualScopeModes,
  OrchestrationModes,
  EnrichmentFanoutModes,
  FrontendHostingModes,
  ConfigProviderTypes,
  EnvironmentProfiles,
} from '../src/config_schema.js';

// ─── §23.1 Key List (authoritative cross-check) ─────────────────────────────

/**
 * All keys that must be in the schema according to design §23.1.
 * This is the ground truth for the schema-completeness test.
 */
const EXPECTED_SECTION_23_1_KEYS = [
  // Infra keys
  'env',
  'bedrock.region',
  'bedrock.model_id',
  'bedrock.model_id_fallbacks',
  'bedrock.embedding_model_id',
  'kb.knowledge_base_id',
  's3.raw_bucket',
  's3.sop_source_bucket',
  's3.artifact_bucket',
  'api.endpoint',
  'ws.endpoint',
  'auth.user_pool_id',
  'observability.xray_enabled',
  'orchestration.mode',
  'enrichment.fanout',
  'frontend.hosting',
  'config.provider',
  // Policy knobs (Strategies A-F)
  'policy.time_alignment.mode',
  'policy.time_alignment.max_staleness_minutes',
  'policy.affected_road.role',
  'policy.ete.affected_set',
  'policy.incident_anchor.mode',
  'policy.affected_intersection_scope.mode',
  'policy.multilingual_scope.mode',
];

describe('Config Schema Completeness (§23.1 cross-check)', () => {
  it('should contain every key listed in §23.1', () => {
    for (const expectedKey of EXPECTED_SECTION_23_1_KEYS) {
      expect(ALL_CONFIG_KEYS).toContain(expectedKey);
    }
  });

  it('should not have fewer keys than the §23.1 list', () => {
    expect(ALL_CONFIG_KEYS.length).toBeGreaterThanOrEqual(EXPECTED_SECTION_23_1_KEYS.length);
  });

  it('every schema key should have a type definition', () => {
    for (const def of CONFIG_SCHEMA) {
      expect(['string', 'number', 'boolean', 'string[]']).toContain(def.type);
    }
  });

  it('every schema key should have a description', () => {
    for (const def of CONFIG_SCHEMA) {
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it('every key should have a unique name', () => {
    const keys = CONFIG_SCHEMA.map((d) => d.key);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });
});

describe('Strategy A-F Mode Keys (≥2 allowed values each)', () => {
  it('should have at least 6 strategy mode keys', () => {
    expect(STRATEGY_MODE_KEYS.length).toBeGreaterThanOrEqual(6);
  });

  it('Strategy A (time_alignment.mode) has >=2 allowed values', () => {
    expect(TimeAlignmentModes.length).toBeGreaterThanOrEqual(2);
    const def = getKeyDefinition('policy.time_alignment.mode');
    expect(def).toBeDefined();
    expect(def!.allowedValues!.length).toBeGreaterThanOrEqual(2);
  });

  it('Strategy B (affected_road.role) has >=2 allowed values', () => {
    expect(AffectedRoadRoles.length).toBeGreaterThanOrEqual(2);
    const def = getKeyDefinition('policy.affected_road.role');
    expect(def).toBeDefined();
    expect(def!.allowedValues!.length).toBeGreaterThanOrEqual(2);
  });

  it('Strategy C (ete.affected_set) has >=2 allowed values', () => {
    expect(EteAffectedSets.length).toBeGreaterThanOrEqual(2);
    const def = getKeyDefinition('policy.ete.affected_set');
    expect(def).toBeDefined();
    expect(def!.allowedValues!.length).toBeGreaterThanOrEqual(2);
  });

  it('Strategy D (incident_anchor.mode) has >=2 allowed values', () => {
    expect(IncidentAnchorModes.length).toBeGreaterThanOrEqual(2);
    const def = getKeyDefinition('policy.incident_anchor.mode');
    expect(def).toBeDefined();
    expect(def!.allowedValues!.length).toBeGreaterThanOrEqual(2);
  });

  it('Strategy E (affected_intersection_scope.mode) has >=2 allowed values', () => {
    expect(AffectedIntersectionScopeModes.length).toBeGreaterThanOrEqual(2);
    const def = getKeyDefinition('policy.affected_intersection_scope.mode');
    expect(def).toBeDefined();
    expect(def!.allowedValues!.length).toBeGreaterThanOrEqual(2);
  });

  it('Strategy F (multilingual_scope.mode) has >=2 allowed values', () => {
    expect(MultilingualScopeModes.length).toBeGreaterThanOrEqual(2);
    const def = getKeyDefinition('policy.multilingual_scope.mode');
    expect(def).toBeDefined();
    expect(def!.allowedValues!.length).toBeGreaterThanOrEqual(2);
  });

  it('all strategy mode keys are marked as provisional policy', () => {
    for (const key of STRATEGY_MODE_KEYS) {
      const def = getKeyDefinition(key);
      expect(def).toBeDefined();
      expect(def!.isProvisionalPolicy).toBe(true);
    }
  });
});

describe('Provisional Defaults', () => {
  it('should provide provisional defaults for all required keys', () => {
    const defaults = getProvisionalDefaults();
    for (const key of REQUIRED_CONFIG_KEYS) {
      expect(defaults[key]).toBeDefined();
    }
  });

  it('provisional defaults should pass validation', () => {
    const defaults = getProvisionalDefaults();
    const result = validateConfig(defaults as Record<string, unknown>);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('validateConfig — Required Key Validation', () => {
  it('should reject an empty config (all required keys missing)', () => {
    const result = validateConfig({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // Every required key should be flagged
    for (const key of REQUIRED_CONFIG_KEYS) {
      expect(result.errors.some((e) => e.key === key)).toBe(true);
    }
  });

  it('should reject config with a single required key missing', () => {
    const defaults = getProvisionalDefaults() as Record<string, unknown>;
    const { 'env': _removed, ...rest } = defaults;
    const result = validateConfig(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.key === 'env')).toBe(true);
  });
});

describe('validateConfig — Type Validation', () => {
  it('should reject number where string expected', () => {
    const defaults = getProvisionalDefaults() as Record<string, unknown>;
    const config = { ...defaults, 'env': 123 };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.key === 'env' && e.error.includes('string'))).toBe(true);
  });

  it('should reject string where boolean expected', () => {
    const defaults = getProvisionalDefaults() as Record<string, unknown>;
    const config = { ...defaults, 'observability.xray_enabled': 'yes' };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.key === 'observability.xray_enabled')).toBe(true);
  });

  it('should reject string where number expected', () => {
    const defaults = getProvisionalDefaults() as Record<string, unknown>;
    const config = { ...defaults, 'policy.time_alignment.max_staleness_minutes': 'thirty' };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.key === 'policy.time_alignment.max_staleness_minutes')).toBe(true);
  });

  it('should reject non-array where string[] expected', () => {
    const defaults = getProvisionalDefaults() as Record<string, unknown>;
    const config = { ...defaults, 'bedrock.model_id_fallbacks': 'single-value' };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.key === 'bedrock.model_id_fallbacks')).toBe(true);
  });

  it('should reject NaN for number type', () => {
    const defaults = getProvisionalDefaults() as Record<string, unknown>;
    const config = { ...defaults, 'policy.time_alignment.max_staleness_minutes': NaN };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.key === 'policy.time_alignment.max_staleness_minutes')).toBe(true);
  });
});

describe('validateConfig — Enum Bounds Validation', () => {
  it('should reject out-of-enum value for env', () => {
    const defaults = getProvisionalDefaults() as Record<string, unknown>;
    const config = { ...defaults, 'env': 'PRODUCTION' };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.key === 'env' && e.error.includes('not in allowed values'))).toBe(true);
  });

  it('should reject out-of-enum value for policy.time_alignment.mode (Strategy A)', () => {
    const defaults = getProvisionalDefaults() as Record<string, unknown>;
    const config = { ...defaults, 'policy.time_alignment.mode': 'invalid_mode' };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.key === 'policy.time_alignment.mode')).toBe(true);
  });

  it('should reject out-of-enum value for policy.affected_road.role (Strategy B)', () => {
    const defaults = getProvisionalDefaults() as Record<string, unknown>;
    const config = { ...defaults, 'policy.affected_road.role': 'trigger_art2' };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.key === 'policy.affected_road.role')).toBe(true);
  });

  it('should reject out-of-enum value for policy.ete.affected_set (Strategy C)', () => {
    const defaults = getProvisionalDefaults() as Record<string, unknown>;
    const config = { ...defaults, 'policy.ete.affected_set': 'everything' };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.key === 'policy.ete.affected_set')).toBe(true);
  });

  it('should reject out-of-enum value for policy.incident_anchor.mode (Strategy D)', () => {
    const defaults = getProvisionalDefaults() as Record<string, unknown>;
    const config = { ...defaults, 'policy.incident_anchor.mode': 'guess' };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.key === 'policy.incident_anchor.mode')).toBe(true);
  });

  it('should reject out-of-enum value for policy.affected_intersection_scope.mode (Strategy E)', () => {
    const defaults = getProvisionalDefaults() as Record<string, unknown>;
    const config = { ...defaults, 'policy.affected_intersection_scope.mode': 'random_guess' };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.key === 'policy.affected_intersection_scope.mode')).toBe(true);
  });

  it('should reject out-of-enum value for policy.multilingual_scope.mode (Strategy F)', () => {
    const defaults = getProvisionalDefaults() as Record<string, unknown>;
    const config = { ...defaults, 'policy.multilingual_scope.mode': 'all_possible_stations_in_universe' };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.key === 'policy.multilingual_scope.mode')).toBe(true);
  });

  it('should reject out-of-enum value for orchestration.mode', () => {
    const defaults = getProvisionalDefaults() as Record<string, unknown>;
    const config = { ...defaults, 'orchestration.mode': 'ecs_fargate' };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.key === 'orchestration.mode')).toBe(true);
  });

  it('should accept all valid enum values for each strategy mode', () => {
    const defaults = getProvisionalDefaults() as Record<string, unknown>;

    for (const mode of TimeAlignmentModes) {
      const config = { ...defaults, 'policy.time_alignment.mode': mode };
      expect(validateConfig(config).valid).toBe(true);
    }
    for (const role of AffectedRoadRoles) {
      const config = { ...defaults, 'policy.affected_road.role': role };
      expect(validateConfig(config).valid).toBe(true);
    }
    for (const set of EteAffectedSets) {
      const config = { ...defaults, 'policy.ete.affected_set': set };
      expect(validateConfig(config).valid).toBe(true);
    }
    for (const mode of IncidentAnchorModes) {
      const config = { ...defaults, 'policy.incident_anchor.mode': mode };
      expect(validateConfig(config).valid).toBe(true);
    }
    for (const mode of AffectedIntersectionScopeModes) {
      const config = { ...defaults, 'policy.affected_intersection_scope.mode': mode };
      expect(validateConfig(config).valid).toBe(true);
    }
    for (const mode of MultilingualScopeModes) {
      const config = { ...defaults, 'policy.multilingual_scope.mode': mode };
      expect(validateConfig(config).valid).toBe(true);
    }
  });
});

describe('Infra Enum Completeness', () => {
  it('EnvironmentProfiles has exactly 3 values', () => {
    expect(EnvironmentProfiles).toHaveLength(3);
    expect(EnvironmentProfiles).toContain('LOCAL_MOCK');
    expect(EnvironmentProfiles).toContain('PERSONAL_AWS_DEV');
    expect(EnvironmentProfiles).toContain('COMPETITION_AWS');
  });

  it('OrchestrationModes has at least 2 values', () => {
    expect(OrchestrationModes.length).toBeGreaterThanOrEqual(2);
  });

  it('EnrichmentFanoutModes has at least 2 values', () => {
    expect(EnrichmentFanoutModes.length).toBeGreaterThanOrEqual(2);
  });

  it('FrontendHostingModes has at least 2 values', () => {
    expect(FrontendHostingModes.length).toBeGreaterThanOrEqual(2);
  });

  it('ConfigProviderTypes has at least 2 values', () => {
    expect(ConfigProviderTypes.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Policy Knob Keys', () => {
  it('should contain all policy.* keys', () => {
    const policyKeys = ALL_CONFIG_KEYS.filter((k) => k.startsWith('policy.'));
    expect(policyKeys.length).toBe(POLICY_KNOB_KEYS.length);
    for (const pk of policyKeys) {
      expect(POLICY_KNOB_KEYS).toContain(pk);
    }
  });

  it('all policy knob keys should be marked required', () => {
    for (const key of POLICY_KNOB_KEYS) {
      const def = getKeyDefinition(key);
      expect(def).toBeDefined();
      expect(def!.required).toBe(true);
    }
  });
});
