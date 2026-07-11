import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

import GapChips from '@/app/reader/components/tts/GapChips';

describe('GapChips', () => {
  afterEach(() => {
    cleanup();
  });

  test('renders the presets and marks the active gap', () => {
    render(<GapChips gap={0.15} onSelect={vi.fn()} />);
    const active = screen.getByRole('radio', { checked: true });
    expect(active.textContent).toBe('0.15s');
    expect(screen.getAllByRole('radio').length).toBe(6);
  });

  test('an off-preset persisted gap appears as an extra active chip in order', () => {
    render(<GapChips gap={0.2} onSelect={vi.fn()} />);
    const chips = screen.getAllByRole('radio');
    expect(chips.length).toBe(7);
    const labels = chips.map((c) => c.textContent);
    expect(labels.indexOf('0.2s')).toBe(labels.indexOf('0.15s') + 1);
    expect(screen.getByRole('radio', { checked: true }).textContent).toBe('0.2s');
  });

  test('selecting a chip reports the numeric gap', () => {
    const onSelect = vi.fn();
    render(<GapChips gap={0.15} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('radio', { name: '0.4s' }));
    expect(onSelect).toHaveBeenCalledWith(0.4);
  });
});
