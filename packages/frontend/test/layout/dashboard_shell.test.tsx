/**
 * Dashboard Shell Tests (TASK-121)
 *
 * Tests that dashboard renders four semantic regions.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardShell } from '../../src/layout/dashboard_shell.js';

describe('DashboardShell', () => {
  it('renders main title', () => {
    render(<DashboardShell />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByText('城市交通應變 AI 指揮台')).toBeInTheDocument();
  });

  it('renders four dashboard regions', () => {
    render(<DashboardShell />);

    // Find all region sections
    const regions = screen.getAllByRole('region');

    // Should have at least 4 regions (Timeline, Roads, Crowd, Decision)
    // Plus potentially the status bar region
    expect(regions.length).toBeGreaterThanOrEqual(4);
  });

  it('renders Timeline region with heading', () => {
    render(<DashboardShell />);

    expect(screen.getByText('時間軸')).toBeInTheDocument();
    expect(screen.getByText('尚無可顯示的時間軸資料')).toBeInTheDocument();
  });

  it('renders Road Traffic region with heading', () => {
    render(<DashboardShell />);

    expect(screen.getByText('路段車流')).toBeInTheDocument();
    expect(screen.getByText('尚無可顯示的路段資料')).toBeInTheDocument();
  });

  it('renders Crowd region with heading', () => {
    render(<DashboardShell />);

    expect(screen.getByText('基地台人流')).toBeInTheDocument();
    expect(screen.getByText('尚無可顯示的基地台資料')).toBeInTheDocument();
  });

  it('renders Decision region with heading', () => {
    render(<DashboardShell />);

    expect(screen.getByText('決策指令')).toBeInTheDocument();
    expect(screen.getByText('目前尚無可顯示的決策結果')).toBeInTheDocument();
  });

  it('renders footer', () => {
    render(<DashboardShell />);

    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByText('City Response Commander')).toBeInTheDocument();
  });

  it('renders operational status bar', () => {
    render(<DashboardShell />);

    // Status bar should show default disconnected state
    expect(screen.getByText('已斷線')).toBeInTheDocument();
    expect(screen.getByText('資料為最新')).toBeInTheDocument();
  });
});
