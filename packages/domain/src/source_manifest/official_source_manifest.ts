/**
 * OfficialSourceManifest — 7 official sources with expected SHA-256 hashes
 *
 * Encodes the seven official contest sources (§10.0, §10.0b) and distinguishes
 * the 5-file RuntimeDecisionSourceManifest from the 7-source SubmissionProvenanceManifest.
 *
 * Expected hashes are injectable/configurable for LOCAL_MOCK (placeholder values)
 * and can be updated when the actual official files are provided.
 *
 * @module domain/source_manifest/official_source_manifest
 */

import { OfficialSourceType, ValidationStatus } from '@city-commander/shared-schemas';

// ─── Types ─────────────────────────────────────────────────

/** Manifest role distinguishing runtime (5 files) from provenance (all 7) */
export type ManifestRole = 'runtime_decision' | 'submission_provenance_only';

/** A single official source entry in the manifest */
export interface OfficialSourceEntry {
  readonly official_filename: string;
  readonly source_type: OfficialSourceType;
  readonly expected_sha256: string;
  readonly manifest_role: ManifestRole;
  readonly is_source_of_truth: true;
}

/** Validated source entry (after hash verification at boot/load) */
export interface ValidatedSourceEntry extends OfficialSourceEntry {
  readonly sha256: string;
  readonly size_bytes: number;
  readonly loaded_at: string;
  readonly validation_status: ValidationStatus;
}

// ─── 7 Official Sources (§10.0b) ───────────────────────────

/**
 * Default expected SHA-256 hashes for the 7 official sources.
 * These are placeholder values from the design doc §10.0b.
 * In LOCAL_MOCK, these can be overridden via config.
 */
export const DEFAULT_EXPECTED_HASHES: Record<string, string> = {
  '(中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf':
    '706B44C94313AAE751434E29EE3CFF6BE1351DAA76077933C5D6DBE5171C15D7',
  '(中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx':
    '0BC38CA8B655308F0DB36E3CF02FAC1289E9509AD61C59C9673CF5A7505FF065',
  'city_traffic_flow.csv':
    'B31436B5280B95325DA7715E7F1D3059AE343CF6E69FB2C063A9C95A541D5F2A',
  'signaling_crowd_density.csv':
    'BD9BC159083A6304C68FEF2DFC52E1C23251523882F9953A10928C26E9564073',
  'road_network_geometry.json':
    '741D253538AAF2BB25C60DEC9D4A8E8DEFECC27112FA09C7A9F1512ADB286B18',
  'emergency_traffic_sop.txt':
    '0C84F2F6F30E2EC18F56E9675AA1C1C6062EBEFAF14920D8CCAC732D41BCAF1D',
  'live_incidents.json':
    'E90C8AE46AFD02A76C233F39CB0628254BE53555B9E48067C4EA3A48E41C0A63',
};

/**
 * The 7 official source entries — the authoritative manifest definition.
 *
 * Sources 1-2: submission provenance only (PDF + DOCX)
 * Sources 3-7: runtime decision sources (2 CSV + 2 JSON + 1 SOP TXT)
 */
export function buildOfficialSourceManifest(
  expectedHashes?: Record<string, string>,
): OfficialSourceEntry[] {
  const hashes = expectedHashes ?? DEFAULT_EXPECTED_HASHES;

  return [
    // #1: 命題文件 PDF (submission provenance only)
    {
      official_filename: '(中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf',
      source_type: OfficialSourceType.PDF,
      expected_sha256: hashes['(中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf'] ?? '',
      manifest_role: 'submission_provenance_only',
      is_source_of_truth: true,
    },
    // #2: 命題解說 DOCX (submission provenance only, NOT PDF)
    {
      official_filename: '(中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx',
      source_type: OfficialSourceType.DOCX,
      expected_sha256: hashes['(中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx'] ?? '',
      manifest_role: 'submission_provenance_only',
      is_source_of_truth: true,
    },
    // #3: city_traffic_flow.csv (runtime decision)
    {
      official_filename: 'city_traffic_flow.csv',
      source_type: OfficialSourceType.CSV,
      expected_sha256: hashes['city_traffic_flow.csv'] ?? '',
      manifest_role: 'runtime_decision',
      is_source_of_truth: true,
    },
    // #4: signaling_crowd_density.csv (runtime decision)
    {
      official_filename: 'signaling_crowd_density.csv',
      source_type: OfficialSourceType.CSV,
      expected_sha256: hashes['signaling_crowd_density.csv'] ?? '',
      manifest_role: 'runtime_decision',
      is_source_of_truth: true,
    },
    // #5: road_network_geometry.json (runtime decision)
    {
      official_filename: 'road_network_geometry.json',
      source_type: OfficialSourceType.JSON,
      expected_sha256: hashes['road_network_geometry.json'] ?? '',
      manifest_role: 'runtime_decision',
      is_source_of_truth: true,
    },
    // #6: emergency_traffic_sop.txt (runtime decision)
    {
      official_filename: 'emergency_traffic_sop.txt',
      source_type: OfficialSourceType.SOP_TXT,
      expected_sha256: hashes['emergency_traffic_sop.txt'] ?? '',
      manifest_role: 'runtime_decision',
      is_source_of_truth: true,
    },
    // #7: live_incidents.json (runtime decision)
    {
      official_filename: 'live_incidents.json',
      source_type: OfficialSourceType.JSON,
      expected_sha256: hashes['live_incidents.json'] ?? '',
      manifest_role: 'runtime_decision',
      is_source_of_truth: true,
    },
  ];
}

/**
 * Get the 5-file RuntimeDecisionSourceManifest (items 3-7).
 * These are the files actually read by the decision engine at runtime.
 */
export function getRuntimeDecisionSources(
  expectedHashes?: Record<string, string>,
): OfficialSourceEntry[] {
  return buildOfficialSourceManifest(expectedHashes).filter(
    (entry) => entry.manifest_role === 'runtime_decision',
  );
}

/**
 * Get the full 7-source SubmissionProvenanceManifest (all items).
 * Used for delivery/audit purposes.
 */
export function getSubmissionProvenanceSources(
  expectedHashes?: Record<string, string>,
): OfficialSourceEntry[] {
  return buildOfficialSourceManifest(expectedHashes);
}
