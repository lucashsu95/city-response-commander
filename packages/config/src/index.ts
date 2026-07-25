/**
 * @city-commander/config — 設定管理 (ConfigProvider)
 *
 * Single entry point for configuration access across all environment profiles:
 * - LOCAL_MOCK: LocalFileConfigProvider (YAML + env overrides, zero AWS calls)
 * - PERSONAL_AWS_DEV / COMPETITION_AWS: SsmConfigProvider (SSM Parameter Store)
 *
 * Use `createConfigProvider()` to get the correct provider for the active profile.
 */

export { ConfigProvider, ConfigKeyMissingError, ConfigLoadError } from './config_provider.js';

export {
  LocalFileConfigProvider,
  LocalFileConfigProviderOptions,
} from './local_file_config_provider.js';

export { SsmConfigProvider, SsmConfigProviderOptions } from './ssm_config_provider.js';

export {
  createConfigProvider,
  ProviderFactoryOptions,
  EnvironmentProfile,
} from './provider_factory.js';

export {
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
} from './config_schema.js';

export type {
  ConfigKeyDefinition,
  ConfigValueType,
  ConfigValidationError,
  ConfigValidationResult,
  TimeAlignmentMode,
  AffectedRoadRole,
  EteAffectedSet,
  IncidentAnchorMode,
  AffectedIntersectionScopeMode,
  MultilingualScopeMode,
  OrchestrationMode,
  EnrichmentFanoutMode,
  FrontendHostingMode,
  ConfigProviderType,
} from './config_schema.js';
