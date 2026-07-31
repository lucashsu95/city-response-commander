/**
 * Events — realtime WebSocket pushes (§13).
 *
 * @module backend/events
 */

export {
  publishFastPathReady,
  buildFastPathReadyEvent,
  buildReadyEventId,
  isStaleConnectionError,
  FastPathGateNotSatisfiedError,
  FAST_PATH_READY_EVENT,
} from './publish_fast_path_ready.js';

export type {
  FastPathReadyEvent,
  FastPathReadySummary,
  FastPathReadyPublishResult,
  ConnectionDeliveryResult,
  ConnectionPublisherPort,
  CoreCommittedGate,
} from './publish_fast_path_ready.js';

export { ApiGatewayConnectionPublisher } from './api_gateway_connection_publisher.js';

export type { ApiGatewayConnectionPublisherOptions } from './api_gateway_connection_publisher.js';
