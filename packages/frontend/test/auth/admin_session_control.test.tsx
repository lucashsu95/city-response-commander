/**
 * Admin Session Control Tests (§17; TASK-128 repair, gap coverage per TASK-135)
 *
 * `admin_session_control.tsx` had no dedicated test file before this task.
 * Covers: load/clear round-trip, the "never render the token value" guarantee,
 * and the status text that `InjectionPanel`'s admin gate depends on.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AdminSessionControl } from '../../src/auth/admin_session_control.js';

function noop(): void {
  // intentionally empty
}

describe('AdminSessionControl — UX state', () => {
  it('shows "not loaded" when adminToken is null', () => {
    render(<AdminSessionControl adminToken={null} onAdminTokenChange={noop} />);

    expect(screen.getByTestId('admin-session-status').textContent).toBe('目前狀態：尚未載入憑證');
  });

  it('shows "loaded" when adminToken is present', () => {
    render(<AdminSessionControl adminToken="abc.def.ghi" onAdminTokenChange={noop} />);

    expect(screen.getByTestId('admin-session-status').textContent).toBe('目前狀態：已載入憑證');
  });

  it('never renders the token value anywhere in the DOM', () => {
    const secretToken = 'super-secret-jwt-value-should-not-leak';
    render(<AdminSessionControl adminToken={secretToken} onAdminTokenChange={noop} />);

    expect(document.body.textContent).not.toContain(secretToken);
  });
});

describe('AdminSessionControl — load flow', () => {
  it('submits the trimmed draft token and clears the input', () => {
    const onAdminTokenChange = vi.fn();
    render(<AdminSessionControl adminToken={null} onAdminTokenChange={onAdminTokenChange} />);

    const input = screen.getByTestId('admin-jwt-input');
    fireEvent.change(input, { target: { value: '  my-token-value  ' } });
    fireEvent.click(screen.getByTestId('admin-session-load-button'));

    expect(onAdminTokenChange).toHaveBeenCalledTimes(1);
    expect(onAdminTokenChange).toHaveBeenCalledWith('my-token-value');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('disables the load button while the draft is blank', () => {
    render(<AdminSessionControl adminToken={null} onAdminTokenChange={noop} />);

    expect(screen.getByTestId('admin-session-load-button')).toBeDisabled();

    fireEvent.change(screen.getByTestId('admin-jwt-input'), { target: { value: 'x' } });
    expect(screen.getByTestId('admin-session-load-button')).not.toBeDisabled();
  });

  it('disables the load button for a whitespace-only draft', () => {
    render(<AdminSessionControl adminToken={null} onAdminTokenChange={noop} />);

    fireEvent.change(screen.getByTestId('admin-jwt-input'), { target: { value: '   ' } });
    expect(screen.getByTestId('admin-session-load-button')).toBeDisabled();
  });

  it('normalizes a whitespace-only submission to null rather than an empty string', () => {
    const onAdminTokenChange = vi.fn();
    render(<AdminSessionControl adminToken={null} onAdminTokenChange={onAdminTokenChange} />);

    const form = screen.getByRole('form', { name: '貼上管理員憑證' });
    fireEvent.change(screen.getByTestId('admin-jwt-input'), { target: { value: '   ' } });
    fireEvent.submit(form);

    // A direct form submit (e.g. Enter key) bypasses the disabled button, but
    // the reported value must still be normalized null, never a blank string
    // masquerading as a token.
    expect(onAdminTokenChange).toHaveBeenCalledTimes(1);
    expect(onAdminTokenChange).toHaveBeenCalledWith(null);
  });

  it('masks the input as a password field', () => {
    render(<AdminSessionControl adminToken={null} onAdminTokenChange={noop} />);

    expect(screen.getByTestId('admin-jwt-input')).toHaveAttribute('type', 'password');
  });
});

describe('AdminSessionControl — clear flow', () => {
  it('clears an existing token', () => {
    const onAdminTokenChange = vi.fn();
    render(<AdminSessionControl adminToken="abc.def.ghi" onAdminTokenChange={onAdminTokenChange} />);

    fireEvent.click(screen.getByTestId('admin-session-clear-button'));

    expect(onAdminTokenChange).toHaveBeenCalledTimes(1);
    expect(onAdminTokenChange).toHaveBeenCalledWith(null);
  });

  it('clears the draft input as well as the committed token', () => {
    const onAdminTokenChange = vi.fn();
    render(<AdminSessionControl adminToken={null} onAdminTokenChange={onAdminTokenChange} />);

    const input = screen.getByTestId('admin-jwt-input');
    fireEvent.change(input, { target: { value: 'partial-draft' } });
    fireEvent.click(screen.getByTestId('admin-session-clear-button'));

    expect((input as HTMLInputElement).value).toBe('');
    expect(onAdminTokenChange).toHaveBeenCalledWith(null);
  });

  it('disables the clear button when there is nothing to clear', () => {
    render(<AdminSessionControl adminToken={null} onAdminTokenChange={noop} />);

    expect(screen.getByTestId('admin-session-clear-button')).toBeDisabled();
  });

  it('enables the clear button once a token is loaded', () => {
    render(<AdminSessionControl adminToken="abc.def.ghi" onAdminTokenChange={noop} />);

    expect(screen.getByTestId('admin-session-clear-button')).not.toBeDisabled();
  });

  it('enables the clear button while a draft is being typed, even with no loaded token', () => {
    render(<AdminSessionControl adminToken={null} onAdminTokenChange={noop} />);

    fireEvent.change(screen.getByTestId('admin-jwt-input'), { target: { value: 'draft' } });
    expect(screen.getByTestId('admin-session-clear-button')).not.toBeDisabled();
  });
});
