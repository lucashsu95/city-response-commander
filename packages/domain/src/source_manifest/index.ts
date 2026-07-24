/**
 * Source Manifest Module
 *
 * Provides the OfficialSourceManifest, SHA-256 verifier, and STOP gate
 * for verifying the 7 official competition sources (§10.0, §15, §21).
 *
 * @module domain/source_manifest
 */

export {
  buildOfficialSourceManifest,
  getRuntimeDecisionSources,
  getSubmissionProvenanceSources,
  DEFAULT_EXPECTED_HASHES,
} from './official_source_manifest.js';

export type {
  ManifestRole,
  OfficialSourceEntry,
  ValidatedSourceEntry,
} from './official_source_manifest.js';

export {
  computeSHA256,
  hashesMatch,
  verifySourceFile,
  verifySourceBuffer,
  toValidatedEntry,
} from './hash_verifier.js';

export type { VerificationResult } from './hash_verifier.js';

export {
  computeSourceManifestHash,
  runManifestGate,
  runManifestGateSync,
} from './manifest_gate.js';

export type {
  DataStatus,
  ManifestGateResult,
  FilePathResolver,
  BufferProvider,
} from './manifest_gate.js';
