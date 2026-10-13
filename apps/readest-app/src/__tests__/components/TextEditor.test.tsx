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
});
