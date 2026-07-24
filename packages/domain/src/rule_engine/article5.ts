/** RuleEngine Article 5 — SOP-5 signal failure manual-command response. */

import type { AffectedIntersectionScope, Incident } from '@city-commander/shared-schemas';
import { IncidentType } from '@city-commander/shared-schemas';

export interface Article5Input {
  readonly incident: Incident;
  /** Display road name used by the official CMS text, resolved from road data. */
  readonly affected_road_name: string;
  readonly affected_intersection_scope: AffectedIntersectionScope;
}

export interface Article5Result {
  readonly triggered: boolean;
  readonly adds_to_triggered_articles: readonly number[];
  readonly affected_intersection_scope?: AffectedIntersectionScope;
  readonly cms_core_text: string | null;
  readonly manual_command_actions: readonly string[];
}

/** SOP-5 is triggered by the official type OR either Chinese failure keyword. */
export function isArticle5Triggered(incident: Incident): boolean {
  return incident.type === IncidentType.Power_Failure ||
    incident.description.includes('號誌失效') || incident.description.includes('故障');
}

export function evaluateArticle5(input: Article5Input): Article5Result {
  if (!isArticle5Triggered(input.incident)) {
    return { triggered: false, adds_to_triggered_articles: [], cms_core_text: null, manual_command_actions: [] };
  }
  return {
    triggered: true,
    adds_to_triggered_articles: [5],
    affected_intersection_scope: input.affected_intersection_scope,
    cms_core_text: `${input.affected_road_name} 號誌故障，請依現場指揮通行`,
    manual_command_actions: ['產出人工指揮派遣建議', '每受影響路口配置 2 名警力', '於報告中提供估計持續時間'],
  };
}
