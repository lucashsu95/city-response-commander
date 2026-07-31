/**
 * Backend runtime configuration — environment variable key contracts.
 *
 * @module backend/config
 */

export {
  TABLE_ENV_KEYS,
  ALL_TABLE_ENV_VAR_NAMES,
  TABLE_NAME_DEFAULTS,
  TableEnvError,
  resolveTableName,
  requireTableName,
  resolveAllTableNames,
  WORKFLOW_EXECUTION_DEADLINE_MS_ENV,
  DEFAULT_WORKFLOW_EXECUTION_DEADLINE_MS,
  resolveExecutionDeadlineMs,
} from './env_keys.js';

export type { TableEnvKeyName, TableEnvVarName, EnvLike } from './env_keys.js';
