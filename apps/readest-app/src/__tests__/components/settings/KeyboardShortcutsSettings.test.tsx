import type { PropsWithChildren, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: () => {},
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/services/environment', () => ({
  isMacPlatform: () => false,
}));

vi.mock('@/components/ModalPortal', () => ({
  default: ({ children }: PropsWithChildren) => <>{children}</>,
}));

vi.mock('@/components/settings/SubPageHeader', () => ({
  default: ({ currentLabel, rightSlot }: { currentLabel: string; rightSlot?: ReactNode }) => (
    <header>
      <h1>{currentLabel}</h1>
      {rightSlot}
    </header>
  ),
}));

vi.mock('@/components/settings/primitives', () => ({
  BoxedList: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingsRow: ({ children, label }: PropsWithChildren<{ label: string }>) => (
    <div>
      <span>{label}</span>
      {children}
    </div>
  ),
}));

import KeyboardShortcutsSettings from '@/components/settings/KeyboardShortcutsSettings';
import { getDefaultShortcuts, saveShortcuts, setShortcutBinding } from '@/helpers/shortcuts';

describe('KeyboardShortcutsSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test('keeps later edits based on shortcuts reset outside the page', () => {
    saveShortcuts(setShortcutBinding(getDefaultShortcuts(), 'onOpenCommandPalette', 'ctrl+k'));
    render(<KeyboardShortcutsSettings onBack={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Open Command Palette: Ctrl+K' })).toBeTruthy();

    act(() => saveShortcuts(getDefaultShortcuts()));

    expect(screen.getByRole('button', { name: 'Open Command Palette: Ctrl+Shift+P' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open Books: Ctrl+O' }));
    fireEvent.keyDown(window, { key: '9', ctrlKey: true, shiftKey: true });

    expect(JSON.parse(localStorage.getItem('customShortcuts') ?? '{}')).toEqual({
      onOpenBooks: ['ctrl+shift+9'],
    });
  });

  test.each([
    'customShortcuts',
    null,
  ])('keeps later edits based on a cross-tab storage update with key %s', (key) => {
    saveShortcuts(setShortcutBinding(getDefaultShortcuts(), 'onOpenCommandPalette', 'ctrl+k'));
    render(<KeyboardShortcutsSettings onBack={vi.fn()} />);
    const oldValue = localStorage.getItem('customShortcuts');

    if (key === null) localStorage.clear();
    else localStorage.setItem('customShortcuts', '{}');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key,
          oldValue,
          newValue: key === null ? null : '{}',
          storageArea: localStorage,
        }),
      );
    });

    expect(screen.getByRole('button', { name: 'Open Command Palette: Ctrl+Shift+P' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open Books: Ctrl+O' }));
    fireEvent.keyDown(window, { key: '9', ctrlKey: true, shiftKey: true });

    expect(JSON.parse(localStorage.getItem('customShortcuts') ?? '{}')).toEqual({
      onOpenBooks: ['ctrl+shift+9'],
    });
  });

  test('renders the replacement dialog inside an open daisyui modal', () => {
    render(<KeyboardShortcutsSettings onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Books: Ctrl+O' }));
    fireEvent.keyDown(window, { key: 'n' });

    // `hidden: true` because jsdom applies the UA `dialog:not([open])
    // { display: none }` rule — in the app daisyui's `.modal` display:grid
    // overrides it, which is exactly what the wrapper is here to restore.
    const dialog = screen.getByRole('alertdialog', { hidden: true });
    expect(dialog.textContent).toContain('The shortcut {{shortcut}} is already assigned to');
    // `.modal-box` is invisible (opacity 0, scale .95) unless it sits inside an
    // open `.modal` — without the wrapper the dialog lays out but never paints.
    const modal = dialog.closest('dialog.modal');
    expect(modal).not.toBeNull();
    expect(modal!.classList.contains('modal-open')).toBe(true);
    expect(dialog.classList.contains('modal-box')).toBe(true);
    // Nothing is written until the user confirms.
    expect(localStorage.getItem('customShortcuts')).toBeNull();
  });
});
