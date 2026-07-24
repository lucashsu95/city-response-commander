import * as fc from "fast-check";
import { it } from "vitest";

/**
 * Default number of iterations for property-based tests.
 * Design §22.1 requires ≥100 iterations per property.
 */
const DEFAULT_NUM_RUNS = 100;

/**
 * Creates the standard label for a property test.
 * Format: `Feature: city-response-commander, Property {n}: {text}`
 */
export function propertyLabel(n: number, text: string): string {
  return `Feature: city-response-commander, Property ${n}: ${text}`;
}

/**
 * Registers a vitest test case that runs a fast-check property assertion
 * with ≥100 iterations and the required label format.
 *
 * @param n - The property number (e.g., 1 for P1)
 * @param text - A short description of the property
 * @param arbitrary - The fast-check arbitrary (generator)
 * @param predicate - The property predicate to verify
 * @param options - Optional overrides for fc.assert parameters
 */
export function propertyTest<T>(
  n: number,
  text: string,
  arbitrary: fc.Arbitrary<T>,
  predicate: (value: T) => boolean | void,
  options?: { numRuns?: number },
): void {
  const label = propertyLabel(n, text);
  const numRuns = options?.numRuns ?? DEFAULT_NUM_RUNS;

  it(label, () => {
    fc.assert(fc.property(arbitrary, predicate), { numRuns });
  });
}

/**
 * Runs fc.assert with the project default numRuns (≥100).
 * Use this when you need more control over the test structure
 * but still want the default iteration count.
 */
export function assertProperty<Ts extends [unknown, ...unknown[]]>(
  property: fc.IPropertyWithHooks<Ts>,
  options?: { numRuns?: number },
): void {
  fc.assert(property, { numRuns: options?.numRuns ?? DEFAULT_NUM_RUNS });
}
