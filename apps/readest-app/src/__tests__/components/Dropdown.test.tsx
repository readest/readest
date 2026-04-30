import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import Dropdown from '@/components/Dropdown';
import { DropdownProvider } from '@/context/DropdownContext';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

afterEach(() => cleanup());

// Simulates the browser behavior where pressing Enter/Space on a focused
// <button> fires both a keydown event and a click event. JSDOM does not
// dispatch the click automatically, so we do it here.
const pressActivationKey = (el: HTMLElement, key: 'Enter' | ' ') => {
  fireEvent.keyDown(el, { key });
  fireEvent.click(el);
};

const renderDropdown = () =>
  render(
    <DropdownProvider>
      <Dropdown label='Test Menu' toggleButton={<span>Toggle</span>} showTooltip={false}>
        <div>
          <button type='button'>Menu Item</button>
        </div>
      </Dropdown>
    </DropdownProvider>,
  );

describe('Dropdown keyboard activation', () => {
  it('opens when Enter is pressed on the toggle button', () => {
    renderDropdown();
    const toggle = screen.getByRole('button', { name: 'Test Menu' });

    toggle.focus();
    pressActivationKey(toggle, 'Enter');

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens when Space is pressed on the toggle button', () => {
    renderDropdown();
    const toggle = screen.getByRole('button', { name: 'Test Menu' });

    toggle.focus();
    pressActivationKey(toggle, ' ');

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes when Enter is pressed again on an open dropdown', () => {
    renderDropdown();
    const toggle = screen.getByRole('button', { name: 'Test Menu' });

    toggle.focus();
    pressActivationKey(toggle, 'Enter');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    pressActivationKey(toggle, 'Enter');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('stops propagation on Enter to prevent global shortcuts from firing', () => {
    renderDropdown();
    const toggle = screen.getByRole('button', { name: 'Test Menu' });

    const onWindowKeyDown = vi.fn();
    window.addEventListener('keydown', onWindowKeyDown);
    try {
      toggle.focus();
      fireEvent.keyDown(toggle, { key: 'Enter' });
      expect(onWindowKeyDown).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', onWindowKeyDown);
    }
  });

  it('stops propagation on Space to prevent global shortcuts from firing', () => {
    renderDropdown();
    const toggle = screen.getByRole('button', { name: 'Test Menu' });

    const onWindowKeyDown = vi.fn();
    window.addEventListener('keydown', onWindowKeyDown);
    try {
      toggle.focus();
      fireEvent.keyDown(toggle, { key: ' ' });
      expect(onWindowKeyDown).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', onWindowKeyDown);
    }
  });
});
