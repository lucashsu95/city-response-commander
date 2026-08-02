import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MultilingualCardDemo } from '../../src/decision/multilingual_card_demo.js';
import type { DemoApiClient, DemoDecisionView } from '../../src/api/demo_api_adapter.js';

function createDecision(): DemoDecisionView {
  return {
    multilingualRequired: true,
    publicAlerts: {
      multilingual_required: true,
      languages: ['zh', 'en', 'ja', 'ko'],
      messages: {
        zh: '中文警示',
        en: 'English alert',
        ja: '日本語の警告',
        ko: '한국어 경고',
      },
    },
  } as unknown as DemoDecisionView;
}

describe('MultilingualCardDemo — four-language alerts', () => {
  it('shows Japanese and Korean tabs when the backend provides both messages', () => {
    const adapter = {
      publishDecision: vi.fn(),
    } as unknown as DemoApiClient;
    render(<MultilingualCardDemo decision={createDecision()} adapter={adapter} />);

    const japaneseTab = screen.getByRole('tab', { name: '日本語' });
    const koreanTab = screen.getByRole('tab', { name: '한국어' });
    expect(japaneseTab).not.toHaveClass('ai-multilingual-tab__btn--unavailable');
    expect(koreanTab).not.toHaveClass('ai-multilingual-tab__btn--unavailable');

    fireEvent.click(japaneseTab);
    expect(screen.getByRole('tabpanel').textContent).toContain('日本語の警告');

    fireEvent.click(koreanTab);
    expect(screen.getByRole('tabpanel').textContent).toContain('한국어 경고');
  });
});
