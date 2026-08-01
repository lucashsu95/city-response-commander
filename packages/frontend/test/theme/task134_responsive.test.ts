import { describe, expect, it } from 'vitest';
import {
  BREAKPOINTS,
  MEDIA_QUERIES,
  MIN_SUPPORTED_VIEWPORT_WIDTH,
  MIN_TOUCH_TARGET_PX,
  PREFERS_REDUCED_MOTION_QUERY,
  maxWidthQuery,
  minWidthQuery,
  resolveBreakpoint,
  resolveResponsiveLayout,
  widthRangeQuery,
} from '../../src/theme/responsive.js';

describe('TASK-134 responsive breakpoint helpers', () => {
  it('resolves required widths into mobile/tablet/desktop/wide tiers', () => {
    expect(MIN_SUPPORTED_VIEWPORT_WIDTH).toBe(320);
    expect(resolveBreakpoint(320)).toBe('mobile');
    expect(resolveBreakpoint(375)).toBe('mobile');
    expect(resolveBreakpoint(768)).toBe('tablet');
    expect(resolveBreakpoint(1024)).toBe('desktop');
    expect(resolveBreakpoint(1440)).toBe('wide');
  });

  it('centralizes media-query strings and the 44px touch target', () => {
    expect(BREAKPOINTS).toEqual({ mobile: 0, tablet: 768, desktop: 1024, wide: 1440 });
    expect(MEDIA_QUERIES.tablet).toBe('(min-width: 768px)');
    expect(minWidthQuery(1024)).toBe('(min-width: 1024px)');
    expect(maxWidthQuery(767)).toBe('(max-width: 767px)');
    expect(widthRangeQuery(768, 1023)).toBe('(min-width: 768px) and (max-width: 1023px)');
    expect(MIN_TOUCH_TARGET_PX).toBe(44);
    expect(PREFERS_REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
  });

  it.each([320, 375, 768, 1024, 1440])(
    'keeps the computed core content inside a %ipx viewport',
    (width) => {
      const layout = resolveResponsiveLayout(width);
      expect(layout.contentWidthPx).toBeGreaterThanOrEqual(0);
      expect(layout.contentWidthPx + layout.outerPaddingPx * 2).toBeLessThanOrEqual(width);
      expect(layout.columns).toBe(width < 768 ? 1 : 2);
    },
  );
});
