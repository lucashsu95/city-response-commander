/**
 * DataIngestionService — Orchestrates all 5 parsers with the manifest STOP gate
 *
 * Composes the five parsers (traffic, crowd, road network, incidents, SOP) with
 * the RuntimeDecisionSourceManifest STOP gate into one read-only ingestion entry point.
 *
 * Flow:
 * 1. Verify the 5 runtime sources via the manifest gate before parsing; STOP on mismatch.
 * 2. Load all 5 files, normalize timestamps, and expose an immutable in-memory model.
 * 3. Surface `data_status` and `source_manifest_hash`.
 *
 * On verified sources, all datasets load. On mismatch, ingestion STOPs with `insufficient_data`.
 * Any source unverified/unreadable → abort (§21).
 *
 * @module domain/ingestion/data_ingestion_service
 */

import type { RawTrafficRecord, RawCrowdRecord, Incident } from '@city-commander/shared-schemas';

import { runManifestGateSync } from '../source_manifest/manifest_gate.js';
import type { BufferProvider, ManifestGateResult } from '../source_manifest/manifest_gate.js';
import { parseTrafficCsv } from './traffic_parser.js';
import { parseCrowdCsv } from './crowd_parser.js';
import { parseRoadNetworkJson } from './road_network_parser.js';
import { parseIncidentsJson } from './incident_parser.js';
import { parseSOPText } from './sop_loader.js';
import type { SOPLoadResult } from './sop_loader.js';
import { normalizeTimestamp } from './timestamp_normalizer.js';
import type { NormalizedTimestamp } from './timestamp_normalizer.js';
import { RoadNetworkModel } from '../road_network/road_network_model.js';

// ─── Types ─────────────────────────────────────────────────

/** Data status for the ingestion result */
export type IngestionDataStatus = 'ready' | 'insufficient_data';

/** Immutable result of data ingestion */
export interface IngestionResult {
  /** Whether the data is ready or insufficient */
  readonly data_status: IngestionDataStatus;
  /** Combined source manifest hash (empty string on failure) */
  readonly source_manifest_hash: string;
  /** Human-readable reason for stopping (null if data is ready) */
  readonly stop_reason: string | null;
  /** Parsed traffic records (only present when data_status='ready') */
  readonly traffic?: readonly RawTrafficRecord[];
  /** Normalized timestamps for traffic records */
  readonly trafficTimestamps?: readonly NormalizedTimestamp[];
  /** Parsed crowd records (only present when data_status='ready') */
  readonly crowd?: readonly RawCrowdRecord[];
  /** Normalized timestamps for crowd records */
  readonly crowdTimestamps?: readonly NormalizedTimestamp[];
  /** Road network model (only present when data_status='ready') */
  readonly roadNetwork?: RoadNetworkModel;
  /** SOP articles (only present when data_status='ready') */
  readonly sopArticles?: SOPLoadResult;
  /** Parsed incidents (only present when data_status='ready') */
  readonly incidents?: readonly Incident[];
}

/** Provider interface for data source buffers */
export interface DataSourceProvider {
  /**
   * Get file content as Buffer by official filename.
   * Returns null if the file is unavailable.
   */
  getBuffer(officialFilename: string): Buffer | null;
}

/** Options for running the data ingestion service */
export interface IngestionOptions {
  /** Override expected hashes (from config) */
  expectedHashes?: Record<string, string>;
}

// ─── File Name Constants ───────────────────────────────────

/** Official filenames for the 5 runtime decision sources */
export const RUNTIME_SOURCE_FILES = {
  TRAFFIC: 'city_traffic_flow.csv',
  CROWD: 'signaling_crowd_density.csv',
  ROAD_NETWORK: 'road_network_geometry.json',
  SOP: 'emergency_traffic_sop.txt',
  INCIDENTS: 'live_incidents.json',
} as const;

// ─── DataIngestionService ──────────────────────────────────

/**
 * Run the full data ingestion pipeline:
 * 1. Verify all 5 runtime sources via manifest gate
 * 2. Parse all sources, normalize timestamps, build road network model
 * 3. Return an immutable IngestionResult
 *
 * @param provider - Abstraction over filesystem/S3 providing file content as Buffer
 * @param options - Optional ingestion configuration
 * @returns Immutable IngestionResult with all parsed datasets or insufficient_data
 */
export function ingestData(
  provider: DataSourceProvider,
  options?: IngestionOptions,
): IngestionResult {
  // Step 1: Verify the 5 runtime sources via manifest gate
  const bufferProvider: BufferProvider = (filename) => provider.getBuffer(filename);

  const gateResult: ManifestGateResult = runManifestGateSync(bufferProvider, {
    expectedHashes: options?.expectedHashes,
  });

  // If gate fails: return error result with data_status='insufficient_data' and stop
  if (!gateResult.passed) {
    return Object.freeze({
      data_status: 'insufficient_data' as const,
      source_manifest_hash: '',
      stop_reason: gateResult.stop_reason,
    });
  }

  // Step 2: Parse all 5 files
  // Get buffers (guaranteed non-null since gate passed)
  const trafficBuffer = provider.getBuffer(RUNTIME_SOURCE_FILES.TRAFFIC)!;
  const crowdBuffer = provider.getBuffer(RUNTIME_SOURCE_FILES.CROWD)!;
  const roadNetworkBuffer = provider.getBuffer(RUNTIME_SOURCE_FILES.ROAD_NETWORK)!;
  const sopBuffer = provider.getBuffer(RUNTIME_SOURCE_FILES.SOP)!;
  const incidentsBuffer = provider.getBuffer(RUNTIME_SOURCE_FILES.INCIDENTS)!;

  try {
    // Parse traffic CSV
    const traffic = parseTrafficCsv(trafficBuffer.toString('utf-8'));

    // Normalize traffic timestamps
    const trafficTimestamps = Object.freeze(
      traffic.map((record) => normalizeTimestamp(record.timestamp_raw)),
    );

    // Parse crowd CSV
    const crowd = parseCrowdCsv(crowdBuffer.toString('utf-8'));

    // Normalize crowd timestamps
    const crowdTimestamps = Object.freeze(
      crowd.map((record) => normalizeTimestamp(record.timestamp_raw)),
    );

    // Parse road network and build model
    const roadSegments = parseRoadNetworkJson(roadNetworkBuffer.toString('utf-8'));
    const roadNetwork = RoadNetworkModel.load(roadSegments);

    // Parse SOP text
    const sopArticles = parseSOPText(sopBuffer.toString('utf-8'));

    // Parse incidents
    const incidents = parseIncidentsJson(incidentsBuffer.toString('utf-8'));

    // Step 3: Return immutable result with data_status and source_manifest_hash
    return Object.freeze({
      data_status: 'ready' as const,
      source_manifest_hash: gateResult.source_manifest_hash,
      stop_reason: null,
      traffic,
      trafficTimestamps,
      crowd,
      crowdTimestamps,
      roadNetwork,
      sopArticles,
      incidents,
    });
  } catch (error) {
    // Any parse error → abort with insufficient_data (§21)
    const message = error instanceof Error ? error.message : String(error);
    return Object.freeze({
      data_status: 'insufficient_data' as const,
      source_manifest_hash: '',
      stop_reason: `Data parsing failed: ${message}`,
    });
  }
}
