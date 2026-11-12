// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReadingRulerSettings from '@/components/settings/theme/ReadingRulerSettings';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));

afterEach(cleanup);

const renderPanel = (overrides: Partial<React.ComponentProps<typeof ReadingRulerSettings>> = {}) =>
  render(
    <ReadingRulerSettings
      enabled
      lines={2}
      opacity={0.5}
      color='transparent'
      rulerStyle='band'
      lineColor='#808080'
      lineThickness={2}
      onEnabledChange={vi.fn()}
      onLinesChange={vi.fn()}
      onOpacityChange={vi.fn()}
      onColorChange={vi.fn()}
      onStyleChange={vi.fn()}
      onLineColorChange={vi.fn()}
      onLineThicknessChange={vi.fn()}
      {...overrides}
    />,
  );

describe('ReadingRulerSettings', () => {
  it('offers the band and line styles', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange });
    const select = screen.getByRole('combobox', { name: 'Ruler Style' });
    expect(Array.from((select as HTMLSelectElement).options, (o) => o.text)).toEqual([
      'Band',
      'Line',
    ]);
    fireEvent.change(select, { target: { value: 'line' } });
    expect(onStyleChange).toHaveBeenCalledWith('line');
  });

  it('offers thickness and a custom color only for the line', () => {
    const onLineThicknessChange = vi.fn();
    const onLineColorChange = vi.fn();
    renderPanel({ rulerStyle: 'line', onLineThicknessChange, onLineColorChange });
    expect(screen.getByText('Line Thickness')).not.toBeNull();
    expect(screen.queryByText('Lines to Highlight')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Increase' })[0]!);
    expect(onLineThicknessChange).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ruler Color' })[0]!);
    const hexInput = screen
      .getAllByRole('textbox')
      .find((input) => (input as HTMLInputElement).value.startsWith('#'));
    expect(hexInput).toBeDefined();
    fireEvent.change(hexInput!, { target: { value: '#123456' } });
    expect(onLineColorChange).toHaveBeenCalledWith('#123456');
  });

  it('disables style and thickness controls when the ruler is off', () => {
    renderPanel({ enabled: false, rulerStyle: 'line' });
    expect(
      (screen.getByRole('combobox', { name: 'Ruler Style' }) as HTMLSelectElement).disabled,
    ).toBe(true);
    expect(
      screen.getAllByRole('textbox').every((input) => (input as HTMLInputElement).disabled),
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Ruler Color' })).toBeNull();
  });
});
