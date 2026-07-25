import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { runManifestGateSync } from '../../src/source_manifest/manifest_gate.js';
import { RUNTIME_SOURCE_FILES } from '../../src/ingestion/data_ingestion_service.js';
import { qualifyCandidates } from '../../src/rule_engine/article2.js';
import { selectEvacuation } from '../../src/rule_engine/evacuation_selector.js';
import { incidentAnchorFromLocationText } from '../../src/strategies/incident_anchor_resolution_strategy.js';
import { unresolvedManualConfirmation } from '../../src/strategies/affected_intersection_scope_strategy.js';
import { makeIncident, roadNetwork, roadSegments } from '../helpers/domain-fixtures.js';

describe('deterministic failure modes', () => {
  it('stops decisioning when one official source byte differs', () => {
    const filenames = Object.values(RUNTIME_SOURCE_FILES); const buffers = new Map(filenames.map((name) => [name, Buffer.from(`verified:${name}`)]));
    const expectedHashes = Object.fromEntries([...buffers].map(([name, value]) => [name, createHash('sha256').update(value).digest('hex').toUpperCase()]));
    buffers.set(RUNTIME_SOURCE_FILES.TRAFFIC, Buffer.from(`tampered:${RUNTIME_SOURCE_FILES.TRAFFIC}`));
    const result = runManifestGateSync((name) => buffers.get(name) ?? null, { expectedHashes });
    expect(result).toMatchObject({ passed: false, data_status: 'insufficient_data', source_manifest_hash: '' });
    expect(result.failures).toHaveLength(1);
  });
  it('documents no legal alternative without inventing a road', () => {
    const candidates = qualifyCandidates('RD_TPE_002', '忠孝東路四段', roadNetwork(), new Map());
    const result = selectEvacuation(candidates.map((route) => ({ ...route, role: 'excluded' as const, exclusion_reason: route.exclusion_reason ?? 'disqualified' })));
    expect(result.primary_evacuation).toBeNull(); expect(result.no_candidate_note).toBe('查無合規替代路段');
    expect(result.excluded_candidates.every((route) => roadSegments()[0].alternatives.includes(route.segment_id))).toBe(true);
  });
  it('requires manual confirmation for an ambiguous anchor', () => {
    const result = incidentAnchorFromLocationText.resolve(makeIncident({ location: '市民大道四段與忠孝東路四段之間' }), roadNetwork(), { mode: 'incident_anchor_from_location_text' });
    expect(result.manual_confirmation_required).toBe(true); expect(result.anchor_intersection).toBe(''); expect(result.position_relative_to_intersection).toBe('');
  });
  it('keeps default SOP-5 police totals unresolved', () => {
    expect(unresolvedManualConfirmation.resolve(makeIncident(), roadSegments()[0], { mode: 'unresolved_manual_confirmation' })).toMatchObject({ affected_intersection_count: 'unresolved', total_police: 'unresolved', manual_confirmation_required: true });
  });
});
