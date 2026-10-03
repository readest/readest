import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NotebookTransitionAlert from '@/app/reader/components/notebook/NotebookTransitionAlert';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

afterEach(cleanup);

describe('NotebookTransitionAlert', () => {
  it('offers every safe recovery action', () => {
    const onKeepOpen = vi.fn();
    const onCopy = vi.fn();
    const onDiscard = vi.fn();
    const onRetry = vi.fn();
    render(
      <NotebookTransitionAlert
        onKeepOpen={onKeepOpen}
        onCopy={onCopy}
        onDiscard={onDiscard}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Keep open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard & Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onKeepOpen).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
