/**
 * Manifest STOP Gate — aborts the decision pipeline on any verification failure
 *
 * Implements the STOP gate: any validation_status != verified aborts decisioning
 * and reports. Exposes source_manifest_hash for DecisionCore (§10.0, §15, §21).
 *
 * The gate checks either:
 * - All 7 sources (SubmissionProvenanceManifest) for full deployment verification
 * - The 5 runtime sources (RuntimeDecisionSourceManifest) for decision pipeline gating
 *
 * @module domain/source_manifest/manifest_gate
 */

import { createHash } from 'node:crypto';

import { ValidationStatus } from '@city-commander/shared-schemas';

import type { OfficialSourceEntry, ValidatedSourceEntry } from './official_source_manifest.js';
import {
  buildOfficialSourceManifest,
  getRuntimeDecisionSources,
} from './official_source_manifest.js';
import { verifySourceFile, verifySourceBuffer, toValidatedEntry } from './hash_verifier.js';
import type { VerificationResult } from './hash_verifier.js';

// ─── Types ─────────────────────────────────────────────────

/** Data status when gate fails */
export type DataStatus = 'ready' | 'insufficient_data';

/** Result of the manifest gate check */
export interface ManifestGateResult {
  /** Whether all sources passed verification */
  readonly passed: boolean;
  /** Data status for the decision pipeline */
  readonly data_status: DataStatus;
  /** Combined manifest hash (SHA-256 of all verified hashes concatenated) for DecisionCore */
  readonly source_manifest_hash: string;
  /** Individual verification results */
  readonly results: ValidatedSourceEntry[];
  /** Sources that failed verification (for error reporting) */
  readonly failures: ValidatedSourceEntry[];
  /** Human-readable stop reason (null if passed) */
  readonly stop_reason: string | null;
}

// ─── Manifest Hash Computation ─────────────────────────────

/**
 * Compute a combined source_manifest_hash from all verified entry hashes.
 * This hash is stored in DecisionCore for traceability.
 *
 * Algorithm: SHA-256 of all individual hashes concatenated in manifest order.
 */
export function computeSourceManifestHash(entries: ValidatedSourceEntry[]): string {
  const concatenated = entries
    .map((e) => e.sha256)
    .join('');
  return createHash('sha256').update(concatenated).digest('hex').toUpperCase();
}

// ─── STOP Gate Logic ───────────────────────────────────────

/**
 * Execute the STOP gate on a set of verified entries.
 * Any validation_status != verified results in a STOP (passed=false).
 */
function evaluateGate(validatedEntries: ValidatedSourceEntry[]): ManifestGateResult {
  const failures = validatedEntries.filter(
    (e) => e.validation_status !== ValidationStatus.VERIFIED,
  );

  if (failures.length > 0) {
    const failureDescriptions = failures.map(
      (f) => `${f.official_filename}: ${f.validation_status}`,
    );
    return {
      passed: false,
      data_status: 'insufficient_data',
      source_manifest_hash: '',
      results: validatedEntries,
      failures,
      stop_reason: `Source verification failed for ${failures.length} file(s): ${failureDescriptions.join('; ')}`,
    };
  }

  return {
    passed: true,
    data_status: 'ready',
    source_manifest_hash: computeSourceManifestHash(validatedEntries),
    results: validatedEntries,
    failures: [],
    stop_reason: null,
  };
}

// ─── File-based Gate (filesystem) ──────────────────────────

/**
 * File path resolver: maps official_filename to an absolute file path.
 * This allows different environments to locate files differently.
 */
export type FilePathResolver = (official_filename: string) => string;

/**
 * Run the STOP gate against files on disk.
 * Verifies the 5 runtime decision sources by default.
 *
 * @param resolveFilePath - Function mapping official_filename to filesystem path
 * @param options - Gate options
 * @returns ManifestGateResult
 */
export async function runManifestGate(
  resolveFilePath: FilePathResolver,
  options?: {
    /** Verify all 7 sources (provenance) instead of just 5 runtime sources */
    verifyAll?: boolean;
    /** Override expected hashes (e.g., from config) */
    expectedHashes?: Record<string, string>;
  },
): Promise<ManifestGateResult> {
  const entries = options?.verifyAll
    ? buildOfficialSourceManifest(options?.expectedHashes)
    : getRuntimeDecisionSources(options?.expectedHashes);

  const verificationResults: ValidatedSourceEntry[] = [];

  for (const entry of entries) {
    const filePath = resolveFilePath(entry.official_filename);
    const result = await verifySourceFile(entry, filePath);
    verificationResults.push(toValidatedEntry(entry, result));
  }

  return evaluateGate(verificationResults);
}

// ─── Buffer-based Gate (for S3 or in-memory data) ──────────

/**
 * Buffer provider: provides file content as Buffer for a given filename.
 * Returns null if the file is not available.
 */
export type BufferProvider = (official_filename: string) => Buffer | null;

/**
 * Run the STOP gate against in-memory buffers.
 * Used when files are fetched from S3 or provided directly (e.g., in tests).
 *
 * @param getBuffer - Function providing file content by official_filename
 * @param options - Gate options
 * @returns ManifestGateResult
 */
export function runManifestGateSync(
  getBuffer: BufferProvider,
  options?: {
    verifyAll?: boolean;
    expectedHashes?: Record<string, string>;
  },
): ManifestGateResult {
  const entries = options?.verifyAll
    ? buildOfficialSourceManifest(options?.expectedHashes)
    : getRuntimeDecisionSources(options?.expectedHashes);

  const verificationResults: ValidatedSourceEntry[] = [];

  for (const entry of entries) {
    const buffer = getBuffer(entry.official_filename);

    if (buffer === null) {
      // File missing
      verificationResults.push(
        toValidatedEntry(entry, {
          official_filename: entry.official_filename,
          validation_status: ValidationStatus.MISSING,
          computed_sha256: null,
          expected_sha256: entry.expected_sha256,
          size_bytes: 0,
          loaded_at: new Date().toISOString(),
        }),
      );
    } else {
      const result = verifySourceBuffer(entry, buffer);
      verificationResults.push(toValidatedEntry(entry, result));
    }
  }

  return evaluateGate(verificationResults);
}
