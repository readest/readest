// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  resetViewSettings: vi.fn(),
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
  useResetViewSettings: () => state.resetViewSettings,
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/tts/providers/bookCacheStore', () => ({
  getTTSCacheConfig: () => ({ enabled: false, budgetMB: 200 }),
  setTTSCacheConfig: vi.fn(),
}));

vi.mock('@/components/settings/theme/TTSHighlightStyleEditor', () => ({
  default: () => null,
}));

const ARIA = { id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US', gender: 'female' as const };
vi.mock('@/services/tts/voiceLibrary', () => ({
  loadVoiceLibrary: async () => ({
    languages: ['en', 'fr'],
    getVoices: async (lang: string) =>
      lang === 'en'
        ? [{ id: 'edge-tts', name: 'Edge TTS', engine: 'edge-tts', voices: [ARIA] }]
        : [],
  }),
}));

import { saveViewSettings } from '@/helpers/settings';
import { TTSUtils } from '@/services/tts/TTSUtils';
import TTSPanel from '@/components/settings/TTSPanel';

describe('TTSPanel voice library row', () => {
  beforeEach(() => {
    localStorage.clear();
    state.uiLocale = 'en-US';
  });

  afterEach(cleanup);

  it("names the language's default voice, else says it is automatic", async () => {
    const { unmount } = render(<TTSPanel bookKey='' onRegisterReset={vi.fn()} />);
    expect(await screen.findByText('English · Automatic')).toBeTruthy();
    unmount();
    TTSUtils.setDefaultVoice('edge-tts', 'en', ARIA.id);
    render(<TTSPanel bookKey='' onRegisterReset={vi.fn()} />);
    expect(await screen.findByText('English · Aria')).toBeTruthy();
  });

  it('opens the voice library, whose pick names the new default on return', async () => {
    render(<TTSPanel bookKey='' onRegisterReset={vi.fn()} />);
    fireEvent.click(await screen.findByText('Voice Library'));
    fireEvent.click(await screen.findByText('Aria'));
    expect(TTSUtils.getDefaultVoice('en')).toEqual({ engine: 'edge-tts', voiceId: ARIA.id });
    fireEvent.click(screen.getByText('TTS'));
    expect(await screen.findByText('English · Aria')).toBeTruthy();
  });
});

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
describe('TTSPanel audio cache', () => {
  afterEach(cleanup);

  it('has no audio sync switch of its own (Book Data sync covers it)', () => {
    const { container } = render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);
    expect(container.querySelector("[data-setting-id='settings.tts.audioCache']")).not.toBeNull();
    expect(container.querySelector("[data-setting-id='settings.tts.audioCacheSync']")).toBeNull();
  });
});

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

describe('TTSPanel mini player visibility preference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.viewSettings.ttsPlayerStyle = 'full';
    state.viewSettings.ttsKeepMiniPlayerVisible = false;
  });

  afterEach(() => {
    cleanup();
    state.viewSettings.ttsPlayerStyle = 'full';
  });

  it('places an opt-in switch below Player Style and persists changes', async () => {
    render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);
    const toggle = screen.getByRole('checkbox', { name: /Keep Mini Player Visible/ });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(
      screen.getByRole('combobox', { name: 'Player Style' }).compareDocumentPosition(toggle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith(
        {},
        'book-1',
        'ttsKeepMiniPlayerVisible',
        true,
        false,
        false,
      ),
    );
  });

  it('loads a saved preference', () => {
    state.viewSettings.ttsKeepMiniPlayerVisible = true;
    render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);
    expect(
      (screen.getByRole('checkbox', { name: /Keep Mini Player Visible/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it('treats a missing legacy preference as disabled', () => {
    Object.assign(state.viewSettings, { ttsKeepMiniPlayerVisible: undefined });
    render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);
    expect(
      (screen.getByRole('checkbox', { name: /Keep Mini Player Visible/ }) as HTMLInputElement)
        .checked,
    ).toBe(false);
  });

  it('hides the switch for minimal style and preserves the preference when switching back', () => {
    state.viewSettings.ttsKeepMiniPlayerVisible = true;
    render(<TTSPanel bookKey='book-1' onRegisterReset={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: 'Player Style' });
    fireEvent.change(select, { target: { value: 'minimal' } });
    expect(screen.queryByRole('checkbox', { name: /Keep Mini Player Visible/ })).toBeNull();
    fireEvent.change(select, { target: { value: 'full' } });
    expect(
      (screen.getByRole('checkbox', { name: /Keep Mini Player Visible/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it('resets the preference to disabled and saves the default', async () => {
    state.viewSettings.ttsKeepMiniPlayerVisible = true;
    state.resetViewSettings.mockImplementationOnce(
      (setters: { ttsKeepMiniPlayerVisible: (value: boolean) => void }) =>
        setters.ttsKeepMiniPlayerVisible(false),
    );
    const onRegisterReset = vi.fn();
    render(<TTSPanel bookKey='book-1' onRegisterReset={onRegisterReset} />);
    act(() => onRegisterReset.mock.calls[0]![0]());
    expect(state.resetViewSettings).toHaveBeenCalledWith(
      expect.objectContaining({ ttsKeepMiniPlayerVisible: expect.any(Function) }),
    );
    expect(
      (screen.getByRole('checkbox', { name: /Keep Mini Player Visible/ }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith(
        {},
        'book-1',
        'ttsKeepMiniPlayerVisible',
        false,
        false,
        false,
      ),
    );
  });
});
