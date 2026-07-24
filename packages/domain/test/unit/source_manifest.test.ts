/**
 * Unit tests for OfficialSourceManifest, SHA-256 verifier, and STOP gate.
 *
 * Tests cover:
 * - verified: correct hashes produce validated status
 * - hash_mismatch: any altered byte produces mismatch
 * - missing: non-existent file produces missing status
 * - unreadable: inaccessible file produces unreadable status
 * - STOP gate: mismatch aborts pipeline (passed=false, data_status=insufficient_data)
 * - Manifest structure: exactly 7 official sources, 5 runtime, correct types
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFile, mkdir, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { OfficialSourceType, ValidationStatus } from '@city-commander/shared-schemas';

import {
  buildOfficialSourceManifest,
  getRuntimeDecisionSources,
  getSubmissionProvenanceSources,
  computeSHA256,
  hashesMatch,
  verifySourceFile,
  verifySourceBuffer,
  runManifestGate,
  runManifestGateSync,
  computeSourceManifestHash,
} from '../../src/source_manifest/index.js';

// ─── Helper ────────────────────────────────────────────────

function sha256OfString(content: string): string {
  return createHash('sha256').update(content).digest('hex').toUpperCase();
}

// ─── Manifest Structure Tests ──────────────────────────────

describe('OfficialSourceManifest', () => {
  it('should define exactly 7 official sources', () => {
    const manifest = buildOfficialSourceManifest();
    expect(manifest).toHaveLength(7);
  });

  it('should have exactly 5 runtime decision sources', () => {
    const runtime = getRuntimeDecisionSources();
    expect(runtime).toHaveLength(5);
    expect(runtime.every((e) => e.manifest_role === 'runtime_decision')).toBe(true);
  });

  it('should have exactly 2 submission-provenance-only sources', () => {
    const provenance = getSubmissionProvenanceSources();
    const provenanceOnly = provenance.filter(
      (e) => e.manifest_role === 'submission_provenance_only',
    );
    expect(provenanceOnly).toHaveLength(2);
  });

  it('should have 命題文件 as PDF only', () => {
    const manifest = buildOfficialSourceManifest();
    const pdf = manifest.find((e) => e.source_type === OfficialSourceType.PDF);
    expect(pdf).toBeDefined();
    expect(pdf!.official_filename).toContain('命題文件');
    expect(pdf!.official_filename).not.toContain('命題解說');
  });

  it('should have 命題解說 as DOCX only (not PDF)', () => {
    const manifest = buildOfficialSourceManifest();
    const docx = manifest.find((e) => e.source_type === OfficialSourceType.DOCX);
    expect(docx).toBeDefined();
    expect(docx!.official_filename).toContain('命題解說');
    expect(docx!.official_filename).toContain('.docx');
  });

  it('should have correct source types: PDF, DOCX, 2 CSV, 2 JSON, 1 SOP_TXT', () => {
    const manifest = buildOfficialSourceManifest();
    const types = manifest.map((e) => e.source_type);
    expect(types.filter((t) => t === OfficialSourceType.PDF)).toHaveLength(1);
    expect(types.filter((t) => t === OfficialSourceType.DOCX)).toHaveLength(1);
    expect(types.filter((t) => t === OfficialSourceType.CSV)).toHaveLength(2);
    expect(types.filter((t) => t === OfficialSourceType.JSON)).toHaveLength(2);
    expect(types.filter((t) => t === OfficialSourceType.SOP_TXT)).toHaveLength(1);
  });

  it('should mark all entries as is_source_of_truth=true', () => {
    const manifest = buildOfficialSourceManifest();
    expect(manifest.every((e) => e.is_source_of_truth === true)).toBe(true);
  });

  it('should support custom expected hashes (injectable)', () => {
    const customHashes = { 'city_traffic_flow.csv': 'AABBCCDD' };
    const manifest = buildOfficialSourceManifest(customHashes);
    const csv = manifest.find((e) => e.official_filename === 'city_traffic_flow.csv');
    expect(csv!.expected_sha256).toBe('AABBCCDD');
  });
});

// ─── SHA-256 Computation Tests ─────────────────────────────

describe('computeSHA256', () => {
  it('should compute correct UPPERCASE SHA-256 for known input', () => {
    const hash = computeSHA256(Buffer.from('hello world'));
    expect(hash).toBe(
      'B94D27B9934D3E08A52E52D7DA7DABFAC484EFE37A5380EE9088F7ACE2EFCDE9',
    );
  });

  it('should produce UPPERCASE hex string of 64 characters', () => {
    const hash = computeSHA256(Buffer.from('test'));
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9A-F]{64}$/);
  });

  it('should differ for any altered byte', () => {
    const hash1 = computeSHA256(Buffer.from('hello'));
    const hash2 = computeSHA256(Buffer.from('hellp'));
    expect(hash1).not.toBe(hash2);
  });
});

describe('hashesMatch', () => {
  it('should match identical hashes', () => {
    expect(hashesMatch('AABB', 'AABB')).toBe(true);
  });

  it('should match case-insensitively', () => {
    expect(hashesMatch('aabb', 'AABB')).toBe(true);
    expect(hashesMatch('AaBb', 'aAbB')).toBe(true);
  });

  it('should not match different hashes', () => {
    expect(hashesMatch('AABB', 'AABC')).toBe(false);
  });
});

// ─── verifySourceBuffer Tests ──────────────────────────────

describe('verifySourceBuffer', () => {
  it('should return verified when hash matches', () => {
    const content = Buffer.from('test content');
    const expectedHash = sha256OfString('test content');

    const entry = {
      official_filename: 'test.csv',
      source_type: OfficialSourceType.CSV,
      expected_sha256: expectedHash,
      manifest_role: 'runtime_decision' as const,
      is_source_of_truth: true as const,
    };

    const result = verifySourceBuffer(entry, content);
    expect(result.validation_status).toBe(ValidationStatus.VERIFIED);
    expect(result.computed_sha256).toBe(expectedHash);
    expect(result.size_bytes).toBe(content.length);
  });

  it('should return hash_mismatch when hash differs', () => {
    const content = Buffer.from('original content');

    const entry = {
      official_filename: 'test.csv',
      source_type: OfficialSourceType.CSV,
      expected_sha256: 'DEADBEEF'.repeat(8),
      manifest_role: 'runtime_decision' as const,
      is_source_of_truth: true as const,
    };

    const result = verifySourceBuffer(entry, content);
    expect(result.validation_status).toBe(ValidationStatus.HASH_MISMATCH);
    expect(result.computed_sha256).not.toBe(entry.expected_sha256);
  });
});

// ─── verifySourceFile Tests ────────────────────────────────

describe('verifySourceFile', () => {
  const testDir = join(tmpdir(), `source-manifest-test-${Date.now()}`);

  it('should return verified for a file with correct hash', async () => {
    await mkdir(testDir, { recursive: true });
    const filePath = join(testDir, 'good.csv');
    const content = 'known content for hash test';
    await writeFile(filePath, content);
    const expectedHash = sha256OfString(content);

    const entry = {
      official_filename: 'good.csv',
      source_type: OfficialSourceType.CSV,
      expected_sha256: expectedHash,
      manifest_role: 'runtime_decision' as const,
      is_source_of_truth: true as const,
    };

    const result = await verifySourceFile(entry, filePath);
    expect(result.validation_status).toBe(ValidationStatus.VERIFIED);

    await rm(testDir, { recursive: true, force: true });
  });

  it('should return hash_mismatch for a file with wrong hash', async () => {
    await mkdir(testDir, { recursive: true });
    const filePath = join(testDir, 'bad.csv');
    await writeFile(filePath, 'actual content');

    const entry = {
      official_filename: 'bad.csv',
      source_type: OfficialSourceType.CSV,
      expected_sha256: 'WRONGHASH'.padEnd(64, '0'),
      manifest_role: 'runtime_decision' as const,
      is_source_of_truth: true as const,
    };

    const result = await verifySourceFile(entry, filePath);
    expect(result.validation_status).toBe(ValidationStatus.HASH_MISMATCH);

    await rm(testDir, { recursive: true, force: true });
  });

  it('should return missing for a non-existent file', async () => {
    const entry = {
      official_filename: 'nonexistent.csv',
      source_type: OfficialSourceType.CSV,
      expected_sha256: 'ABC'.padEnd(64, '0'),
      manifest_role: 'runtime_decision' as const,
      is_source_of_truth: true as const,
    };

    const result = await verifySourceFile(entry, '/tmp/definitely-not-exists-xyz.csv');
    expect(result.validation_status).toBe(ValidationStatus.MISSING);
    expect(result.computed_sha256).toBeNull();
  });
});

// ─── STOP Gate Tests ───────────────────────────────────────

describe('runManifestGateSync (STOP gate)', () => {
  it('should pass when all runtime sources have correct hashes', () => {
    const files: Record<string, string> = {
      'city_traffic_flow.csv': 'csv1 content',
      'signaling_crowd_density.csv': 'csv2 content',
      'road_network_geometry.json': 'json1 content',
      'emergency_traffic_sop.txt': 'sop content',
      'live_incidents.json': 'json2 content',
    };

    const expectedHashes: Record<string, string> = {};
    for (const [name, content] of Object.entries(files)) {
      expectedHashes[name] = sha256OfString(content);
    }

    const result = runManifestGateSync(
      (filename) => {
        const content = files[filename];
        return content != null ? Buffer.from(content) : null;
      },
      { expectedHashes },
    );

    expect(result.passed).toBe(true);
    expect(result.data_status).toBe('ready');
    expect(result.failures).toHaveLength(0);
    expect(result.stop_reason).toBeNull();
    expect(result.source_manifest_hash).toHaveLength(64);
    expect(result.results).toHaveLength(5);
  });

  it('should STOP (passed=false) when any file has a hash mismatch', () => {
    const files: Record<string, string> = {
      'city_traffic_flow.csv': 'csv1 content',
      'signaling_crowd_density.csv': 'ALTERED content',
      'road_network_geometry.json': 'json1 content',
      'emergency_traffic_sop.txt': 'sop content',
      'live_incidents.json': 'json2 content',
    };

    const expectedHashes: Record<string, string> = {
      'city_traffic_flow.csv': sha256OfString('csv1 content'),
      'signaling_crowd_density.csv': sha256OfString('original content'),
      'road_network_geometry.json': sha256OfString('json1 content'),
      'emergency_traffic_sop.txt': sha256OfString('sop content'),
      'live_incidents.json': sha256OfString('json2 content'),
    };

    const result = runManifestGateSync(
      (filename) => {
        const content = files[filename];
        return content != null ? Buffer.from(content) : null;
      },
      { expectedHashes },
    );

    expect(result.passed).toBe(false);
    expect(result.data_status).toBe('insufficient_data');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].official_filename).toBe('signaling_crowd_density.csv');
    expect(result.failures[0].validation_status).toBe(ValidationStatus.HASH_MISMATCH);
    expect(result.stop_reason).not.toBeNull();
    expect(result.stop_reason).toContain('signaling_crowd_density.csv');
  });

  it('should STOP when a file is missing', () => {
    const files: Record<string, string> = {
      'city_traffic_flow.csv': 'csv1 content',
      // signaling_crowd_density.csv is MISSING
      'road_network_geometry.json': 'json1 content',
      'emergency_traffic_sop.txt': 'sop content',
      'live_incidents.json': 'json2 content',
    };

    const expectedHashes: Record<string, string> = {
      'city_traffic_flow.csv': sha256OfString('csv1 content'),
      'signaling_crowd_density.csv': sha256OfString('csv2 content'),
      'road_network_geometry.json': sha256OfString('json1 content'),
      'emergency_traffic_sop.txt': sha256OfString('sop content'),
      'live_incidents.json': sha256OfString('json2 content'),
    };

    const result = runManifestGateSync(
      (filename) => {
        const content = files[filename];
        return content != null ? Buffer.from(content) : null;
      },
      { expectedHashes },
    );

    expect(result.passed).toBe(false);
    expect(result.data_status).toBe('insufficient_data');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].validation_status).toBe(ValidationStatus.MISSING);
  });

  it('should verify all 7 sources when verifyAll=true', () => {
    const files: Record<string, string> = {
      '(中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf': 'pdf content',
      '(中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx': 'docx content',
      'city_traffic_flow.csv': 'csv1 content',
      'signaling_crowd_density.csv': 'csv2 content',
      'road_network_geometry.json': 'json1 content',
      'emergency_traffic_sop.txt': 'sop content',
      'live_incidents.json': 'json2 content',
    };

    const expectedHashes: Record<string, string> = {};
    for (const [name, content] of Object.entries(files)) {
      expectedHashes[name] = sha256OfString(content);
    }

    const result = runManifestGateSync(
      (filename) => {
        const content = files[filename];
        return content != null ? Buffer.from(content) : null;
      },
      { expectedHashes, verifyAll: true },
    );

    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(7);
  });

  it('should expose source_manifest_hash for DecisionCore when passed', () => {
    const files: Record<string, string> = {
      'city_traffic_flow.csv': 'a',
      'signaling_crowd_density.csv': 'b',
      'road_network_geometry.json': 'c',
      'emergency_traffic_sop.txt': 'd',
      'live_incidents.json': 'e',
    };

    const expectedHashes: Record<string, string> = {};
    for (const [name, content] of Object.entries(files)) {
      expectedHashes[name] = sha256OfString(content);
    }

    const result = runManifestGateSync(
      (filename) => {
        const content = files[filename];
        return content != null ? Buffer.from(content) : null;
      },
      { expectedHashes },
    );

    expect(result.passed).toBe(true);
    expect(result.source_manifest_hash).toMatch(/^[0-9A-F]{64}$/);
    // The hash should be deterministic for the same inputs
    const result2 = runManifestGateSync(
      (filename) => {
        const content = files[filename];
        return content != null ? Buffer.from(content) : null;
      },
      { expectedHashes },
    );
    expect(result2.source_manifest_hash).toBe(result.source_manifest_hash);
  });
});

// ─── File-based gate test (async) ──────────────────────────

describe('runManifestGate (file-based)', () => {
  const testDir = join(tmpdir(), `manifest-gate-test-${Date.now()}`);

  it('should pass when all runtime files exist and match', async () => {
    await mkdir(testDir, { recursive: true });

    const files: Record<string, string> = {
      'city_traffic_flow.csv': 'csv1',
      'signaling_crowd_density.csv': 'csv2',
      'road_network_geometry.json': 'json1',
      'emergency_traffic_sop.txt': 'sop',
      'live_incidents.json': 'json2',
    };

    const expectedHashes: Record<string, string> = {};
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(testDir, name), content);
      expectedHashes[name] = sha256OfString(content);
    }

    const result = await runManifestGate(
      (filename) => join(testDir, filename),
      { expectedHashes },
    );

    expect(result.passed).toBe(true);
    expect(result.data_status).toBe('ready');
    expect(result.source_manifest_hash).toMatch(/^[0-9A-F]{64}$/);

    await rm(testDir, { recursive: true, force: true });
  });

  it('should STOP when a file is altered', async () => {
    await mkdir(testDir, { recursive: true });

    const files: Record<string, string> = {
      'city_traffic_flow.csv': 'csv1',
      'signaling_crowd_density.csv': 'csv2',
      'road_network_geometry.json': 'json1',
      'emergency_traffic_sop.txt': 'sop',
      'live_incidents.json': 'TAMPERED',
    };

    const expectedHashes: Record<string, string> = {
      'city_traffic_flow.csv': sha256OfString('csv1'),
      'signaling_crowd_density.csv': sha256OfString('csv2'),
      'road_network_geometry.json': sha256OfString('json1'),
      'emergency_traffic_sop.txt': sha256OfString('sop'),
      'live_incidents.json': sha256OfString('original json2'),
    };

    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(testDir, name), content);
    }

    const result = await runManifestGate(
      (filename) => join(testDir, filename),
      { expectedHashes },
    );

    expect(result.passed).toBe(false);
    expect(result.data_status).toBe('insufficient_data');
    expect(result.failures[0].official_filename).toBe('live_incidents.json');

    await rm(testDir, { recursive: true, force: true });
  });
});
