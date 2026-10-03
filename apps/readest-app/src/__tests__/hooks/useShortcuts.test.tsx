import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useShortcuts, { KeyActionHandlers } from '@/hooks/useShortcuts';
import { eventDispatcher } from '@/utils/event';

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

const keyboardEventFor = (target: HTMLElement, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
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

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Meta', { metaKey: true }],
  ])('preserves native %s+Backspace editing in inputs', (_modifier, modifiers) => {
    const onOpenCommandPalette = vi.fn();
    render(
      <ShortcutHarness
        actions={{ onOpenCommandPalette }}
        options={{ allowInInputs: true, requireModifierInInputs: true }}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Input' });
    input.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
      ...modifiers,
    });

    input.dispatchEvent(event);

    expect(onOpenCommandPalette).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('still prevents unmodified Backspace outside inputs', () => {
    render(<ShortcutHarness actions={{}} />);
    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('preserves mouse defaults when a contextual shortcut declines the action', () => {
    localStorage.setItem('customShortcuts', JSON.stringify({ onHighlightSelection: ['MouseX1'] }));
    const onHighlightSelection = vi.fn(() => false);
    render(<ShortcutHarness actions={{ onHighlightSelection }} />);
    const events = ['mousedown', 'mouseup', 'auxclick'].map(
      (type) => new MouseEvent(type, { button: 3, bubbles: true, cancelable: true }),
    );

    for (const event of events) window.dispatchEvent(event);

    expect(onHighlightSelection).toHaveBeenCalledOnce();
    expect(events.every((event) => !event.defaultPrevented)).toBe(true);
  });

  it('prevents only the mouseup default when a mouse shortcut is handled', () => {
    localStorage.setItem('customShortcuts', JSON.stringify({ onHighlightSelection: ['MouseX1'] }));
    const onHighlightSelection = vi.fn(() => true);
    render(<ShortcutHarness actions={{ onHighlightSelection }} />);
    const events = ['mousedown', 'mouseup', 'auxclick'].map(
      (type) => new MouseEvent(type, { button: 3, bubbles: true, cancelable: true }),
    );

    for (const event of events) window.dispatchEvent(event);

    expect(onHighlightSelection).toHaveBeenCalledOnce();
    expect(events.map((event) => event.defaultPrevented)).toEqual([false, true, false]);
  });

  it('requires a modifier for direct iframe shortcuts from inputs', () => {
    localStorage.setItem(
      'customShortcuts',
      JSON.stringify({ onOpenCommandPalette: ['p', 'ctrl+p'] }),
    );
    const onOpenCommandPalette = vi.fn(() => true);
    render(
      <ShortcutHarness
        actions={{ onOpenCommandPalette }}
        options={{ allowInInputs: true, requireModifierInInputs: true }}
      />,
    );
    const iframeInput = document.createElement('input');

    const unmodifiedHandled = eventDispatcher.dispatchSync('iframe-shortcut-keydown', {
      bookKey: 'book-1',
      event: keyboardEventFor(iframeInput, { key: 'p', code: 'KeyP' }),
    });

    expect(unmodifiedHandled).toBe(false);
    expect(onOpenCommandPalette).not.toHaveBeenCalled();

    const modifiedHandled = eventDispatcher.dispatchSync('iframe-shortcut-keydown', {
      bookKey: 'book-1',
      event: keyboardEventFor(iframeInput, { key: 'p', code: 'KeyP', ctrlKey: true }),
    });

    expect(modifiedHandled).toBe(true);
    expect(onOpenCommandPalette).toHaveBeenCalledOnce();
  });

  it('preserves iframe button activation while allowing noninteractive shortcuts', () => {
    localStorage.setItem('customShortcuts', JSON.stringify({ onOpenCommandPalette: ['Enter'] }));
    const onOpenCommandPalette = vi.fn(() => true);
    render(
      <ShortcutHarness
        actions={{ onOpenCommandPalette }}
        options={{ allowInInputs: true, requireModifierInInputs: true }}
      />,
    );

    const buttonHandled = eventDispatcher.dispatchSync('iframe-shortcut-keydown', {
      bookKey: 'book-1',
      event: keyboardEventFor(document.createElement('button'), {
        key: 'Enter',
        code: 'Enter',
      }),
    });
    const contentHandled = eventDispatcher.dispatchSync('iframe-shortcut-keydown', {
      bookKey: 'book-1',
      event: keyboardEventFor(document.createElement('div'), {
        key: 'Enter',
        code: 'Enter',
      }),
    });

    expect(buttonHandled).toBe(false);
    expect(contentHandled).toBe(true);
    expect(onOpenCommandPalette).toHaveBeenCalledOnce();
  });
});
