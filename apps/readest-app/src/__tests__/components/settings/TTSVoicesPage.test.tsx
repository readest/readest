// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TTSVoicesGroup } from '@/services/tts/types';
import type { VoiceLibrary } from '@/services/tts/voiceLibrary';

const state = vi.hoisted(() => ({
  user: { id: 'u' } as { id: string } | null,
  push: vi.fn(),
  range: null as Range | null,
  play: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, opts?: Record<string, unknown>) =>
    opts ? key.replace(/{{(\w+)}}/g, (_m, k) => String(opts[k])) : key,
}));
vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getLocale: () => 'en-US',
}));
vi.mock('@/store/readerProgressStore', () => ({
  getBookProgress: () => (state.range ? { range: state.range } : null),
}));
vi.mock('@/services/tts/voicePreview', () => ({
  canPreviewEngine: () => true,
  primeVoicePreview: vi.fn(),
  suspendReadingForPreview: vi.fn().mockResolvedValue(false),
  playVoicePreview: state.play,
  READEST_TTS_ENGINE: 'readest-tts',
}));

import { TTSUtils } from '@/services/tts/TTSUtils';
import TTSVoicesPage from '@/components/settings/TTSVoicesPage';

const VOICES: Record<string, TTSVoicesGroup[]> = {
  en: [
    {
      id: 'readest-tts',
      name: 'Readest Voice',
      engine: 'readest-tts',
      voices: [
        { id: 'kokoro:af_heart', name: 'Heart', lang: 'en-US', tier: 'plus', gender: 'female' },
        {
          id: 'omnivoice:ethan',
          name: 'Ethan',
          lang: 'en-US',
          tier: 'pro',
          gender: 'male',
          disabled: true,
        },
      ],
    },
    {
      id: 'edge-tts',
      name: 'Edge TTS',
      engine: 'edge-tts',
      voices: [{ id: 'en-GB-RyanNeural', name: 'Ryan', lang: 'en-GB', gender: 'male' }],
    },
  ],
  fr: [
    {
      id: 'edge-tts',
      name: 'Edge TTS',
      engine: 'edge-tts',
      voices: [{ id: 'fr-FR-DeniseNeural', name: 'Denise', lang: 'fr-FR', gender: 'female' }],
    },
  ],
};

const library: VoiceLibrary = {
  languages: ['en', 'fr'],
  getVoices: async (lang) => VOICES[lang] ?? [],
};

// Each custom service is a group of its own under the one custom engine.
const customLibrary: VoiceLibrary = {
  languages: ['en'],
  getVoices: async () => [
    {
      id: 'custom-tts:kokoro',
      name: 'Kokoro',
      literalName: true,
      engine: 'custom-tts',
      voices: [{ id: 'kokoro:bella', name: 'Bella', lang: 'en-US', literalName: true }],
    },
    {
      id: 'custom-tts:openai',
      name: 'OpenAI',
      literalName: true,
      engine: 'custom-tts',
      voices: [{ id: 'openai:alloy', name: 'Alloy', lang: 'en-US', literalName: true }],
    },
    ...VOICES['en']!.filter((group) => group.engine === 'edge-tts'),
  ],
};

const engineSelect = () => screen.getByLabelText('Voice Engine') as HTMLSelectElement;
const pickEngine = (label: string) => {
  const option = [...engineSelect().options].find((o) => o.text === label)!;
  fireEvent.change(engineSelect(), { target: { value: option.value } });
};

const renderPage = (props: Partial<React.ComponentProps<typeof TTSVoicesPage>> = {}) => {
  const onDefaultChange = vi.fn();
  render(
    <TTSVoicesPage
      library={library}
      lang='en'
      bookKey={null}
      onBack={vi.fn()}
      onDefaultChange={onDefaultChange}
      initialSection=''
      onLeave={vi.fn()}
      {...props}
    />,
  );
  return { onDefaultChange };
};

describe('TTSVoicesPage', () => {
  beforeEach(() => {
    localStorage.clear();
    state.user = { id: 'u' };
    state.range = null;
    state.play.mockReset().mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("picks a language's default voice without touching the other languages", async () => {
    const { onDefaultChange } = renderPage();
    fireEvent.click(await screen.findByText('Ryan'));
    expect(TTSUtils.getDefaultVoice('en')).toEqual({
      engine: 'edge-tts',
      voiceId: 'en-GB-RyanNeural',
    });
    expect(onDefaultChange).toHaveBeenCalled();
    expect(screen.getByText('Ryan').closest('button')!.getAttribute('aria-current')).toBe('true');

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fr' } });
    fireEvent.click(await screen.findByText('Denise'));
    expect(TTSUtils.getDefaultVoice('fr')?.voiceId).toBe('fr-FR-DeniseNeural');
    expect(TTSUtils.getDefaultVoice('en')?.voiceId).toBe('en-GB-RyanNeural');
  });

  it('a voice the plan lacks can be previewed but leads to the plans to be chosen', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Ethan'));
    expect(state.push).toHaveBeenCalledWith(expect.stringMatching(/^\/user/));
    expect(TTSUtils.getDefaultVoice('en')).toBeNull();
    fireEvent.click(screen.getByLabelText('Preview Ethan'));
    await waitFor(() => expect(state.play).toHaveBeenCalled());
  });

  it('from the library, a preview reads a sample in the voice’s own language', async () => {
    renderPage();
    fireEvent.click(await screen.findByLabelText('Preview Ryan'));
    await waitFor(() => expect(state.play).toHaveBeenCalled());
    expect(state.play.mock.calls[0]![0]).toMatchObject({
      engine: 'edge-tts',
      voiceId: 'en-GB-RyanNeural',
      lang: 'en-GB',
      text: expect.stringMatching(/^Hello!/),
    });
  });

  it('with a book open, the language is the book’s and previews read its page', async () => {
    const doc = new DOMParser().parseFromString(
      '<body><p id="p">Call me Ishmael. Some years ago, never mind how long precisely, I went to sea.</p></body>',
      'text/html',
    );
    state.range = doc.createRange();
    state.range.selectNodeContents(doc.getElementById('p')!);
    renderPage({ bookKey: 'book-1' });
    expect(screen.queryByLabelText('Language')).toBeNull();
    expect(screen.getByText('English')).toBeTruthy();
    fireEvent.click(await screen.findByLabelText('Preview Heart'));
    await waitFor(() => expect(state.play).toHaveBeenCalled());
    expect(state.play.mock.calls[0]![0]).toMatchObject({
      lang: 'en',
      text: 'Call me Ishmael. Some years ago, never mind how long precisely, I went to sea.',
    });
  });

  it('a signed-out reader is sent to sign in to preview Readest Voice, not other engines', async () => {
    state.user = null;
    renderPage();
    fireEvent.click(await screen.findByLabelText('Preview Heart'));
    expect(state.push).toHaveBeenCalledWith(expect.stringMatching(/^\/auth/));
    expect(state.play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Preview Ryan'));
    await waitFor(() => expect(state.play).toHaveBeenCalled());
  });

  it('lists every engine at first; the engine picker narrows the list to one', async () => {
    renderPage();
    expect(await screen.findByText('Heart')).toBeTruthy();
    expect(screen.getByText('Ryan')).toBeTruthy();
    expect(engineSelect().selectedOptions[0]!.text).toBe('All');

    pickEngine('Edge TTS');
    expect(screen.getByText('Ryan')).toBeTruthy();
    expect(screen.queryByText('Heart')).toBeNull();

    pickEngine('All');
    expect(screen.getByText('Heart')).toBeTruthy();
  });

  it('with one engine picked, its starred voices are listed under Favorites first', async () => {
    TTSUtils.toggleFavoriteVoice('edge-tts', 'en-GB-RyanNeural');
    renderPage();
    await screen.findByText('Heart');

    pickEngine('Edge TTS');
    const titles = screen.queryAllByRole('heading').map((heading) => heading.textContent);
    expect(titles).toEqual(['Favorites', 'Edge TTS']);
    expect(screen.getAllByText('Ryan')).toHaveLength(2);

    pickEngine('Readest Voice');
    expect(screen.queryByText('Favorites')).toBeNull();
  });

  it('offers each custom service on its own, by its name', async () => {
    renderPage({ library: customLibrary });
    await screen.findByText('Alloy');
    expect([...engineSelect().options].map((o) => o.text)).toEqual([
      'All',
      'Kokoro',
      'OpenAI',
      'Edge TTS',
    ]);
    pickEngine('OpenAI');
    expect(screen.getByText('Alloy')).toBeTruthy();
    expect(screen.queryByText('Bella')).toBeNull();
  });

  it('the filter finds voices by name or language across every engine', async () => {
    renderPage();
    await screen.findByText('Heart');
    fireEvent.change(screen.getByLabelText('Filter voices'), { target: { value: 'ryan' } });
    expect(screen.getByText('Ryan')).toBeTruthy();
    expect(screen.queryByText('Heart')).toBeNull();

    fireEvent.change(screen.getByLabelText('Filter voices'), {
      target: { value: 'united kingdom' },
    });
    expect(screen.getByText('Ryan')).toBeTruthy();
    expect(screen.queryByText('Heart')).toBeNull();

    fireEvent.click(screen.getByLabelText('Clear'));
    expect(screen.getByText('Heart')).toBeTruthy();
    expect((screen.getByLabelText('Filter voices') as HTMLInputElement).value).toBe('');
  });

  it('the filter and the gender tab narrow the list together', async () => {
    renderPage();
    await screen.findByText('Heart');
    fireEvent.click(screen.getByRole('radio', { name: 'Female' }));
    fireEvent.change(screen.getByLabelText('Filter voices'), { target: { value: 'ethan' } });
    expect(screen.queryByText('Ethan')).toBeNull();
    expect(screen.getByText('No voices match this filter')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    expect(screen.getByText('Ethan')).toBeTruthy();
  });

  it('switching engines resets the gender filter to all', async () => {
    renderPage();
    await screen.findByText('Heart');
    fireEvent.click(screen.getByRole('radio', { name: 'Female' }));
    expect(screen.queryByText('Ethan')).toBeNull();

    pickEngine('Readest Voice');
    expect(screen.getByText('Ethan')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'All' }).getAttribute('aria-checked')).toBe('true');
  });

  it('reports the engine on show when it leaves, and starts on the one it is given', async () => {
    const onLeave = vi.fn();
    renderPage({ onLeave });
    await screen.findByText('Heart');
    pickEngine('Readest Voice');
    const shown = engineSelect().value;
    fireEvent.click(screen.getByText('Ethan'));
    expect(onLeave).toHaveBeenCalledWith(shown);
    cleanup();

    renderPage({ initialSection: shown });
    expect(await screen.findByText('Heart')).toBeTruthy();
    expect(screen.queryByText('Ryan')).toBeNull();
    expect(engineSelect().selectedOptions[0]!.text).toBe('Readest Voice');
  });
});
