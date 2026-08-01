/**
 * Demo Backend Ports — interfaces for the demo Lambda handler
 *
 * @module backend/demo/demo_ports
 */

import type { RawTrafficRecord, RawCrowdRecord, Incident } from '@city-commander/shared-schemas';
import type { RoadNetworkModel } from '@city-commander/domain';
import type { SOPLoadResult } from '@city-commander/domain';
import type { NormalizedTimestamp } from '@city-commander/domain';

// ─── In-memory data container ───────────────────────────────────────────────

/** In-memory dataset populated at Lambda cold-start from S3 */
export interface DemoDataSet {
  traffic: readonly RawTrafficRecord[];
  trafficTimestamps: readonly NormalizedTimestamp[];
  crowd: readonly RawCrowdRecord[];
  crowdTimestamps: readonly NormalizedTimestamp[];
  roadNetwork: RoadNetworkModel;
  sopArticles: SOPLoadResult;
  incidents: readonly Incident[];
}

// ─── Config port ────────────────────────────────────────────────────────────

/** Environment keys expected by the demo Lambda */
export interface DemoEnv {
  DEMO_DATA_BUCKET: string;
  BEDROCK_REGION: string;
  BEDROCK_MODEL_ID: string;
  DEMO_MODE: string;
}

// ─── S3 data source provider ────────────────────────────────────────────────

export interface S3DataSourceProvider {
  getBuffer(filename: string): Buffer | null;
}
