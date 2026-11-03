import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FailedImportsDialog from '@/app/library/components/FailedImportsDialog';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_match, name) => String(options[name] ?? ''));
  },
}));

vi.mock('@/components/Dialog', () => ({
  __esModule: true,
  default: ({
    title,
    children,
    onClose,
  }: {
    title?: string;
    children: React.ReactNode;
    onClose: () => void;
  }) => (
    <div role='dialog' aria-label={title}>
      <h2>{title}</h2>
      <button type='button' aria-label='close-dialog' onClick={onClose} />
      {children}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe('FailedImportsDialog', () => {
  it('renders the count in the title and each failed filename', () => {
    render(
      <FailedImportsDialog
        failedImports={[
          { filename: 'book-a.epub', errorMessage: 'Unsupported format' },
          { filename: 'book-b.pdf', errorMessage: '' },
          { filename: 'book-c.mobi', errorMessage: 'File is corrupted' },
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Failed to import 3 books' })).toBeTruthy();
    expect(screen.getByText('book-a.epub')).toBeTruthy();
    expect(screen.getByText('book-b.pdf')).toBeTruthy();
    expect(screen.getByText('book-c.mobi')).toBeTruthy();
    expect(screen.getByText('Unsupported format')).toBeTruthy();
    expect(screen.getByText('File is corrupted')).toBeTruthy();
  });

  it('invokes onClose when the OK button is clicked', () => {
    const onClose = vi.fn();
    render(
      <FailedImportsDialog
        failedImports={[{ filename: 'book.epub', errorMessage: 'boom' }]}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
