/**
 * Sop_Coverage_Resolver — official SOP article matching vs. the
 * system-default universal containment principles
 * (spec: boundary-snapping-containment, R6).
 *
 * Pure, decision-time lookup. Never refuses: an incident `type` outside the
 * table always resolves to UNKNOWN_TYPE_UNIVERSAL_SOP rather than an error
 * or an "I don't know" response (R6 AC3, AC9 — the "no refusal" mandate is
 * enforced by Containment_Assembler always producing Safe_Context guidance
 * for this status; this module's job is only the deterministic status/
 * citation lookup).
 *
 * @module domain/boundary/sop_coverage_resolver
 */

import {
  IncidentType,
  type SopCoverageResult,
  type UniversalPrinciple,
} from '@city-commander/shared-schemas';
import { articleFiveDescriptionTrigger } from '../rule_engine/article5.js';

/** System-default containment policy for incident types outside the official SOP table. */
export const DEFAULT_UNIVERSAL_SOP: readonly UniversalPrinciple[] = [
  {
    principle_id: 'UPSTREAM_REDUCTION',
    description: '上游減量：於周界錨點上游疏導車流，降低進入未劃設區域之流量',
  },
  {
    principle_id: 'PERIMETER_DISPERSAL',
    description: '周邊擴散：透過 alternatives 分流至周界錨點鄰近之替代路段',
  },
  {
    principle_id: 'PERIMETER_CONTROL',
    description: '周界管制：於周界錨點設立管制點，阻止車流繼續駛向未劃設區域',
  },
] as const;

interface SopTypeArticleMapping {
  readonly incidentType: string;
  readonly articleNos: readonly number[];
  /** Traceability note — which emergency_traffic_sop.txt clause this maps to. */
  readonly sopReference: string;
}

/**
 * Deterministic `incident.type` → official SOP article-number table.
 *
 * This is authored domain knowledge, not something derivable from
 * `SOPArticleChunk`/`getByArticleNo` (those only carry article text keyed
 * by article_no, not which incident type triggers which article) — so it
 * is hardcoded here and cross-checked against the 3 official golden events
 * instead of being threaded through as a runtime parameter (design.md §5
 * originally sketched a `sopArticleTable` parameter for this; corrected
 * here because no such derivable table exists).
 *
 * Only articles whose SOP-text trigger condition is actually gated on an
 * incident occurring (not an ambient/background rule) are included:
 * - Article 1 (交通擁塞級別判定) applies to all 15 segments continuously,
 *   independent of any injected incident's type — excluded.
 * - Article 3/4/6 trigger purely off BS_ station data thresholds
 *   (Growth_Rate/User_Count/Roaming_User_Pct), not off `incident.type` for
 *   any incident type except the traceable Article 3 pairing below.
 * - Article 7 (ETE) is a formula applied when applicable, not a
 *   type-triggered article in its own right.
 *
 * Traceable to the 3 official `live_incidents.json` golden walkthroughs
 * (`.kiro/specs/impl1/tasks.md` TASK-053/054/055):
 * - ACC_001 (Road_Collapse_Accident, RD_TPE_002) → SOP-1 + SOP-2; SOP-2 is
 *   the only article whose trigger is specific to this incident *type*
 *   (emergency_traffic_sop.txt §2 "車禍與路障應變", condition 3: affected_segment
 *   starts with RD_ — Road_Collapse_Accident is the RD_-prefixed accident type).
 * - EVT_002 (Crowd_Surge_Injury, BS_MRT_BL17) → SOP-3 (golden test title:
 *   "SOP-3 evaluation, must-compute"); §3 "捷運與接駁分流" is the crowd-density
 *   diversion procedure a crowd-surge incident type maps to.
 * - EVT_003 (Power_Failure, RD_TPE_007) → SOP-5 (golden test title: "SOP-5");
 *   §5 explicitly triggers on `type = "Power_Failure"`.
 */
const TYPE_TO_ARTICLE_TABLE: readonly SopTypeArticleMapping[] = [
  {
    incidentType: IncidentType.Road_Collapse_Accident,
    articleNos: [2],
    sopReference: 'emergency_traffic_sop.txt §2 車禍與路障應變',
  },
  {
    incidentType: IncidentType.Crowd_Surge_Injury,
    articleNos: [3],
    sopReference: 'emergency_traffic_sop.txt §3 捷運與接駁分流',
  },
  {
    incidentType: IncidentType.Power_Failure,
    articleNos: [5],
    sopReference: 'emergency_traffic_sop.txt §5 號誌故障應變',
  },
];

/**
 * Resolve whether an incident's `type` maps to an official SOP article, or
 * must fall back to DEFAULT_UNIVERSAL_SOP (R6).
 *
 * Order (R6 AC2/AC3):
 * 1. `type` found in the table → OFFICIAL_SOP_MATCHED.
 * 2. Else, `description` matches Article 5's textual trigger (the only SOP
 *    article with a description-text condition) → OFFICIAL_SOP_MATCHED on
 *    article 5, same as `isArticle5Triggered`'s existing behavior for a
 *    known-type incident whose type didn't match but description did.
 * 3. Else → UNKNOWN_TYPE_UNIVERSAL_SOP, DEFAULT_UNIVERSAL_SOP attached.
 */
export function resolveSopCoverage(
  incidentType: string,
  incidentDescription: string,
): SopCoverageResult {
  const tableEntry = TYPE_TO_ARTICLE_TABLE.find((entry) => entry.incidentType === incidentType);
  if (tableEntry !== undefined) {
    return {
      sop_coverage_status: 'OFFICIAL_SOP_MATCHED',
      sop_authority: 'OFFICIAL_SOP',
      matched_article_nos: tableEntry.articleNos,
      universal_principles: [],
    };
  }

  if (articleFiveDescriptionTrigger(incidentDescription)) {
    return {
      sop_coverage_status: 'OFFICIAL_SOP_MATCHED',
      sop_authority: 'OFFICIAL_SOP',
      matched_article_nos: [5],
      universal_principles: [],
    };
  }

  return {
    sop_coverage_status: 'UNKNOWN_TYPE_UNIVERSAL_SOP',
    sop_authority: 'SYSTEM_DEFAULT_PRINCIPLE',
    matched_article_nos: [],
    universal_principles: DEFAULT_UNIVERSAL_SOP,
  };
}
