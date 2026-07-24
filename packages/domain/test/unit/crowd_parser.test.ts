import { describe, it, expect } from 'vitest';
import { parseCrowdCsv, CrowdParseError } from '../../src/ingestion/crowd_parser.js';

const HEADER = 'Timestamp,BS_ID,Location_Name,User_Count,Stay_Time_Avg,Growth_Rate,Roaming_User_Pct';
const VALID_ROW = '2026/5/20 17:00,BS_TPE_DOME,大巨蛋場館內,15000,45,0.05,5%';

function makeCsv(...rows: string[]): string {
  return [HEADER, ...rows].join('\r\n');
}

describe('parseCrowdCsv', () => {
  describe('well-formed input', () => {
    it('parses a single valid row', () => {
      const csv = makeCsv(VALID_ROW);
      const records = parseCrowdCsv(csv);

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        timestamp_raw: '2026/5/20 17:00',
        BS_ID: 'BS_TPE_DOME',
        Location_Name: '大巨蛋場館內',
        User_Count: 15000,
        Stay_Time_Avg: 45,
        Growth_Rate: 0.05,
        Roaming_User_Pct: '5%',
        roaming_pct_value: 0.05,
      });
    });

    it('handles BOM character at the start of file', () => {
      const csv = '\uFEFF' + makeCsv(VALID_ROW);
      const records = parseCrowdCsv(csv);

      expect(records).toHaveLength(1);
      expect(records[0].BS_ID).toBe('BS_TPE_DOME');
    });

    it('preserves timestamp_raw verbatim', () => {
      const rawTimestamp = '2026/5/20 18:00';
      const row = `${rawTimestamp},BS_MRT_BL17,捷運國父紀念館站,8500,20,0.88,8%`;
      const records = parseCrowdCsv(makeCsv(row));

      expect(records[0].timestamp_raw).toBe(rawTimestamp);
    });

    it('preserves Roaming_User_Pct original string immutably', () => {
      const row = '2026/5/20 17:00,BS_TPE_DOME,大巨蛋場館內,15000,45,0.05,5%';
      const records = parseCrowdCsv(makeCsv(row));

      expect(records[0].Roaming_User_Pct).toBe('5%');
    });

    it('parses roaming_pct_value correctly for "5%"', () => {
      const row = '2026/5/20 17:00,BS_TPE_DOME,大巨蛋場館內,15000,45,0.05,5%';
      const records = parseCrowdCsv(makeCsv(row));

      expect(records[0].roaming_pct_value).toBe(0.05);
    });

    it('parses roaming_pct_value correctly for "30%"', () => {
      const row = '2026/5/20 20:00,BS_TPE_101,台北101廣場,9500,85,0.15,30%';
      const records = parseCrowdCsv(makeCsv(row));

      expect(records[0].roaming_pct_value).toBeCloseTo(0.30, 10);
    });

    it('parses roaming_pct_value correctly for "45%"', () => {
      const row = '2026/5/20 21:00,BS_TPE_101,台北101廣場,10500,90,0.10,45%';
      const records = parseCrowdCsv(makeCsv(row));

      expect(records[0].roaming_pct_value).toBeCloseTo(0.45, 10);
    });

    it('parses roaming_pct_value correctly for "8%"', () => {
      const row = '2026/5/20 18:00,BS_MRT_BL17,捷運國父紀念館站,8500,20,0.88,8%';
      const records = parseCrowdCsv(makeCsv(row));

      expect(records[0].roaming_pct_value).toBeCloseTo(0.08, 10);
    });

    it('parses roaming_pct_value correctly for "40%"', () => {
      const row = '2026/5/20 20:00,BS_TPE_101,台北101廣場,9500,85,0.15,40%';
      const records = parseCrowdCsv(makeCsv(row));

      expect(records[0].roaming_pct_value).toBeCloseTo(0.40, 10);
    });

    it('parses multiple rows', () => {
      const rows = [
        '2026/5/20 17:00,BS_TPE_DOME,大巨蛋場館內,15000,45,0.05,5%',
        '2026/5/20 18:00,BS_MRT_BL17,捷運國父紀念館站,8500,20,0.88,8%',
        '2026/5/20 20:00,BS_TPE_101,台北101廣場,9500,85,0.15,40%',
      ];
      const records = parseCrowdCsv(makeCsv(...rows));

      expect(records).toHaveLength(3);
      expect(records[0].BS_ID).toBe('BS_TPE_DOME');
      expect(records[1].BS_ID).toBe('BS_MRT_BL17');
      expect(records[2].BS_ID).toBe('BS_TPE_101');
    });

    it('validates User_Count is parsed as integer', () => {
      const row = '2026/5/20 17:00,BS_TPE_DOME,大巨蛋場館內,15000,45,0.05,5%';
      const records = parseCrowdCsv(makeCsv(row));

      expect(Number.isInteger(records[0].User_Count)).toBe(true);
      expect(records[0].User_Count).toBe(15000);
    });

    it('validates Growth_Rate is parsed as number', () => {
      const row = '2026/5/20 18:00,BS_MRT_BL17,捷運國父紀念館站,8500,20,0.88,8%';
      const records = parseCrowdCsv(makeCsv(row));

      expect(typeof records[0].Growth_Rate).toBe('number');
      expect(records[0].Growth_Rate).toBeCloseTo(0.88, 10);
    });

    it('handles LF line endings (no CR)', () => {
      const csv = [HEADER, VALID_ROW].join('\n');
      const records = parseCrowdCsv(csv);

      expect(records).toHaveLength(1);
    });

    it('handles trailing empty lines', () => {
      const csv = makeCsv(VALID_ROW) + '\r\n\r\n';
      const records = parseCrowdCsv(csv);

      expect(records).toHaveLength(1);
    });

    it('returns a frozen (readonly) array', () => {
      const records = parseCrowdCsv(makeCsv(VALID_ROW));

      expect(Object.isFrozen(records)).toBe(true);
    });

    it('preserves original Roaming_User_Pct while deriving roaming_pct_value', () => {
      const row = '2026/5/20 20:00,BS_TPE_101,台北101廣場,9500,85,0.15,40%';
      const records = parseCrowdCsv(makeCsv(row));

      // Original string preserved
      expect(records[0].Roaming_User_Pct).toBe('40%');
      // Derived normalized value
      expect(records[0].roaming_pct_value).toBeCloseTo(0.40, 10);
    });

    it('handles negative Growth_Rate', () => {
      const row = '2026/5/20 22:00,BS_TPE_DOME,大巨蛋場館內,28000,30,-0.31,5%';
      const records = parseCrowdCsv(makeCsv(row));

      expect(records[0].Growth_Rate).toBeCloseTo(-0.31, 10);
    });
  });

  describe('malformed input', () => {
    it('throws EMPTY_DATA for empty string', () => {
      expect(() => parseCrowdCsv('')).toThrow(CrowdParseError);
      try {
        parseCrowdCsv('');
      } catch (e) {
        expect(e).toBeInstanceOf(CrowdParseError);
        expect((e as CrowdParseError).code).toBe('EMPTY_DATA');
      }
    });

    it('throws EMPTY_DATA for header-only CSV', () => {
      expect(() => parseCrowdCsv(HEADER)).toThrow(CrowdParseError);
      try {
        parseCrowdCsv(HEADER);
      } catch (e) {
        expect((e as CrowdParseError).code).toBe('EMPTY_DATA');
      }
    });

    it('throws SCHEMA_MISMATCH for wrong column count in header', () => {
      const badHeader = 'Timestamp,BS_ID,Location_Name';
      expect(() => parseCrowdCsv(badHeader + '\n' + VALID_ROW)).toThrow(CrowdParseError);
      try {
        parseCrowdCsv(badHeader + '\n' + VALID_ROW);
      } catch (e) {
        expect((e as CrowdParseError).code).toBe('SCHEMA_MISMATCH');
      }
    });

    it('throws SCHEMA_MISMATCH for wrong column names', () => {
      const badHeader = 'Time,Station_ID,Place,Count,Stay,Growth,Roaming';
      expect(() => parseCrowdCsv(badHeader + '\n' + VALID_ROW)).toThrow(CrowdParseError);
      try {
        parseCrowdCsv(badHeader + '\n' + VALID_ROW);
      } catch (e) {
        expect((e as CrowdParseError).code).toBe('SCHEMA_MISMATCH');
      }
    });

    it('throws INVALID_ROW for a row with wrong field count', () => {
      const badRow = '2026/5/20 17:00,BS_TPE_DOME,大巨蛋場館內,15000,45';
      expect(() => parseCrowdCsv(makeCsv(badRow))).toThrow(CrowdParseError);
      try {
        parseCrowdCsv(makeCsv(badRow));
      } catch (e) {
        expect((e as CrowdParseError).code).toBe('INVALID_ROW');
      }
    });

    it('throws INVALID_ROW for non-integer User_Count', () => {
      const row = '2026/5/20 17:00,BS_TPE_DOME,大巨蛋場館內,abc,45,0.05,5%';
      expect(() => parseCrowdCsv(makeCsv(row))).toThrow(CrowdParseError);
      try {
        parseCrowdCsv(makeCsv(row));
      } catch (e) {
        expect((e as CrowdParseError).code).toBe('INVALID_ROW');
        expect((e as CrowdParseError).details?.field).toBe('User_Count');
      }
    });

    it('throws INVALID_ROW for non-numeric Growth_Rate', () => {
      const row = '2026/5/20 17:00,BS_TPE_DOME,大巨蛋場館內,15000,45,high,5%';
      expect(() => parseCrowdCsv(makeCsv(row))).toThrow(CrowdParseError);
      try {
        parseCrowdCsv(makeCsv(row));
      } catch (e) {
        expect((e as CrowdParseError).code).toBe('INVALID_ROW');
        expect((e as CrowdParseError).details?.field).toBe('Growth_Rate');
      }
    });

    it('throws INVALID_ROW for non-numeric Stay_Time_Avg', () => {
      const row = '2026/5/20 17:00,BS_TPE_DOME,大巨蛋場館內,15000,xyz,0.05,5%';
      expect(() => parseCrowdCsv(makeCsv(row))).toThrow(CrowdParseError);
      try {
        parseCrowdCsv(makeCsv(row));
      } catch (e) {
        expect((e as CrowdParseError).code).toBe('INVALID_ROW');
        expect((e as CrowdParseError).details?.field).toBe('Stay_Time_Avg');
      }
    });

    it('throws PERCENT_PARSE_ERROR for unparseable Roaming_User_Pct (no %)', () => {
      const row = '2026/5/20 17:00,BS_TPE_DOME,大巨蛋場館內,15000,45,0.05,thirty';
      expect(() => parseCrowdCsv(makeCsv(row))).toThrow(CrowdParseError);
      try {
        parseCrowdCsv(makeCsv(row));
      } catch (e) {
        expect((e as CrowdParseError).code).toBe('PERCENT_PARSE_ERROR');
        expect((e as CrowdParseError).details?.field).toBe('Roaming_User_Pct');
      }
    });

    it('throws PERCENT_PARSE_ERROR for non-numeric percent', () => {
      const row = '2026/5/20 17:00,BS_TPE_DOME,大巨蛋場館內,15000,45,0.05,abc%';
      expect(() => parseCrowdCsv(makeCsv(row))).toThrow(CrowdParseError);
      try {
        parseCrowdCsv(makeCsv(row));
      } catch (e) {
        expect((e as CrowdParseError).code).toBe('PERCENT_PARSE_ERROR');
        expect((e as CrowdParseError).details?.field).toBe('Roaming_User_Pct');
      }
    });

    it('throws INVALID_ROW for empty BS_ID', () => {
      const row = '2026/5/20 17:00,,大巨蛋場館內,15000,45,0.05,5%';
      expect(() => parseCrowdCsv(makeCsv(row))).toThrow(CrowdParseError);
      try {
        parseCrowdCsv(makeCsv(row));
      } catch (e) {
        expect((e as CrowdParseError).code).toBe('INVALID_ROW');
        expect((e as CrowdParseError).details?.field).toBe('BS_ID');
      }
    });

    it('throws INVALID_ROW for empty Location_Name', () => {
      const row = '2026/5/20 17:00,BS_TPE_DOME,,15000,45,0.05,5%';
      expect(() => parseCrowdCsv(makeCsv(row))).toThrow(CrowdParseError);
      try {
        parseCrowdCsv(makeCsv(row));
      } catch (e) {
        expect((e as CrowdParseError).code).toBe('INVALID_ROW');
        expect((e as CrowdParseError).details?.field).toBe('Location_Name');
      }
    });
  });

  describe('official data integration', () => {
    it('parses the actual signaling_crowd_density.csv', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const csvPath = path.resolve(
        __dirname,
        '../../../../中華電信資料集/signaling_crowd_density.csv',
      );
      const content = fs.readFileSync(csvPath, 'utf-8');
      const records = parseCrowdCsv(content);

      // Should have data rows
      expect(records.length).toBeGreaterThan(0);

      // Verify roaming_pct_value for all rows
      for (const record of records) {
        expect(record.roaming_pct_value).toBeGreaterThanOrEqual(0);
        expect(record.roaming_pct_value).toBeLessThanOrEqual(1);
        // Original string should be preserved
        expect(record.Roaming_User_Pct).toContain('%');
      }

      // Verify User_Count is integer for all rows
      for (const record of records) {
        expect(Number.isInteger(record.User_Count)).toBe(true);
      }

      // Verify Growth_Rate is a number for all rows
      for (const record of records) {
        expect(typeof record.Growth_Rate).toBe('number');
        expect(isNaN(record.Growth_Rate)).toBe(false);
      }

      // Verify timestamp_raw is preserved verbatim (spot check first row)
      expect(records[0].timestamp_raw).toBe('2026/5/20 17:00');
    });
  });
});
