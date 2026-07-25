/** Deterministic report/public-content assembly and LLM field boundary. */

export interface ReportFacts {
  readonly event_id: string;
  readonly triggered_articles: readonly number[];
  readonly applied_formula_articles: readonly number[];
  readonly classification: { readonly level: 'A' | 'B' | null; readonly saturation: number };
  readonly primary_evacuation: string | null;
  readonly secondary_evacuation: readonly string[];
  readonly excluded_routes: readonly { readonly segment_id: string; readonly reason: string }[];
  readonly signal_timing: { readonly alternatives_green_plus_pct: 25 } | null;
  readonly article3_triggered: boolean;
  readonly article5_triggered: boolean;
  readonly ete: { readonly minutes: number | null; readonly lower_bound_minutes?: number; readonly basis: string };
  readonly cms_core_text: string;
}

export interface CommandCenterReport {
  readonly event_identification: { readonly event_id: string; readonly sop_articles: readonly number[] };
  readonly classification_section: ReportFacts['classification'];
  readonly route_section: {
    readonly primary: string | null;
    readonly secondary: readonly string[];
    readonly exclusions: ReportFacts['excluded_routes'];
  };
  readonly signal_timing_section: ReportFacts['signal_timing'];
  readonly cross_system_requests: readonly ('mrt' | 'bus' | 'police')[];
  readonly ete_section: ReportFacts['ete'];
  readonly cms_section: { readonly cms_core_text: string; readonly cms_explanation_text?: string };
}

export interface PublicAlertFacts {
  readonly location: string;
  readonly reroute: string;
  readonly delay_minutes: number;
  readonly avoidance_reminder: string;
  readonly sop6_triggered: boolean;
}

export interface PublicAlertContent extends PublicAlertFacts {
  readonly text: string;
}

export interface Sop2CmsFacts {
  readonly incident_road: string;
  readonly primary_evacuation: string;
  readonly ete_minutes: number;
}

export function assembleCommandCenterReport(facts: ReportFacts): CommandCenterReport {
  const crossSystem = new Set<'mrt' | 'bus' | 'police'>();
  if (facts.article3_triggered) { crossSystem.add('mrt'); crossSystem.add('bus'); }
  if (facts.article5_triggered) crossSystem.add('police');
  return {
    event_identification: {
      event_id: facts.event_id,
      sop_articles: [...new Set([...facts.triggered_articles, ...facts.applied_formula_articles])].sort((a, b) => a - b),
    },
    classification_section: facts.classification,
    route_section: {
      primary: facts.primary_evacuation,
      secondary: facts.secondary_evacuation,
      exclusions: facts.excluded_routes,
    },
    signal_timing_section: facts.signal_timing,
    cross_system_requests: [...crossSystem],
    ete_section: facts.ete,
    cms_section: { cms_core_text: facts.cms_core_text },
  };
}

export function assemblePublicAlert(facts: PublicAlertFacts): PublicAlertContent {
  return {
    ...facts,
    text: `${facts.location}；改道 ${facts.reroute}；預計延誤 ${facts.delay_minutes} 分鐘；${facts.avoidance_reminder}`,
  };
}

/** Official deterministic SOP-2 CMS skeleton; RendererFn cannot alter this value. */
export function buildSop2CmsCoreText(facts: Sop2CmsFacts): string {
  if (!Number.isFinite(facts.ete_minutes) || facts.ete_minutes < 0) {
    throw new Error('SOP-2 CMS requires a finite non-negative ETE.');
  }
  return `${facts.incident_road}封閉，請改道 ${facts.primary_evacuation}，預計延誤 ${facts.ete_minutes} 分鐘`;
}

const LLM_WRITABLE_FIELDS = new Set(['report_text', 'cms_explanation_text', 'citations_presentation', 'public_alert_text', 'explanation_text']);

/** Rejects any renderer attempt to write deterministic fields such as cms_core_text. */
export function validateNarrativePatch(patch: Readonly<Record<string, unknown>>): { readonly ok: boolean; readonly rejected_fields: readonly string[] } {
  const rejected_fields = Object.keys(patch).filter((key) => !LLM_WRITABLE_FIELDS.has(key));
  return { ok: rejected_fields.length === 0, rejected_fields };
}
