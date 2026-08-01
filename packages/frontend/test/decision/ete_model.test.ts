/**
 * ETE boundary decoder tests (TASK-131).
 *
 * Covers the §10.9 decode contract across all three documented spellings of the
 * per-road readings, the insufficient-common-snapshot state, the rule that no
 * operand is ever computed client-side, and the role-resolution provenance.
 */

import { describe, expect, it } from 'vitest';
import {
  decodeEte,
  eteSubstitution,
  isCalculated,
  isInsufficientCommonSnapshot,
  resolveAffectedRoles,
} from '../../src/decision/ete_model.js';
import type { EteView } from '../../src/decision/ete_model.js';
import { eteViewOf } from '../../src/decision/use_ete_view.js';
import { coreView, wireEte } from './fixtures.js';

const INSUFFICIENT_ETE = {
  calculation_status: 'insufficient_common_snapshot',
  ete_minutes: null,
  ete_lower_bound_minutes: 60,
  congestion_penalty: null,
  avg_saturation: null,
  manual_confirmation_required: true,
  lower_bound_only: true,
  snapshot_provenance: {
    selection_status: 'insufficient_common_snapshot',
    event_timestamp: '2026-05-20 22:10',
    common_snapshot_timestamp: null,
    readings: [],
  },
};

function decode(overrides: Record<string, unknown> = {}): EteView {
  const result = decodeEte(wireEte(overrides));
  if (!result.ok) throw new Error(`unexpected decode failure: ${result.error.code}`);
  return result.ete;
}

describe('decodeEte — live wire shape', () => {
  it('reads the ACC_001 computed result verbatim', () => {
    const ete = decode();

    expect(ete.severity).toBe('Critical');
    expect(ete.baseClearance).toBe(60);
    expect(ete.avgSaturation).toBe(0.81);
    expect(ete.congestionPenalty).toBe(18.6);
    expect(ete.eteMinutes).toBe(78.6);
    expect(ete.calculationStatus).toBe('computed');
    expect(ete.manualConfirmationRequired).toBe(false);
    expect(ete.eteSnapshotTimestamp).toBe('2026-05-20 22:00');
    expect(ete.eventTimestamp).toBe('2026-05-20 22:10');
    expect(ete.snapshotSelectionStatus).toBe('common_exact_snapshot');
  });

  it('reports saturation_sum and road_count as not supplied rather than deriving them', () => {
    const ete = decode();

    expect(ete.saturationSum).toBeNull();
    // Three roads are listed in affected_set, yet road_count stays null: the
    // formula operand is not counted client-side.
    expect(ete.affectedSet).toHaveLength(3);
    expect(ete.roadCount).toBeNull();
  });

  it('reports the HG-001 fields absent from the live wire as not supplied', () => {
    const ete = decode();

    expect(ete.policyMode).toBeNull();
    expect(ete.snapshotMode).toBeNull();
    expect(ete.guidanceId).toBeNull();
  });

  it('reads snapshot_provenance.readings as the per-road inputs', () => {
    const ete = decode();

    expect(ete.saturationInputs).toEqual([
      {
        segmentId: 'RD_TPE_002',
        role: null,
        saturation: 1.0,
        timestamp: '2026-05-20 22:00',
      },
      {
        segmentId: 'RD_TPE_004',
        role: null,
        saturation: 0.78,
        timestamp: '2026-05-20 22:00',
      },
      {
        segmentId: 'RD_TPE_005',
        role: null,
        saturation: 0.65,
        timestamp: '2026-05-20 22:00',
      },
    ]);
  });

  it('does not assign roles from affected_set order', () => {
    const ete = decode();

    expect(ete.affectedSet.map((member) => member.role)).toEqual([null, null, null]);
  });
});

describe('decodeEte — documented spellings', () => {
  it('reads the design §10.9 affected_set with roles', () => {
    const ete = decode({
      affected_set: [
        { segment_id: 'RD_TPE_002', role: 'INCIDENT' },
        { segment_id: 'RD_TPE_004', role: 'PRIMARY' },
        { segment_id: 'RD_TPE_005', role: 'SECONDARY' },
      ],
    });

    expect(ete.affectedSet).toEqual([
      { segmentId: 'RD_TPE_002', role: 'INCIDENT' },
      { segmentId: 'RD_TPE_004', role: 'PRIMARY' },
      { segmentId: 'RD_TPE_005', role: 'SECONDARY' },
    ]);
  });

  it('reads the design §10.9 saturation_inputs objects, overriding readings', () => {
    const ete = decode({
      saturation_inputs: [
        {
          segment_id: 'RD_TPE_002',
          role: 'INCIDENT',
          saturation: 1.0,
          timestamp: '2026-05-20 22:00',
        },
      ],
    });

    expect(ete.saturationInputs).toEqual([
      { segmentId: 'RD_TPE_002', role: 'INCIDENT', saturation: 1.0, timestamp: '2026-05-20 22:00' },
    ]);
  });

  it('reads the design §12 bare-number saturation_inputs without matching positions', () => {
    const ete = decode({ saturation_inputs: [1.0, 0.78, 0.65] });

    expect(ete.saturationInputs).toEqual([
      { segmentId: null, role: null, saturation: 1.0, timestamp: null },
      { segmentId: null, role: null, saturation: 0.78, timestamp: null },
      { segmentId: null, role: null, saturation: 0.65, timestamp: null },
    ]);
  });

  it('prefers ete_snapshot_timestamp when the design spelling is present', () => {
    const ete = decode({ ete_snapshot_timestamp: '2026-05-20 21:30' });

    expect(ete.eteSnapshotTimestamp).toBe('2026-05-20 21:30');
  });

  it('accepts basis_note and applicability_note as the same basis text', () => {
    expect(decode({ basis_note: 'HG-001 依據' }).basisNote).toBe('HG-001 依據');
    expect(decode().basisNote).toContain('HG-001 organizer-guided set');
  });

  it('recognizes both spellings of each calculation status', () => {
    expect(isCalculated('computed')).toBe(true);
    expect(isCalculated('CALCULATED')).toBe(true);
    expect(isInsufficientCommonSnapshot('insufficient_common_snapshot')).toBe(true);
    expect(isInsufficientCommonSnapshot('INSUFFICIENT_COMMON_SNAPSHOT')).toBe(true);
    expect(isInsufficientCommonSnapshot('computed')).toBe(false);
  });
});

describe('decodeEte — failure modes', () => {
  it('rejects a non-object block', () => {
    const result = decodeEte(null);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_AN_OBJECT');
  });

  it('rejects a malformed affected_set element', () => {
    const result = decodeEte(wireEte({ affected_set: [{ role: 'INCIDENT' }] }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_AFFECTED_SET');
  });

  it('rejects malformed readings', () => {
    const result = decodeEte(
      wireEte({
        snapshot_provenance: {
          selection_status: 'common_exact_snapshot',
          event_timestamp: '2026-05-20 22:10',
          common_snapshot_timestamp: '2026-05-20 22:00',
          readings: [{ road_id: 'RD_TPE_002', saturation_score: 'high' }],
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_SNAPSHOT_PROVENANCE');
  });

  it('rejects a string ete_minutes rather than coercing it', () => {
    const result = decodeEte(wireEte({ ete_minutes: '78.6' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_ETE_FIELD');
  });
});

describe('decodeEte — insufficient common snapshot (R12.8)', () => {
  it('keeps ete_minutes null and carries the lower bound', () => {
    const ete = decode(INSUFFICIENT_ETE);

    expect(ete.eteMinutes).toBeNull();
    expect(ete.eteLowerBoundMinutes).toBe(60);
    expect(ete.congestionPenalty).toBeNull();
    expect(ete.avgSaturation).toBeNull();
    expect(ete.manualConfirmationRequired).toBe(true);
    expect(ete.eteSnapshotTimestamp).toBeNull();
    expect(isInsufficientCommonSnapshot(ete.calculationStatus)).toBe(true);
  });

  it('produces no formula substitution at all', () => {
    expect(eteSubstitution(decode(INSUFFICIENT_ETE), 'missing')).toBeNull();
  });

  it('produces no substitution when the status is computed but the value is absent', () => {
    expect(eteSubstitution(decode({ ete_minutes: null }), 'missing')).toBeNull();
  });
});

describe('eteSubstitution — formatting only', () => {
  it('writes the backend operands into the art.7 formulas', () => {
    const substitution = eteSubstitution(
      decode({ saturation_sum: 2.43, road_count: 3 }),
      'missing',
    );

    expect(substitution).not.toBeNull();
    expect(substitution?.average.substituted).toBe('2.43 / 3');
    expect(substitution?.average.result).toBe('0.81');
    expect(substitution?.penalty.substituted).toBe('max(0, (0.81 - 0.5) * 60)');
    expect(substitution?.penalty.result).toBe('18.6');
    expect(substitution?.ete.substituted).toBe('60 + 18.6');
    expect(substitution?.ete.result).toBe('78.6');
  });

  it('marks a missing operand instead of back-computing it', () => {
    // The live wire supplies no sum/count, so the average line must show the
    // gap next to the backend's own average.
    const substitution = eteSubstitution(decode(), '未提供');

    expect(substitution?.average.substituted).toBe('未提供 / 未提供');
    expect(substitution?.average.result).toBe('0.81');
  });

  it('displays the backend average even when the readings would average differently', () => {
    const substitution = eteSubstitution(decode({ avg_saturation: 0.42 }), '未提供');

    // readings are 1.00 / 0.78 / 0.65 (mean 0.81); the backend said 0.42.
    expect(substitution?.average.result).toBe('0.42');
    expect(substitution?.penalty.substituted).toBe('max(0, (0.42 - 0.5) * 60)');
  });
});

describe('resolveAffectedRoles', () => {
  it('prefers the role on ete.affected_set and records its source', () => {
    const rows = resolveAffectedRoles(
      [{ segmentId: 'RD_TPE_002', role: 'INCIDENT' }],
      [{ segmentId: 'RD_TPE_002', role: 'PRIMARY', included: true, reason: null }],
    );

    expect(rows).toEqual([
      { segmentId: 'RD_TPE_002', role: 'INCIDENT', roleSource: 'ete.affected_set' },
    ]);
  });

  it('falls back to the evidence block by segment id', () => {
    const rows = resolveAffectedRoles(
      [{ segmentId: 'RD_TPE_004', role: null }],
      [{ segmentId: 'RD_TPE_004', role: 'PRIMARY', included: true, reason: 'selected primary' }],
    );

    expect(rows).toEqual([
      {
        segmentId: 'RD_TPE_004',
        role: 'PRIMARY',
        roleSource: 'evidence.affected_set_construction',
      },
    ]);
  });

  it('leaves the role unknown when neither block supplies one', () => {
    const rows = resolveAffectedRoles(
      [
        { segmentId: 'RD_TPE_002', role: null },
        { segmentId: 'RD_TPE_004', role: null },
      ],
      null,
    );

    expect(rows).toEqual([
      { segmentId: 'RD_TPE_002', role: null, roleSource: null },
      { segmentId: 'RD_TPE_004', role: null, roleSource: null },
    ]);
  });
});

describe('eteViewOf', () => {
  it('reports an absent core distinctly', () => {
    expect(eteViewOf(null)).toEqual({ kind: 'absent' });
  });

  it('reports a core without an ete block as not applicable', () => {
    expect(eteViewOf(coreView({ ete: null }))).toEqual({ kind: 'not_applicable' });
  });

  it('wraps a successful decode', () => {
    expect(eteViewOf(coreView()).kind).toBe('ok');
  });

  it('wraps a decode failure the envelope decoder does not cover', () => {
    // TASK-132 validates only the five summary fields it renders, so a
    // malformed `affected_set` reaches this decoder intact.
    const result = eteViewOf(coreView({ ete: wireEte({ affected_set: [{ role: 'INCIDENT' }] }) }));

    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.error.code).toBe('INVALID_AFFECTED_SET');
  });
});
