import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

import SpeedChips from '@/app/reader/components/tts/SpeedChips';

describe('SpeedChips', () => {
  afterEach(() => {
    cleanup();
  });

  test('renders the presets and marks the active rate', () => {
    render(<SpeedChips rate={1.0} onSelect={vi.fn()} />);
    const active = screen.getByRole('radio', { checked: true });
    expect(active.textContent).toBe('1×');
    expect(screen.getAllByRole('radio').length).toBe(11);
  });

  test('an off-preset persisted rate appears as an extra active chip in order', () => {
    render(<SpeedChips rate={1.3} onSelect={vi.fn()} />);
    const chips = screen.getAllByRole('radio');
    expect(chips.length).toBe(12);
    const labels = chips.map((c) => c.textContent);
    expect(labels.indexOf('1.3×')).toBe(labels.indexOf('1.25×') + 1);
    expect(screen.getByRole('radio', { checked: true }).textContent).toBe('1.3×');
  });

  test('selecting a chip reports the numeric rate', () => {
    const onSelect = vi.fn();
    render(<SpeedChips rate={1.0} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('radio', { name: '1.5×' }));
    expect(onSelect).toHaveBeenCalledWith(1.5);
  });
});
