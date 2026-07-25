/** Deterministic dashboard light mapping for SOP-1 grades. */

export type TrafficLightColor = 'red' | 'yellow' | 'green';

export function trafficLightFor(level: 'A' | 'B' | null): TrafficLightColor {
  if (level === 'A') return 'red';
  if (level === 'B') return 'yellow';
  return 'green';
}
