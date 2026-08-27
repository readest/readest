import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useShortcuts, { KeyActionHandlers } from '@/hooks/useShortcuts';

interface ShortcutHarnessProps {
  actions: KeyActionHandlers;
  noteEditor?: boolean;
  options?: Parameters<typeof useShortcuts>[2] & { requireModifierInInputs?: boolean };
}

const ShortcutHarness = ({ actions, noteEditor = false, options }: ShortcutHarnessProps) => {
  useShortcuts(actions, [], options);
  return noteEditor ? (
    <textarea aria-label='Editor' className='note-editor' />
  ) : (
    <input aria-label='Input' />
  );
};

describe('useShortcuts input handling', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('honors remapped save and close actions in note editors', () => {
    localStorage.setItem(
      'customShortcuts',
      JSON.stringify({ onSaveNote: ['ctrl+s'], onEscape: ['ctrl+e'] }),
    );
    const onSaveNote = vi.fn();
    const onEscape = vi.fn();
    render(<ShortcutHarness actions={{ onSaveNote, onEscape }} noteEditor />);
    const editor = screen.getByRole('textbox', { name: 'Editor' });
    editor.focus();

    fireEvent.keyDown(editor, { key: 's', ctrlKey: true });
    fireEvent.keyDown(editor, { key: 'e', ctrlKey: true });

    expect(onSaveNote).toHaveBeenCalledOnce();
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it('does not run unmodified global shortcuts while typing', () => {
    localStorage.setItem(
      'customShortcuts',
      JSON.stringify({ onOpenCommandPalette: ['p', 'ctrl+p'] }),
    );
    const onOpenCommandPalette = vi.fn();
    render(
      <ShortcutHarness
        actions={{ onOpenCommandPalette }}
        options={{ allowInInputs: true, capture: true, requireModifierInInputs: true }}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Input' });
    input.focus();

    fireEvent.keyDown(input, { key: 'p' });
    expect(onOpenCommandPalette).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'p', ctrlKey: true });
    expect(onOpenCommandPalette).toHaveBeenCalledOnce();
  });
});
