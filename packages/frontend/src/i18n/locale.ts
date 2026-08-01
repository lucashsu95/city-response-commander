/**
 * Locale Definitions (TASK-134)
 *
 * Supported dashboard UI locales. This is UI-language selection only — it
 * never affects which languages a backend-provided public alert carries, and
 * it never triggers any recomputation of multilingual SOP requirements.
 *
 * @module frontend/i18n/locale
 */

/** Supported operator dashboard UI locales. */
export type Locale = 'zh-TW' | 'ja' | 'ko';

/** Default locale on first load, per TASK-134 (§21.3 language floor is unrelated). */
export const DEFAULT_LOCALE: Locale = 'zh-TW';

/** All supported locales, in display order for the language switcher. */
export const SUPPORTED_LOCALES: readonly Locale[] = ['zh-TW', 'ja', 'ko'];

/** Narrows an arbitrary string to {@link Locale}, if it is one of the supported values. */
export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Maps a UI {@link Locale} to the public-alert language code used on the wire
 * (`PublicAlertTextView.language`). This is a display-only correspondence —
 * it does not imply the backend actually supplied text in that language, and
 * it never causes the frontend to fabricate one when absent.
 */
export function localeToAlertLanguage(locale: Locale): string {
  switch (locale) {
    case 'zh-TW':
      return 'zh';
    case 'ja':
      return 'ja';
    case 'ko':
      return 'ko';
  }
}
