import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import DialogueHighlightSettings from '@/components/settings/theme/DialogueHighlightSettings';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

afterEach(() => {
  cleanup();
});

const renderPanel = (
  overrides: Partial<React.ComponentProps<typeof DialogueHighlightSettings>> = {},
) =>
  render(
    <DialogueHighlightSettings
      dialogueHighlight
      customBackground={false}
      backgroundColor='#facc15'
      customTextColor={false}
      textColor=''
      onToggle={() => {}}
      onCustomBackgroundToggle={() => {}}
      onBackgroundColorChange={() => {}}
      onCustomTextColorToggle={() => {}}
      onTextColorChange={() => {}}
      {...overrides}
    />,
  );

describe('DialogueHighlightSettings', () => {
  it('names the text-color switch accessibly', () => {
    renderPanel();
    expect(screen.getByRole('checkbox', { name: /^Text Color/ })).not.toBeNull();
  });

  it('seeds the fallback color when enabling text color with none set', () => {
    const onCustomTextColorToggle = vi.fn();
    const onTextColorChange = vi.fn();
    renderPanel({
      customTextColor: false,
      textColor: '',
      onCustomTextColorToggle,
      onTextColorChange,
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /^Text Color/ }));
    expect(onTextColorChange).toHaveBeenCalledWith('#808080');
    expect(onCustomTextColorToggle).toHaveBeenCalledWith(true);
  });

  it('does not reseed when a text color is already set or when disabling', () => {
    const onCustomTextColorToggle = vi.fn();
    const onTextColorChange = vi.fn();
    renderPanel({
      customTextColor: true,
      textColor: '#112233',
      onCustomTextColorToggle,
      onTextColorChange,
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /^Text Color/ }));
    expect(onTextColorChange).not.toHaveBeenCalled();
    expect(onCustomTextColorToggle).toHaveBeenCalledWith(false);
  });

  it('describes a custom background without printing its hex value', () => {
    renderPanel({ customBackground: true, backgroundColor: '#facc15' });
    expect(screen.queryByText('#facc15')).toBeNull();
    expect(screen.getByRole('checkbox', { name: /^Background/ })).not.toBeNull();
  });

  it('shows the text color picker only while the text color switch is on', () => {
    renderPanel({ customTextColor: false, textColor: '#112233' });
    expect(screen.queryByText('Color')).toBeNull();
    cleanup();
    renderPanel({ customTextColor: true, textColor: '#112233' });
    expect(screen.getByText('Color')).not.toBeNull();
  });
});
