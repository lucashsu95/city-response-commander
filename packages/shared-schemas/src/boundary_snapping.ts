/**
 * Boundary_Snapper types — Entity_Scope_Check, Perimeter_Anchor derivation,
 * and spatial snapping (spec: boundary-snapping-containment, R2/R3/R4/R5).
 *
 * All fields here are decision-time facts produced by deterministic code in
 * `packages/domain/src/boundary/boundary_snapper.ts`; never written by Bedrock.
 *
 * @module shared-schemas/boundary_snapping
 */

/** Entity_Scope_Check outcome before any spatial snapping is attempted. */
export type LocationCoverageStatus = 'IN_SCOPE' | 'IN_SCOPE_BY_INTERSECTION' | 'OUT_OF_BOUNDS';

/**
 * Final data_scope_status exposed on the API (R10 AC1). `OUT_OF_BOUNDS`
 * (the intermediate Entity_Scope_Check result) never reaches the API —
 * it always resolves to one of the two snapped/jurisdiction outcomes.
 */
export type DataScopeStatus =
  | 'IN_SCOPE'
  | 'IN_SCOPE_BY_INTERSECTION'
  | 'OUT_OF_BOUNDS_SNAPPED'
  | 'OUT_OF_JURISDICTION';

export interface EntityScopeResult {
  readonly coverage_status: LocationCoverageStatus;
  /** null only when coverage_status === 'OUT_OF_BOUNDS' (R2 AC1-AC4). */
  readonly decision_anchor_segment_id: string | null;
  readonly matched_field: 'affected_segment' | 'affected_road' | 'location_intersection' | null;
  readonly matched_value: string | null;
}

/**
 * A real周界管制門 (perimeter gateway), derived purely from road-network
 * topology — never a hardcoded id (R4 AC1/AC2/AC6/AC7).
 */
export interface PerimeterAnchor {
  /** @derived always a member of Road_Whitelist */
  readonly segment_id: string;
  /** @derived always a member of Intersection_Whitelist */
  readonly gateway_intersection: string;
  /** @immutable-official from RoadSegment.capacity_vph */
  readonly capacity_vph: number;
}

export interface SnapResult {
  readonly coverage_status: Extract<DataScopeStatus, 'OUT_OF_BOUNDS_SNAPPED' | 'OUT_OF_JURISDICTION'>;
  /** null when coverage_status === 'OUT_OF_JURISDICTION' (R4 AC5/AC8). */
  readonly anchor: PerimeterAnchor | null;
  /** null when the coordinate path is not enabled/usable (R3 AC6). */
  readonly distance_meters: number | null;
  readonly reason: string;
  /** Snapping evidence strings, e.g. 'gazetteer_unavailable', 'invalid_coordinate'. */
  readonly evidence: readonly string[];
}

export interface AnchorGazetteerEntry {
  readonly lat: number;
  readonly lon: number;
}

/**
 * Config consumed by Boundary_Snapper. Read from ConfigProvider's
 * `boundary_snapping.*` keys — see packages/config/src/config_schema.ts.
 */
export interface BoundarySnapperConfig {
  /** Required; no provisional default — missing means explicit failure (R5 AC1/AC2). */
  readonly max_snap_distance_meters: number;
  readonly coordinate_path_enabled: boolean;
  /** Present only when coordinate_path_enabled and a source is configured (R3 AC1/AC3). */
  readonly anchor_gazetteer?: ReadonlyMap<string, AnchorGazetteerEntry>;
}
