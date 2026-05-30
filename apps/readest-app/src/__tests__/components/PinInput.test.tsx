import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import PinInput from '@/components/PinInput';

vi.mock('@/libs/crypto/applock', () => ({
  PIN_LENGTH: 4,
}));

afterEach(cleanup);

describe('PinInput', () => {
  it('focuses the input on mount when autoFocus is true', async () => {
    render(<PinInput value='' onChange={() => {}} ariaLabel='PIN code' autoFocus />);

    const input = screen.getByLabelText('PIN code');
    await vi.waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('focuses the input on mount when stickyFocus is true', async () => {
    render(<PinInput value='' onChange={() => {}} ariaLabel='PIN code' stickyFocus />);

    const input = screen.getByLabelText('PIN code');
    await vi.waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('does not focus the input when neither autoFocus nor stickyFocus is set', () => {
    render(<PinInput value='' onChange={() => {}} ariaLabel='PIN code' />);

    const input = screen.getByLabelText('PIN code');
    expect(document.activeElement).not.toBe(input);
  });
});
