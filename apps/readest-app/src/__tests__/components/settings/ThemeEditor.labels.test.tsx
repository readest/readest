import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalReadSettings: { customThemes: [] } } }),
}));

import ThemeEditor from '@/components/settings/theme/ThemeEditor';

afterEach(() => {
  cleanup();
});

describe('ThemeEditor', () => {
  // "Theme Name" was a label with no control, so the name field was read as
  // an unnamed text field (#7911).
  it('names the theme name field by its label', () => {
    render(
      <ThemeEditor customTheme={null} onSave={vi.fn()} onDelete={vi.fn()} onCancel={vi.fn()} />,
    );

    const input = screen.getByLabelText<HTMLInputElement>('Theme Name');
    expect(input.value).toBe('Custom');
  });
});
