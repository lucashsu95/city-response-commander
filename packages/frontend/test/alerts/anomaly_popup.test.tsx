/**
 * Anomaly Popup Component Tests (TASK-127)
 *
 * Accessibility and verbatim-rendering behaviour. Deterministic, no timers.
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AnomalyPopup } from '../../src/alerts/anomaly_popup.js';
import type { AnomalyPresentation } from '../../src/alerts/anomaly_model.js';

function presentation(overrides: Partial<AnomalyPresentation> = {}): AnomalyPresentation {
  return {
    identity: 'RD_TPE_0007@2026-05-20 22:10',
    source: 'realtime',
    category: 'ROAD_SATURATION',
    entityId: 'RD_TPE_0007',
    summary: '中山北路南下車道已達癱瘓等級，請立即啟動替代動線。',
    observedAt: '2026-05-20 22:10',
    stale: null,
    provisional: true,
    dataStatus: null,
    serverSignals: ['ROAD_SATURATION'],
    thresholdLabel: 'SOP-1 A 級',
    valueLabel: '0.97',
    ...overrides,
  };
}

describe('AnomalyPopup (TASK-127)', () => {
  it('1. renders nothing while closed', () => {
    render(<AnomalyPopup anomaly={presentation()} isOpen={false} onDismiss={() => {}} />);

    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('renders nothing when there is no anomaly', () => {
    render(<AnomalyPopup anomaly={null} isOpen onDismiss={() => {}} />);

    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('11a. exposes an accessible alertdialog with a title and description', () => {
    render(<AnomalyPopup anomaly={presentation()} isOpen onDismiss={() => {}} />);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const titleId = dialog.getAttribute('aria-labelledby');
    const descriptionId = dialog.getAttribute('aria-describedby');
    expect(titleId).not.toBeNull();
    expect(descriptionId).not.toBeNull();
    expect(document.getElementById(titleId as string)?.textContent).toBe('偵測到異常');
    expect(document.getElementById(descriptionId as string)?.textContent).toBe(
      '中山北路南下車道已達癱瘓等級，請立即啟動替代動線。',
    );
  });

  it('4. shows the backend summary verbatim', () => {
    render(
      <AnomalyPopup
        anomaly={presentation({ summary: '後端原文：站區人流暴增。' })}
        isOpen
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByTestId('anomaly-popup-description').textContent).toBe(
      '後端原文：站區人流暴增。',
    );
  });

  it('falls back to fixed framing when the backend supplied no text', () => {
    render(
      <AnomalyPopup
        anomaly={presentation({ source: 'roads', summary: null })}
        isOpen
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByTestId('anomaly-popup-description').textContent).toBe(
      '請查看即時道路與人流警示',
    );
  });

  it('renders the backend category, entity, instant and signals', () => {
    render(<AnomalyPopup anomaly={presentation()} isOpen onDismiss={() => {}} />);

    expect(screen.getByTestId('anomaly-popup-category').textContent).toBe('ROAD_SATURATION');
    expect(screen.getByTestId('anomaly-popup-entity').textContent).toBe('RD_TPE_0007');
    expect(screen.getByTestId('anomaly-popup-observed-at').textContent).toBe('2026-05-20 22:10');
    expect(screen.getByTestId('anomaly-popup-signals').textContent).toBe('ROAD_SATURATION');
    expect(screen.getByTestId('anomaly-popup-source').textContent).toContain('即時推播');
  });

  it('21. shows a textual stale indicator only when the backend said stale', () => {
    const view = render(
      <AnomalyPopup anomaly={presentation({ stale: true })} isOpen onDismiss={() => {}} />,
    );

    // Carried by text, not colour alone.
    expect(screen.getByTestId('anomaly-popup-stale').textContent).toContain('資料陳舊');

    view.rerender(
      <AnomalyPopup anomaly={presentation({ stale: null })} isOpen onDismiss={() => {}} />,
    );
    expect(screen.queryByTestId('anomaly-popup-stale')).toBeNull();

    view.rerender(
      <AnomalyPopup anomaly={presentation({ stale: false })} isOpen onDismiss={() => {}} />,
    );
    expect(screen.queryByTestId('anomaly-popup-stale')).toBeNull();
  });

  it('omits fields the backend did not supply instead of inventing placeholders', () => {
    render(
      <AnomalyPopup
        anomaly={presentation({
          category: null,
          entityId: null,
          observedAt: null,
          dataStatus: null,
          thresholdLabel: null,
          valueLabel: null,
          serverSignals: [],
          provisional: null,
        })}
        isOpen
        onDismiss={() => {}}
      />,
    );

    expect(screen.queryByTestId('anomaly-popup-category')).toBeNull();
    expect(screen.queryByTestId('anomaly-popup-entity')).toBeNull();
    expect(screen.queryByTestId('anomaly-popup-observed-at')).toBeNull();
    expect(screen.queryByTestId('anomaly-popup-data-status')).toBeNull();
    expect(screen.queryByTestId('anomaly-popup-threshold')).toBeNull();
    expect(screen.queryByTestId('anomaly-popup-value')).toBeNull();
    expect(screen.queryByTestId('anomaly-popup-signals')).toBeNull();
    expect(screen.queryByTestId('anomaly-popup-provisional')).toBeNull();
  });

  it('11b. offers an explicit close control that dismisses', () => {
    const onDismiss = vi.fn();
    render(<AnomalyPopup anomaly={presentation()} isOpen onDismiss={onDismiss} />);

    fireEvent.click(screen.getByTestId('anomaly-popup-close'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('23. Escape dismisses the popup', () => {
    const onDismiss = vi.fn();
    render(<AnomalyPopup anomaly={presentation()} isOpen onDismiss={onDismiss} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated keys', () => {
    const onDismiss = vi.fn();
    render(<AnomalyPopup anomaly={presentation()} isOpen onDismiss={onDismiss} />);

    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'a' });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does not listen for Escape while closed', () => {
    const onDismiss = vi.fn();
    render(<AnomalyPopup anomaly={presentation()} isOpen={false} onDismiss={onDismiss} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('24. moves focus into the popup on open and restores it on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'outside';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const view = render(
      <AnomalyPopup anomaly={presentation()} isOpen onDismiss={() => {}} />,
    );

    expect(document.activeElement).toBe(screen.getByTestId('anomaly-popup-close'));

    view.rerender(
      <AnomalyPopup anomaly={presentation()} isOpen={false} onDismiss={() => {}} />,
    );

    expect(document.activeElement).toBe(trigger);

    view.unmount();
    trigger.remove();
  });

  it('does not throw when the previously focused element is gone at close time', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const view = render(<AnomalyPopup anomaly={presentation()} isOpen onDismiss={() => {}} />);
    trigger.remove();

    expect(() => {
      view.rerender(
        <AnomalyPopup anomaly={presentation()} isOpen={false} onDismiss={() => {}} />,
      );
    }).not.toThrow();

    view.unmount();
  });

  it('removes the dialog from the accessibility tree after unmount', () => {
    const view = render(<AnomalyPopup anomaly={presentation()} isOpen onDismiss={() => {}} />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    view.unmount();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
