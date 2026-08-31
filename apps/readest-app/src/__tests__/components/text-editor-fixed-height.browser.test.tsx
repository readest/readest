/**
 * The Notebook uses TextEditor as a fixed-height scrolling surface. Its text
 * must not turn the textarea itself into a content-height element while typing.
 *
 * Needs real textarea layout and real Tailwind, so it runs as a browser test.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { default: TextEditor } = await import('@/components/TextEditor');
await import('@/styles/globals.css');

afterEach(cleanup);

describe('TextEditor fixed-height mode', () => {
  it('keeps long Notebook text inside the editor while typing', () => {
    render(
      <div data-testid='notebook-editor-frame' style={{ height: 120, width: 320 }}>
        <TextEditor
          value=''
          onChange={vi.fn()}
          autoResize={false}
          ariaLabel='Notebook'
          className='h-full min-h-0 overflow-y-auto'
        />
      </div>,
    );

    const frame = screen.getByTestId('notebook-editor-frame');
    const editor = screen.getByRole('textbox', { name: 'Notebook' }) as HTMLTextAreaElement;
    const initialHeight = editor.getBoundingClientRect().height;

    fireEvent.change(editor, {
      target: { value: Array.from({ length: 40 }, (_, index) => `Line ${index + 1}`).join('\n') },
    });

    expect(editor.getBoundingClientRect().height).toBe(initialHeight);
    expect(editor.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      frame.getBoundingClientRect().bottom,
    );
    expect(editor.scrollHeight).toBeGreaterThan(editor.clientHeight);
  });
});
