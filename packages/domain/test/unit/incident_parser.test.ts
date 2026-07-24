/**
 * Unit tests for incident_parser.ts
 *
 * Verifies:
 * - Three official events parse correctly (ACC_001, EVT_002, EVT_003)
 * - `affected_road` is present only where provided (EVT_002)
 * - Severity validation: unknown severity → typed error
 * - Unknown type → typed error
 * - Unknown status → typed error
 * - Malformed JSON → typed error
 */

import { describe, it, expect } from 'vitest';
import { parseIncidentsJson, IncidentParseError } from '../../src/ingestion/incident_parser.js';
import { IncidentType, IncidentStatus, IncidentSeverity } from '@city-commander/shared-schemas';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read the actual official data file
const LIVE_INCIDENTS_PATH = resolve(
  __dirname,
  '../../../../中華電信資料集/live_incidents.json',
);

describe('parseIncidentsJson', () => {
  describe('official data (live_incidents.json)', () => {
    const jsonContent = readFileSync(LIVE_INCIDENTS_PATH, 'utf-8');
    const incidents = parseIncidentsJson(jsonContent);

    it('should parse all three official events', () => {
      expect(incidents).toHaveLength(3);
    });

    it('ACC_001: Road_Collapse_Accident, RD_TPE_002, Closed, Critical, no affected_road', () => {
      const acc001 = incidents.find((i) => i.event_id === 'TPE_2026_ACC_001');
      expect(acc001).toBeDefined();
      expect(acc001!.type).toBe(IncidentType.Road_Collapse_Accident);
      expect(acc001!.location).toBe('光復南路與忠孝東路口南側');
      expect(acc001!.affected_segment).toBe('RD_TPE_002');
      expect(acc001!.status).toBe(IncidentStatus.Closed);
      expect(acc001!.severity).toBe(IncidentSeverity.Critical);
      expect(acc001!.timestamp).toBe('2026-05-20 22:10');
      // affected_road should NOT be present
      expect(acc001!.affected_road).toBeUndefined();
    });

    it('EVT_002: Crowd_Surge_Injury, BS_MRT_BL17, Restricted, High, affected_road = RD_TPE_001', () => {
      const evt002 = incidents.find((i) => i.event_id === 'TPE_2026_EVT_002');
      expect(evt002).toBeDefined();
      expect(evt002!.type).toBe(IncidentType.Crowd_Surge_Injury);
      expect(evt002!.location).toBe('捷運國父紀念館站 5 號出口');
      expect(evt002!.affected_segment).toBe('BS_MRT_BL17');
      expect(evt002!.status).toBe(IncidentStatus.Restricted);
      expect(evt002!.severity).toBe(IncidentSeverity.High);
      expect(evt002!.timestamp).toBe('2026-05-20 22:20');
      // affected_road IS present for EVT_002
      expect(evt002!.affected_road).toBe('RD_TPE_001');
    });

    it('EVT_003: Power_Failure, RD_TPE_007, Caution, Medium, no affected_road', () => {
      const evt003 = incidents.find((i) => i.event_id === 'TPE_2026_EVT_003');
      expect(evt003).toBeDefined();
      expect(evt003!.type).toBe(IncidentType.Power_Failure);
      expect(evt003!.location).toBe('信義威秀/ATT4FUN周邊路燈號誌故障');
      expect(evt003!.affected_segment).toBe('RD_TPE_007');
      expect(evt003!.status).toBe(IncidentStatus.Caution);
      expect(evt003!.severity).toBe(IncidentSeverity.Medium);
      expect(evt003!.timestamp).toBe('2026-05-20 22:30');
      // affected_road should NOT be present
      expect(evt003!.affected_road).toBeUndefined();
    });

    it('affected_road is present ONLY on EVT_002', () => {
      const withAffectedRoad = incidents.filter((i) => i.affected_road !== undefined);
      expect(withAffectedRoad).toHaveLength(1);
      expect(withAffectedRoad[0].event_id).toBe('TPE_2026_EVT_002');
    });
  });

  describe('severity validation', () => {
    it('should reject unknown severity with UNKNOWN_SEVERITY error', () => {
      const data = JSON.stringify([
        {
          event_id: 'TEST_001',
          type: 'Power_Failure',
          location: 'Test Location',
          affected_segment: 'RD_TPE_001',
          status: 'Closed',
          severity: 'Low', // invalid severity
          description: 'Test',
          timestamp: '2026-05-20 22:00',
        },
      ]);

      expect(() => parseIncidentsJson(data)).toThrow(IncidentParseError);
      try {
        parseIncidentsJson(data);
      } catch (e) {
        const err = e as IncidentParseError;
        expect(err.code).toBe('UNKNOWN_SEVERITY');
        expect(err.details?.field).toBe('severity');
        expect(err.details?.value).toBe('Low');
      }
    });
  });

  describe('type validation', () => {
    it('should reject unknown type with UNKNOWN_TYPE error', () => {
      const data = JSON.stringify([
        {
          event_id: 'TEST_001',
          type: 'Earthquake',
          location: 'Test Location',
          affected_segment: 'RD_TPE_001',
          status: 'Closed',
          severity: 'Critical',
          description: 'Test',
          timestamp: '2026-05-20 22:00',
        },
      ]);

      expect(() => parseIncidentsJson(data)).toThrow(IncidentParseError);
      try {
        parseIncidentsJson(data);
      } catch (e) {
        const err = e as IncidentParseError;
        expect(err.code).toBe('UNKNOWN_TYPE');
        expect(err.details?.value).toBe('Earthquake');
      }
    });
  });

  describe('status validation', () => {
    it('should reject unknown status with UNKNOWN_STATUS error', () => {
      const data = JSON.stringify([
        {
          event_id: 'TEST_001',
          type: 'Power_Failure',
          location: 'Test Location',
          affected_segment: 'RD_TPE_001',
          status: 'Unknown',
          severity: 'Medium',
          description: 'Test',
          timestamp: '2026-05-20 22:00',
        },
      ]);

      expect(() => parseIncidentsJson(data)).toThrow(IncidentParseError);
      try {
        parseIncidentsJson(data);
      } catch (e) {
        const err = e as IncidentParseError;
        expect(err.code).toBe('UNKNOWN_STATUS');
        expect(err.details?.value).toBe('Unknown');
      }
    });
  });

  describe('malformed input handling', () => {
    it('should reject invalid JSON', () => {
      expect(() => parseIncidentsJson('not json')).toThrow(IncidentParseError);
      try {
        parseIncidentsJson('not json');
      } catch (e) {
        expect((e as IncidentParseError).code).toBe('INVALID_JSON');
      }
    });

    it('should reject non-array JSON', () => {
      expect(() => parseIncidentsJson('{"a": 1}')).toThrow(IncidentParseError);
      try {
        parseIncidentsJson('{"a": 1}');
      } catch (e) {
        expect((e as IncidentParseError).code).toBe('NOT_ARRAY');
      }
    });

    it('should reject empty array', () => {
      expect(() => parseIncidentsJson('[]')).toThrow(IncidentParseError);
      try {
        parseIncidentsJson('[]');
      } catch (e) {
        expect((e as IncidentParseError).code).toBe('EMPTY_DATA');
      }
    });

    it('should reject record with missing required field', () => {
      const data = JSON.stringify([
        {
          event_id: 'TEST_001',
          // type missing
          location: 'Test',
          affected_segment: 'RD_TPE_001',
          status: 'Closed',
          severity: 'Critical',
          description: 'Test',
          timestamp: '2026-05-20 22:00',
        },
      ]);

      expect(() => parseIncidentsJson(data)).toThrow(IncidentParseError);
      try {
        parseIncidentsJson(data);
      } catch (e) {
        expect((e as IncidentParseError).code).toBe('INVALID_RECORD');
      }
    });
  });
});
