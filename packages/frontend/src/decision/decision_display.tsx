/**
 * Decision Panel Display Primitives (§16, §21)
 *
 * TASK-132. Shared presentation atoms for the decision panels (report, public
 * alert, explanation chain, routes, ETE). Every helper here is formatting only:
 *
 * - a value the backend did not supply is shown as an explicit "not supplied"
 *   marker, never as `0`, `false`, `—`, or an empty cell
 * - a number is stringified as received: never rounded, scaled, or re-unit'd
 * - a badge reflects a backend flag; no badge is ever derived from a threshold
 *
 * @module frontend/decision/decision_display
 */

import type { ReactNode } from 'react';

/** Shown where the backend supplied no value at all. */
export const UNAVAILABLE = '尚無資料';

/**
 * Shown where a field is expected by the design contract but absent from the
 * live payload. Distinct from {@link UNAVAILABLE} so a contract gap is not
 * mistaken for "no data at this moment".
 */
export const NOT_SUPPLIED = '後端未提供（前端不得代算）';

/** Stringifies a backend number verbatim. */
export function numberText(value: number | null): string {
  return value === null ? UNAVAILABLE : String(value);
}

/** Renders a backend boolean. Never inferred from another field. */
export function booleanText(value: boolean | null): string {
  if (value === null) return UNAVAILABLE;
  return value ? '是' : '否';
}

/** Renders backend text verbatim, or the unavailable marker. */
export function textOrUnavailable(value: string | null): string {
  return value === null || value === '' ? UNAVAILABLE : value;
}

/** Renders a list of article numbers as SOP article labels. */
export function articleListText(articles: readonly number[]): string {
  return articles.length === 0 ? '無' : articles.map((article) => `第 ${article} 條`).join('、');
}

/** Renders a list of identifiers, or an explicit "none". */
export function idListText(ids: readonly string[]): string {
  return ids.length === 0 ? '無' : ids.join('、');
}

// ─── Badges ──────────────────────────────────────────────────

export interface BadgeProps {
  readonly children: ReactNode;
}

/**
 * Marks a value produced under a provisional (Strategy A–F) team policy.
 * Rendered wherever the design marks a field `@provisional`.
 */
export function ProvisionalBadge({ children = '暫定政策' }: Partial<BadgeProps>): ReactNode {
  return (
    <span className="decision-badge decision-badge--provisional" role="note">
      {children}
    </span>
  );
}

/** Marks text produced by the deterministic §21.3 template, not by Bedrock. */
export function TemplateBadge(): ReactNode {
  return (
    <span className="decision-badge decision-badge--template" role="note">
      系統模板
    </span>
  );
}

/** Marks text authored by Bedrock (explanatory only, never authoritative). */
export function AiTextBadge(): ReactNode {
  return (
    <span className="decision-badge decision-badge--ai" role="note">
      AI 生成文字（不得取代核心數值）
    </span>
  );
}

/** Marks a deterministic, LLM-prohibited value. */
export function DeterministicBadge(): ReactNode {
  return (
    <span className="decision-badge decision-badge--deterministic" role="note">
      決定性核心值（LLM 不可改寫）
    </span>
  );
}

export interface NoticeProps {
  readonly message: string;
}

/** Human-confirmation requirement carried by the backend. */
export function ManualConfirmationNotice({ message }: NoticeProps): ReactNode {
  return (
    <p className="decision-notice decision-notice--manual" role="alert">
      需人工確認：{message}
    </p>
  );
}

/**
 * A contract breach the panel refuses to paper over — for example an excluded
 * candidate with no exclusion reason, which the server is required to
 * guarantee (R13.3). Surfaced as a data error rather than an empty cell.
 */
export function DataContractWarning({ message }: NoticeProps): ReactNode {
  return (
    <p className="decision-notice decision-notice--contract" role="alert">
      資料合約異常：{message}
    </p>
  );
}

/** A design-contract field the live payload does not carry yet. */
export function NotSuppliedNote({ message }: NoticeProps): ReactNode {
  return (
    <p className="decision-notice decision-notice--gap" role="note">
      {message}
    </p>
  );
}

// ─── Field List ──────────────────────────────────────────────

export interface FieldRowProps {
  readonly label: string;
  readonly children: ReactNode;
  /** Optional marker rendered after the value (e.g. a provisional badge). */
  readonly marker?: ReactNode;
}

/** One labelled read-only field. */
export function FieldRow({ label, children, marker }: FieldRowProps): ReactNode {
  return (
    <div className="decision-field">
      <dt className="decision-field__label">{label}</dt>
      <dd className="decision-field__value">
        {children}
        {marker}
      </dd>
    </div>
  );
}

export interface FieldListProps {
  readonly children: ReactNode;
  readonly className?: string;
}

/** Container for {@link FieldRow}s. */
export function FieldList({ children, className }: FieldListProps): ReactNode {
  return <dl className={className ?? 'decision-field-list'}>{children}</dl>;
}
