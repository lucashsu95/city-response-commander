/**
 * Runtime Boundary Decode Primitives (frontend `decision/` slice)
 *
 * Shared structural helpers for the `GET /decisions/{decision_id}` boundary
 * decoders (TASK-132 envelope, TASK-129 evidence, TASK-130 routes, TASK-131
 * ETE). They encode one discipline and nothing else:
 *
 * - an **absent** or explicitly `null` field decodes to `null` ("the backend did
 *   not supply this"), so a panel can render an explicit "not supplied" state
 * - a field **present with the wrong type** decodes to `undefined`, which every
 *   caller must treat as a decode failure — never coerce, round, or drop it
 *
 * No business rule lives here: nothing is compared against a threshold,
 * classified, averaged, or re-derived. These are shape checks only (§9).
 *
 * @module frontend/decision/decode_primitives
 */

/** `undefined` marks "present but malformed"; callers must fail the decode. */
export type Malformed = undefined;

/**
 * A key counts as absent when it is missing, `null`, or explicitly `undefined`.
 *
 * JSON never produces `undefined`, so treating it as absent costs nothing at the
 * HTTP boundary and keeps a JS caller that spreads `{ field: undefined }` from
 * being reported as a malformed payload.
 */
function isAbsent(record: Record<string, unknown>, key: string): boolean {
  return !(key in record) || record[key] === null || record[key] === undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Absent/`null` ⇒ `null`; wrong type ⇒ {@link Malformed}. */
export function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | null | Malformed {
  if (isAbsent(record, key)) return null;
  return typeof record[key] === 'string' ? (record[key] as string) : undefined;
}

/** Same contract as {@link optionalString}, rejecting empty/whitespace text. */
export function optionalNonEmptyString(
  record: Record<string, unknown>,
  key: string,
): string | null | Malformed {
  const value = optionalString(record, key);
  if (value === null || value === undefined) return value;
  return value.trim() === '' ? undefined : value;
}

/** Same contract as {@link optionalString} for finite numbers. */
export function optionalFiniteNumber(
  record: Record<string, unknown>,
  key: string,
): number | null | Malformed {
  if (isAbsent(record, key)) return null;
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Same contract as {@link optionalString} for booleans. */
export function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | null | Malformed {
  if (isAbsent(record, key)) return null;
  return typeof record[key] === 'boolean' ? (record[key] as boolean) : undefined;
}

/** Absent/`null` ⇒ `null`; present non-object ⇒ {@link Malformed}. */
export function optionalRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null | Malformed {
  if (isAbsent(record, key)) return null;
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

/**
 * Absent/`null` ⇒ `[]` (nothing supplied); present non-array or any malformed
 * element ⇒ {@link Malformed}. An empty supplied array stays empty: "the
 * backend said none" and "the backend said nothing" are both rendered as an
 * explicit empty state, never as invented content.
 */
export function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
): readonly string[] | Malformed {
  if (isAbsent(record, key)) return [];
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '') return undefined;
    items.push(entry);
  }
  return items;
}

/** Same contract as {@link optionalStringArray} for finite numbers. */
export function optionalNumberArray(
  record: Record<string, unknown>,
  key: string,
): readonly number[] | Malformed {
  if (isAbsent(record, key)) return [];
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const items: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return undefined;
    items.push(entry);
  }
  return items;
}

/** Same contract as {@link optionalStringArray} for plain objects. */
export function optionalRecordArray(
  record: Record<string, unknown>,
  key: string,
): readonly Record<string, unknown>[] | Malformed {
  if (isAbsent(record, key)) return [];
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const items: Record<string, unknown>[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return undefined;
    items.push(entry);
  }
  return items;
}

/**
 * A required non-empty string. The two failure modes stay distinguishable so a
 * caller can report "missing" and "malformed" as different contract breaches.
 */ export type RequiredStringLookup =
  { readonly kind: 'MISSING' } | { readonly kind: 'INVALID' } | string;

export function requiredNonEmptyString(
  record: Record<string, unknown>,
  key: string,
): RequiredStringLookup {
  if (isAbsent(record, key)) return { kind: 'MISSING' };
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') return { kind: 'INVALID' };
  return value;
}

/**
 * Reads a segment identifier that the wire may carry either as a bare string
 * (the live handler's `primary_evacuation: string | null`) or as an object with
 * a `segment_id` (design §12's `{"segment_id": "RD_TPE_004", …}` example).
 *
 * Both spellings are documented forms of the same authoritative value, so both
 * are accepted verbatim; nothing else is. This is tolerance for a known
 * contract drift, not a rename and not a guess.
 */
/**
 * Reads a segment identifier that the wire may carry either as a bare string
 * (the live handler's `primary_evacuation: string | null`) or as an object with
 * a `segment_id` (design §12's `{"segment_id": "RD_TPE_004", …}` example).
 *
 * Both spellings are documented forms of the same authoritative value, so both
 * are accepted verbatim; nothing else is. This is tolerance for a known
 * contract drift, not a rename and not a guess.
 */
export function readSegmentReference(value: unknown): string | null | Malformed {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() === '' ? undefined : value;
  if (isRecord(value)) return optionalNonEmptyString(value, 'segment_id');
  return undefined;
}

/** {@link readSegmentReference} for one key of a record. */
export function optionalSegmentReference(
  record: Record<string, unknown>,
  key: string,
): string | null | Malformed {
  if (isAbsent(record, key)) return null;
  return readSegmentReference(record[key]);
}

/** {@link readSegmentReference} over an array-valued key. */
export function optionalSegmentReferenceArray(
  record: Record<string, unknown>,
  key: string,
): readonly string[] | Malformed {
  if (isAbsent(record, key)) return [];
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const items: string[] = [];
  for (const entry of value) {
    const resolved = readSegmentReference(entry);
    if (resolved === undefined || resolved === null) return undefined;
    items.push(resolved);
  }
  return items;
}
