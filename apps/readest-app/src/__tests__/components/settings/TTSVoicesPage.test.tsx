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

const renderPage = (props: Partial<React.ComponentProps<typeof TTSVoicesPage>> = {}) => {
  const onDefaultChange = vi.fn();
  render(
    <TTSVoicesPage
      library={library}
      lang='en'
      bookKey={null}
      onBack={vi.fn()}
      onDefaultChange={onDefaultChange}
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
    expect(screen.queryByRole('combobox')).toBeNull();
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
});
