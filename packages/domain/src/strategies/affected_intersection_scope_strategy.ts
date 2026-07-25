/** Strategy E — resolve the provisional SOP-5 affected-intersection scope. */

import type {
  AffectedIntersectionScope,
  Incident,
  RoadSegment,
} from '@city-commander/shared-schemas';

export type AffectedIntersectionScopeMode =
  'unresolved_manual_confirmation' | 'all_segment_intersections' | 'explicit_host_set';

export interface AffectedIntersectionScopeConfig {
  readonly mode: AffectedIntersectionScopeMode;
  /** Only meaningful for explicit_host_set after a host policy is supplied. */
  readonly explicit_intersections?: readonly string[];
}

export interface AffectedIntersectionScopeStrategy {
  resolve(
    incident: Incident,
    affectedSegment: RoadSegment | undefined,
    config: AffectedIntersectionScopeConfig,
  ): AffectedIntersectionScope;
}

const unresolvedScope: AffectedIntersectionScope = {
  police_per_intersection: 2,
  affected_intersection_count: 'unresolved',
  total_police: 'unresolved',
  manual_confirmation_required: true,
  official_golden_answer: false,
};

/** Conservative default: never infer all road intersections as affected. */
export const unresolvedManualConfirmation: AffectedIntersectionScopeStrategy = {
  resolve: () => unresolvedScope,
};

/** A configurable, explicitly provisional demonstration policy. */
export const allSegmentIntersections: AffectedIntersectionScopeStrategy = {
  resolve: (_incident, affectedSegment) => deriveExample(affectedSegment?.intersections.length),
};

/** Uses only an explicitly supplied host set; absent input remains unresolved. */
export const explicitHostSet: AffectedIntersectionScopeStrategy = {
  resolve: (_incident, _affectedSegment, config) =>
    config.explicit_intersections === undefined
      ? unresolvedScope
      : deriveExample(config.explicit_intersections.length),
};

export function resolveAffectedIntersectionScopeStrategy(
  mode: AffectedIntersectionScopeMode,
): AffectedIntersectionScopeStrategy {
  switch (mode) {
    case 'unresolved_manual_confirmation':
      return unresolvedManualConfirmation;
    case 'all_segment_intersections':
      return allSegmentIntersections;
    case 'explicit_host_set':
      return explicitHostSet;
  }
}

function deriveExample(count: number | undefined): AffectedIntersectionScope {
  if (count === undefined) return unresolvedScope;
  return {
    police_per_intersection: 2,
    affected_intersection_count: count,
    total_police: count * 2,
    manual_confirmation_required: true,
    example_classification: 'PROVISIONAL_DERIVED_EXAMPLE',
    official_golden_answer: false,
  };
}
