/**
 * Admin Auth Seam Tests (§17; TASK-128, gap coverage per TASK-135)
 *
 * `admin_session.ts` had no dedicated test file before this task. Covers the
 * fail-closed contract `injection_panel.tsx` depends on: a `null` or
 * whitespace-only token must never produce a usable `Authorization` header or
 * a "logged in" verdict.
 */

import { describe, expect, it } from 'vitest';
import { adminAuthorizationHeader, hasAdminToken } from '../../src/auth/admin_session.js';

describe('hasAdminToken', () => {
  it('is false for null (no session)', () => {
    expect(hasAdminToken(null)).toBe(false);
  });

  it('is false for an empty string', () => {
    expect(hasAdminToken('')).toBe(false);
  });

  it('is false for a whitespace-only token', () => {
    expect(hasAdminToken('   ')).toBe(false);
    expect(hasAdminToken('\t\n')).toBe(false);
  });

  it('is true for a non-blank token', () => {
    expect(hasAdminToken('abc.def.ghi')).toBe(true);
  });

  it('is true for a token with incidental surrounding whitespace', () => {
    expect(hasAdminToken('  abc.def.ghi  ')).toBe(true);
  });
});

describe('adminAuthorizationHeader', () => {
  it('returns null for a null token (fail closed)', () => {
    expect(adminAuthorizationHeader(null)).toBeNull();
  });

  it('returns null for a whitespace-only token (fail closed)', () => {
    expect(adminAuthorizationHeader('   ')).toBeNull();
  });

  it('builds a Bearer header from a valid token', () => {
    expect(adminAuthorizationHeader('abc.def.ghi')).toBe('Bearer abc.def.ghi');
  });

  it('trims the token before building the header', () => {
    expect(adminAuthorizationHeader('  abc.def.ghi  ')).toBe('Bearer abc.def.ghi');
  });

  it('never returns a header for a token that hasAdminToken rejects', () => {
    for (const token of [null, '', '   ', '\n\t']) {
      expect(hasAdminToken(token)).toBe(false);
      expect(adminAuthorizationHeader(token)).toBeNull();
    }
  });
});
