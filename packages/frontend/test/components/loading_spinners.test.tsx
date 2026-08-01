import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
import type { ApiClient } from '../../src/api/client.js';
import { CometSpinner } from '../../src/components/loading/comet_spinner.js';
import { TripleDotSpinner } from '../../src/components/loading/triple_dot_spinner.js';
import { LoadingIndicator } from '../../src/components/system/async_state.js';
import { LocaleProvider, type Locale } from '../../src/i18n/index.js';
import { DashboardShell } from '../../src/layout/dashboard_shell.js';
import { WhatIfDialog } from '../../src/whatif/whatif_dialog.js';

const PRODUCT_TITLE = 'CHT City Response Commander｜城市應變指揮中心';
const loadingStyles = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../src/styles/global.css'),
  'utf8',
);

describe('shared loading spinners', () => {
  it('exposes role=status and accessible screen-reader loading text', () => {
    render(
      <>
        <CometSpinner label="一般資料載入中" />
        <TripleDotSpinner label="AI 回覆產生中" />
      </>,
    );

    expect(screen.getByRole('status', { name: '一般資料載入中' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'AI 回覆產生中' })).toBeInTheDocument();
    expect(screen.getByText('一般資料載入中')).toHaveClass('sr-only');
    expect(screen.getByText('AI 回覆產生中')).toHaveClass('sr-only');
  });

  it('forwards className, style, and native HTML props', () => {
    render(
      <>
        <CometSpinner
          label="載入中"
          className="custom-comet"
          style={{ color: 'rgb(1, 2, 3)' }}
          data-testid="comet"
          title="comet title"
        />
        <TripleDotSpinner
          label="輸入中"
          className="custom-dots"
          style={{ color: 'rgb(4, 5, 6)' }}
          data-testid="dots"
          title="dots title"
        />
      </>,
    );

    expect(screen.getByTestId('comet')).toHaveClass('comet-spinner', 'custom-comet');
    expect(screen.getByTestId('comet')).toHaveStyle({ color: 'rgb(1, 2, 3)' });
    expect(screen.getByTestId('comet')).toHaveAttribute('title', 'comet title');
    expect(screen.getByTestId('dots')).toHaveClass('triple-dot-spinner', 'custom-dots');
    expect(screen.getByTestId('dots')).toHaveStyle({ color: 'rgb(4, 5, 6)' });
    expect(screen.getByTestId('dots')).toHaveAttribute('title', 'dots title');
  });

  it('clamps CometSpinner headScale and radiusScale to the source geometry limits', () => {
    render(
      <>
        <CometSpinner label="low" headScale={-1} radiusScale={-1} data-testid="low" />
        <CometSpinner label="high" headScale={10} radiusScale={10} data-testid="high" />
      </>,
    );

    expect(screen.getByTestId('low').style.getPropertyValue('--loading-ui-comet-head')).toBe(
      '8.00cqmin',
    );
    expect(screen.getByTestId('low').style.getPropertyValue('--loading-ui-comet-radius')).toBe(
      '30.00cqmin',
    );
    expect(screen.getByTestId('high').style.getPropertyValue('--loading-ui-comet-head')).toBe(
      '35.00cqmin',
    );
    expect(screen.getByTestId('high').style.getPropertyValue('--loading-ui-comet-radius')).toBe(
      '110.00cqmin',
    );
  });

  it('centralizes default durations and reduced-motion handling in shared CSS', () => {
    expect(loadingStyles).toContain('var(--duration, 1.7s)');
    expect(loadingStyles).toContain('var(--duration, 2s)');
    expect(loadingStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.comet-spinner__visual,[\s\S]*\.triple-dot-spinner__visual/,
    );
    expect(loadingStyles).not.toContain('.loading-spinner > style');
  });
});

describe('localized loading labels', () => {
  it.each([
    ['zh-TW', '載入中'],
    ['ja', '読み込み中'],
    ['ko', '불러오는 중'],
  ] as const)('uses the %s TASK-134 aria label', (locale: Locale, label: string) => {
    render(
      <LocaleProvider initialLocale={locale}>
        <CometSpinner />
        <TripleDotSpinner />
      </LocaleProvider>,
    );

    expect(screen.getAllByRole('status', { name: label })).toHaveLength(2);
  });
});

describe('loading usage and branding', () => {
  it('uses CometSpinner for a general Dashboard loading state', () => {
    render(
      <DashboardShell timelineContent={<LoadingIndicator label="載入時間軸中" />} />,
    );

    expect(screen.getByRole('status', { name: '載入時間軸中' })).toHaveClass('comet-spinner');
    expect(document.querySelector('.triple-dot-spinner')).toBeNull();
  });

  it('uses TripleDotSpinner while What-if AI text is being generated', () => {
    const client = {
      postWhatIf: vi.fn(() => new Promise(() => {})),
    } as unknown as ApiClient;

    render(<WhatIfDialog client={client} />);
    fireEvent.change(screen.getByTestId('whatif-query-input'), {
      target: { value: '測試假設情境' },
    });
    fireEvent.click(screen.getByTestId('whatif-submit-button'));
    fireEvent.click(screen.getByTestId('whatif-confirm-button'));

    expect(screen.getByRole('status', { name: 'What-if 計算中' })).toHaveClass(
      'triple-dot-spinner',
    );
    expect(document.querySelector('.comet-spinner')).toBeNull();
  });

  it('sets the exact browser title', () => {
    expect(indexHtml).toContain(`<title>${PRODUCT_TITLE}</title>`);
  });
});
