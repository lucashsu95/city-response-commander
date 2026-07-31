/**
 * Type/schema tests for AffectedRoadContext (§11.2, Strategy B / AffectedRoadStrategy output)
 *
 * Validates:
 * - AffectedRoadContext is exported and assignable with a realistic example
 * - triggers_article2 is literal false, at both type level and runtime
 *   (§11.2 Strategy B invariant: BS_ events' affected_road context can
 *   never trigger article 2)
 * - role accepts 'display_only'
 */
import { describe, it, expect } from 'vitest';
import type { AffectedRoadContext } from '../src/index.js';

describe('shared-schemas AffectedRoadContext', () => {
  it('is exported and assignable with a realistic example', () => {
    const context: AffectedRoadContext = {
      incident_event_id: 'TPE_2026_EVT_002',
      affected_road: 'RD_TPE_004',
      role: 'display_only',
      triggers_article2: false,
      included_in_ete: false,
      revalidated_article2_conditions: false,
    };

    expect(context.incident_event_id).toBe('TPE_2026_EVT_002');
    expect(context.affected_road).toBe('RD_TPE_004');
    expect(context.role).toBe('display_only');
    expect(context.included_in_ete).toBe(false);
    expect(context.revalidated_article2_conditions).toBe(false);
  });

  describe('triggers_article2 invariant', () => {
    const context: AffectedRoadContext = {
      incident_event_id: 'TPE_2026_EVT_002',
      affected_road: 'RD_TPE_004',
      role: 'display_only',
      triggers_article2: false,
      included_in_ete: false,
      revalidated_article2_conditions: false,
    };

    it('is literal false at the type level', () => {
      // Compile-time: triggers_article2 is typed as the literal `false`,
      // not `boolean` — this satisfies check fails to compile if the
      // type is ever widened.
      const check = context.triggers_article2 satisfies false;
      expect(check).toBe(false);
    });

    it('is false at runtime', () => {
      expect(context.triggers_article2).toBe(false);
    });
  });

  describe('role', () => {
    it('accepts display_only', () => {
      const context: AffectedRoadContext = {
        incident_event_id: 'TPE_2026_EVT_002',
        affected_road: 'RD_TPE_004',
        role: 'display_only',
        triggers_article2: false,
        included_in_ete: false,
        revalidated_article2_conditions: false,
      };
      expect(context.role).toBe('display_only');
    });
  });
});
