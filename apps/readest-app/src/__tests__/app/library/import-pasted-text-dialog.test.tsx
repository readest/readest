import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ImportPastedTextDialog from '@/app/library/components/ImportPastedTextDialog';

const readTextFromClipboard = vi.fn();
vi.mock('@/utils/clipboard', () => ({
  readTextFromClipboard: () => readTextFromClipboard(),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/components/Dialog', () => ({
  __esModule: true,
  default: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div role='dialog' aria-label={title}>
        {children}
      </div>
    ) : null,
}));

afterEach(() => {
  cleanup();
  readTextFromClipboard.mockReset();
});

describe('ImportPastedTextDialog', () => {
  it('imports pasted text as a TXT file through the normal library import callback', async () => {
    const onImport = vi.fn(async (_file: File) => true);
    const onClose = vi.fn();
    render(<ImportPastedTextDialog isOpen onClose={onClose} onImport={onImport} />);

    const importButton = screen.getByRole('button', { name: 'Import' });
    expect(importButton).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Book title'), { target: { value: 'Notes / News' } });
    fireEvent.change(screen.getByLabelText('Text'), {
      target: { value: 'First line\nSecond line' },
    });
    fireEvent.click(importButton);

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const file = onImport.mock.calls[0]![0];
    expect(file.name).toBe('Notes - News.txt');
    expect(file.type).toBe('text/plain');
    expect(await file.text()).toBe('First line\nSecond line');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('does not import an empty title or whitespace-only text', () => {
    const onImport = vi.fn(async (_file: File) => true);
    render(<ImportPastedTextDialog isOpen onClose={vi.fn()} onImport={onImport} />);
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: '   \n' } });
    expect(screen.getByRole('button', { name: 'Import' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Book title'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Content' } });
    expect(screen.getByRole('button', { name: 'Import' })).toHaveProperty('disabled', true);
    expect(onImport).not.toHaveBeenCalled();
  });

  it('fills the editor from the clipboard on a user tap', async () => {
    readTextFromClipboard.mockResolvedValue('Copied article');
    render(<ImportPastedTextDialog isOpen onClose={vi.fn()} onImport={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste from Clipboard' }));

    await waitFor(() =>
      expect(screen.getByLabelText('Text')).toHaveProperty('value', 'Copied article'),
    );
    expect(readTextFromClipboard).toHaveBeenCalledTimes(1);
  });

  it('keeps manual paste available when clipboard access is denied', async () => {
    readTextFromClipboard.mockResolvedValue(null);
    render(<ImportPastedTextDialog isOpen onClose={vi.fn()} onImport={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste from Clipboard' }));

    await screen.findByRole('alert');
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Typed instead' } });
    expect(screen.getByRole('button', { name: 'Import' })).toHaveProperty('disabled', false);
  });

  it('keeps the pasted text when the library import fails', async () => {
    const onClose = vi.fn();
    const onImport = vi.fn(async (_file: File) => false);
    render(<ImportPastedTextDialog isOpen onClose={onClose} onImport={onImport} />);
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Keep this text' } });

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    await screen.findByRole('alert');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Text')).toHaveProperty('value', 'Keep this text');
  });
});
