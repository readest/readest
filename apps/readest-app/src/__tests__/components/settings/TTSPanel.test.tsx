import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ViewSettings } from '@/types/book';

const state = vi.hoisted(() => ({
  uiLocale: 'ja',
  viewSettings: {
    ttsMediaMetadata: 'sentence',
    ttsPlayerStyle: 'full',
    ttsHighlightGranularity: 'word',
    ttsHighlightOptions: { style: 'highlight', color: '#808080' },
    ttsSkipInlineAnnotations: false,
  } as unknown as ViewSettings,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getLocale: () => state.uiLocale,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => state.viewSettings }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      globalViewSettings: state.viewSettings,
      globalReadSettings: { customTtsHighlightColors: [] },
    },
    setSettings: vi.fn(),
    saveSettings: vi.fn(),
  }),
}));

vi.mock('@/hooks/useResetSettings', () => ({
  useResetViewSettings: () => vi.fn(),
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/tts/providers/bookCacheStore', () => ({
  getTTSCacheConfig: () => ({ enabled: false, syncEnabled: false, budgetMB: 200 }),
  setTTSCacheConfig: vi.fn(),
}));

vi.mock('@/components/settings/theme/TTSHighlightStyleEditor', () => ({
  default: () => null,
}));

import { saveViewSettings } from '@/helpers/settings';
import TTSPanel from '@/components/settings/TTSPanel';

describe('TTSPanel inline reading annotations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.uiLocale = 'ja';
    state.viewSettings.ttsSkipInlineAnnotations = false;
  });

  afterEach(cleanup);

  it('shows an opt-in switch and persists it as a view setting', async () => {
    render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);
    const row = screen.getByText('Skip Parenthetical Readings').closest('label')!;
    const toggle = row.querySelector('input[type="checkbox"]') as HTMLInputElement;

    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith(
        {},
        'book-1',
        'ttsSkipInlineAnnotations',
        true,
        false,
        false,
      ),
    );
  });

  it('hides the switch when the UI language is not Japanese', () => {
    state.uiLocale = 'en-US';

    render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

    expect(screen.queryByText('Skip Parenthetical Readings')).toBeNull();
  });
});
