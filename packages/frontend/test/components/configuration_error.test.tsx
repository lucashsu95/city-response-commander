/**
 * Configuration Error Screen Tests (TASK-121)
 *
 * Tests that configuration errors render accessible UI without crashing.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfigurationErrorScreen } from '../../src/components/system/configuration_error.js';

describe('ConfigurationErrorScreen', () => {
  it('renders error screen with title', () => {
    const errors = [
      {
        code: 'MISSING_API_ENDPOINT' as const,
        message: 'VITE_API_ENDPOINT is required but not configured',
        field: 'apiEndpoint',
      },
    ];

    render(<ConfigurationErrorScreen errors={errors} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('應用程式設定錯誤')).toBeInTheDocument();
  });

  it('renders all error messages', () => {
    const errors = [
      {
        code: 'MISSING_API_ENDPOINT' as const,
        message: 'API endpoint missing',
        field: 'apiEndpoint',
      },
      {
        code: 'MISSING_WS_ENDPOINT' as const,
        message: 'WebSocket endpoint missing',
        field: 'wsEndpoint',
      },
    ];

    render(<ConfigurationErrorScreen errors={errors} />);

    expect(screen.getByText('API endpoint missing')).toBeInTheDocument();
    expect(screen.getByText('WebSocket endpoint missing')).toBeInTheDocument();
  });

  it('renders error codes', () => {
    const errors = [
      {
        code: 'INVALID_API_PROTOCOL' as const,
        message: 'Invalid protocol',
        field: 'apiEndpoint',
      },
    ];

    render(<ConfigurationErrorScreen errors={errors} />);

    expect(screen.getByText('INVALID_API_PROTOCOL')).toBeInTheDocument();
  });

  it('has accessible role and live region', () => {
    const errors = [
      {
        code: 'MISSING_API_ENDPOINT' as const,
        message: 'Missing endpoint',
        field: 'apiEndpoint',
      },
    ];

    render(<ConfigurationErrorScreen errors={errors} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
  });

  it('renders help text about environment variables', () => {
    const errors = [
      {
        code: 'MISSING_API_ENDPOINT' as const,
        message: 'Missing',
        field: 'apiEndpoint',
      },
    ];

    render(<ConfigurationErrorScreen errors={errors} />);

    expect(screen.getByText(/VITE_API_ENDPOINT/)).toBeInTheDocument();
    expect(screen.getByText(/VITE_WS_ENDPOINT/)).toBeInTheDocument();
    expect(screen.getByText(/VITE_APP_ENV/)).toBeInTheDocument();
  });
});
