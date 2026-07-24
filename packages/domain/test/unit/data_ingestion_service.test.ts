/**
 * Unit tests for DataIngestionService
 *
 * Tests cover:
 * - On verified sources, all datasets load successfully (data_status='ready')
 * - On hash mismatch, ingestion STOPs with 'insufficient_data'
 * - On missing source, ingestion STOPs with 'insufficient_data'
 * - On parse error, ingestion STOPs with 'insufficient_data'
 * - source_manifest_hash is surfaced when data is ready
 * - Result is immutable (frozen)
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ingestData, RUNTIME_SOURCE_FILES } from '../../src/ingestion/data_ingestion_service.js';
import type { DataSourceProvider } from '../../src/ingestion/data_ingestion_service.js';

// ─── Helpers ───────────────────────────────────────────────

/** Path to the official data directory */
const DATA_DIR = join(__dirname, '..', '..', '..', '..', '中華電信資料集');

/** Load all 5 runtime source files as buffers from the official data directory */
function loadRealBuffers(): Map<string, Buffer> {
  const buffers = new Map<string, Buffer>();
  buffers.set(
    RUNTIME_SOURCE_FILES.TRAFFIC,
    readFileSync(join(DATA_DIR, RUNTIME_SOURCE_FILES.TRAFFIC)),
  );
  buffers.set(
    RUNTIME_SOURCE_FILES.CROWD,
    readFileSync(join(DATA_DIR, RUNTIME_SOURCE_FILES.CROWD)),
  );
  buffers.set(
    RUNTIME_SOURCE_FILES.ROAD_NETWORK,
    readFileSync(join(DATA_DIR, RUNTIME_SOURCE_FILES.ROAD_NETWORK)),
  );
  buffers.set(
    RUNTIME_SOURCE_FILES.SOP,
    readFileSync(join(DATA_DIR, RUNTIME_SOURCE_FILES.SOP)),
  );
  buffers.set(
    RUNTIME_SOURCE_FILES.INCIDENTS,
    readFileSync(join(DATA_DIR, RUNTIME_SOURCE_FILES.INCIDENTS)),
  );
  return buffers;
}

/** Create a DataSourceProvider from a Map of buffers */
function createProvider(buffers: Map<string, Buffer>): DataSourceProvider {
  return {
    getBuffer(filename: string): Buffer | null {
      return buffers.get(filename) ?? null;
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────

describe('DataIngestionService', () => {
  describe('successful ingestion (verified sources)', () => {
    it('should return data_status=ready with all datasets loaded', () => {
      const buffers = loadRealBuffers();
      const provider = createProvider(buffers);
      const result = ingestData(provider);

      expect(result.data_status).toBe('ready');
      expect(result.stop_reason).toBeNull();
      expect(result.source_manifest_hash).toBeTruthy();
      expect(result.source_manifest_hash.length).toBe(64); // SHA-256 hex
    });

    it('should load traffic records', () => {
      const buffers = loadRealBuffers();
      const provider = createProvider(buffers);
      const result = ingestData(provider);

      expect(result.traffic).toBeDefined();
      expect(result.traffic!.length).toBeGreaterThan(0);
      // All 15 segments should be present (across multiple timestamps)
      const uniqueSegments = new Set(result.traffic!.map((r) => r.Segment_ID));
      expect(uniqueSegments.size).toBe(15);
    });

    it('should normalize traffic timestamps', () => {
      const buffers = loadRealBuffers();
      const provider = createProvider(buffers);
      const result = ingestData(provider);

      expect(result.trafficTimestamps).toBeDefined();
      expect(result.trafficTimestamps!.length).toBe(result.traffic!.length);
      // All displays should be in YYYY-MM-DD HH:MM format
      for (const ts of result.trafficTimestamps!) {
        expect(ts.timestamp_display).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      }
    });

    it('should load crowd records with roaming_pct_value', () => {
      const buffers = loadRealBuffers();
      const provider = createProvider(buffers);
      const result = ingestData(provider);

      expect(result.crowd).toBeDefined();
      expect(result.crowd!.length).toBeGreaterThan(0);
      // Every record should have a valid roaming_pct_value
      for (const record of result.crowd!) {
        expect(record.roaming_pct_value).toBeGreaterThanOrEqual(0);
        expect(record.roaming_pct_value).toBeLessThanOrEqual(1);
      }
    });

    it('should normalize crowd timestamps', () => {
      const buffers = loadRealBuffers();
      const provider = createProvider(buffers);
      const result = ingestData(provider);

      expect(result.crowdTimestamps).toBeDefined();
      expect(result.crowdTimestamps!.length).toBe(result.crowd!.length);
    });

    it('should build road network model', () => {
      const buffers = loadRealBuffers();
      const provider = createProvider(buffers);
      const result = ingestData(provider);

      expect(result.roadNetwork).toBeDefined();
      expect(result.roadNetwork!.size).toBeGreaterThan(0);
      // Should be able to look up a known segment
      const segment = result.roadNetwork!.getSegment('RD_TPE_002');
      expect(segment).toBeDefined();
      expect(segment!.name).toBe('光復南路');
    });

    it('should load SOP articles (exactly 7)', () => {
      const buffers = loadRealBuffers();
      const provider = createProvider(buffers);
      const result = ingestData(provider);

      expect(result.sopArticles).toBeDefined();
      expect(result.sopArticles!.articles).toHaveLength(7);
      // Lookup by article_no should work
      const art1 = result.sopArticles!.getByArticleNo(1);
      expect(art1).toBeDefined();
      expect(art1!.article_no).toBe(1);
    });

    it('should load incidents', () => {
      const buffers = loadRealBuffers();
      const provider = createProvider(buffers);
      const result = ingestData(provider);

      expect(result.incidents).toBeDefined();
      expect(result.incidents!.length).toBe(3); // 3 official events
    });
  });

  describe('manifest gate failure (STOP)', () => {
    it('should STOP with insufficient_data on hash mismatch', () => {
      const buffers = loadRealBuffers();
      // Corrupt traffic buffer to cause hash mismatch
      const corruptedTraffic = Buffer.from('corrupted data');
      buffers.set(RUNTIME_SOURCE_FILES.TRAFFIC, corruptedTraffic);

      const provider = createProvider(buffers);
      const result = ingestData(provider);

      expect(result.data_status).toBe('insufficient_data');
      expect(result.stop_reason).toBeTruthy();
      expect(result.stop_reason).toContain('verification failed');
      expect(result.source_manifest_hash).toBe('');
      // No datasets should be loaded
      expect(result.traffic).toBeUndefined();
      expect(result.crowd).toBeUndefined();
      expect(result.roadNetwork).toBeUndefined();
      expect(result.sopArticles).toBeUndefined();
      expect(result.incidents).toBeUndefined();
    });

    it('should STOP with insufficient_data on missing source', () => {
      const buffers = loadRealBuffers();
      // Remove one source to simulate missing file
      buffers.delete(RUNTIME_SOURCE_FILES.CROWD);

      const provider = createProvider(buffers);
      const result = ingestData(provider);

      expect(result.data_status).toBe('insufficient_data');
      expect(result.stop_reason).toBeTruthy();
      expect(result.source_manifest_hash).toBe('');
      expect(result.traffic).toBeUndefined();
    });

    it('should STOP when all sources are missing', () => {
      const provider: DataSourceProvider = {
        getBuffer: () => null,
      };

      const result = ingestData(provider);

      expect(result.data_status).toBe('insufficient_data');
      expect(result.stop_reason).toBeTruthy();
    });
  });

  describe('parse error handling', () => {
    it('should STOP with insufficient_data on malformed CSV (passes hash gate but fails parse)', () => {
      const buffers = loadRealBuffers();
      // Create a buffer that has the right hash but produces a parse error
      // We override ALL expectedHashes so the gate passes with the malformed traffic file
      const malformedCsv = 'WrongHeader1,WrongHeader2\nfoo,bar\n';
      const malformedBuffer = Buffer.from(malformedCsv);

      // Compute the expected hashes for all files (including the malformed one)
      const expectedHashes: Record<string, string> = {};
      for (const [filename, buffer] of buffers.entries()) {
        expectedHashes[filename] = createHash('sha256').update(buffer).digest('hex').toUpperCase();
      }
      // Override the traffic buffer with malformed content and update its expected hash
      buffers.set(RUNTIME_SOURCE_FILES.TRAFFIC, malformedBuffer);
      expectedHashes[RUNTIME_SOURCE_FILES.TRAFFIC] = createHash('sha256').update(malformedBuffer).digest('hex').toUpperCase();

      const provider = createProvider(buffers);
      const result = ingestData(provider, { expectedHashes });

      expect(result.data_status).toBe('insufficient_data');
      expect(result.stop_reason).toBeTruthy();
      expect(result.stop_reason).toContain('parsing failed');
    });
  });

  describe('result immutability', () => {
    it('should return a frozen result object', () => {
      const buffers = loadRealBuffers();
      const provider = createProvider(buffers);
      const result = ingestData(provider);

      expect(Object.isFrozen(result)).toBe(true);
    });

    it('should have frozen traffic array', () => {
      const buffers = loadRealBuffers();
      const provider = createProvider(buffers);
      const result = ingestData(provider);

      expect(result.traffic).toBeDefined();
      expect(Object.isFrozen(result.traffic)).toBe(true);
    });

    it('should have frozen crowd array', () => {
      const buffers = loadRealBuffers();
      const provider = createProvider(buffers);
      const result = ingestData(provider);

      expect(result.crowd).toBeDefined();
      expect(Object.isFrozen(result.crowd)).toBe(true);
    });

    it('should have frozen incident array', () => {
      const buffers = loadRealBuffers();
      const provider = createProvider(buffers);
      const result = ingestData(provider);

      expect(result.incidents).toBeDefined();
      expect(Object.isFrozen(result.incidents)).toBe(true);
    });
  });
});
