/**
 * Security — anomaly signals and security alerting.
 *
 * @module backend/security
 */

export {
  SecurityAlerting,
  SECURITY_ALERT_LEVELS,
  SECURITY_ALERT_METRICS,
} from './security_alerting.js';

export type { SecurityEvent, SecurityAlertRecord } from './security_alerting.js';
