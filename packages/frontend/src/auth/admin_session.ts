/**
 * Admin Auth Seam (§17; TASK-128)
 *
 * **New seam, added by this task.** No Cognito/auth wiring existed anywhere in
 * `packages/frontend` before TASK-128 (checked: TASK-121's scaffold and
 * `api/client.ts` carry no token, header, or Cognito reference). §17 requires
 * `POST /incidents/{event_id}/inject` to be **Cognito(admin)**-protected, and
 * TASK-128 needs a control-plane place to hold "is an admin token present" and
 * "what header does it produce" — so this module is the smallest additive seam
 * that satisfies that requirement without inventing a Cognito Hosted UI flow,
 * which is deployment/infra scope no task in this pass owns.
 *
 * ## What this module is, and is not
 *
 * - it is a **typed holder** for an admin bearer token (the Cognito access/ID
 *   token an actual Hosted UI/Amplify sign-in would produce) and the derived
 *   `Authorization` header
 * - it is **not** a Cognito client: it does not call any Cognito API, does not
 *   validate JWT signatures or claims, and does not implement sign-in/sign-out.
 *   Token *acquisition* is out of this task's scope; this module only carries
 *   whatever token the surrounding app already has and gates the injection
 *   panel on its presence, per §17's authorization requirement.
 * - the panel derives admin-gating from {@link hasAdminToken} only — never from
 *   guessing a role from the token's contents, since this module does not
 *   decode the token.
 *
 * @module frontend/auth/admin_session
 */

/** An admin bearer token, or `null` when no admin session is present. */
export type AdminToken = string | null;

/**
 * `true` when a non-blank admin token is present.
 *
 * The injection panel's admin gate reads only this — never `token !== null`
 * directly — so a whitespace-only token (e.g. a placeholder left behind by a
 * misconfigured build) is treated the same as no token.
 */
export function hasAdminToken(token: AdminToken): token is string {
  return token !== null && token.trim() !== '';
}

/**
 * Builds the `Authorization` header value for an admin-gated request.
 *
 * @returns `null` when {@link hasAdminToken} would be `false` for this token,
 *          so a caller can never construct a header from an absent/blank token.
 */
export function adminAuthorizationHeader(token: AdminToken): string | null {
  return hasAdminToken(token) ? `Bearer ${token.trim()}` : null;
}
