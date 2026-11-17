// @vitest-environment happy-dom
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TextEditor, { TextEditorRef } from '@/components/TextEditor';

afterEach(cleanup);

describe('TextEditor', () => {
  it('continues resizing auto-resize editors on input and imperative updates', () => {
    const editorRef = createRef<TextEditorRef>();
    render(<TextEditor ref={editorRef} value='' onChange={vi.fn()} ariaLabel='Annotation note' />);

    const editor = screen.getByRole('textbox', { name: 'Annotation note' }) as HTMLTextAreaElement;
    let scrollHeight = 48;
    Object.defineProperty(editor, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });

    fireEvent.change(editor, { target: { value: 'A longer annotation' } });
    expect(editor.style.height).toBe('48px');

    scrollHeight = 72;
    act(() => editorRef.current?.setValue('An even longer annotation'));
    expect(editor.style.height).toBe('72px');
  });

  it('keeps fixed-height editors fixed while typing when auto-resize is disabled', () => {
    const onChange = vi.fn();
    render(<TextEditor value='' onChange={onChange} autoResize={false} ariaLabel='Notebook' />);

    const editor = screen.getByRole('textbox', { name: 'Notebook' }) as HTMLTextAreaElement;
    expect(editor.style.height).toBe('');

    fireEvent.change(editor, { target: { value: 'A growing notebook entry' } });

    expect(onChange).toHaveBeenCalledWith('A growing notebook entry');
    expect(editor.style.height).toBe('');
  });

  it('keeps fixed-height editors fixed when their value is set imperatively', () => {
    const editorRef = createRef<TextEditorRef>();
    render(
      <TextEditor
        ref={editorRef}
        value=''
        onChange={vi.fn()}
        autoResize={false}
        ariaLabel='Notebook'
      />,
    );

    const editor = screen.getByRole('textbox', { name: 'Notebook' }) as HTMLTextAreaElement;
    act(() => editorRef.current?.setValue('The last accepted notebook value'));

    expect(editor.value).toBe('The last accepted notebook value');
    expect(editor.style.height).toBe('');
  });

  // Read Aloud holds the view still while a note editor has focus (#6837).
  it('marks its text area as a note editor', () => {
    render(<TextEditor value='' onChange={vi.fn()} ariaLabel='Annotation note' />);

    const editor = screen.getByRole('textbox', { name: 'Annotation note' });
    expect(editor.hasAttribute('data-note-editor')).toBe(true);
  });

  it.each([
    { shortcut: 'Ctrl+Enter', ctrlKey: true, metaKey: false },
    { shortcut: 'Cmd+Enter', ctrlKey: false, metaKey: true },
  ])('saves with $shortcut when a parent stops keydown propagation', ({ ctrlKey, metaKey }) => {
    const onSave = vi.fn();
    const parentRef = createRef<HTMLDivElement>();

    render(
      <div ref={parentRef}>
        <TextEditor
          value='My annotation'
          onChange={vi.fn()}
          onSave={onSave}
          ariaLabel='Annotation note'
        />
      </div>,
    );

    const parentListener = vi.fn((event: KeyboardEvent) => {
      event.stopPropagation();
    });
    parentRef.current!.addEventListener('keydown', parentListener);

    const editor = screen.getByRole('textbox', { name: 'Annotation note' });
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey, metaKey });

    expect(onSave).toHaveBeenCalledOnce();
    expect(parentListener).not.toHaveBeenCalled();
  });

  // Most browsers flag a key typed into an IME composition with isComposing;
  // Safari's key that commits one only carries keyCode 229.
  it.each([
    { browser: 'isComposing', init: { isComposing: true } },
    { browser: 'keyCode 229', init: { keyCode: 229 } },
  ])('does not save on Ctrl+Enter while an IME composes ($browser)', ({ init }) => {
    const onSave = vi.fn();
    render(<TextEditor value='' onChange={vi.fn()} onSave={onSave} ariaLabel='Annotation note' />);

    const editor = screen.getByRole('textbox', { name: 'Annotation note' });
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true, ...init });

    expect(onSave).not.toHaveBeenCalled();
  });

  // The note popup (Popup) and sheet (Dialog) close on Escape themselves, with
  // the same cancel the editor runs: Escape must cancel once, not twice.
  it('cancels once on Escape inside a host that also closes on Escape', () => {
    const cancel = vi.fn();
    const parentRef = createRef<HTMLDivElement>();

    render(
      <div ref={parentRef}>
        <TextEditor value='' onChange={vi.fn()} onEscape={cancel} ariaLabel='Annotation note' />
      </div>,
    );

    const hostListener = vi.fn((event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
      event.stopPropagation();
    });
    parentRef.current!.addEventListener('keydown', hostListener);

    const editor = screen.getByRole('textbox', { name: 'Annotation note' });
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(cancel).toHaveBeenCalledOnce();

    // Keys the editor doesn't handle still reach the host.
    fireEvent.keyDown(editor, { key: 'a' });
    expect(hostListener).toHaveBeenCalledOnce();
  });
});
