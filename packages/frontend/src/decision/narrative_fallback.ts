/**
 * Deterministic Narrative Fallback Templates (§21.3, §14.4, R13/R14)
 *
 * TASK-132. When Bedrock has not written a narrative item yet — the normal
 * `data_status=partial` Fast Path state, or a Bedrock outage — the panels must
 * still show something truthful. §21.3 prescribes deterministic approved
 * templates for exactly this case, and tasks.md TASK-132 requires the result to
 * be labelled 「系統模板」.
 *
 * Three hard rules govern every builder here:
 *
 * 1. **Substitution only.** A template inserts values the backend already
 *    committed (`event_facts`, `primary_evacuation`, `ete_minutes`,
 *    `base_clearance`, article sets). Nothing is computed, rounded, converted,
 *    or guessed.
 * 2. **A missing value drops its clause.** An absent fact is reported in
 *    {@link FallbackTemplate.omittedFields} so the panel can disclose the gap.
 *    A clause is never completed with a placeholder number.
 * 3. **ETE is never fabricated.** With `ete_minutes === null` the delay clause
 *    falls back to §21.3's lower-bound wording
 *    (「預計至少延誤 {base_clearance} 分鐘」) and, when even
 *    `base_clearance` is absent, disappears entirely.
 *
 * The language floor (§14.4, §21.3「不得退化為僅中文」) is applied to the
 * backend's own `multilingual_required` boolean: `zh` always, plus `en` when
 * the backend says article 6 requires multilingual publication. The panel never
 * evaluates the 30% roaming threshold itself, and no `ja`/`ko` template is
 * produced here — those bonus languages are rendered only when the backend
 * actually supplies their text (TASK-134 scope).
 *
 * @module frontend/decision/narrative_fallback
 */

import type { DecisionCoreView } from './decision_read_model.js';
import type { EvidenceTraceView } from './evidence_model.js';

/** Languages this module can produce a deterministic template for. */
export type FallbackLanguage = 'zh' | 'en';

/** One rendered template plus the deterministic facts that were unavailable. */
export interface FallbackTemplate {
  /** `null` when not a single clause could be filled from backend truth. */
  readonly text: string | null;
  /** Wire field names whose absence dropped a clause. Never silently ignored. */
  readonly omittedFields: readonly string[];
}

function joinClauses(clauses: readonly string[], separator: string): string | null {
  return clauses.length === 0 ? null : clauses.join(separator);
}

/**
 * The event instant used by the templates.
 *
 * `event_facts.timestamp` is the official incident timestamp; `occurred_at` is
 * the same instant as recorded on the core (§10.11a). Whichever the backend
 * supplied is used verbatim — neither is reformatted, and no clock is read.
 */
function eventInstant(core: DecisionCoreView): string | null {
  return core.eventFacts?.timestamp ?? core.occurredAt;
}

/** Delay clause per §21.3, including the explicit lower-bound variant. */
function delayClause(
  core: DecisionCoreView,
  language: FallbackLanguage,
): { readonly clause: string | null; readonly omitted: readonly string[] } {
  const eteMinutes = core.ete?.eteMinutes ?? null;
  if (eteMinutes !== null) {
    return {
      clause: language === 'zh' ? `預計延誤約 ${eteMinutes} 分鐘` : `Est. delay ~${eteMinutes} min`,
      omitted: [],
    };
  }

  const lowerBound = core.ete?.eteLowerBoundMinutes ?? core.ete?.baseClearance ?? null;
  if (lowerBound !== null) {
    return {
      clause:
        language === 'zh'
          ? `預計至少延誤 ${lowerBound} 分鐘，將依即時路況更新`
          : `Est. delay at least ${lowerBound} min, to be updated with live traffic`,
      omitted: ['ete.ete_minutes'],
    };
  }

  return { clause: null, omitted: ['ete.ete_minutes', 'ete.ete_lower_bound_minutes'] };
}

/** Detour clause. An unresolved primary route is stated, never invented. */
function detourClause(
  core: DecisionCoreView,
  language: FallbackLanguage,
): { readonly clause: string; readonly omitted: readonly string[] } {
  if (core.primaryEvacuation !== null) {
    return {
      clause:
        language === 'zh'
          ? `建議改道 ${core.primaryEvacuation}`
          : `Detour via ${core.primaryEvacuation}`,
      omitted: [],
    };
  }
  return {
    clause:
      language === 'zh'
        ? '主疏散路徑尚未確定，需人工確認'
        : 'Primary evacuation route not determined; manual confirmation required',
    omitted: ['primary_evacuation'],
  };
}

/**
 * Builds the deterministic public-alert template for one language (§21.3,
 * R14.4: location, detour guidance, expected delay, and a reroute advisory).
 */
export function buildPublicAlertTemplate(
  core: DecisionCoreView,
  language: FallbackLanguage,
): FallbackTemplate {
  const omitted: string[] = [];
  const clauses: string[] = [];

  const instant = eventInstant(core);
  const location = core.eventFacts?.location ?? null;
  const status = core.eventFacts?.status ?? null;

  const head = [instant, location, status].filter((part): part is string => part !== null);
  if (instant === null) omitted.push('event_facts.timestamp');
  if (location === null) omitted.push('event_facts.location');
  if (status === null) omitted.push('event_facts.status');
  if (head.length > 0) {
    clauses.push(language === 'zh' ? head.join(' ') : head.join(' — '));
  }

  const detour = detourClause(core, language);
  clauses.push(detour.clause);
  omitted.push(...detour.omitted);

  const delay = delayClause(core, language);
  if (delay.clause !== null) clauses.push(delay.clause);
  omitted.push(...delay.omitted);

  clauses.push(language === 'zh' ? '請提前改道' : 'Please reroute early');

  const body = joinClauses(clauses, language === 'zh' ? '，' : '. ');
  return {
    text: body === null ? null : language === 'zh' ? `${body}。` : `${body}.`,
    omittedFields: omitted,
  };
}

/**
 * The language set the public-alert panel must cover when a narrative is
 * missing (§14.4 floor applied to the backend's `multilingual_required`).
 *
 * - `multilingual_required === true` → `zh` + `en`
 * - `multilingual_required === false` → `zh` only (R14.2)
 * - `multilingual_required === null` → `zh` only, and the caller must disclose
 *   that the article 6 verdict was not supplied rather than assume either way
 */
export function fallbackLanguageFloor(
  multilingualRequired: boolean | null,
): readonly FallbackLanguage[] {
  return multilingualRequired === true ? ['zh', 'en'] : ['zh'];
}

/**
 * Builds the deterministic command-centre report template (§21.3, R13).
 *
 * Deliberately a compact factual sentence rather than prose: the full
 * deterministic breakdown (articles, classification levels, routes, ETE basis)
 * is rendered as labelled fields by the report/route/ETE panels, and this text
 * exists only so the narrative slot is never blank.
 */
export function buildReportTemplate(core: DecisionCoreView): FallbackTemplate {
  const omitted: string[] = [];
  const clauses: string[] = [];

  const eventId = core.eventId;
  const location = core.eventFacts?.location ?? null;
  const status = core.eventFacts?.status ?? null;
  if (eventId === null) omitted.push('event_id');
  if (location === null) omitted.push('event_facts.location');
  if (status === null) omitted.push('event_facts.status');

  const context = [location, status].filter((part): part is string => part !== null).join('，');
  if (eventId !== null) {
    clauses.push(context === '' ? `事件 ${eventId}` : `事件 ${eventId}（${context}）`);
  } else if (context !== '') {
    clauses.push(`事件（${context}）`);
  }

  if (core.triggeredArticles.length > 0) {
    clauses.push(`觸發 SOP 第 ${core.triggeredArticles.join('、')} 條`);
  } else {
    omitted.push('triggered_articles');
  }

  if (core.appliedFormulaArticles.length > 0) {
    clauses.push(`套用第 ${core.appliedFormulaArticles.join('、')} 條公式`);
  }

  const detour = detourClause(core, 'zh');
  clauses.push(detour.clause);
  omitted.push(...detour.omitted);

  if (core.secondaryEvacuation.length > 0) {
    clauses.push(`次要疏散 ${core.secondaryEvacuation.join('、')}`);
  }

  const delay = delayClause(core, 'zh');
  if (delay.clause !== null) clauses.push(delay.clause);
  omitted.push(...delay.omitted);

  const body = joinClauses(clauses, '；');
  return { text: body === null ? null : `${body}。`, omittedFields: omitted };
}

/**
 * Builds the deterministic explanation template (§21.3, R15) used when the
 * `EXPLANATION` narrative has not been committed yet.
 *
 * Added by TASK-129 alongside the report/alert templates so all three §21.3
 * fallbacks stay in one place. Same three rules apply: substitution only, a
 * missing fact drops its clause and is disclosed, nothing is computed. In
 * particular the grading conclusions and exclusion reasons are quoted from
 * `EvidenceTrace` — the template never re-derives a level from the value beside
 * it.
 */
export function buildExplanationTemplate(
  core: DecisionCoreView,
  evidence: EvidenceTraceView,
): FallbackTemplate {
  const omitted: string[] = [];
  const clauses: string[] = [];

  if (core.triggeredArticles.length > 0) {
    clauses.push(`依 SOP 第 ${core.triggeredArticles.join('、')} 條判定`);
  } else {
    omitted.push('triggered_articles');
  }

  if (evidence.classificationReasoning.length > 0) {
    const gradings = evidence.classificationReasoning.map((row) => {
      const value = row.value === null ? '（無數值）' : String(row.value);
      const threshold = row.threshold === null ? '（無門檻說明）' : row.threshold;
      const conclusion = row.conclusion === null ? '（無結論）' : row.conclusion;
      return `${row.segmentId} 飽和度 ${value}（門檻 ${threshold}）→ ${conclusion}`;
    });
    clauses.push(gradings.join('；'));
  } else {
    omitted.push('evidence.classification_reasoning');
  }

  if (evidence.excludedRoutes.length > 0) {
    const exclusions = evidence.excludedRoutes.map(
      (row) => `${row.segmentId}：${row.reason ?? '（後端未提供排除理由）'}`,
    );
    clauses.push(`排除候選 — ${exclusions.join('；')}`);
  }

  if (evidence.sopCitations.length > 0) {
    const articles = [...new Set(evidence.sopCitations.map((citation) => citation.articleNo))].sort(
      (left, right) => left - right,
    );
    clauses.push(`引用條款第 ${articles.join('、')} 條`);
  } else {
    omitted.push('evidence.sop_citations');
  }

  const body = joinClauses(clauses, '。');
  return { text: body === null ? null : `${body}。`, omittedFields: omitted };
}
