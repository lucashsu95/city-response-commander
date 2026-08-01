/**
 * Intersection text matching — shared "does this intersection name appear in
 * free-form location text" logic.
 *
 * Extracted from `IncidentAnchorResolutionStrategy` (Strategy D) so that
 * `Boundary_Snapper`'s Entity_Scope_Check (spec: boundary-snapping-containment,
 * R2) uses the exact same matching rules instead of a second, independently
 * maintained implementation that could silently drift from Strategy D's.
 *
 * @module domain/road_network/intersection_text_match
 */

/**
 * Check whether an intersection name (or its unambiguous road-name alias
 * without a section suffix, e.g. 忠孝東路四段 -> 忠孝東路) appears in the
 * given location text.
 */
export function intersectionAppearsInLocation(
  locationText: string,
  intersectionName: string,
): boolean {
  if (locationText.includes(intersectionName)) return true;
  const roadAlias = intersectionName.replace(/[一二三四五六七八九十]+段$/u, '');
  return roadAlias !== intersectionName && locationText.includes(roadAlias);
}
