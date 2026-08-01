/**
 * Accessible triple-dot spinner for typing and AI text-generation states.
 *
 * Animation keyframes are centralized in the shared stylesheet rather than
 * being inserted into the document on every render.
 *
 * @module frontend/components/loading/triple_dot_spinner
 */

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { useI18n } from '../../i18n/index.js';

export interface TripleDotSpinnerProps
  extends Omit<ComponentPropsWithoutRef<'span'>, 'children' | 'role'> {
  /** Accessible loading text. Defaults to the active TASK-134 locale. */
  readonly label?: string;
}

/** Typing indicator reserved for chat, What-if, and AI-generated text. */
export function TripleDotSpinner({
  className,
  label,
  'aria-label': ariaLabel,
  'aria-live': ariaLive,
  ...props
}: TripleDotSpinnerProps): ReactNode {
  const { t } = useI18n();
  const resolvedLabel = label ?? t('async.loading');

  return (
    <span
      {...props}
      role="status"
      aria-live={ariaLive ?? 'polite'}
      aria-label={ariaLabel ?? resolvedLabel}
      className={['loading-spinner', 'triple-dot-spinner', className].filter(Boolean).join(' ')}
    >
      <span aria-hidden="true" className="triple-dot-spinner__visual">
        <span className="triple-dot-spinner__dot" />
        <span className="triple-dot-spinner__dot" />
        <span className="triple-dot-spinner__dot" />
      </span>
      <span className="sr-only">{resolvedLabel}</span>
    </span>
  );
}
