/**
 * Drift guard: eslint-local-rules.cjs's LLM_PROHIBITED_FIELDS must match the
 * canonical list in packages/shared-schemas/src/llm_boundary.ts.
 *
 * eslint-local-rules.cjs is a repo-root, lint-time CJS module outside any
 * package's build output, so it keeps its own literal copy instead of
 * importing the (ESM) shared-schemas package directly. This test is what
 * keeps that copy honest — if DecisionCore's fields change and only one
 * side gets updated, this fails instead of silently drifting.
 */
import { describe, it, expect } from 'vitest';
import { LLM_PROHIBITED_FIELDS as CANONICAL } from '@city-commander/shared-schemas';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const localRules = require('../../eslint-local-rules.cjs') as {
  LLM_PROHIBITED_FIELDS: Set<string>;
};

describe('LLM_PROHIBITED_FIELDS sync', () => {
  it('eslint-local-rules.cjs matches the shared-schemas canonical list', () => {
    expect([...localRules.LLM_PROHIBITED_FIELDS].sort()).toEqual([...CANONICAL].sort());
  });
});
