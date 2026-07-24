/**
 * RuleEngine Article 3 — SOP-3 MRT Shuttle (捷運與接駁分流)
 *
 * Deterministic encoding of SOP-3 for station BS_MRT_BL17 (捷運國父紀念館站).
 *
 * TRIGGER (OR — any one suffices):
 *   1. BS_MRT_BL17 Growth_Rate > 0.30  (0.30 NOT met, must be strictly greater)
 *   2. BS_MRT_BL17 User_Count > 25000  (25000 NOT met, must be strictly greater)
 *
 * ACTIONS when triggered:
 *   1. Recommend MRT express skip-stop ("過站不停")
 *   2. Notify bus authority to dispatch shuttle buses
 *   3. Guide crowd to walk to BS_MRT_BL18
 *
 * FAILURE CASES:
 *   - Missing readings (null) → data_status='insufficient_data', no assumption of trigger
 *
 * IMPORTANT: This is an EVALUATION function — given BL17's readings, determine if
 * art.3 triggers. EVT_002 involves BL17 but we COMPUTE whether it triggers, never assume.
 *
 * @module domain/rule_engine/article3
 */

// ─── Constants ─────────────────────────────────────────────

/** The station ID for SOP-3 evaluation */
export const ARTICLE3_STATION_ID = 'BS_MRT_BL17' as const;

/** The target station for crowd walking guidance */
export const ARTICLE3_WALK_TARGET = 'BS_MRT_BL18' as const;

/** Growth rate threshold (strictly greater than) */
export const GROWTH_RATE_THRESHOLD = 0.30;

/** User count threshold (strictly greater than) */
export const USER_COUNT_THRESHOLD = 25000;

// ─── Types ─────────────────────────────────────────────────

/**
 * Input for Article 3 evaluation.
 */
export interface Article3Input {
  /** Should be 'BS_MRT_BL17' */
  readonly bs_id: string;
  /** User count at the station; null = missing reading */
  readonly user_count: number | null;
  /** Growth rate at the station; null = missing reading */
  readonly growth_rate: number | null;
}

/**
 * Result of Article 3 evaluation.
 */
export interface Article3Result {
  /** Whether art.3 conditions are met */
  readonly triggered: boolean;
  /** Which condition triggered (null if not triggered or insufficient data) */
  readonly trigger_reason: string | null;
  /** Action descriptions when triggered */
  readonly actions: readonly string[];
  /** [3] when triggered, empty otherwise */
  readonly adds_to_triggered_articles: readonly number[];
  /** Data status: 'ready' when data is available, 'insufficient_data' when readings are missing */
  readonly data_status: 'ready' | 'insufficient_data';
}

// ─── Actions ───────────────────────────────────────────────

/**
 * The three actions prescribed by SOP-3 when triggered.
 */
const ARTICLE3_ACTIONS: readonly string[] = [
  '建議北捷「過站不停」(MRT express skip-stop)',
  '通知公車處調度接駁專車 (notify bus authority to dispatch shuttle buses)',
  '引導群眾步行至 BS_MRT_BL18 (guide crowd to walk to BS_MRT_BL18)',
] as const;

// ─── Evaluation ────────────────────────────────────────────

/**
 * Evaluate Article 3 (SOP-3) for station BS_MRT_BL17.
 *
 * Trigger conditions (OR — any one suffices):
 *   - Growth_Rate > 0.30 (strictly greater; 0.30 does NOT trigger)
 *   - User_Count > 25000 (strictly greater; 25000 does NOT trigger)
 *
 * Both readings being null means insufficient data — no trigger assumed.
 * If one reading is null but the other satisfies its condition, art.3 triggers.
 *
 * @param input - The station readings for BS_MRT_BL17
 * @returns Article3Result with trigger status and actions
 */
export function evaluateArticle3(input: Article3Input): Article3Result {
  // Validate station ID
  if (input.bs_id !== ARTICLE3_STATION_ID) {
    return {
      triggered: false,
      trigger_reason: null,
      actions: [],
      adds_to_triggered_articles: [],
      data_status: 'ready',
    };
  }

  // Evaluate OR conditions. One known true condition is sufficient even if the
  // other input is unavailable.
  const growthTriggered = input.growth_rate !== null && input.growth_rate > GROWTH_RATE_THRESHOLD;
  const countTriggered = input.user_count !== null && input.user_count > USER_COUNT_THRESHOLD;

  if (growthTriggered || countTriggered) {
    const reasons: string[] = [];
    if (growthTriggered) {
      reasons.push(`Growth_Rate ${input.growth_rate} > ${GROWTH_RATE_THRESHOLD}`);
    }
    if (countTriggered) {
      reasons.push(`User_Count ${input.user_count} > ${USER_COUNT_THRESHOLD}`);
    }

    return {
      triggered: true,
      trigger_reason: reasons.join(' OR '),
      actions: ARTICLE3_ACTIONS,
      adds_to_triggered_articles: [3],
      data_status: 'ready',
    };
  }

  // A missing input could still satisfy the OR condition, so a false outcome is
  // conclusive only when both in-scope readings are available.
  if (input.user_count === null || input.growth_rate === null) {
    return {
      triggered: false,
      trigger_reason: null,
      actions: [],
      adds_to_triggered_articles: [],
      data_status: 'insufficient_data',
    };
  }

  return {
    triggered: false,
    trigger_reason: null,
    actions: [],
    adds_to_triggered_articles: [],
    data_status: 'ready',
  };
}
