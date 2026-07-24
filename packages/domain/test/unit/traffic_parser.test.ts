import { describe, it, expect } from 'vitest';
import { parseTrafficCsv, TrafficParseError } from '../../src/ingestion/traffic_parser.js';

const HEADER = 'Timestamp,Segment_ID,Road_Name,Avg_Speed,Vehicle_Count,Saturation_Score,Lane_Status';
const VALID_ROW = '2026/5/20 17:00,RD_TPE_001,忠孝東路四段,42,1250,0.58,Normal';

function makeCsv(...rows: string[]): string {
  return [HEADER, ...rows].join('\r\n');
}

describe('parseTrafficCsv', () => {
  describe('well-formed input', () => {
    it('parses a single valid row', () => {
      const csv = makeCsv(VALID_ROW);
      const records = parseTrafficCsv(csv);

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        timestamp_raw: '2026/5/20 17:00',
        Segment_ID: 'RD_TPE_001',
        Road_Name: '忠孝東路四段',
        Avg_Speed: 42,
        Vehicle_Count: 1250,
        Saturation_Score: 0.58,
        Lane_Status: 'Normal',
      });
    });

    it('handles BOM character at the start of file', () => {
      const csv = '\uFEFF' + makeCsv(VALID_ROW);
      const records = parseTrafficCsv(csv);

      expect(records).toHaveLength(1);
      expect(records[0].Segment_ID).toBe('RD_TPE_001');
    });

    it('preserves timestamp_raw verbatim (byte-identical to source)', () => {
      const rawTimestamp = '2026/5/20 22:10';
      const row = `${rawTimestamp},RD_TPE_002,光復南路,38,820,0.62,Normal`;
      const records = parseTrafficCsv(makeCsv(row));

      expect(records[0].timestamp_raw).toBe(rawTimestamp);
    });

    it('parses Saturation_Score as a float between 0 and 1', () => {
      const row = '2026/5/20 17:00,RD_TPE_001,忠孝東路四段,42,1250,0.95,Critical';
      const records = parseTrafficCsv(makeCsv(row));

      expect(records[0].Saturation_Score).toBe(0.95);
      expect(records[0].Saturation_Score).toBeGreaterThanOrEqual(0);
      expect(records[0].Saturation_Score).toBeLessThanOrEqual(1);
    });

    it('parses all valid LaneStatus values', () => {
      const statuses = [
        'Normal', 'Congested', 'Critical', 'Blocked',
        'Gridlock', 'Accident_Impact', 'Partial_Open',
      ];

      for (const status of statuses) {
        const row = `2026/5/20 17:00,RD_TPE_001,忠孝東路四段,42,1250,0.58,${status}`;
        const records = parseTrafficCsv(makeCsv(row));
        expect(records[0].Lane_Status).toBe(status);
      }
    });

    it('parses multiple rows', () => {
      const rows = [
        '2026/5/20 17:00,RD_TPE_001,忠孝東路四段,42,1250,0.58,Normal',
        '2026/5/20 17:00,RD_TPE_002,光復南路,38,820,0.62,Normal',
        '2026/5/20 17:00,RD_TPE_003,基隆路一段,32,1550,0.78,Normal',
      ];
      const records = parseTrafficCsv(makeCsv(...rows));

      expect(records).toHaveLength(3);
      expect(records[0].Segment_ID).toBe('RD_TPE_001');
      expect(records[1].Segment_ID).toBe('RD_TPE_002');
      expect(records[2].Segment_ID).toBe('RD_TPE_003');
    });

    it('handles LF line endings (no CR)', () => {
      const csv = [HEADER, VALID_ROW].join('\n');
      const records = parseTrafficCsv(csv);

      expect(records).toHaveLength(1);
    });

    it('handles trailing empty lines', () => {
      const csv = makeCsv(VALID_ROW) + '\r\n\r\n';
      const records = parseTrafficCsv(csv);

      expect(records).toHaveLength(1);
    });

    it('returns a frozen (readonly) array', () => {
      const records = parseTrafficCsv(makeCsv(VALID_ROW));

      expect(Object.isFrozen(records)).toBe(true);
    });

    it('parses Saturation_Score of 0.0 and 1.0', () => {
      const row0 = '2026/5/20 17:00,RD_TPE_001,忠孝東路四段,42,1250,0,Normal';
      const row1 = '2026/5/20 22:10,RD_TPE_002,光復南路,0,0,1,Critical';
      const records = parseTrafficCsv(makeCsv(row0, row1));

      expect(records[0].Saturation_Score).toBe(0);
      expect(records[1].Saturation_Score).toBe(1);
    });
  });

  describe('malformed input', () => {
    it('throws EMPTY_DATA for empty string', () => {
      expect(() => parseTrafficCsv('')).toThrow(TrafficParseError);
      try {
        parseTrafficCsv('');
      } catch (e) {
        expect(e).toBeInstanceOf(TrafficParseError);
        expect((e as TrafficParseError).code).toBe('EMPTY_DATA');
      }
    });

    it('throws EMPTY_DATA for header-only CSV', () => {
      expect(() => parseTrafficCsv(HEADER)).toThrow(TrafficParseError);
      try {
        parseTrafficCsv(HEADER);
      } catch (e) {
        expect((e as TrafficParseError).code).toBe('EMPTY_DATA');
      }
    });

    it('throws SCHEMA_MISMATCH for wrong column count in header', () => {
      const badHeader = 'Timestamp,Segment_ID,Road_Name';
      expect(() => parseTrafficCsv(badHeader + '\n' + VALID_ROW)).toThrow(TrafficParseError);
      try {
        parseTrafficCsv(badHeader + '\n' + VALID_ROW);
      } catch (e) {
        expect((e as TrafficParseError).code).toBe('SCHEMA_MISMATCH');
      }
    });

    it('throws SCHEMA_MISMATCH for wrong column names', () => {
      const badHeader = 'Time,Seg_ID,Road,Speed,Count,Score,Status';
      expect(() => parseTrafficCsv(badHeader + '\n' + VALID_ROW)).toThrow(TrafficParseError);
      try {
        parseTrafficCsv(badHeader + '\n' + VALID_ROW);
      } catch (e) {
        expect((e as TrafficParseError).code).toBe('SCHEMA_MISMATCH');
      }
    });

    it('throws INVALID_ROW for a row with wrong field count', () => {
      const badRow = '2026/5/20 17:00,RD_TPE_001,忠孝東路四段,42,1250';
      expect(() => parseTrafficCsv(makeCsv(badRow))).toThrow(TrafficParseError);
      try {
        parseTrafficCsv(makeCsv(badRow));
      } catch (e) {
        expect((e as TrafficParseError).code).toBe('INVALID_ROW');
      }
    });

    it('throws INVALID_ROW for non-numeric Avg_Speed', () => {
      const row = '2026/5/20 17:00,RD_TPE_001,忠孝東路四段,abc,1250,0.58,Normal';
      expect(() => parseTrafficCsv(makeCsv(row))).toThrow(TrafficParseError);
      try {
        parseTrafficCsv(makeCsv(row));
      } catch (e) {
        expect((e as TrafficParseError).code).toBe('INVALID_ROW');
        expect((e as TrafficParseError).details?.field).toBe('Avg_Speed');
      }
    });

    it('throws INVALID_ROW for non-integer Vehicle_Count', () => {
      const row = '2026/5/20 17:00,RD_TPE_001,忠孝東路四段,42,abc,0.58,Normal';
      expect(() => parseTrafficCsv(makeCsv(row))).toThrow(TrafficParseError);
      try {
        parseTrafficCsv(makeCsv(row));
      } catch (e) {
        expect((e as TrafficParseError).code).toBe('INVALID_ROW');
        expect((e as TrafficParseError).details?.field).toBe('Vehicle_Count');
      }
    });

    it('throws INVALID_ROW for Saturation_Score out of range (> 1)', () => {
      const row = '2026/5/20 17:00,RD_TPE_001,忠孝東路四段,42,1250,1.5,Normal';
      expect(() => parseTrafficCsv(makeCsv(row))).toThrow(TrafficParseError);
      try {
        parseTrafficCsv(makeCsv(row));
      } catch (e) {
        expect((e as TrafficParseError).code).toBe('INVALID_ROW');
        expect((e as TrafficParseError).details?.field).toBe('Saturation_Score');
      }
    });

    it('throws INVALID_ROW for Saturation_Score out of range (< 0)', () => {
      const row = '2026/5/20 17:00,RD_TPE_001,忠孝東路四段,42,1250,-0.1,Normal';
      expect(() => parseTrafficCsv(makeCsv(row))).toThrow(TrafficParseError);
      try {
        parseTrafficCsv(makeCsv(row));
      } catch (e) {
        expect((e as TrafficParseError).code).toBe('INVALID_ROW');
        expect((e as TrafficParseError).details?.field).toBe('Saturation_Score');
      }
    });

    it('throws INVALID_ROW for invalid Lane_Status', () => {
      const row = '2026/5/20 17:00,RD_TPE_001,忠孝東路四段,42,1250,0.58,Unknown';
      expect(() => parseTrafficCsv(makeCsv(row))).toThrow(TrafficParseError);
      try {
        parseTrafficCsv(makeCsv(row));
      } catch (e) {
        expect((e as TrafficParseError).code).toBe('INVALID_ROW');
        expect((e as TrafficParseError).details?.field).toBe('Lane_Status');
      }
    });

    it('throws INVALID_ROW for empty Segment_ID', () => {
      const row = '2026/5/20 17:00,,忠孝東路四段,42,1250,0.58,Normal';
      expect(() => parseTrafficCsv(makeCsv(row))).toThrow(TrafficParseError);
      try {
        parseTrafficCsv(makeCsv(row));
      } catch (e) {
        expect((e as TrafficParseError).code).toBe('INVALID_ROW');
        expect((e as TrafficParseError).details?.field).toBe('Segment_ID');
      }
    });

    it('throws INVALID_ROW for non-numeric Saturation_Score', () => {
      const row = '2026/5/20 17:00,RD_TPE_001,忠孝東路四段,42,1250,high,Normal';
      expect(() => parseTrafficCsv(makeCsv(row))).toThrow(TrafficParseError);
      try {
        parseTrafficCsv(makeCsv(row));
      } catch (e) {
        expect((e as TrafficParseError).code).toBe('INVALID_ROW');
        expect((e as TrafficParseError).details?.field).toBe('Saturation_Score');
      }
    });
  });

  describe('official data integration', () => {
    it('parses the actual city_traffic_flow.csv (all 15 segments present)', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const csvPath = path.resolve(
        __dirname,
        '../../../../中華電信資料集/city_traffic_flow.csv',
      );
      const content = fs.readFileSync(csvPath, 'utf-8');
      const records = parseTrafficCsv(content);

      // Should have data rows
      expect(records.length).toBeGreaterThan(0);

      // All 15 segments should be present
      const segmentIds = new Set(records.map((r) => r.Segment_ID));
      expect(segmentIds.size).toBe(15);

      // Verify all expected segment IDs
      for (let i = 1; i <= 15; i++) {
        const id = `RD_TPE_${String(i).padStart(3, '0')}`;
        expect(segmentIds.has(id)).toBe(true);
      }

      // Verify all Saturation_Score values are in [0, 1]
      for (const record of records) {
        expect(record.Saturation_Score).toBeGreaterThanOrEqual(0);
        expect(record.Saturation_Score).toBeLessThanOrEqual(1);
      }

      // Verify timestamp_raw is preserved verbatim (spot check first row)
      expect(records[0].timestamp_raw).toBe('2026/5/20 17:00');
    });
  });
});
