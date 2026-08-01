/**
 * Accessible comet spinner for general data loading and submission states.
 *
 * The geometry follows Loading UI's comet spinner, while animation keyframes
 * live in the shared stylesheet so rendering the component never injects a
 * duplicate `<style>` element.
 *
 * @module frontend/components/loading/comet_spinner
 */

import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from 'react';
import { useI18n } from '../../i18n/index.js';

type CometSpinnerStyle = CSSProperties & {
  '--loading-ui-comet-head': string;
  '--loading-ui-comet-radius': string;
};

export interface CometSpinnerProps
  extends Omit<ComponentPropsWithoutRef<'span'>, 'children' | 'role'> {
  /** Accessible loading text. Defaults to the active TASK-134 locale. */
  readonly label?: string;
  /** Relative size of the comet head. Clamped to 0.08–0.35. */
  readonly headScale?: number;
  /** Relative orbit radius. Clamped to 0.3–1.1. */
  readonly radiusScale?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** General-purpose loading spinner for dashboard data and write operations. */
export function CometSpinner({
  className,
  style,
  label,
  headScale = 0.2,
  radiusScale = 0.83,
  'aria-label': ariaLabel,
  'aria-live': ariaLive,
  ...props
}: CometSpinnerProps): ReactNode {
  const { t } = useI18n();
  const resolvedLabel = label ?? t('async.loading');
  const safeHeadScale = clamp(headScale, 0.08, 0.35);
  const safeRadiusScale = clamp(radiusScale, 0.3, 1.1);
  const cometStyle: CometSpinnerStyle = {
    ...style,
    '--loading-ui-comet-head': `${(safeHeadScale * 100).toFixed(2)}cqmin`,
    '--loading-ui-comet-radius': `${(safeRadiusScale * 100).toFixed(2)}cqmin`,
  };

  return (
    <span
      {...props}
      role="status"
      aria-live={ariaLive ?? 'polite'}
      aria-label={ariaLabel ?? resolvedLabel}
      className={['loading-spinner', 'comet-spinner', className].filter(Boolean).join(' ')}
      style={cometStyle}
    >
      <span aria-hidden="true" className="comet-spinner__visual" />
      <span className="sr-only">{resolvedLabel}</span>
    </span>
  );
}
