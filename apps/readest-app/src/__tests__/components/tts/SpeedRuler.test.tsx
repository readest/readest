import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

import SpeedRuler from '@/app/reader/components/tts/SpeedRuler';

describe('SpeedRuler', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test('renders a 0.5-3 slider and spotlights the current rate over its mark', () => {
    render(<SpeedRuler rate={1.0} onSelect={vi.fn()} />);
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('min')).toBe('0.5');
    expect(slider.getAttribute('max')).toBe('3');
    expect(slider.getAttribute('step')).toBe('0.05');
    expect(screen.getByText('1×')).toBeTruthy();
    // The bright value label replaces the 1.0 mark it would overlap; the
    // other marks stay visible.
    expect(screen.getByText('1.0').className).toContain('invisible');
    expect(screen.getByText('0.5').className).not.toContain('invisible');
    expect(screen.getByText('3.0').className).not.toContain('invisible');
  });

  test('a mark a full 0.2 away from the value stays visible despite float error', () => {
    render(<SpeedRuler rate={1.8} onSelect={vi.fn()} />);
    expect(screen.getByText('2.0').className).not.toContain('invisible');
    expect(screen.getByText('1.5').className).not.toContain('invisible');
  });

  test('dragging previews the rate and commits once on release', () => {
    const onSelect = vi.fn();
    render(<SpeedRuler rate={1.0} onSelect={onSelect} />);
    const slider = screen.getByRole('slider');
    fireEvent.pointerUp(slider);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.change(slider, { target: { value: '1.3' } });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText('1.3×')).toBeTruthy();
    fireEvent.pointerUp(slider);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(1.3);
  });

  test('keyboard changes commit after the hold-to-repeat debounce', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(<SpeedRuler rate={1.0} onSelect={onSelect} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '1.05' } });
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    expect(onSelect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onSelect).toHaveBeenCalledWith(1.05);
  });

  test('an off-grid persisted rate is displayed exactly', () => {
    render(<SpeedRuler rate={0.87} onSelect={vi.fn()} />);
    expect(screen.getByText('0.87×')).toBeTruthy();
  });
});
