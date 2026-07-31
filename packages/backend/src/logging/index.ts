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
} from './structured_logger.js';

export type {
  LogLevel,
  LogEvent,
  LogCorrelation,
  LogSink,
  StructuredLogRecord,
  StructuredLoggerOptions,
} from './structured_logger.js';
