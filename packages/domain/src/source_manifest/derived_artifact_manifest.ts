/**
 * DerivedArtifactManifest — Mirrors are NOT source of truth (§10.0c)
 *
 * Registers .md / docx_extracted.txt mirrors as `derived_searchable_mirror`
 * in a separate manifest so they can NEVER substitute for the official
 * PDF/DOCX/SOP/CSV/JSON sources.
 *
 * Key rules:
 * - `derived_searchable_mirror` is NOT a valid OfficialSourceManifest.source_type
 * - `is_source_of_truth` is always `false` for derived artifacts
 * - Derived mirrors exist only for human reading/search, never for decision authority
 * - The decision path must never read a derived mirror as authority
 *
 * @module domain/source_manifest/derived_artifact_manifest
 */

import { OfficialSourceType } from '@city-commander/shared-schemas';

// ─── Types ─────────────────────────────────────────────────

/**
 * Artifact type for derived mirrors.
 * This value is intentionally NOT part of the OfficialSourceType enum.
 */
export const DERIVED_ARTIFACT_TYPE = 'derived_searchable_mirror' as const;

export type DerivedArtifactType = typeof DERIVED_ARTIFACT_TYPE;

/** A single derived artifact entry (§10.0c) */
export interface DerivedArtifactEntry {
  /** Filename of the derived mirror (e.g., `命題解說.md`, `docx_extracted.txt`) */
  readonly derived_filename: string;
  /** Always `derived_searchable_mirror` */
  readonly artifact_type: DerivedArtifactType;
  /** The official source filename this was derived from */
  readonly derived_from: string;
  /** Always `false` — mirrors are never source of truth */
  readonly is_source_of_truth: false;
  /** SHA-256 hash (64 hex uppercase) of the derived file */
  readonly sha256: string;
}

// ─── Guard: derived_searchable_mirror is NOT a valid OfficialSourceType ─────

/**
 * Asserts that `derived_searchable_mirror` is NOT a member of OfficialSourceType.
 * This is a compile-time + runtime guard ensuring the two manifests are disjoint.
 */
export function assertDerivedTypeNotInOfficialSourceType(): void {
  const officialValues: string[] = Object.values(OfficialSourceType);
  if (officialValues.includes(DERIVED_ARTIFACT_TYPE)) {
    throw new Error(
      `INTEGRITY VIOLATION: '${DERIVED_ARTIFACT_TYPE}' must NOT be a valid OfficialSourceType. ` +
        `Found in OfficialSourceType values: [${officialValues.join(', ')}]. ` +
        `Derived mirrors can never substitute for official sources.`,
    );
  }
}

// Run assertion at module load to catch any accidental addition of the type
assertDerivedTypeNotInOfficialSourceType();

// ─── Guard: prevent decision-path code from using derived mirrors ────────────

/**
 * Error thrown when an attempt is made to treat a derived mirror as an official source.
 */
export class DerivedMirrorAsOfficialError extends Error {
  constructor(derivedFilename: string) {
    super(
      `REJECTED: Cannot treat derived mirror '${derivedFilename}' as an official source. ` +
        `Derived mirrors (artifact_type='${DERIVED_ARTIFACT_TYPE}') are for human ` +
        `reading/search only and must NEVER be used as decision authority.`,
    );
    this.name = 'DerivedMirrorAsOfficialError';
  }
}

/**
 * Validates that a filename is NOT a registered derived mirror.
 * Call this in the decision path before using any filename as an official source.
 *
 * @throws DerivedMirrorAsOfficialError if the filename is a registered derived mirror
 */
export function rejectIfDerivedMirror(filename: string, manifest: DerivedArtifactManifest): void {
  if (manifest.isDerivedMirror(filename)) {
    throw new DerivedMirrorAsOfficialError(filename);
  }
}

// ─── DerivedArtifactManifest ────────────────────────────────

/**
 * Manifest for derived artifacts (§10.0c).
 *
 * Registers .md / docx_extracted.txt mirrors separately from the OfficialSourceManifest.
 * Provides guards to prevent these mirrors from being used as decision authority.
 */
export class DerivedArtifactManifest {
  private readonly entries: ReadonlyArray<DerivedArtifactEntry>;
  private readonly filenameIndex: ReadonlySet<string>;

  constructor(entries: DerivedArtifactEntry[]) {
    // Validate all entries
    for (const entry of entries) {
      if (entry.artifact_type !== DERIVED_ARTIFACT_TYPE) {
        throw new Error(
          `Invalid artifact_type '${entry.artifact_type}' for derived entry ` +
            `'${entry.derived_filename}'. Must be '${DERIVED_ARTIFACT_TYPE}'.`,
        );
      }
      if (entry.is_source_of_truth !== false) {
        throw new Error(
          `Invalid is_source_of_truth for derived entry '${entry.derived_filename}'. ` +
            `Derived mirrors must always have is_source_of_truth=false.`,
        );
      }
    }

    this.entries = Object.freeze([...entries]);
    this.filenameIndex = new Set(entries.map((e) => e.derived_filename));
  }

  /** Get all registered derived artifact entries */
  getEntries(): ReadonlyArray<DerivedArtifactEntry> {
    return this.entries;
  }

  /** Check if a filename is a registered derived mirror */
  isDerivedMirror(filename: string): boolean {
    return this.filenameIndex.has(filename);
  }

  /** Find the entry for a derived filename, or undefined if not registered */
  findByFilename(filename: string): DerivedArtifactEntry | undefined {
    return this.entries.find((e) => e.derived_filename === filename);
  }

  /** Find all mirrors derived from a given official source */
  findByOfficialSource(officialFilename: string): DerivedArtifactEntry[] {
    return this.entries.filter((e) => e.derived_from === officialFilename);
  }

  /** Get the count of registered derived artifacts */
  get size(): number {
    return this.entries.length;
  }
}

// ─── Factory: build from known derived mirrors ──────────────

/**
 * Creates the DerivedArtifactManifest for known competition mirrors.
 *
 * Examples of derived mirrors:
 * - `命題解說.md` — derived from the official DOCX
 * - `docx_extracted.txt` — extracted text from DOCX
 *
 * @param entries - Array of derived artifact entries to register
 */
export function buildDerivedArtifactManifest(
  entries: DerivedArtifactEntry[],
): DerivedArtifactManifest {
  return new DerivedArtifactManifest(entries);
}

/**
 * Creates a DerivedArtifactEntry with validation.
 *
 * @param derived_filename - Name of the derived mirror file
 * @param derived_from - Official source filename this was derived from
 * @param sha256 - SHA-256 hash of the derived file (64 hex uppercase)
 */
export function createDerivedArtifactEntry(
  derived_filename: string,
  derived_from: string,
  sha256: string,
): DerivedArtifactEntry {
  return {
    derived_filename,
    artifact_type: DERIVED_ARTIFACT_TYPE,
    derived_from,
    is_source_of_truth: false,
    sha256,
  };
}
