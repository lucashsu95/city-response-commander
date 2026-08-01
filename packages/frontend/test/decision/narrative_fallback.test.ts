/**
 * Deterministic narrative template tests (TASK-132, §21.3 / §14.4).
 *
 * The templates may only substitute values the backend already committed. These
 * tests pin the three rules: substitution only, a missing fact drops its clause
 * (and is disclosed), and an uncomputed ETE is never fabricated.
 */

import { describe, expect, it } from 'vitest';
import {
  buildPublicAlertTemplate,
  buildReportTemplate,
  fallbackLanguageFloor,
} from '../../src/decision/narrative_fallback.js';
import { coreView, wireEte } from './fixtures.js';

describe('fallbackLanguageFloor — §14.4 language floor from backend truth', () => {
  it('requires zh + en when the backend says multilingual is required', () => {
    expect(fallbackLanguageFloor(true)).toEqual(['zh', 'en']);
  });

  it('requires zh only when the backend says it is not required (R14.2)', () => {
    expect(fallbackLanguageFloor(false)).toEqual(['zh']);
  });

  it('requires zh only when the backend supplied no verdict', () => {
    expect(fallbackLanguageFloor(null)).toEqual(['zh']);
  });
});

describe('buildPublicAlertTemplate', () => {
  it('substitutes the committed deterministic facts (zh)', () => {
    const template = buildPublicAlertTemplate(coreView(), 'zh');

    expect(template.text).toBe(
      '2026-05-20 22:10 光復南路與忠孝東路口南側 Closed，建議改道 RD_TPE_004，預計延誤約 78.6 分鐘，請提前改道。',
    );
    expect(template.omittedFields).toEqual([]);
  });

  it('substitutes the committed deterministic facts (en)', () => {
    const template = buildPublicAlertTemplate(coreView(), 'en');

    expect(template.text).toContain('Detour via RD_TPE_004');
    expect(template.text).toContain('Est. delay ~78.6 min');
    expect(template.text).toContain('Please reroute early');
  });

  it('never invents an ETE: falls back to the known lower bound', () => {
    const template = buildPublicAlertTemplate(
      coreView({
        ete: wireEte({
          ete_minutes: null,
          ete_lower_bound_minutes: 60,
          congestion_penalty: null,
          avg_saturation: null,
          calculation_status: 'insufficient_common_snapshot',
          manual_confirmation_required: true,
          lower_bound_only: true,
        }),
      }),
      'zh',
    );

    expect(template.text).toContain('預計至少延誤 60 分鐘');
    expect(template.text).not.toContain('78.6');
    expect(template.omittedFields).toContain('ete.ete_minutes');
  });

  it('drops the delay clause entirely when no ETE fact exists at all', () => {
    const template = buildPublicAlertTemplate(coreView({ ete: null }), 'zh');

    expect(template.text).not.toContain('延誤');
    expect(template.omittedFields).toEqual(
      expect.arrayContaining(['ete.ete_minutes', 'ete.ete_lower_bound_minutes']),
    );
  });

  it('states an unresolved primary route instead of naming a road', () => {
    const template = buildPublicAlertTemplate(coreView({ primary_evacuation: null }), 'zh');

    expect(template.text).toContain('主疏散路徑尚未確定，需人工確認');
    expect(template.text).not.toContain('RD_TPE_004');
    expect(template.omittedFields).toContain('primary_evacuation');
  });

  it('drops the head clause and discloses it when event_facts is absent', () => {
    const template = buildPublicAlertTemplate(coreView({ event_facts: null }), 'zh');

    expect(template.text).not.toContain('光復南路');
    expect(template.omittedFields).toEqual(
      expect.arrayContaining(['event_facts.location', 'event_facts.status']),
    );
    // `occurred_at` is the same official event instant, so it still substitutes.
    expect(template.text).toContain('2026-05-20 22:10');
  });
});

describe('buildReportTemplate', () => {
  it('substitutes articles, routes and ETE from backend truth', () => {
    const template = buildReportTemplate(coreView());

    expect(template.text).toContain('事件 TPE_2026_ACC_001');
    expect(template.text).toContain('觸發 SOP 第 1、2 條');
    expect(template.text).toContain('套用第 7 條公式');
    expect(template.text).toContain('建議改道 RD_TPE_004');
    expect(template.text).toContain('次要疏散 RD_TPE_005');
    expect(template.text).toContain('預計延誤約 78.6 分鐘');
    expect(template.omittedFields).toEqual([]);
  });

  it('discloses an empty triggered-article set instead of inventing one', () => {
    const template = buildReportTemplate(coreView({ triggered_articles: [] }));

    expect(template.text).not.toContain('觸發 SOP 第');
    expect(template.omittedFields).toContain('triggered_articles');
  });

  it('never fabricates an ETE in the report template either', () => {
    const template = buildReportTemplate(
      coreView({
        ete: wireEte({
          ete_minutes: null,
          ete_lower_bound_minutes: 40,
          calculation_status: 'insufficient_common_snapshot',
        }),
      }),
    );

    expect(template.text).toContain('預計至少延誤 40 分鐘');
    expect(template.text).not.toContain('78.6');
  });
});
