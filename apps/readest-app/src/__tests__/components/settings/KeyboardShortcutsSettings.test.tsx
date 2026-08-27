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
});
