import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { saveMock } = vi.hoisted(() => ({
  saveMock: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { id: 'env' } }),
}));

vi.mock('@/services/wordlens/customGlossary', () => ({
  saveWordLensGlossaryEntry: saveMock,
}));

import WordLensGlossaryPopup from '@/app/reader/components/annotator/WordLensGlossaryPopup';

const renderPopup = (
  overrides: Partial<React.ComponentProps<typeof WordLensGlossaryPopup>> = {},
) => {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const onSaved = vi.fn();
  render(
    <WordLensGlossaryPopup
      bookKey='hash-a-1'
      term='Dark Brotherhood'
      onSave={onSave}
      onCancel={onCancel}
      onSaved={onSaved}
      {...overrides}
    />,
  );
  return { onSave, onCancel, onSaved };
};

describe('WordLensGlossaryPopup', () => {
  beforeEach(() => {
    saveMock.mockClear();
    saveMock.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the selected term and disables series scope when the book has none', () => {
    renderPopup();
    expect(screen.getByText('Dark Brotherhood')).toBeTruthy();
    const series = screen.getByRole('option', { name: 'This series' }) as HTMLOptionElement;
    expect(series.disabled).toBe(true);
  });

  it('does not save an empty definition', () => {
    const { onSave } = renderPopup();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('stores the full definition and the chosen scope', () => {
    const definition = 'a sacred object; kept whole, not split into senses at all';
    const { onSave } = renderPopup({ seriesName: 'Mistborn' });
    fireEvent.change(screen.getByLabelText('Definition'), {
      target: { value: `  ${definition}  ` },
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'book' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({ definition, scope: 'book' });
    expect(saveMock).toHaveBeenCalledWith({ id: 'env' }, 'hash-a-1', {
      term: 'Dark Brotherhood',
      definition,
      scope: 'book',
    });
    expect(screen.getByRole('option', { name: 'This series' })).toHaveProperty('disabled', false);
  });

  it('cancels without saving', () => {
    const { onCancel } = renderPopup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('keeps the editor open and shows an error when save returns false', async () => {
    saveMock.mockResolvedValueOnce(false);
    const { onSaved } = renderPopup();
    fireEvent.change(screen.getByLabelText('Definition'), {
      target: { value: 'a secret society' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Could not save the entry.')).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Definition')).toHaveProperty('value', 'a secret society');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('keeps the editor open and shows an error when save rejects', async () => {
    saveMock.mockRejectedValueOnce(new Error('disk full'));
    const { onSaved } = renderPopup();
    fireEvent.change(screen.getByLabelText('Definition'), {
      target: { value: 'a secret society' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Could not save the entry.')).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Definition')).toHaveProperty('value', 'a secret society');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});
