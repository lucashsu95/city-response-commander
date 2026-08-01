/**
 * Typed Bundle Resolver (TASK-134)
 *
 * Resolves a {@link Locale} to its translation bundle and performs simple
 * `{token}` interpolation for the handful of keys that carry a backend-
 * provided number/string (e.g. staleness minutes, polling counts). The
 * interpolated values themselves are always caller-supplied backend data —
 * this module never invents or computes one.
 *
 * @module frontend/i18n/resolver
 */

import type { Locale } from './locale.js';
import { zhTW } from './translations/zh-TW.js';
import type { ZhTWKeys } from './translations/zh-TW.js';
import { ja } from './translations/ja.js';
import { ko } from './translations/ko.js';

/** Union of every translation key. Typed so an unknown key fails to compile. */
export type TranslationKey = ZhTWKeys;

const BUNDLES: Readonly<Record<Locale, Readonly<Record<TranslationKey, string>>>> = {
  'zh-TW': zhTW,
  ja,
  ko,
};

/** Returns the full bundle for one locale. */
export function getBundle(locale: Locale): Readonly<Record<TranslationKey, string>> {
  return BUNDLES[locale];
}

/**
 * Looks up one key in the given locale's bundle and substitutes any
 * `{token}` placeholders from `params`. A missing param leaves the token
 * untouched rather than throwing, so a translation gap is visible instead of
 * crashing the dashboard.
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  const bundle = getBundle(locale);
  const template = bundle[key];
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, token: string) => {
    const value = params[token];
    return value === undefined ? match : String(value);
  });
}
