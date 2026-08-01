import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DashboardShell } from '../../src/layout/dashboard_shell.js';
import {
  DEFAULT_LOCALE,
  LocaleProvider,
  SUPPORTED_LOCALES,
  getBundle,
  isLocale,
  selectServerPublicAlertText,
  translate,
  type Locale,
} from '../../src/i18n/index.js';

describe('TASK-134 typed locale bundles', () => {
  it('resolves only zh-TW, ja and ko and defaults to zh-TW', () => {
    expect(DEFAULT_LOCALE).toBe('zh-TW');
    expect(SUPPORTED_LOCALES).toEqual(['zh-TW', 'ja', 'ko']);
    expect(isLocale('zh-TW')).toBe(true);
    expect(isLocale('ja')).toBe(true);
    expect(isLocale('ko')).toBe(true);
    expect(isLocale('en')).toBe(false);
  });

  it('keeps every locale bundle key-complete', () => {
    const referenceKeys = Object.keys(getBundle('zh-TW')).sort();
    expect(Object.keys(getBundle('ja')).sort()).toEqual(referenceKeys);
    expect(Object.keys(getBundle('ko')).sort()).toEqual(referenceKeys);
    expect(translate('ja', 'region.timeline.heading')).toBe('タイムライン');
    expect(translate('ko', 'region.timeline.heading')).toBe('타임라인');
  });
});

describe('TASK-134 LocaleProvider and Dashboard', () => {
  it('switches zh-TW → ja → ko and synchronizes document.lang', async () => {
    render(
      <LocaleProvider>
        <DashboardShell />
      </LocaleProvider>,
    );

    const select = screen.getByTestId('language-switcher-select');
    await waitFor(() => expect(document.documentElement.lang).toBe('zh-TW'));
    expect(
      screen.getByRole('heading', { name: 'CHT City Response Commander｜城市應變指揮中心' }),
    ).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'ja' } });
    await waitFor(() => expect(document.documentElement.lang).toBe('ja'));
    expect(
      screen.getByRole('heading', { name: 'CHT City Response Commander｜城市應變指揮中心' }),
    ).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'ko' } });
    await waitFor(() => expect(document.documentElement.lang).toBe('ko'));
    expect(
      screen.getByRole('heading', { name: 'CHT City Response Commander｜城市應變指揮中心' }),
    ).toBeInTheDocument();
  });

  it.each(SUPPORTED_LOCALES)('keeps every major Dashboard region in %s', (locale: Locale) => {
    const bundle = getBundle(locale);
    render(
      <LocaleProvider initialLocale={locale}>
        <DashboardShell />
      </LocaleProvider>,
    );

    for (const key of [
      'region.timeline.heading',
      'region.roads.heading',
      'region.crowd.heading',
      'region.decision.heading',
      'region.whatif.heading',
      'region.map.heading',
      'region.injection.heading',
    ] as const) {
      expect(screen.getByRole('heading', { name: bundle[key] })).toBeInTheDocument();
    }
  });
});

describe('TASK-134 server public-alert locale selection', () => {
  const supplied = [
    { language: 'zh', text: '後端中文警示 RD_TPE_004' },
    { language: 'ja', text: 'バックエンド日本語警報 RD_TPE_004' },
  ] as const;

  it('uses the exact backend text for the requested locale', () => {
    expect(selectServerPublicAlertText(supplied, 'ja')).toEqual({
      language: 'ja',
      text: 'バックエンド日本語警報 RD_TPE_004',
      requestedLanguage: 'ja',
      usedFallback: false,
    });
  });

  it('falls back to backend Traditional Chinese without translating or rewriting facts', () => {
    expect(selectServerPublicAlertText(supplied, 'ko')).toEqual({
      language: 'zh',
      text: '後端中文警示 RD_TPE_004',
      requestedLanguage: 'ko',
      usedFallback: true,
    });
  });

  it('returns null rather than translating unsupported backend text', () => {
    expect(selectServerPublicAlertText([{ language: 'en', text: 'Backend alert' }], 'ko')).toBeNull();
  });
});
