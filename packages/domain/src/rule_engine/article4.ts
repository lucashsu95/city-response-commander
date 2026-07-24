/**
 * RuleEngine Article 4 — SOP-4 dome dispersal.
 *
 * A dispersal response is marked only when BS_TPE_DOME has a historical
 * User_Count peak of at least 30,000 and its current Growth_Rate is at most
 * -0.20. A marked response proactively invokes the Article 3 shuttle
 * mechanism; this linkage is distinct from Article 3's BL17 trigger.
 */

import { ARTICLE3_WALK_TARGET } from './article3.js';

export const ARTICLE4_STATION_ID = 'BS_TPE_DOME' as const;
export const DOME_PEAK_THRESHOLD = 30_000;
export const DOME_GROWTH_THRESHOLD = -0.2;
export const ARTICLE3_SHUTTLE_MECHANISM = 'article3_mrt_shuttle_mechanism' as const;

export interface HistoricalUserCountObservation {
  /** Timestamp normalized from the immutable source timestamp for temporal comparison. */
  readonly observed_at: Date;
  readonly user_count: number;
}

export interface Article4Input {
  readonly bs_id: string;
  /** Timestamp of the current Strategy-A-aligned snapshot. */
  readonly current_observed_at: Date;
  /** Timestamped readings; values later than current_observed_at are excluded. */
  readonly historical_observations: readonly HistoricalUserCountObservation[] | null;
  /** Growth_Rate from the current Strategy-A-aligned snapshot. */
  readonly current_growth_rate: number | null;
}

export interface Article4Result {
  readonly triggered: boolean;
  readonly dispersal_marked: boolean;
  readonly historical_peak: number | null;
  readonly adds_to_triggered_articles: readonly number[];
  readonly invoked_procedures: readonly string[];
  readonly article3_shuttle_actions: readonly string[];
  readonly data_status: 'ready' | 'insufficient_data';
}

const SHUTTLE_ACTIONS: readonly string[] = [
  '建議北捷「過站不停」(MRT express skip-stop)',
  '通知公車處調度接駁專車 (notify bus authority to dispatch shuttle buses)',
  `引導群眾步行至 ${ARTICLE3_WALK_TARGET} (guide crowd to walk to ${ARTICLE3_WALK_TARGET})`,
] as const;

/** Evaluate SOP-4 using observations no later than the current aligned snapshot. */
export function evaluateArticle4(input: Article4Input): Article4Result {
  if (
    input.bs_id !== ARTICLE4_STATION_ID ||
    input.historical_observations === null ||
    input.current_growth_rate === null
  ) {
    return noResult('insufficient_data');
  }

  const observationsAsOfCurrent = input.historical_observations.filter(
    (observation) => observation.observed_at <= input.current_observed_at,
  );
  if (observationsAsOfCurrent.length === 0) {
    return noResult('insufficient_data');
  }

  const historical_peak = Math.max(...observationsAsOfCurrent.map((observation) => observation.user_count));
  const triggered =
    historical_peak >= DOME_PEAK_THRESHOLD &&
    input.current_growth_rate <= DOME_GROWTH_THRESHOLD;

  if (!triggered) return { ...noResult('ready'), historical_peak };

  return {
    triggered: true,
    dispersal_marked: true,
    historical_peak,
    adds_to_triggered_articles: [4],
    invoked_procedures: [ARTICLE3_SHUTTLE_MECHANISM],
    article3_shuttle_actions: SHUTTLE_ACTIONS,
    data_status: 'ready',
  };
}

function noResult(data_status: 'ready' | 'insufficient_data'): Article4Result {
  return {
    triggered: false,
    dispersal_marked: false,
    historical_peak: null,
    adds_to_triggered_articles: [],
    invoked_procedures: [],
    article3_shuttle_actions: [],
    data_status,
  };
}
