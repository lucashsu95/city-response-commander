/**
 * Selects one server-provided public-alert text for the active UI locale.
 *
 * This module never translates text, calls a model, or derives a multilingual
 * trigger. It only chooses among strings already returned by the backend. When
 * the requested ja/ko text is absent, the UI contract falls back to Traditional
 * Chinese (`zh`/`zh-TW`) and then to the first supported server-provided text.
 */

import { localeToAlertLanguage, type Locale } from './locale.js';

export interface ServerPublicAlertText {
  readonly language: string;
  readonly text: string;
}

export interface SelectedPublicAlertText extends ServerPublicAlertText {
  readonly requestedLanguage: string;
  readonly usedFallback: boolean;
}

const DISPLAYABLE_ALERT_LANGUAGES = new Set(['zh', 'zh-TW', 'ja', 'ko']);

function isTraditionalChinese(language: string): boolean {
  return language === 'zh' || language === 'zh-TW';
}

function matchesRequested(language: string, requested: string): boolean {
  return requested === 'zh' ? isTraditionalChinese(language) : language === requested;
}

/** Returns only backend-provided text; `null` means the backend supplied no usable locale. */
export function selectServerPublicAlertText(
  suppliedTexts: readonly ServerPublicAlertText[],
  locale: Locale,
): SelectedPublicAlertText | null {
  const requestedLanguage = localeToAlertLanguage(locale);
  const usable = suppliedTexts.filter(
    (entry) => DISPLAYABLE_ALERT_LANGUAGES.has(entry.language) && entry.text.trim() !== '',
  );
  const exact = usable.find((entry) => matchesRequested(entry.language, requestedLanguage));
  const fallback = exact ?? usable.find((entry) => isTraditionalChinese(entry.language)) ?? usable[0];

  if (fallback === undefined) return null;
  return {
    ...fallback,
    requestedLanguage,
    usedFallback: !matchesRequested(fallback.language, requestedLanguage),
  };
}
