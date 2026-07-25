/** ConfigProvider-backed selection for provisional Strategies A-F. */

import type { PolicyMetadata } from '@city-commander/shared-schemas';
import { SnapshotSelector, type SnapshotSelectorConfigProvider } from '../snapshot/snapshot_selector.js';
import { createAffectedRoadStrategy, type AffectedRoadRole, type AffectedRoadStrategy } from './affected_road_strategy.js';
import {
  directlyAffectedRoadsAtEventSnapshot,
  incidentPrimaryAndSelectedSecondary,
  type EteAffectedSetMode,
  type EteAffectedSetStrategy,
} from './ete_affected_set_strategy.js';
import {
  resolveIncidentAnchorStrategy,
  type IncidentAnchorMode,
  type IncidentAnchorResolutionStrategy,
} from './incident_anchor_resolution_strategy.js';
import {
  resolveAffectedIntersectionScopeStrategy,
  type AffectedIntersectionScopeMode,
  type AffectedIntersectionScopeStrategy,
} from './affected_intersection_scope_strategy.js';
import {
  resolveMultilingualScopeStrategy,
  type MultilingualScopeMode,
  type MultilingualScopeStrategy,
} from './multilingual_scope_strategy.js';

export type PolicyStrategyConfigProvider = SnapshotSelectorConfigProvider;

export interface PolicyStrategyBundle {
  readonly timeAlignment: SnapshotSelector;
  readonly affectedRoad: AffectedRoadStrategy;
  readonly eteAffectedSet: EteAffectedSetStrategy;
  readonly incidentAnchor: IncidentAnchorResolutionStrategy;
  readonly affectedIntersectionScope: AffectedIntersectionScopeStrategy;
  readonly multilingualScope: MultilingualScopeStrategy;
  readonly metadata: PolicyMetadata;
}

/** Resolve all strategies at the ConfigProvider boundary; RuleEngine never reads config keys. */
export function createPolicyStrategyBundle(provider: PolicyStrategyConfigProvider): PolicyStrategyBundle {
  const timeAlignmentMode = readEnum(provider, 'policy.time_alignment.mode', [
    'exact_or_latest_prior_per_entity', 'last_known_value_with_visible_staleness',
  ] as const);
  const maxStalenessMinutes = provider.get('policy.time_alignment.max_staleness_minutes');
  if (typeof maxStalenessMinutes !== 'number' || !Number.isFinite(maxStalenessMinutes) || maxStalenessMinutes < 0) {
    throw new Error('policy.time_alignment.max_staleness_minutes must be a non-negative number.');
  }
  const affectedRoadRole = readEnum(provider, 'policy.affected_road.role', [
    'display_only', 'context_and_ete', 'parallel_road_impact_explicit_host',
  ] as const satisfies readonly AffectedRoadRole[]);
  const eteMode = readEnum(provider, 'policy.ete.affected_set', [
    'directly_affected_roads_at_event_snapshot', 'incident_primary_and_selected_secondary',
  ] as const satisfies readonly EteAffectedSetMode[]);
  const anchorMode = readEnum(provider, 'policy.incident_anchor.mode', [
    'incident_anchor_from_location_text', 'explicit_host_mapping',
  ] as const satisfies readonly IncidentAnchorMode[]);
  const intersectionMode = readEnum(provider, 'policy.affected_intersection_scope.mode', [
    'unresolved_manual_confirmation', 'all_segment_intersections', 'explicit_host_set',
  ] as const satisfies readonly AffectedIntersectionScopeMode[]);
  const multilingualMode = readEnum(provider, 'policy.multilingual_scope.mode', [
    'current_snapshot_all_available_stations', 'incident_area_nearby_stations', 'explicit_host_policy',
  ] as const satisfies readonly MultilingualScopeMode[]);

  return {
    timeAlignment: new SnapshotSelector(provider),
    affectedRoad: createAffectedRoadStrategy(affectedRoadRole),
    eteAffectedSet: eteMode === 'incident_primary_and_selected_secondary'
      ? incidentPrimaryAndSelectedSecondary
      : directlyAffectedRoadsAtEventSnapshot,
    incidentAnchor: resolveIncidentAnchorStrategy(anchorMode),
    affectedIntersectionScope: resolveAffectedIntersectionScopeStrategy(intersectionMode),
    multilingualScope: resolveMultilingualScopeStrategy(multilingualMode),
    metadata: {
      classification: 'PROVISIONAL_TEAM_POLICY',
      status: 'AWAITING_HOST_REPLY',
      is_official: false,
      guidance_id: 'HG-001',
      official_golden_answer: false,
      time_alignment: {
        mode: timeAlignmentMode,
        max_staleness_minutes: maxStalenessMinutes,
        on_insufficient: timeAlignmentMode === 'exact_or_latest_prior_per_entity' ? 'insufficient_data' : 'visible_staleness',
      },
      affected_road: { role: affectedRoadRole },
      ete: { affected_set: eteMode },
      incident_anchor: { mode: anchorMode },
      affected_intersection_scope: { mode: intersectionMode },
      multilingual_scope: { mode: multilingualMode },
      saturated_vs_congested: 'PARTIALLY_DEFINED',
    },
  };
}

function readEnum<const T extends readonly string[]>(provider: PolicyStrategyConfigProvider, key: string, allowed: T): T[number] {
  const value = provider.get(key);
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`${key} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T[number];
}
