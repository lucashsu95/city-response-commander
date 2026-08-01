/**
 * Whitelist_Guard tests (spec: boundary-snapping-containment, R9 AC1, R14.5).
 */
import * as fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { partitionByWhitelist, extractRoadIdLike } from '../../src/boundary/whitelist_guard.js';

describe('partitionByWhitelist', () => {
  it('puts whitelisted ids in allowed and the rest in rejected', () => {
    const whitelist = new Set(['RD_TPE_001', 'RD_TPE_002']);
    const result = partitionByWhitelist(['RD_TPE_001', 'RD_TPE_099', 'RD_TPE_002'], whitelist);
    expect(result.allowed).toEqual(new Set(['RD_TPE_001', 'RD_TPE_002']));
    expect(result.rejected).toEqual(new Set(['RD_TPE_099']));
  });

  it('returns empty sets for an empty candidate list', () => {
    const result = partitionByWhitelist([], new Set(['RD_TPE_001']));
    expect(result.allowed.size).toBe(0);
    expect(result.rejected.size).toBe(0);
  });

  it('rejects everything against an empty whitelist', () => {
    const result = partitionByWhitelist(['RD_TPE_001', 'RD_TPE_002'], new Set());
    expect(result.allowed.size).toBe(0);
    expect(result.rejected).toEqual(new Set(['RD_TPE_001', 'RD_TPE_002']));
  });

  describe('R14.5 property — partition covers the input with no overlap', () => {
    it('allowed ∪ rejected == candidateIds (as sets) and allowed ∩ rejected == ∅, for arbitrary inputs', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 0, maxLength: 12 })),
          fc.array(fc.string({ minLength: 0, maxLength: 12 })),
          (candidateIds, whitelistArray) => {
            const whitelist = new Set(whitelistArray);
            const result = partitionByWhitelist(candidateIds, whitelist);

            // No overlap.
            for (const id of result.allowed) {
              expect(result.rejected.has(id)).toBe(false);
            }

            // Union equals the input set.
            const union = new Set([...result.allowed, ...result.rejected]);
            expect(union).toEqual(new Set(candidateIds));

            // Every allowed id is genuinely in the whitelist; every rejected id is not.
            for (const id of result.allowed) expect(whitelist.has(id)).toBe(true);
            for (const id of result.rejected) expect(whitelist.has(id)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('purity / determinism', () => {
    it('returns equal results for repeated calls with the same input', () => {
      const whitelist = new Set(['RD_TPE_001']);
      const first = partitionByWhitelist(['RD_TPE_001', 'RD_TPE_002'], whitelist);
      const second = partitionByWhitelist(['RD_TPE_001', 'RD_TPE_002'], whitelist);
      expect(first).toEqual(second);
    });
  });
});

describe('extractRoadIdLike', () => {
  it('finds a single road id embedded in a mixed Chinese/English sentence', () => {
    expect(extractRoadIdLike('請改道 RD_TPE_004，預計延誤 90 分鐘')).toEqual(['RD_TPE_004']);
  });

  it('finds multiple road ids in one sentence, in order', () => {
    expect(
      extractRoadIdLike('建議調度 RD_TPE_009 與 RD_TPE_003 進行分流，並封鎖 RD_TPE_001'),
    ).toEqual(['RD_TPE_009', 'RD_TPE_003', 'RD_TPE_001']);
  });

  it('returns an empty array when there is no road-id-shaped substring', () => {
    expect(extractRoadIdLike('本區域無可用替代道路，建議維持現況')).toEqual([]);
  });

  it('does not match a bare prefix with no trailing digits', () => {
    expect(extractRoadIdLike('請洽詢 RD_TPE_ 服務台')).toEqual([]);
  });

  it('does not match unrelated ids such as BS_ station ids', () => {
    expect(extractRoadIdLike('BS_MRT_BL17 人流已達門檻')).toEqual([]);
  });
});
