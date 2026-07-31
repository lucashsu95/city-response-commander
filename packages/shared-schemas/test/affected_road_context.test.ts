/**
 * Type/schema tests for AffectedRoadContext (§10.9b, §11.2, Strategy B / AffectedRoadStrategy output)
 *
 * Validates:
 * - AffectedRoadContext is exported and assignable with a realistic DISPLAY_AND_CONTEXT_ONLY example
 * - mandatory_action / enters_ete_set / triggers_article1_or_2 are literal `false`, at both type
 *   level and runtime (§10.9b hard rule: affected_road never mutates core numeric/boolean truth)
 * - role accepts 'DISPLAY_AND_CONTEXT_ONLY'
 * - the displayAndContextOnlyAffectedRoadContext factory produces the pinned shape
 */
import { describe, it, expect } from 'vitest';
import { displayAndContextOnlyAffectedRoadContext } from '../src/index.js';
import type { AffectedRoadContext } from '../src/index.js';

describe('shared-schemas AffectedRoadContext', () => {
  it('is exported and assignable with a realistic DISPLAY_AND_CONTEXT_ONLY example', () => {
    const context: AffectedRoadContext = {
      role: 'DISPLAY_AND_CONTEXT_ONLY',
      affected_road: 'RD_TPE_004',
      mandatory_action: false,
      enters_ete_set: false,
      triggers_article1_or_2: false,
      guidance_id: 'HG-001',
    };

    expect(context.affected_road).toBe('RD_TPE_004');
    expect(context.role).toBe('DISPLAY_AND_CONTEXT_ONLY');
    expect(context.mandatory_action).toBe(false);
    expect(context.enters_ete_set).toBe(false);
    expect(context.triggers_article1_or_2).toBe(false);
    expect(context.guidance_id).toBe('HG-001');
  });

  describe('DISPLAY_AND_CONTEXT_ONLY hard-rule flags', () => {
    const context = displayAndContextOnlyAffectedRoadContext('RD_TPE_004');

    it('are literal false at the type level, not widened to boolean', () => {
      // Compile-time: if these were typed as `boolean` instead of the
      // literal `false`, these assignments would fail to compile.
      const mandatoryActionCheck: false = context.mandatory_action;
      const entersEteSetCheck: false = context.enters_ete_set;
      const triggersArticleCheck: false = context.triggers_article1_or_2;

      expect(mandatoryActionCheck).toBe(false);
      expect(entersEteSetCheck).toBe(false);
      expect(triggersArticleCheck).toBe(false);
    });

    it('are false at runtime', () => {
      expect(context.mandatory_action).toBe(false);
      expect(context.enters_ete_set).toBe(false);
      expect(context.triggers_article1_or_2).toBe(false);
    });
  });

  describe('role', () => {
    it('accepts DISPLAY_AND_CONTEXT_ONLY', () => {
      const context: AffectedRoadContext = {
        role: 'DISPLAY_AND_CONTEXT_ONLY',
        affected_road: 'RD_TPE_004',
        mandatory_action: false,
        enters_ete_set: false,
        triggers_article1_or_2: false,
        guidance_id: 'HG-001',
      };
      expect(context.role).toBe('DISPLAY_AND_CONTEXT_ONLY');
    });
  });

  describe('displayAndContextOnlyAffectedRoadContext factory', () => {
    it('pins the DISPLAY_AND_CONTEXT_ONLY shape for a real affected_road string', () => {
      const context = displayAndContextOnlyAffectedRoadContext('RD_TPE_004');

      expect(context).toEqual({
        role: 'DISPLAY_AND_CONTEXT_ONLY',
        affected_road: 'RD_TPE_004',
        mandatory_action: false,
        enters_ete_set: false,
        triggers_article1_or_2: false,
        guidance_id: 'HG-001',
      });
    });

    it('pins the DISPLAY_AND_CONTEXT_ONLY shape when affected_road is null', () => {
      const context = displayAndContextOnlyAffectedRoadContext(null);

      expect(context).toEqual({
        role: 'DISPLAY_AND_CONTEXT_ONLY',
        affected_road: null,
        mandatory_action: false,
        enters_ete_set: false,
        triggers_article1_or_2: false,
        guidance_id: 'HG-001',
      });
    });
  });
});
