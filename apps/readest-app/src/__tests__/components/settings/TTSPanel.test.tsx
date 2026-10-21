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
  token: null as string | null,
  user: null as { id: string } | null,
  push: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: state.token, user: state.user }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push }),
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

vi.mock('@/store/settingsStore', () => {
  const store = {
    settings: {
      globalViewSettings: state.viewSettings,
      globalReadSettings: { customTtsHighlightColors: [] },
    },
    setSettings: vi.fn(),
    saveSettings: vi.fn(),
  };
  return { useSettingsStore: Object.assign(() => store, { getState: () => store }) };
});

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

  it('shows the switch when the UI language is Korean', () => {
    state.uiLocale = 'ko';

    render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

    expect(screen.getByText('Skip Parenthetical Readings')).toBeTruthy();
  });

  it('hides the switch when the UI language is not Japanese or Korean', () => {
    state.uiLocale = 'en-US';

    render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

    expect(screen.queryByText('Skip Parenthetical Readings')).toBeNull();
  });
});

const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url');
const sessionToken = (claims: object) => `${encode({ alg: 'none' })}.${encode(claims)}.sig`;

const getCustomServicesRow = () =>
  screen.getByText('Custom TTS Services').closest('button') as HTMLButtonElement;

// Custom TTS services are premium: free and signed-out readers see the row
// with a Premium badge that routes to the upgrade page or sign-in.
describe('TTSPanel custom TTS services premium gate', () => {
  beforeEach(() => {
    state.token = null;
    state.user = null;
    state.push.mockReset();
  });

  afterEach(cleanup);

  it('sends a signed-out reader to sign in', () => {
    render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);
    expect(getCustomServicesRow().textContent).toContain('Premium');
    fireEvent.click(getCustomServicesRow());
    expect(state.push).toHaveBeenCalledWith(expect.stringMatching(/^\/auth\?redirect=/));
  });

  it('sends a free user to the plans page', () => {
    state.token = sessionToken({ plan: 'free' });
    state.user = { id: 'u' };
    render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);
    fireEvent.click(getCustomServicesRow());
    expect(state.push).toHaveBeenCalledWith(expect.stringMatching(/^\/user\?redirect=/));
    expect(screen.queryByText('Add TTS Service')).toBeNull();
  });

  it('opens the services page for Full Customization', () => {
    state.token = sessionToken({ plan: 'free', customization_purchased: true });
    state.user = { id: 'u' };
    render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);
    expect(getCustomServicesRow().textContent).not.toContain('Premium');
    fireEvent.click(getCustomServicesRow());
    expect(state.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Add TTS Service'));
    expect(screen.getByLabelText('Base URL')).toBeTruthy();
  });
});
