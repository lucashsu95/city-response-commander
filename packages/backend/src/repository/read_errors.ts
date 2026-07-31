/**
 * Read-path errors shared by the strongly-consistent decision-table readers.
 *
 * A read failure is never reported as "absent". `null` means the item provably
 * does not exist; a fault always throws. That distinction is load-bearing for
 * recovery: mistaking a throttled read for a missing DecisionCore would send a
 * recovery down FULL_WORKFLOW and rewrite an already-committed core.
 *
 * @module backend/repository/read_errors
 */

/** Which table a read failure came from. */
export type DecisionTableName = 'DecisionCoreTable' | 'DecisionNarrativeTable';

/** A strongly-consistent read failed. Fail-closed: callers must not continue. */
export class TableReadError extends Error {
  constructor(
    message: string,
    public readonly table: DecisionTableName,
    public readonly operation: 'GetItem' | 'Query',
    public readonly key: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'TableReadError';
  }
}

/** The reader was called in a way that can never be correct. */
export class ReaderUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReaderUsageError';
  }
}
