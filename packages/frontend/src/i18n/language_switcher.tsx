/**
 * Language Switcher (TASK-134)
 *
 * Small dashboard-header control that lets the operator switch the UI
 * language among zh-TW / ja / ko. Selecting a language only changes
 * {@link useI18n}'s `locale` (and, via {@link LocaleProvider}'s effect,
 * `document.documentElement.lang`); it never touches backend data, never
 * triggers a refetch, and never affects which public-alert languages are
 * available.
 *
 * @module frontend/i18n/language_switcher
 */

import type { ReactNode } from 'react';
import { SUPPORTED_LOCALES } from './locale.js';
import type { Locale } from './locale.js';
import { useI18n } from './locale_provider.js';

const LOCALE_LABELS: Readonly<Record<Locale, string>> = {
  'zh-TW': '中文',
  ja: '日本語',
  ko: '한국어',
};

export function LanguageSwitcher(): ReactNode {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="language-switcher" data-testid="language-switcher">
      <label className="language-switcher__label" htmlFor="language-switcher-select">
        {t('shell.languageSwitcher.label')}
      </label>
      <select
        id="language-switcher-select"
        className="language-switcher__select"
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        data-testid="language-switcher-select"
      >
        {SUPPORTED_LOCALES.map((candidate) => (
          <option key={candidate} value={candidate}>
            {LOCALE_LABELS[candidate]}
          </option>
        ))}
      </select>
    </div>
  );
}
