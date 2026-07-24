/**
 * SHA-256 Hash Verifier — computes and compares file hashes
 *
 * Implements SHA-256 computation and comparison producing validation_status:
 * - verified: computed hash matches expected (UPPERCASE comparison)
 * - hash_mismatch: file readable but hash differs
 * - missing: file does not exist
 * - unreadable: file exists but cannot be read
 *
 * All hashes are compared in UPPERCASE hex format per §10.0b.
 *
 * @module domain/source_manifest/hash_verifier
 */

import { createHash } from 'node:crypto';
import { readFile, stat, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

import { ValidationStatus } from '@city-commander/shared-schemas';

import type { OfficialSourceEntry, ValidatedSourceEntry } from './official_source_manifest.js';

// ─── Types ─────────────────────────────────────────────────

/** Result of verifying a single source file */
export interface VerificationResult {
  readonly official_filename: string;
  readonly validation_status: ValidationStatus;
  readonly computed_sha256: string | null;
  readonly expected_sha256: string;
  readonly size_bytes: number;
  readonly loaded_at: string;
}

// ─── Core Functions ────────────────────────────────────────

/**
 * Compute SHA-256 hash of a buffer, returning UPPERCASE hex string.
 */
export function computeSHA256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex').toUpperCase();
}

/**
 * Compare two SHA-256 hash strings (case-insensitive, normalized to UPPERCASE).
 */
export function hashesMatch(computed: string, expected: string): boolean {
  return computed.toUpperCase() === expected.toUpperCase();
}

/**
 * Format current time as YYYY-MM-DD HH:MM for loaded_at field.
 */
function formatLoadedAt(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}

/**
 * Verify a single source file against its expected hash.
 *
 * @param entry - The manifest entry defining expected hash
 * @param filePath - Absolute path to the file on disk (or in S3 abstraction)
 * @returns VerificationResult with validation_status
 */
export async function verifySourceFile(
  entry: OfficialSourceEntry,
  filePath: string,
): Promise<VerificationResult> {
  const loadedAt = formatLoadedAt();

  // Check if file exists
  try {
    await access(filePath, fsConstants.R_OK);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {
        official_filename: entry.official_filename,
        validation_status: ValidationStatus.MISSING,
        computed_sha256: null,
        expected_sha256: entry.expected_sha256,
        size_bytes: 0,
        loaded_at: loadedAt,
      };
    }
    // Not accessible (permission denied, etc.)
    return {
      official_filename: entry.official_filename,
      validation_status: ValidationStatus.UNREADABLE,
      computed_sha256: null,
      expected_sha256: entry.expected_sha256,
      size_bytes: 0,
      loaded_at: loadedAt,
    };
  }

  // Read file and compute hash
  let data: Buffer;
  let fileSize: number;
  try {
    data = await readFile(filePath);
    const fileStats = await stat(filePath);
    fileSize = fileStats.size;
  } catch {
    return {
      official_filename: entry.official_filename,
      validation_status: ValidationStatus.UNREADABLE,
      computed_sha256: null,
      expected_sha256: entry.expected_sha256,
      size_bytes: 0,
      loaded_at: loadedAt,
    };
  }

  const computedHash = computeSHA256(data);
  const matches = hashesMatch(computedHash, entry.expected_sha256);

  return {
    official_filename: entry.official_filename,
    validation_status: matches ? ValidationStatus.VERIFIED : ValidationStatus.HASH_MISMATCH,
    computed_sha256: computedHash,
    expected_sha256: entry.expected_sha256,
    size_bytes: fileSize,
    loaded_at: loadedAt,
  };
}

/**
 * Verify a source file from an in-memory buffer (for testing or S3-fetched data).
 *
 * @param entry - The manifest entry defining expected hash
 * @param data - File content as a Buffer
 * @returns VerificationResult
 */
export function verifySourceBuffer(
  entry: OfficialSourceEntry,
  data: Buffer,
): VerificationResult {
  const loadedAt = formatLoadedAt();
  const computedHash = computeSHA256(data);
  const matches = hashesMatch(computedHash, entry.expected_sha256);

  return {
    official_filename: entry.official_filename,
    validation_status: matches ? ValidationStatus.VERIFIED : ValidationStatus.HASH_MISMATCH,
    computed_sha256: computedHash,
    expected_sha256: entry.expected_sha256,
    size_bytes: data.length,
    loaded_at: loadedAt,
  };
}

/**
 * Convert a VerificationResult into a ValidatedSourceEntry.
 */
export function toValidatedEntry(
  entry: OfficialSourceEntry,
  result: VerificationResult,
): ValidatedSourceEntry {
  return {
    ...entry,
    sha256: result.computed_sha256 ?? '',
    size_bytes: result.size_bytes,
    loaded_at: result.loaded_at,
    validation_status: result.validation_status,
  };
}
