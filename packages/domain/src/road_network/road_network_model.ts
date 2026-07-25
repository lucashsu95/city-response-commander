/**
 * Road Network Model — Load and query road segments
 *
 * Stores parsed RoadSegment records indexed by segment_id.
 * Provides O(1) segment lookup and enumeration.
 * Does not modify or fill any data (empty nearby_stations stays empty).
 *
 * @module domain/road_network/road_network_model
 */

import type { RoadSegment } from '@city-commander/shared-schemas';

/**
 * In-memory model of the road network geometry.
 *
 * Loaded from parsed RoadSegment records.
 * Provides indexed access by segment_id.
 */
export class RoadNetworkModel {
  private readonly segmentMap: ReadonlyMap<string, RoadSegment>;
  private readonly segmentList: readonly RoadSegment[];

  private constructor(segments: readonly RoadSegment[]) {
    const map = new Map<string, RoadSegment>();
    for (const segment of segments) {
      if (map.has(segment.segment_id)) {
        throw new Error(`Duplicate segment_id "${segment.segment_id}" in road network data`);
      }
      map.set(segment.segment_id, segment);
    }
    this.segmentMap = map;
    this.segmentList = segments;
  }

  /**
   * Load road network model from a parsed array of RoadSegment records.
   *
   * @param segments - Readonly array from parseRoadNetworkJson()
   * @returns A new RoadNetworkModel instance
   * @throws Error if duplicate segment_id found
   */
  static load(segments: readonly RoadSegment[]): RoadNetworkModel {
    return new RoadNetworkModel(segments);
  }

  /**
   * Get a single segment by its ID.
   *
   * @param segmentId - The segment_id to look up
   * @returns The RoadSegment or undefined if not found
   */
  getSegment(segmentId: string): RoadSegment | undefined {
    return this.segmentMap.get(segmentId);
  }

  /**
   * Get all segments in their original load order.
   *
   * @returns Readonly array of all RoadSegment records
   */
  getAllSegments(): readonly RoadSegment[] {
    return this.segmentList;
  }

  /**
   * Total number of segments in the model.
   */
  get size(): number {
    return this.segmentMap.size;
  }

  /**
   * Return the alternatives list of the given segment.
   *
   * This is a one-way lookup: if A lists B in alternatives, that does NOT
   * imply B lists A. No symmetric inference or symmetric graph search.
   *
   * @param segmentId - The segment whose alternatives to retrieve
   * @returns The segment's alternatives array, or an empty array if segment not found
   */
  alternativesOf(segmentId: string): readonly string[] {
    const segment = this.segmentMap.get(segmentId);
    if (!segment) {
      return [];
    }
    return segment.alternatives;
  }

  /**
   * Return the nearby_stations list of the given segment.
   *
   * Empty array is normal (no nearby recorded stations) and is returned as-is.
   * Never fills or supplements the list.
   *
   * @param segmentId - The segment whose nearby stations to retrieve
   * @returns The segment's nearby_stations array, or an empty array if segment not found
   */
  nearbyStations(segmentId: string): readonly string[] {
    const segment = this.segmentMap.get(segmentId);
    if (!segment) {
      return [];
    }
    return segment.nearby_stations;
  }

  /**
   * Determine whether a given intersection name is upstream or downstream
   * of an anchor intersection, based on the ordered intersections array.
   *
   * The intersections array is ordered upstream → downstream (first element = most upstream).
   * If candidateIntersection appears at an index less than anchorIntersection's index,
   * it is upstream; if at a greater index, it is downstream.
   *
   * @param segmentId - The segment whose intersections array to use
   * @param candidateIntersection - The intersection name to check
   * @param anchorIntersection - The incident anchor intersection
   * @returns 'upstream' | 'downstream' | null (null if either not found in the intersections array)
   */
  positionRelativeToAnchor(
    segmentId: string,
    candidateIntersection: string,
    anchorIntersection: string,
  ): 'upstream' | 'downstream' | null {
    const segment = this.segmentMap.get(segmentId);
    if (!segment) {
      return null;
    }

    const intersections = segment.intersections;
    const candidateIndex = intersections.indexOf(candidateIntersection);
    const anchorIndex = intersections.indexOf(anchorIntersection);

    if (candidateIndex === -1 || anchorIndex === -1) {
      return null;
    }

    if (candidateIndex < anchorIndex) {
      return 'upstream';
    }
    if (candidateIndex > anchorIndex) {
      return 'downstream';
    }

    // Same index (candidate IS the anchor) — not upstream or downstream
    return null;
  }

  /**
   * Check if a candidate road name appears in a segment's intersections list.
   *
   * Used to determine if a candidate route directly intersects the given segment.
   *
   * @param segmentId - The segment whose intersections to check
   * @param candidateRoadName - The road name to look for
   * @returns true if the candidateRoadName is in the segment's intersections array
   */
  isDirectIntersection(segmentId: string, candidateRoadName: string): boolean {
    const segment = this.segmentMap.get(segmentId);
    if (!segment) {
      return false;
    }
    return segment.intersections.includes(candidateRoadName);
  }
}
