import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ImportAnnotationsDialog from '@/app/reader/components/annotator/ImportAnnotationsDialog';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
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
      <button type='button' aria-label='close-dialog' onClick={onClose} />
      {children}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe('ImportAnnotationsDialog', () => {
  it('renders every import source', () => {
    render(
      <ImportAnnotationsDialog
        isOpen
        onClose={vi.fn()}
        onImportMoonReader={vi.fn()}
        onImportReadEra={vi.fn()}
        onImportReadest={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Import Annotations' })).toBeTruthy();
    expect(screen.getByText('Readest')).toBeTruthy();
    expect(screen.getByText('Moon+ Reader')).toBeTruthy();
    expect(screen.getByText('ReadEra')).toBeTruthy();
  });

  it('invokes onImportMoonReader when the Moon+ Reader row is clicked', () => {
    const onImportMoonReader = vi.fn();
    render(
      <ImportAnnotationsDialog
        isOpen
        onClose={vi.fn()}
        onImportMoonReader={onImportMoonReader}
        onImportReadEra={vi.fn()}
        onImportReadest={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Moon+ Reader'));
    expect(onImportMoonReader).toHaveBeenCalledTimes(1);
  });

  it('invokes onImportReadEra when the ReadEra row is clicked', () => {
    const onImportReadEra = vi.fn();
    render(
      <ImportAnnotationsDialog
        isOpen
        onClose={vi.fn()}
        onImportMoonReader={vi.fn()}
        onImportReadEra={onImportReadEra}
        onImportReadest={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('ReadEra'));
    expect(onImportReadEra).toHaveBeenCalledTimes(1);
  });

  it('invokes onImportReadest when the Readest row is clicked', () => {
    const onImportReadest = vi.fn();
    render(
      <ImportAnnotationsDialog
        isOpen
        onClose={vi.fn()}
        onImportMoonReader={vi.fn()}
        onImportReadEra={vi.fn()}
        onImportReadest={onImportReadest}
      />,
    );

    fireEvent.click(screen.getByText('Readest'));
    expect(onImportReadest).toHaveBeenCalledTimes(1);
  });
});
