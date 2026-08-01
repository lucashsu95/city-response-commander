/**
 * Responsive Design Tokens (TASK-134)
 *
 * Central, typed source of truth for breakpoints, minimum touch target size,
 * and layout width/spacing tokens used across the dashboard. Consumers read
 * these constants instead of hard-coding pixel values in components or CSS,
 * so 320px/375px/768px/1024px/1440px behaviour stays consistent and auditable
 * from one place.
 *
 * This module is presentation-only: it has no dependency on backend data,
 * issues no request, and makes no SOP/threshold decision. It is a peer of
 * `state/app_state.ts`, not a replacement for it.
 *
 * @module frontend/theme/responsive
 */

// ─── Breakpoints ────────────────────────────────────────────

/** Named breakpoint tiers required by TASK-134 (§ responsive requirements). */
export type BreakpointName = 'mobile' | 'tablet' | 'desktop' | 'wide';

/**
 * Minimum viewport width (px) for each named tier. `mobile` has no explicit
 * floor since it is the base/default tier down to the smallest supported
 * viewport (320px).
 */
export const BREAKPOINTS: Readonly<Record<BreakpointName, number>> = {
  mobile: 0,
  tablet: 768,
  desktop: 1024,
  wide: 1440,
};

/** Minimum viewport width this dashboard is required to render without overflow. */
export const MIN_SUPPORTED_VIEWPORT_WIDTH = 320;

/** `min-width` media-query strings, one per non-base tier. */
export const MEDIA_QUERIES: Readonly<Record<Exclude<BreakpointName, 'mobile'>, string>> = {
  tablet: `(min-width: ${BREAKPOINTS.tablet}px)`,
  desktop: `(min-width: ${BREAKPOINTS.desktop}px)`,
  wide: `(min-width: ${BREAKPOINTS.wide}px)`,
};

/** Builds a `min-width` media query string for an arbitrary pixel value. */
export function minWidthQuery(px: number): string {
  return `(min-width: ${px}px)`;
}

/** Builds a `max-width` media query string. */
export function maxWidthQuery(px: number): string {
  return `(max-width: ${px}px)`;
}

/** Builds a closed viewport range query without duplicating formatting logic. */
export function widthRangeQuery(minPx: number, maxPx: number): string {
  return `${minWidthQuery(minPx)} and ${maxWidthQuery(maxPx)}`;
}

/**
 * Resolves the named tier for a given viewport width. Pure function so it is
 * usable both in tests and in a `matchMedia`-driven hook without duplicating
 * the threshold logic.
 */
export function resolveBreakpoint(viewportWidth: number): BreakpointName {
  if (viewportWidth >= BREAKPOINTS.wide) return 'wide';
  if (viewportWidth >= BREAKPOINTS.desktop) return 'desktop';
  if (viewportWidth >= BREAKPOINTS.tablet) return 'tablet';
  return 'mobile';
}

// ─── Touch Targets ──────────────────────────────────────────

/**
 * Minimum interactive control size (px), per WCAG 2.5.5 / TASK-134's 44px
 * requirement. Applies to buttons, form controls, and any clickable map
 * entity.
 */
export const MIN_TOUCH_TARGET_PX = 44;

// ─── Layout Width / Spacing Tokens ─────────────────────────

/** Max content width per tier, so wide desktops don't stretch text/tables unreadably. */
export const CONTENT_MAX_WIDTH: Readonly<Record<BreakpointName, string>> = {
  mobile: '100%',
  tablet: '100%',
  desktop: '1200px',
  wide: '1440px',
};

/** Spacing scale (px), reused instead of ad hoc rem/px literals. */
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export type SpacingToken = keyof typeof SPACING;

/** Returns a spacing token as a CSS length string, e.g. `spacingPx('lg')` → `'16px'`. */
export function spacingPx(token: SpacingToken): string {
  return `${SPACING[token]}px`;
}

/** Dashboard grid column count per tier (mirrors `global.css`'s `.dashboard-grid`). */
export const GRID_COLUMNS: Readonly<Record<BreakpointName, number>> = {
  mobile: 1,
  tablet: 2,
  desktop: 2,
  wide: 2,
};

export interface ResponsiveLayout {
  readonly breakpoint: BreakpointName;
  readonly columns: number;
  readonly outerPaddingPx: number;
  readonly gapPx: number;
  readonly contentWidthPx: number;
}

const CONTENT_MAX_WIDTH_PX: Readonly<Record<BreakpointName, number>> = {
  mobile: Number.POSITIVE_INFINITY,
  tablet: Number.POSITIVE_INFINITY,
  desktop: 1200,
  wide: 1440,
};

/**
 * Pure layout projection used by responsive tests and non-DOM consumers. It
 * guarantees the computed content box never exceeds the supplied viewport.
 */
export function resolveResponsiveLayout(viewportWidth: number): ResponsiveLayout {
  const safeWidth = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  const breakpoint = resolveBreakpoint(safeWidth);
  const outerPaddingPx = breakpoint === 'mobile' ? SPACING.md : SPACING.xl;
  const availableWidth = Math.max(0, safeWidth - outerPaddingPx * 2);
  return {
    breakpoint,
    columns: GRID_COLUMNS[breakpoint],
    outerPaddingPx,
    gapPx: breakpoint === 'mobile' ? SPACING.md : SPACING.xl,
    contentWidthPx: Math.min(availableWidth, CONTENT_MAX_WIDTH_PX[breakpoint]),
  };
}

// ─── Reduced Motion ─────────────────────────────────────────

/** `prefers-reduced-motion` media query, reused instead of a string literal. */
export const PREFERS_REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Reads the current `prefers-reduced-motion` preference. Returns `false` in
 * non-browser environments (e.g. server-side rendering, or a test without a
 * `matchMedia` polyfill) rather than throwing.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(PREFERS_REDUCED_MOTION_QUERY).matches;
}
