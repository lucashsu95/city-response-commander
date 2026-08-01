/**
 * Logging — structured CloudWatch output.
 *
 * @module backend/logging
 */

export {
  StructuredLogger,
  redactSensitive,
  consoleLogSink,
  REDACTED,
  RESERVED_LOG_KEYS,
} from './structured_logger.js';

export type {
  LogLevel,
  LogEvent,
  LogCorrelation,
  LogSink,
  StructuredLogRecord,
  StructuredLoggerOptions,
} from './structured_logger.js';
