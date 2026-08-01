/**
 * i18n Module Public Surface (TASK-134)
 *
 * @module frontend/i18n
 */

export { DEFAULT_LOCALE, SUPPORTED_LOCALES, isLocale, localeToAlertLanguage } from './locale.js';
export type { Locale } from './locale.js';
export { getBundle, translate } from './resolver.js';
export type { TranslationKey } from './resolver.js';
export { LocaleProvider, useI18n } from './locale_provider.js';
export type { I18nContextValue } from './locale_provider.js';
export { LanguageSwitcher } from './language_switcher.js';
export { selectServerPublicAlertText } from './public_alert.js';
export type { ServerPublicAlertText, SelectedPublicAlertText } from './public_alert.js';
