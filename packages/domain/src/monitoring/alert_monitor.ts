/** Deterministic anomaly monitor for the SOP-1/3/4/6 dashboard popup. */

export interface AlertMonitorSnapshot {
  readonly road_saturations: readonly number[];
  readonly bl17?: { readonly user_count: number; readonly growth_rate: number };
  readonly dome?: { readonly historical_peak: number; readonly current_growth_rate: number };
  readonly station_roaming_rates: readonly number[];
}

export type AlertReason = 'article1' | 'article3' | 'article4' | 'article6';

export interface AlertMonitorResult {
  readonly anomaly_detected: boolean;
  readonly event_type: 'anomaly.detected' | null;
  readonly reasons: readonly AlertReason[];
}

/** Emits one anomaly event exactly when at least one official threshold is met. */
export function monitorAlerts(snapshot: AlertMonitorSnapshot): AlertMonitorResult {
  const reasons: AlertReason[] = [];
  if (snapshot.road_saturations.some((value) => value >= 0.85)) reasons.push('article1');
  if (
    snapshot.bl17 !== undefined &&
    (snapshot.bl17.growth_rate > 0.3 || snapshot.bl17.user_count > 25_000)
  )
    reasons.push('article3');
  if (
    snapshot.dome !== undefined &&
    snapshot.dome.historical_peak >= 30_000 &&
    snapshot.dome.current_growth_rate <= -0.2
  )
    reasons.push('article4');
  if (snapshot.station_roaming_rates.some((value) => value >= 0.3)) reasons.push('article6');
  return {
    anomaly_detected: reasons.length > 0,
    event_type: reasons.length > 0 ? 'anomaly.detected' : null,
    reasons,
  };
}
