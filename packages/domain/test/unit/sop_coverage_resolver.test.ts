/**
 * Sop_Coverage_Resolver tests (spec: boundary-snapping-containment, R6).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { resolveSopCoverage } from '../../src/boundary/sop_coverage_resolver.js';
import { parseIncidentsJson } from '../../src/ingestion/incident_parser.js';
import { DEFAULT_UNIVERSAL_SOP, IncidentType } from '@city-commander/shared-schemas';

describe('resolveSopCoverage', () => {
  describe('R6 AC2 — official type-to-article table (every known IncidentType)', () => {
    it('Road_Collapse_Accident matches article 2 (車禍與路障應變)', () => {
      const result = resolveSopCoverage(IncidentType.Road_Collapse_Accident, '路面坍塌');
      expect(result).toEqual({
        sop_coverage_status: 'OFFICIAL_SOP_MATCHED',
        sop_authority: 'OFFICIAL_SOP',
        matched_article_nos: [2],
        universal_principles: [],
      });
    });

    it('Crowd_Surge_Injury matches article 3 (捷運與接駁分流)', () => {
      const result = resolveSopCoverage(IncidentType.Crowd_Surge_Injury, '捷運站人流推擠');
      expect(result).toEqual({
        sop_coverage_status: 'OFFICIAL_SOP_MATCHED',
        sop_authority: 'OFFICIAL_SOP',
        matched_article_nos: [3],
        universal_principles: [],
      });
    });

    it('Power_Failure matches article 5 (號誌故障應變)', () => {
      const result = resolveSopCoverage(IncidentType.Power_Failure, '路燈號誌故障');
      expect(result).toEqual({
        sop_coverage_status: 'OFFICIAL_SOP_MATCHED',
        sop_authority: 'OFFICIAL_SOP',
        matched_article_nos: [5],
        universal_principles: [],
      });
    });
  });

  describe('R6 AC3 — description-text fallback trigger (article 5 only)', () => {
    it('an unrecognized type whose description mentions 故障 still matches article 5', () => {
      const result = resolveSopCoverage('Unknown_Cell_Tower_Collapse', '電信號塔倒塌造成號誌故障');
      expect(result.sop_coverage_status).toBe('OFFICIAL_SOP_MATCHED');
      expect(result.matched_article_nos).toEqual([5]);
    });

    it('an unrecognized type whose description mentions 號誌失效 still matches article 5', () => {
      const result = resolveSopCoverage('Unknown_Gas_Leak', '路口號誌失效，車流混亂');
      expect(result.sop_coverage_status).toBe('OFFICIAL_SOP_MATCHED');
      expect(result.matched_article_nos).toEqual([5]);
    });
  });

  describe('R6 AC3/AC4 — unknown type + no textual trigger -> UNKNOWN_TYPE_UNIVERSAL_SOP', () => {
    const unknownTypeCases = [
      ['Unknown_Chemical_Leak', '未知化學氣體洩漏'],
      ['Cell_Tower_Collapse', '電信號塔倒塌'],
      ['Building_Fire', '建築物火警'],
      ['Gas_Explosion', '瓦斯氣爆'],
    ] as const;

    for (const [type, description] of unknownTypeCases) {
      it(`"${type}" resolves UNKNOWN_TYPE_UNIVERSAL_SOP`, () => {
        const result = resolveSopCoverage(type, description);
        expect(result.sop_coverage_status).toBe('UNKNOWN_TYPE_UNIVERSAL_SOP');
        expect(result.sop_authority).toBe('SYSTEM_DEFAULT_PRINCIPLE');
        expect(result.matched_article_nos).toEqual([]);
        expect(result.universal_principles).toBe(DEFAULT_UNIVERSAL_SOP);
      });
    }

    it('covers at least 3 distinct unknown types (R14.6)', () => {
      expect(unknownTypeCases.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('R6 AC6 — principle_id and official article_no never populated together', () => {
    it('OFFICIAL_SOP_MATCHED never carries universal_principles', () => {
      const result = resolveSopCoverage(IncidentType.Power_Failure, '');
      expect(result.universal_principles).toHaveLength(0);
      expect(result.matched_article_nos.length).toBeGreaterThan(0);
    });

    it('UNKNOWN_TYPE_UNIVERSAL_SOP never carries matched_article_nos', () => {
      const result = resolveSopCoverage('Totally_Unknown', '完全未知的描述文字');
      expect(result.matched_article_nos).toHaveLength(0);
      expect(result.universal_principles.length).toBeGreaterThan(0);
    });
  });

  describe('purity / determinism', () => {
    it('returns identical results for repeated calls with the same input', () => {
      const first = resolveSopCoverage(IncidentType.Road_Collapse_Accident, '路面坍塌');
      const second = resolveSopCoverage(IncidentType.Road_Collapse_Accident, '路面坍塌');
      expect(first).toEqual(second);
    });
  });

  describe('regression against the official 3 live_incidents.json events', () => {
    const LIVE_INCIDENTS_PATH = resolve(__dirname, '../../../../中華電信資料集/live_incidents.json');
    const officialIncidents = parseIncidentsJson(readFileSync(LIVE_INCIDENTS_PATH, 'utf-8'));

    it('TPE_2026_ACC_001 (Road_Collapse_Accident) matches article 2', () => {
      const incident = officialIncidents.find((i) => i.event_id === 'TPE_2026_ACC_001')!;
      const result = resolveSopCoverage(incident.type, incident.description);
      expect(result.matched_article_nos).toEqual([2]);
    });

    it('TPE_2026_EVT_002 (Crowd_Surge_Injury) matches article 3', () => {
      const incident = officialIncidents.find((i) => i.event_id === 'TPE_2026_EVT_002')!;
      const result = resolveSopCoverage(incident.type, incident.description);
      expect(result.matched_article_nos).toEqual([3]);
    });

    it('TPE_2026_EVT_003 (Power_Failure) matches article 5', () => {
      const incident = officialIncidents.find((i) => i.event_id === 'TPE_2026_EVT_003')!;
      const result = resolveSopCoverage(incident.type, incident.description);
      expect(result.matched_article_nos).toEqual([5]);
    });
  });
});
