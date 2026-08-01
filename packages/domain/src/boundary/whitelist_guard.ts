/**
 * Whitelist_Guard — partitions any candidate road-id set against
 * Road_Whitelist, and extracts road-id-shaped substrings from free text
 * (spec: boundary-snapping-containment, R9 AC1, R14.5).
 *
 * Used both to build Safe_Context's allowed action space (R8) and to audit
 * Bedrock_Composer's generated text for fabricated road ids (R9).
 *
 * @module domain/boundary/whitelist_guard
 */

import { ROAD_SEGMENT_PREFIX, type WhitelistPartition } from '@city-commander/shared-schemas';

/**
 * Partition `candidateIds` into members that are and are not in `whitelist`.
 *
 * Property (R14.5): `allowed ∪ rejected == new Set(candidateIds)` and
 * `allowed ∩ rejected == ∅` — every candidate id lands in exactly one side.
 */
export function partitionByWhitelist(
  candidateIds: readonly string[],
  whitelist: ReadonlySet<string>,
): WhitelistPartition {
  const allowed = new Set<string>();
  const rejected = new Set<string>();

  for (const id of candidateIds) {
    if (whitelist.has(id)) {
      allowed.add(id);
    } else {
      rejected.add(id);
    }
  }

  return { allowed, rejected };
}

/**
 * Extract every road-id-shaped substring (e.g. `RD_TPE_009`) from free text,
 * for auditing Bedrock_Composer's generated wording (R9 AC1).
 *
 * Uses the canonical `ROAD_SEGMENT_PREFIX` from shared-schemas rather than a
 * duplicated literal, so a future prefix change only needs updating there.
 * Matching alone does NOT imply the id is real — callers must still run the
 * result through `partitionByWhitelist` against the actual Road_Whitelist.
 */
export function extractRoadIdLike(text: string): readonly string[] {
  const pattern = new RegExp(`${ROAD_SEGMENT_PREFIX}\\d+`, 'g');
  return text.match(pattern) ?? [];
}
