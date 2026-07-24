import { describe } from "vitest";
import * as fc from "fast-check";
import { propertyTest } from "../helpers/pbt-helper";

describe("Sample property tests (PBT framework validation)", () => {
  propertyTest(
    0,
    "addition is commutative",
    fc.tuple(fc.integer(), fc.integer()),
    ([a, b]) => {
      return a + b === b + a;
    },
  );

  propertyTest(
    0,
    "array reverse is involutory",
    fc.array(fc.integer()),
    (arr) => {
      const reversed = [...arr].reverse().reverse();
      return (
        arr.length === reversed.length &&
        arr.every((v, i) => v === reversed[i])
      );
    },
  );
});
