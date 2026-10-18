import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '@/styles/globals.css';

afterEach(cleanup);

describe('window-drag-input cursor', () => {
  it('shows the arrow, not the text cursor, while the field drags the window', () => {
    render(
      <div data-window-drag=''>
        <input aria-label='search' className='window-drag-input input' />
      </div>,
    );
    const input = screen.getByLabelText('search');

    expect(getComputedStyle(input).cursor).toBe('default');
  });

  it('shows the text cursor once the field is focused for typing', () => {
    render(
      <div data-window-drag=''>
        <input aria-label='search' className='window-drag-input input' />
      </div>,
    );
    const input = screen.getByLabelText('search');
    input.focus();

    expect(getComputedStyle(input).cursor).not.toBe('default');
  });

  it('keeps the text cursor where nothing drags the window (web, select mode)', () => {
    render(<input aria-label='search' className='window-drag-input input' />);
    const input = screen.getByLabelText('search');

    expect(getComputedStyle(input).cursor).toBe('text');
  });
});
