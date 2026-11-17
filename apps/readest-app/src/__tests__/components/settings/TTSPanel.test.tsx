// @vitest-environment happy-dom
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
  useTranslation: () => (value: string, opts?: Record<string, unknown>) =>
    opts ? value.replace(/{{(\w+)}}/g, (_m, k) => String(opts[k])) : value,
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
    setSettings: vi.fn((settings: typeof store.settings) => {
      store.settings = settings;
    }),
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
  getTTSCacheConfig: () => ({ enabled: false, budgetMB: 200 }),
  setTTSCacheConfig: vi.fn(),
}));

vi.mock('@/components/settings/theme/TTSHighlightStyleEditor', () => ({
  default: ({ onCustomColorsChange }: { onCustomColorsChange: (colors: string[]) => void }) => (
    <button onClick={() => onCustomColorsChange(['#123456'])}>Add TTS color</button>
  ),
}));

const ARIA = { id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US', gender: 'female' as const };
const HEART = { id: 'kokoro:af_heart', name: 'Heart', lang: 'en-US', tier: 'plus' as const };
const ETHAN = {
  id: 'omnivoice:ethan',
  name: 'Ethan',
  lang: 'en-US',
  tier: 'pro' as const,
  disabled: true,
};
vi.mock('@/services/tts/voiceLibrary', () => ({
  loadVoiceLibrary: async () => ({
    languages: ['en', 'fr'],
    getVoices: async (lang: string) =>
      lang === 'en'
        ? [
            {
              id: 'readest-tts',
              name: 'Readest Voice',
              engine: 'readest-tts',
              voices: [HEART, ETHAN],
            },
            { id: 'edge-tts', name: 'Edge TTS', engine: 'edge-tts', voices: [ARIA] },
          ]
        : [],
  }),
}));

vi.mock('@/services/tts/voicePreview', () => ({
  canPreviewEngine: () => true,
  primeVoicePreview: vi.fn(),
  suspendReadingForPreview: vi.fn().mockResolvedValue(false),
  playVoicePreview: vi.fn().mockResolvedValue(undefined),
  READEST_TTS_ENGINE: 'readest-tts',
}));

import { saveViewSettings } from '@/helpers/settings';
import { playVoicePreview } from '@/services/tts/voicePreview';
import { useSettingsStore } from '@/store/settingsStore';
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

describe('TTSPanel sign-in round trip from the voice library', () => {
  // Leaving for /auth or /user unmounts Settings; coming back mounts it afresh.
  const mount = () => render(<TTSPanel bookKey='' onRegisterReset={vi.fn()} />);
  const openVoiceLibrary = async () => {
    const view = mount();
    fireEvent.click(await screen.findByText('Voice Library'));
    await screen.findByText('Ethan');
    return view;
  };
  const expectVoiceLibrary = () =>
    waitFor(() =>
      expect(screen.queryByLabelText('Language'), 'reopens on the voice library').not.toBeNull(),
    );
  const expectPanel = async () => {
    expect(await screen.findByText('Custom TTS Services')).toBeTruthy();
    expect(screen.queryByLabelText('Language'), 'opens on the TTS panel').toBeNull();
  };

  beforeEach(() => {
    localStorage.clear();
    state.uiLocale = 'en-US';
    state.user = null;
    state.push.mockReset();
    vi.mocked(playVoicePreview).mockClear();
  });

  afterEach(cleanup);

  it('a locked voice leaves for sign-in; coming back reopens the voice library, once', async () => {
    const { unmount } = await openVoiceLibrary();
    fireEvent.click(screen.getByText('Ethan'));
    expect(state.push).toHaveBeenCalledWith(expect.stringMatching(/^\/auth/));
    unmount();

    const back = mount();
    await expectVoiceLibrary();
    back.unmount();

    // A later open of Settings starts on the panel again.
    mount();
    await expectPanel();
  });

  it('a Readest Voice preview signed out comes back to the voice library too', async () => {
    const { unmount } = await openVoiceLibrary();
    fireEvent.click(screen.getByLabelText('Preview Heart'));
    expect(state.push).toHaveBeenCalledWith(expect.stringMatching(/^\/auth/));
    unmount();

    mount();
    await expectVoiceLibrary();
  });

  it('coming back shows the engine that was on show, for that visit only', async () => {
    const { unmount } = await openVoiceLibrary();
    const select = screen.getByLabelText('Voice Engine') as HTMLSelectElement;
    const readest = [...select.options].find((o) => o.text === 'Readest Voice')!;
    fireEvent.change(select, { target: { value: readest.value } });
    fireEvent.click(screen.getByText('Ethan'));
    unmount();

    mount();
    await expectVoiceLibrary();
    await screen.findByText('Ethan');
    const restored = screen.getByLabelText('Voice Engine') as HTMLSelectElement;
    expect(restored.selectedOptions[0]!.text).toBe('Readest Voice');
    expect(screen.queryByText('Aria')).toBeNull();

    // Back ends that visit: the next one starts on every engine again.
    fireEvent.click(screen.getByText('TTS'));
    fireEvent.click(await screen.findByText('Voice Library'));
    await screen.findByText('Ethan');
    const reopened = screen.getByLabelText('Voice Engine') as HTMLSelectElement;
    expect(reopened.selectedOptions[0]!.text, 'reopens on All').toBe('All');
  });

  it('a preview that plays stays on the page, so a later open starts on the panel', async () => {
    state.user = { id: 'u' };
    const { unmount } = await openVoiceLibrary();
    fireEvent.click(screen.getByLabelText('Preview Aria'));
    await waitFor(() => expect(playVoicePreview).toHaveBeenCalled());
    expect(state.push).not.toHaveBeenCalled();
    unmount();

    mount();
    await expectPanel();
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

describe('TTSPanel custom highlight colors (#7490)', () => {
  afterEach(cleanup);

  it('hands the store a new settings snapshot so account sync publishes it', () => {
    const store = useSettingsStore.getState();
    const previous = store.settings;
    render(<TTSPanel bookKey='' onRegisterReset={vi.fn()} />);
    fireEvent.click(screen.getByText('Add TTS color'));

    const next = useSettingsStore.getState().settings;
    expect(next).not.toBe(previous);
    expect(next.globalReadSettings.customTtsHighlightColors).toEqual(['#123456']);
    expect(previous.globalReadSettings.customTtsHighlightColors).toEqual([]);
    expect(store.saveSettings).toHaveBeenLastCalledWith({}, next);
  });
});
