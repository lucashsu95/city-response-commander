/**
 * Connection Mode Indicator Tests (TASK-122)
 *
 * Verifies the §13/§16.4 realtime and degraded-polling indicators are visible,
 * accessible, and never claim live data while polling is failing.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ConnectionModeIndicator,
  PollingDegradationNotice,
} from '../../src/components/system/operational_status.js';
import { DashboardShell } from '../../src/layout/dashboard_shell.js';

const REALTIME_LABEL = '即時連線（WebSocket）';
const DEGRADED_LABEL = '即時連線降級為輪詢';

describe('ConnectionModeIndicator', () => {
  it('identifies realtime WebSocket mode', () => {
    render(<ConnectionModeIndicator mode="websocket" />);

    const indicator = screen.getByRole('status');
    expect(indicator).toHaveAttribute('data-connection-mode', 'websocket');
    expect(screen.getByText(REALTIME_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(DEGRADED_LABEL)).not.toBeInTheDocument();
  });

  it('identifies the degraded polling mode with accessible text, not colour alone', () => {
    render(<ConnectionModeIndicator mode="polling" />);

    const indicator = screen.getByRole('status');
    expect(indicator).toHaveAttribute('data-connection-mode', 'polling');
    expect(indicator).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText(DEGRADED_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(REALTIME_LABEL)).not.toBeInTheDocument();
    // Wording carries the state; the coloured dot is decorative only.
    expect(indicator.textContent).toContain(DEGRADED_LABEL);
  });
});

describe('PollingDegradationNotice', () => {
  it('renders nothing outside polling mode', () => {
    const { container } = render(<PollingDegradationNotice mode="websocket" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reports polling refresh progress while degraded', () => {
    render(<PollingDegradationNotice mode="polling" pollingUpdateCount={3} />);
    expect(screen.getByText('已完成 3 次輪詢更新')).toBeInTheDocument();
  });

  it('raises an accessible alert when polling itself is failing', () => {
    render(
      <PollingDegradationNotice
        mode="polling"
        pollingErrorMessage="GET /timeline 輪詢失敗（NETWORK_ERROR）"
        pollingUpdateCount={5}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('輪詢更新失敗');
    expect(alert.textContent).toContain('GET /timeline');
    // No success claim while polling is failing.
    expect(screen.queryByText('已完成 5 次輪詢更新')).not.toBeInTheDocument();
  });
});

describe('DashboardShell connection mode wiring', () => {
  it('shows connected mode in the operational status bar', () => {
    render(<DashboardShell connectionMode="websocket" />);
    expect(screen.getByText(REALTIME_LABEL)).toBeInTheDocument();
  });

  it('shows the degraded polling mode in the operational status bar', () => {
    render(<DashboardShell connectionMode="polling" pollingUpdateCount={2} />);

    expect(screen.getByText(DEGRADED_LABEL)).toBeInTheDocument();
    expect(screen.getByText('已完成 2 次輪詢更新')).toBeInTheDocument();
    expect(screen.queryByText(REALTIME_LABEL)).not.toBeInTheDocument();
  });

  it('does not present a connected state when polling is failing', () => {
    render(
      <DashboardShell
        connectionMode="polling"
        pollingErrorMessage="GET /roads 輪詢失敗（HTTP_ERROR）"
      />,
    );

    expect(screen.getByText(DEGRADED_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(REALTIME_LABEL)).not.toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toContain('輪詢更新失敗');
  });
});
