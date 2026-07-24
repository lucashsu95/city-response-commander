/**
 * Unit tests for DerivedArtifactManifest (§10.0c)
 *
 * Tests cover:
 * - derived_searchable_mirror is NOT a valid OfficialSourceManifest.source_type
 * - Mirrors register only in DerivedArtifactManifest with is_source_of_truth=false
 * - Decision-path guard rejects treating a derived mirror as official
 * - Attempting to add a mirror to the official manifest is rejected
 * - DerivedArtifactManifest class methods work correctly
 */

import { describe, it, expect } from 'vitest';
import { OfficialSourceType } from '@city-commander/shared-schemas';

import {
  DERIVED_ARTIFACT_TYPE,
  DerivedArtifactManifest,
  DerivedMirrorAsOfficialError,
  assertDerivedTypeNotInOfficialSourceType,
  rejectIfDerivedMirror,
  buildDerivedArtifactManifest,
  createDerivedArtifactEntry,
  buildOfficialSourceManifest,
} from '../../src/source_manifest/index.js';

// ─── Assertion: derived_searchable_mirror NOT in OfficialSourceType ──

describe('derived_searchable_mirror exclusion from OfficialSourceType', () => {
  it('should NOT be a valid OfficialSourceType value', () => {
    const officialValues = Object.values(OfficialSourceType);
    expect(officialValues).not.toContain(DERIVED_ARTIFACT_TYPE);
    expect(officialValues).not.toContain('derived_searchable_mirror');
  });

  it('assertDerivedTypeNotInOfficialSourceType should not throw', () => {
    expect(() => assertDerivedTypeNotInOfficialSourceType()).not.toThrow();
  });

  it('DERIVED_ARTIFACT_TYPE should equal "derived_searchable_mirror"', () => {
    expect(DERIVED_ARTIFACT_TYPE).toBe('derived_searchable_mirror');
  });

  it('OfficialSourceType should only contain PDF, DOCX, CSV, JSON, SOP_TXT', () => {
    const expected = new Set(['PDF', 'DOCX', 'CSV', 'JSON', 'SOP_TXT']);
    const actual = new Set(Object.values(OfficialSourceType));
    expect(actual).toEqual(expected);
  });
});

// ─── Mirrors register only in DerivedArtifactManifest ───────

describe('DerivedArtifactManifest registration', () => {
  const sampleEntries = [
    createDerivedArtifactEntry(
      '命題解說.md',
      '(中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx',
      'A1B2C3D4E5F6'.padEnd(64, '0'),
    ),
    createDerivedArtifactEntry(
      'docx_extracted.txt',
      '(中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx',
      'F6E5D4C3B2A1'.padEnd(64, '0'),
    ),
  ];

  it('should register mirrors with is_source_of_truth=false', () => {
    const manifest = buildDerivedArtifactManifest(sampleEntries);
    const entries = manifest.getEntries();
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.is_source_of_truth).toBe(false);
    }
  });

  it('should register mirrors with artifact_type=derived_searchable_mirror', () => {
    const manifest = buildDerivedArtifactManifest(sampleEntries);
    for (const entry of manifest.getEntries()) {
      expect(entry.artifact_type).toBe(DERIVED_ARTIFACT_TYPE);
    }
  });

  it('should identify registered mirrors by filename', () => {
    const manifest = buildDerivedArtifactManifest(sampleEntries);
    expect(manifest.isDerivedMirror('命題解說.md')).toBe(true);
    expect(manifest.isDerivedMirror('docx_extracted.txt')).toBe(true);
    expect(manifest.isDerivedMirror('city_traffic_flow.csv')).toBe(false);
    expect(manifest.isDerivedMirror('nonexistent.md')).toBe(false);
  });

  it('should find entry by filename', () => {
    const manifest = buildDerivedArtifactManifest(sampleEntries);
    const entry = manifest.findByFilename('命題解說.md');
    expect(entry).toBeDefined();
    expect(entry!.derived_from).toContain('命題解說');
    expect(entry!.derived_from).toContain('.docx');
  });

  it('should find all mirrors derived from a given official source', () => {
    const manifest = buildDerivedArtifactManifest(sampleEntries);
    const docxMirrors = manifest.findByOfficialSource(
      '(中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx',
    );
    expect(docxMirrors).toHaveLength(2);
  });

  it('should track correct size', () => {
    const manifest = buildDerivedArtifactManifest(sampleEntries);
    expect(manifest.size).toBe(2);
  });

  it('should handle empty manifest', () => {
    const manifest = buildDerivedArtifactManifest([]);
    expect(manifest.size).toBe(0);
    expect(manifest.isDerivedMirror('anything')).toBe(false);
  });
});

// ─── createDerivedArtifactEntry ─────────────────────────────

describe('createDerivedArtifactEntry', () => {
  it('should create an entry with correct fields', () => {
    const entry = createDerivedArtifactEntry(
      'test.md',
      'official.docx',
      'ABCDEF01'.padEnd(64, '0'),
    );

    expect(entry.derived_filename).toBe('test.md');
    expect(entry.artifact_type).toBe('derived_searchable_mirror');
    expect(entry.derived_from).toBe('official.docx');
    expect(entry.is_source_of_truth).toBe(false);
    expect(entry.sha256).toBe('ABCDEF01'.padEnd(64, '0'));
  });
});

// ─── Decision-path guard: reject derived mirrors as official ─

describe('rejectIfDerivedMirror (decision-path guard)', () => {
  const manifest = buildDerivedArtifactManifest([
    createDerivedArtifactEntry(
      '命題解說.md',
      '(中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx',
      'A'.repeat(64),
    ),
    createDerivedArtifactEntry(
      'docx_extracted.txt',
      '(中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx',
      'B'.repeat(64),
    ),
  ]);

  it('should throw DerivedMirrorAsOfficialError for a registered mirror', () => {
    expect(() => rejectIfDerivedMirror('命題解說.md', manifest)).toThrow(
      DerivedMirrorAsOfficialError,
    );
    expect(() => rejectIfDerivedMirror('命題解說.md', manifest)).toThrow(
      /Cannot treat derived mirror/,
    );
  });

  it('should throw for docx_extracted.txt', () => {
    expect(() => rejectIfDerivedMirror('docx_extracted.txt', manifest)).toThrow(
      DerivedMirrorAsOfficialError,
    );
  });

  it('should NOT throw for official source files', () => {
    expect(() => rejectIfDerivedMirror('city_traffic_flow.csv', manifest)).not.toThrow();
    expect(() =>
      rejectIfDerivedMirror('emergency_traffic_sop.txt', manifest),
    ).not.toThrow();
    expect(() =>
      rejectIfDerivedMirror(
        '(中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf',
        manifest,
      ),
    ).not.toThrow();
  });

  it('should NOT throw for non-existent filenames (not registered as mirrors)', () => {
    expect(() => rejectIfDerivedMirror('random_file.md', manifest)).not.toThrow();
  });
});

// ─── Derived mirrors cannot enter OfficialSourceManifest ────

describe('OfficialSourceManifest exclusion of derived mirrors', () => {
  it('official manifest should never contain derived_searchable_mirror as source_type', () => {
    const official = buildOfficialSourceManifest();
    for (const entry of official) {
      expect(entry.source_type).not.toBe(DERIVED_ARTIFACT_TYPE);
      expect(entry.source_type).not.toBe('derived_searchable_mirror');
    }
  });

  it('official manifest entries should all have is_source_of_truth=true', () => {
    const official = buildOfficialSourceManifest();
    for (const entry of official) {
      expect(entry.is_source_of_truth).toBe(true);
    }
  });

  it('derived manifest entries should all have is_source_of_truth=false', () => {
    const derived = buildDerivedArtifactManifest([
      createDerivedArtifactEntry('test.md', 'source.docx', 'C'.repeat(64)),
    ]);
    for (const entry of derived.getEntries()) {
      expect(entry.is_source_of_truth).toBe(false);
    }
  });
});

// ─── Validation: reject invalid entries ─────────────────────

describe('DerivedArtifactManifest validation', () => {
  it('should reject entry with wrong artifact_type', () => {
    const badEntry = {
      derived_filename: 'bad.md',
      artifact_type: 'WRONG_TYPE' as any,
      derived_from: 'source.docx',
      is_source_of_truth: false as const,
      sha256: 'D'.repeat(64),
    };

    expect(() => new DerivedArtifactManifest([badEntry])).toThrow(
      /Invalid artifact_type/,
    );
  });

  it('should reject entry with is_source_of_truth=true', () => {
    const badEntry = {
      derived_filename: 'bad.md',
      artifact_type: DERIVED_ARTIFACT_TYPE,
      derived_from: 'source.docx',
      is_source_of_truth: true as any,
      sha256: 'E'.repeat(64),
    };

    expect(() => new DerivedArtifactManifest([badEntry])).toThrow(
      /is_source_of_truth/,
    );
  });
});
