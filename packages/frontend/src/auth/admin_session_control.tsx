/**
 * Admin Session Control (§17; TASK-128 repair)
 *
 * Minimal UI for an operator to paste an admin Cognito JWT obtained through
 * an external sign-in flow, and to clear it again. This component performs
 * **no authentication and no authorization**: it is a thin, in-memory holder
 * that hands the pasted token to the caller (`onAdminTokenChange`) so it can
 * be forwarded to `InjectionPanel`. The Backend/Cognito authorizer remains
 * the sole source of authorization truth — this control never inspects,
 * decodes, or trusts the JWT payload, and never claims the frontend has
 * verified admin identity.
 *
 * ## Storage model
 *
 * The token lives only in the `adminToken` state owned by the caller
 * (`DashboardPage`, via `useState`). This component never persists it:
 *
 * - no `localStorage` / `sessionStorage` / cookies
 * - no URL, runtime config, or `VITE_*` env var
 * - no `console.log` of the token or any fragment of it
 * - a page refresh naturally clears it, since it is plain React state
 *
 * ## Why a raw paste box and not a login flow
 *
 * Implementing a Cognito Hosted UI / Amplify sign-in is out of this repair's
 * scope (§17 requires the *backend* route to be Cognito(admin)-protected; it
 * does not require this frontend to implement the sign-in UI). This control
 * is the smallest additive seam that lets an operator carry a token obtained
 * elsewhere into the one component that needs it.
 *
 * @module frontend/auth/admin_session_control
 */

import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { hasAdminToken } from './admin_session.js';
import type { AdminToken } from './admin_session.js';
import { useI18n } from '../i18n/index.js';

export interface AdminSessionControlProps {
  /** Current in-memory admin token, or `null` when none is held. */
  readonly adminToken: AdminToken;
  /**
   * Called with the normalized token whenever the operator submits the paste
   * field, and with `null` when they clear it. This component never stores
   * the token itself beyond the local input field's own draft value.
   */
  readonly onAdminTokenChange: (token: AdminToken) => void;
}

/** Blank/whitespace-only input normalizes to `null`, matching `hasAdminToken`. */
function normalizedToken(raw: string): AdminToken {
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Renders the admin JWT paste/clear control.
 *
 * Never renders the token's value, length, or any prefix/suffix of it back
 * to the page — only a boolean "已載入憑證" / "尚未載入憑證" status.
 */
export function AdminSessionControl({
  adminToken,
  onAdminTokenChange,
}: AdminSessionControlProps): ReactNode {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const loaded = hasAdminToken(adminToken);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const token = normalizedToken(draft);
      onAdminTokenChange(token);
      setDraft('');
    },
    [draft, onAdminTokenChange],
  );

  const handleClear = useCallback(() => {
    setDraft('');
    onAdminTokenChange(null);
  }, [onAdminTokenChange]);

  return (
    <div className="admin-session-control" data-testid="admin-session-control">
      <h3 className="admin-session-control__heading">{t('admin.heading')}</h3>
      <p className="admin-session-control__note">
        請貼上由 Cognito admin 帳號取得的 JWT。憑證只保留於目前頁面記憶體，重新整理或清除後即消失。
      </p>
      <p
        className="admin-session-control__status"
        role="status"
        aria-live="polite"
        data-testid="admin-session-status"
      >
        {loaded ? t('admin.statusLoaded') : t('admin.statusEmpty')}
      </p>

      <form
        className="admin-session-control__form"
        onSubmit={handleSubmit}
        aria-label="貼上管理員憑證"
      >
        <label className="admin-session-control__label" htmlFor="admin-jwt-input">
          管理員 JWT
        </label>
        <input
          id="admin-jwt-input"
          className="admin-session-control__input"
          type="password"
          autoComplete="off"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="貼上 Cognito admin JWT"
          data-testid="admin-jwt-input"
        />
        <div className="admin-session-control__actions">
          <button
            type="submit"
            className="admin-session-control__submit"
            data-testid="admin-session-load-button"
            disabled={normalizedToken(draft) === null}
          >
            {t('admin.loadButton')}
          </button>
          <button
            type="button"
            className="admin-session-control__clear"
            onClick={handleClear}
            data-testid="admin-session-clear-button"
            disabled={!loaded && draft === ''}
          >
            {t('admin.clearButton')}
          </button>
        </div>
      </form>
    </div>
  );
}
