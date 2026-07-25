import * as fc from 'fast-check';
import { it } from 'vitest';

/** Design §22.1 requires at least 100 runs for every property. */
export const DEFAULT_NUM_RUNS = 100;

export function propertyLabel(n: number, text: string): string {
  return `Feature: city-response-commander, Property ${n}: ${text}`;
}

export function propertyTest<T>(
  n: number,
  text: string,
  arbitrary: fc.Arbitrary<T>,
  predicate: (value: T) => boolean | void,
  options?: { numRuns?: number },
): void {
  const numRuns = requireMinimumRuns(options?.numRuns);
  it(propertyLabel(n, text), () => {
    fc.assert(fc.property(arbitrary, predicate), { numRuns });
  });
}

export function assertProperty<Ts extends [unknown, ...unknown[]]>(
  property: fc.IPropertyWithHooks<Ts>,
  options?: { numRuns?: number },
): void {
  fc.assert(property, { numRuns: requireMinimumRuns(options?.numRuns) });
}

function requireMinimumRuns(requested: number | undefined): number {
  const numRuns = requested ?? DEFAULT_NUM_RUNS;
  if (!Number.isInteger(numRuns) || numRuns < DEFAULT_NUM_RUNS) {
    throw new Error(`Property tests require numRuns >= ${DEFAULT_NUM_RUNS}; received ${numRuns}.`);
  }
  return numRuns;
}
