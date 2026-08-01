/**
 * Containment_Assembler tests (spec: boundary-snapping-containment, R1, R12).
 *
 * TASK-BS-10 scope: the STOP-gate short circuit and the
 * Entity_Scope_Check → SOP coverage ordering only. The `runDeterministicDecision`
 * / `snap()` branches land in TASK-BS-11/TASK-BS-12.
 */
import { describe, it, expect } from 'vitest';
import { RoadNetworkModel } from '@city-commander/domain';
import type { IngestionResult } from '@city-commander/domain';
import type { Incident } from '@city-commander/shared-schemas';
import { assembleContainment } from '../../src/decision/containment_assembler.js';

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    event_id: 'TPE_2026_ACC_001',
    type: 'Road_Collapse_Accident',
    location: '光復南路與忠孝東路四段南側',
    affected_segment: 'RD_TPE_002',
    status: 'Closed',
    severity: 'Critical',
    description: '路面塌陷',
    timestamp: '2026-05-20 22:10',
    ...overrides,
  } as unknown as Incident;
}

function roadNetwork(): RoadNetworkModel {
  return RoadNetworkModel.load([
    { segment_id: 'RD_TPE_002', name: '光復南路', flow_direction: '南北向', intersections: ['市民大道四段', '忠孝東路四段', '仁愛路四段'], capacity_vph: 1800, alternatives: ['RD_TPE_004'], nearby_stations: [] },
    { segment_id: 'RD_TPE_004', name: '市民大道四段', flow_direction: '東西向', intersections: ['光復南路'], capacity_vph: 2500, alternatives: [], nearby_stations: [] },
  ]);
}

describe('assembleContainment', () => {
  describe('R12 AC2 — STOP-gate short circuit', () => {
    it('returns the ingestion insufficient_data/stop_reason verbatim without touching roadNetwork', () => {
      const ingestion = {
        data_status: 'insufficient_data',
        stop_reason: 'Source manifest hash mismatch for road_network_geometry.json.',
        source_manifest_hash: '',
        get roadNetwork(): RoadNetworkModel {
          throw new Error('roadNetwork must not be accessed when data_status !== ready (R12 AC2)');
        },
      } as unknown as IngestionResult;

      const result = assembleContainment({ ingestion, incident: incident() });

      expect(result).toEqual({
        data_status: 'insufficient_data',
        stop_reason: 'Source manifest hash mismatch for road_network_geometry.json.',
        source_manifest_hash: '',
        entity_scope: null,
        sop_coverage: null,
      });
    });

    it('is byte-identical to the existing insufficient_data shape backend handlers already rely on', () => {
      const ingestion: IngestionResult = {
        data_status: 'insufficient_data',
        stop_reason: 'Domain pipeline reported insufficient_data.',
        source_manifest_hash: '',
      };
      const result = assembleContainment({ ingestion, incident: incident() });
      expect(result.data_status).toBe(ingestion.data_status);
      expect(result.stop_reason).toBe(ingestion.stop_reason);
      expect(result.source_manifest_hash).toBe(ingestion.source_manifest_hash);
    });

    it('guards against a ready ingestion missing roadNetwork (invariant violation) without throwing', () => {
      const ingestion = {
        data_status: 'ready',
        stop_reason: null,
        source_manifest_hash: 'sha256:abc',
        // roadNetwork intentionally absent despite data_status='ready'
      } as unknown as IngestionResult;

      expect(() => assembleContainment({ ingestion, incident: incident() })).not.toThrow();
      const result = assembleContainment({ ingestion, incident: incident() });
      expect(result.data_status).toBe('insufficient_data');
      expect(result.entity_scope).toBeNull();
      expect(result.sop_coverage).toBeNull();
    });
  });

  describe('R1 AC1 — Entity_Scope_Check then SOP coverage resolution', () => {
    it('runs both and returns their results when ingestion is ready', () => {
      const ingestion: IngestionResult = {
        data_status: 'ready',
        stop_reason: null,
        source_manifest_hash: 'sha256:abc',
        roadNetwork: roadNetwork(),
      };
      const result = assembleContainment({ ingestion, incident: incident() });

      expect(result.data_status).toBe('ready');
      expect(result.entity_scope).toEqual({
        coverage_status: 'IN_SCOPE',
        decision_anchor_segment_id: 'RD_TPE_002',
        matched_field: 'affected_segment',
        matched_value: 'RD_TPE_002',
      });
      expect(result.sop_coverage).toEqual({
        sop_coverage_status: 'OFFICIAL_SOP_MATCHED',
        sop_authority: 'OFFICIAL_SOP',
        matched_article_nos: [2],
        universal_principles: [],
      });
    });

    it('resolves OUT_OF_BOUNDS + UNKNOWN_TYPE_UNIVERSAL_SOP for an incident outside both the network and the SOP table', () => {
      const ingestion: IngestionResult = {
        data_status: 'ready',
        stop_reason: null,
        source_manifest_hash: 'sha256:abc',
        roadNetwork: roadNetwork(),
      };
      const outOfBoundsIncident = incident({
        affected_segment: 'RD_TPE_099',
        affected_road: undefined,
        location: '完全不在路網範圍內的地點',
        type: 'Unknown_Chemical_Leak' as unknown as Incident['type'],
        description: '未知化學氣體洩漏',
      });
      const result = assembleContainment({ ingestion, incident: outOfBoundsIncident });

      expect(result.entity_scope?.coverage_status).toBe('OUT_OF_BOUNDS');
      expect(result.sop_coverage?.sop_coverage_status).toBe('UNKNOWN_TYPE_UNIVERSAL_SOP');
      expect(result.sop_coverage?.universal_principles.length).toBeGreaterThan(0);
    });
  });

  describe('purity / determinism', () => {
    it('returns equal results for repeated calls with the same input', () => {
      const ingestion: IngestionResult = {
        data_status: 'ready',
        stop_reason: null,
        source_manifest_hash: 'sha256:abc',
        roadNetwork: roadNetwork(),
      };
      const first = assembleContainment({ ingestion, incident: incident() });
      const second = assembleContainment({ ingestion, incident: incident() });
      expect(first).toEqual(second);
    });
  });
});
