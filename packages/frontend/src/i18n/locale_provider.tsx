/**
 * Locale Provider / useI18n Hook (TASK-134)
 *
 * Distributes the active dashboard UI locale and a typed `t()` translation
 * function. On mount, and on every locale change, `document.documentElement.lang`
 * is synchronized to the active locale so assistive technology and the
 * browser's own language heuristics see the correct value.
 *
 * This provider owns UI-language selection only. It never reads, writes, or
 * infers anything about the backend's multilingual SOP verdict
 * (`multilingual_required`) or which public-alert languages the backend
 * supplied — those stay entirely inside `decision/alert_panel.tsx`.
 *
 * @module frontend/i18n/locale_provider
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_LOCALE } from './locale.js';
import type { Locale } from './locale.js';
import { translate } from './resolver.js';
import type { TranslationKey } from './resolver.js';

export interface I18nContextValue {
  readonly locale: Locale;
  readonly setLocale: (locale: Locale) => void;
  readonly t: (key: TranslationKey, params?: Readonly<Record<string, string | number>>) => string;
}

const DEFAULT_CONTEXT: I18nContextValue = {
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key, params) => translate(DEFAULT_LOCALE, key, params),
};

// Independently rendered leaf components safely fall back to zh-TW. The app
// itself is always wrapped by LocaleProvider, where locale switching and the
// document language synchronization are active.
const LocaleContext = createContext<I18nContextValue>(DEFAULT_CONTEXT);

export interface LocaleProviderProps {
  readonly children: ReactNode;
  /** Overrides the initial locale. Defaults to {@link DEFAULT_LOCALE} (zh-TW). */
  readonly initialLocale?: Locale;
}

/**
 * Provides the active locale, a locale setter, and a typed `t()` function to
 * the whole dashboard tree.
 *
 * Every locale change synchronizes `document.documentElement.lang` in the
 * same effect that reacts to the locale, so a switch from zh-TW → ja → ko
 * always leaves `<html lang>` consistent with the last selection, including
 * on first mount.
 */
export function LocaleProvider({ children, initialLocale }: LocaleProviderProps): ReactNode {
  const [locale, setLocale] = useState<Locale>(initialLocale ?? DEFAULT_LOCALE);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const t = useCallback(
    (key: TranslationKey, params?: Readonly<Record<string, string | number>>) =>
      translate(locale, key, params),
    [locale],
  );

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * Reads the active locale, setter, and translation function. Leaf components
 * rendered without the application provider use the safe zh-TW default.
 */
export function useI18n(): I18nContextValue {
  return useContext(LocaleContext);
}
