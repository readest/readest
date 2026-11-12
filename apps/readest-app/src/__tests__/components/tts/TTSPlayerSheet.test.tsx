import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor as waitForWithOptions,
} from '@testing-library/react';

// One key with a real translation, so a name that must stay literal can be told
// from one that is translated.
const TRANSLATIONS: Record<string, string> = { Cherry: 'Cerise' };
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, opts?: Record<string, unknown>) =>
    opts
      ? Object.entries(opts).reduce((s, [k, v]) => s.replace(`{{${k}}}`, String(v)), key)
      : (TRANSLATIONS[key] ?? key),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
  useDefaultIconSize: () => 24,
}));

vi.mock('@/components/Dialog', () => ({
  default: ({
    isOpen,
    header,
    children,
    boxClassName,
  }: {
    isOpen: boolean;
    header?: React.ReactNode;
    children: React.ReactNode;
    boxClassName?: string;
  }) =>
    isOpen ? (
      <div role='dialog' className='modal-box' data-box-class={boxClassName}>
        {header}
        {children}
      </div>
    ) : null,
}));

const envConfig = {};
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig, appService: { hasHaptics: false } }),
}));

const viewSettings: Record<string, unknown> = {};
const setViewSettings = vi.fn();
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getViewSettings: () => viewSettings,
    setViewSettings,
  }),
}));

const settings = { globalViewSettings: { ttsRate: 1.0, ttsSentenceGap: 0.15 } };
const saveSettings = vi.fn();
const settingsState = { settings, setSettings: vi.fn(), saveSettings };
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => settingsState, { getState: () => settingsState }),
}));

const getBookData = vi.fn();
vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({ getBookData })),
}));

const saveViewSettings = vi.fn();
vi.mock('@/helpers/settings', () => ({
  saveViewSettings: (...args: unknown[]) => saveViewSettings(...args),
}));

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({ sectionLabel: 'Chapter 5' }),
  getBookProgress: () => null,
}));

// Previews resolve when the test says the audio ended.
const preview = vi.hoisted(() => ({
  play: vi.fn(),
  suspend: vi.fn(),
  end: () => {},
}));
vi.mock('@/services/tts/voicePreview', () => ({
  canPreviewEngine: (engine?: string) => !!engine && engine !== 'media-overlay',
  primeVoicePreview: vi.fn(),
  suspendReadingForPreview: preview.suspend,
  playVoicePreview: preview.play,
  READEST_TTS_ENGINE: 'readest-tts',
}));

// Premium gating for the offline-audio row. Defaults to a signed-in premium
// user so the existing tests (which don't render the row) are unaffected;
// the gating tests below flip these.
const { routerPush, mockAuth, mockQuota } = vi.hoisted(() => ({
  routerPush: vi.fn(),
  mockAuth: { user: { id: 'u' } as { id: string } | null },
  mockQuota: {
    userProfilePlan: 'pro' as 'free' | 'plus' | 'pro' | 'purchase' | undefined,
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockAuth.user, token: 'tok' }),
}));
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({ userProfilePlan: mockQuota.userProfilePlan }),
}));
vi.mock('@/app/reader/components/tts/TTSChaptersView', () => ({
  default: () => <div>chapters-view</div>,
}));

import TTSPlayerSheet from '@/app/reader/components/tts/TTSPlayerSheet';

const waitFor = <T,>(callback: () => T | Promise<T>) =>
  waitForWithOptions(callback, { interval: 1 });

const voiceGroups = [
  {
    id: 'edge',
    name: 'Edge TTS',
    engine: 'edge-tts',
    voices: [
      { id: 'ava', name: 'Ava', lang: 'en-US', disabled: false, gender: 'female' as const },
      { id: 'guy', name: 'Guy', lang: 'en-US', disabled: false, gender: 'male' as const },
    ],
  },
];

const makeProps = (overrides: Record<string, unknown> = {}) => ({
  bookKey: 'b1',
  isOpen: true,
  ttsLang: 'en',
  isPlaying: true,
  hasTimeline: true,
  audioTransport: false,
  timeoutOption: 0,
  timeoutTimestamp: 0,
  chapterRemainingSec: null as number | null,
  onClose: vi.fn(),
  onTogglePlay: vi.fn(),
  onBackward: vi.fn(),
  onForward: vi.fn(),
  loopState: 'off' as 'off' | 'a' | 'ab',
  onToggleLoop: vi.fn(),
  onGetLyricLoopRange: vi.fn().mockReturnValue(null),
  onSetRate: vi.fn(),
  clientsReady: true,
  onGetVoices: vi.fn().mockResolvedValue(voiceGroups),
  onSetVoice: vi.fn(),
  onGetVoiceId: vi.fn().mockReturnValue('ava'),
  onSelectTimeout: vi.fn(),
  onSeek: vi.fn().mockResolvedValue(undefined),
  onSeekPreview: vi.fn(),
  onGetPlaybackInfo: vi
    .fn()
    .mockReturnValue({ position: 10, duration: 100, measuredFraction: 0.4 }),
  // Lyric view off by default here: these tests cover the cover player, and
  // the lyric layout has its own suite.
  supportsLyrics: false,
  buffering: false,
  onGetLyrics: vi.fn().mockResolvedValue(null),
  onGetActiveIndex: vi.fn().mockReturnValue(-1),
  onGetLyricPage: vi.fn().mockResolvedValue(null),
  onPlayFromLyric: vi.fn().mockResolvedValue(undefined),
  downloads: {
    supported: false,
    chapters: [],
    statuses: new Map(),
    cacheBytes: 0,
    clearing: false,
    items: [],
    itemFor: () => undefined,
    downloadChapter: vi.fn(),
    downloadAll: vi.fn(),
    cancelChapter: vi.fn(),
    cancelAll: vi.fn(),
    clearDownloads: vi.fn().mockResolvedValue(undefined),
    statusOf: vi.fn().mockReturnValue('none'),
    refresh: vi.fn().mockResolvedValue(undefined),
  },
  activeSectionIndex: null as number | null,
  ...overrides,
});

describe('TTSPlayerSheet', () => {
  beforeEach(() => {
    viewSettings['ttsRate'] = 1.0;
    viewSettings['ttsSentenceGap'] = 0.15;
    viewSettings['isEink'] = false;
    // Shared fixture object: clear what individual tests write, or a value set
    // by one test leaks into the next.
    delete viewSettings['ttsVoice'];
    delete viewSettings['ttsUseNarration'];
    delete viewSettings['ttsPauseAfterSentence'];
    getBookData.mockReturnValue({
      book: { title: 'Alice in Wonderland', coverImageUrl: null },
    });
    // Default: signed-in premium user (the row-less tests never hit the gate).
    mockAuth.user = { id: 'u' };
    mockQuota.userProfilePlan = 'pro';
    preview.suspend.mockResolvedValue(false);
    preview.play.mockImplementation(
      (_req, signal: AbortSignal, { onStart }: { onStart: () => void }) =>
        new Promise<void>((resolve) => {
          onStart();
          preview.end = resolve;
          signal.addEventListener('abort', () => resolve());
        }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test('opened while the clients initialize, it loads the voices once they are ready', async () => {
    const props = makeProps({
      clientsReady: false,
      onGetVoices: vi.fn().mockResolvedValue([]),
      onGetVoiceId: vi.fn().mockReturnValue(''),
    });
    const { rerender } = render(<TTSPlayerSheet {...props} />);
    // Transport waits for the clients: a pause now would be undone by startup.
    expect((screen.getByLabelText('Previous Paragraph') as HTMLButtonElement).disabled).toBe(true);
    props.onGetVoices.mockResolvedValue(voiceGroups);
    props.onGetVoiceId.mockReturnValue('ava');
    rerender(<TTSPlayerSheet {...props} clientsReady />);
    expect(await waitFor(() => screen.getByText('Ava'))).toBeTruthy();
    expect(props.onGetVoices).toHaveBeenCalledTimes(2);
    expect((screen.getByLabelText('Previous Paragraph') as HTMLButtonElement).disabled).toBe(false);
  });

  test('a voice list that arrives after a newer one is discarded', async () => {
    let answerEarly: (groups: typeof voiceGroups) => void = () => {};
    const props = makeProps({
      clientsReady: false,
      onGetVoices: vi
        .fn()
        .mockImplementationOnce(() => new Promise((r) => (answerEarly = r)))
        .mockResolvedValue(voiceGroups),
    });
    const { rerender } = render(<TTSPlayerSheet {...props} />);
    rerender(<TTSPlayerSheet {...props} clientsReady />);
    expect(await waitFor(() => screen.getByText('Ava'))).toBeTruthy();
    // The request made before the clients were ready answers last, empty.
    await act(async () => answerEarly([]));
    expect(screen.getByText('Ava')).toBeTruthy();
  });

  test('shows title, chapter, scrubber, and transport on the main view', async () => {
    render(<TTSPlayerSheet {...makeProps()} />);
    expect(screen.getByText('Alice in Wonderland')).toBeTruthy();
    expect(screen.getByText('Chapter 5')).toBeTruthy();
    expect(screen.getByRole('slider')).toBeTruthy();
    expect(screen.getByLabelText('Previous Paragraph')).toBeTruthy();
    expect(screen.getByLabelText('Next Paragraph')).toBeTruthy();
    // Compact one-row controls: speed / voice / sleep timer buttons.
    expect(screen.getByLabelText('Speed')).toBeTruthy();
    expect(screen.getByLabelText('Sleep Timer')).toBeTruthy();
    expect(await waitFor(() => screen.getByText('Ava'))).toBeTruthy(); // voice button caption
    // The main view carries no header label (vertical space).
    expect(screen.queryByText('Read Aloud')).toBeNull();
  });

  test('a corner grip resizes the player on desktop and the size is kept', () => {
    localStorage.removeItem('ttsPlayerSize');
    render(<TTSPlayerSheet {...makeProps()} />);
    const box = screen.getByRole('dialog');
    box.getBoundingClientRect = () => ({ width: 420, height: 500 }) as DOMRect;
    const grip = box.querySelector<HTMLElement>('[data-tts-player-resize]')!;
    expect(grip).toBeTruthy();

    // The box is centered, so it grows on both sides: twice the pointer's
    // travel keeps the corner under the pointer.
    fireEvent.pointerDown(grip, { clientX: 500, clientY: 500, pointerId: 1, button: 0 });
    fireEvent.pointerMove(grip, { clientX: 550, clientY: 560, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientX: 550, clientY: 560, pointerId: 1 });
    expect(box.style.getPropertyValue('--tts-player-w')).toBe('520px');
    expect(box.style.getPropertyValue('--tts-player-h')).toBe('620px');
    expect(box.dataset['boxClass']).toContain('sm:w-[var(--tts-player-w,420px)]!');

    // Dragged past the window's edges it fills the window: full screen.
    fireEvent.pointerDown(grip, { clientX: 500, clientY: 500, pointerId: 1, button: 0 });
    fireEvent.pointerMove(grip, { clientX: 5000, clientY: 5000, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientX: 5000, clientY: 5000, pointerId: 1 });
    expect(box.style.getPropertyValue('--tts-player-w')).toBe(`${window.innerWidth}px`);
    expect(box.style.getPropertyValue('--tts-player-h')).toBe(`${window.innerHeight}px`);
    expect(box.dataset['boxClass']).not.toContain('sm:max-h-[85%]!');
    // Dialog caps a desktop box at 600px wide; the player must outgrow that.
    expect(box.dataset['boxClass']).toContain('sm:max-w-full!');

    cleanup();
    render(<TTSPlayerSheet {...makeProps()} />);
    expect(screen.getByRole('dialog').style.getPropertyValue('--tts-player-w')).toBe(
      `${window.innerWidth}px`,
    );
  });

  test('play/pause is the theme-neutral contrast button, not the accent CTA', () => {
    render(<TTSPlayerSheet {...makeProps()} />);
    const toggle = screen.getByRole('button', { name: /^(Play|Pause)$/ });
    expect(toggle.className).toContain('btn-contrast');
    expect(toggle.className).not.toContain('btn-primary');
  });

  test('resolves the chapter label from the ranged TTS section metadata', () => {
    const props = makeProps();
    render(
      <TTSPlayerSheet
        {...props}
        activeSectionIndex={3}
        downloads={{
          ...props.downloads,
          chapters: [
            { key: 'one', label: 'Chapter One', depth: 0, startSection: 0, endSection: 2 },
            { key: 'two', label: 'Chapter Two', depth: 0, startSection: 2, endSection: 5 },
          ],
        }}
      />,
    );

    expect(screen.getByText('Chapter Two')).toBeTruthy();
    expect(screen.queryByText('Chapter 5')).toBeNull();
  });

  test('falls back to an accurate section label when chapter metadata is missing', () => {
    const props = makeProps();
    render(
      <TTSPlayerSheet
        {...props}
        activeSectionIndex={4}
        downloads={{ ...props.downloads, chapters: [] }}
      />,
    );

    expect(screen.getByText('Section 5')).toBeTruthy();
    expect(screen.queryByText('Chapter 5')).toBeNull();
  });

  test('ignores malformed chapter ranges and blank labels', () => {
    const props = makeProps();
    render(
      <TTSPlayerSheet
        {...props}
        activeSectionIndex={3}
        downloads={{
          ...props.downloads,
          chapters: [
            { key: 'negative', label: 'Wrong Negative', depth: 0, startSection: -1, endSection: 5 },
            {
              key: 'fractional',
              label: 'Wrong Fractional',
              depth: 0,
              startSection: 2.5,
              endSection: 5,
            },
            { key: 'blank', label: '   ', depth: 0, startSection: 2, endSection: 5 },
          ],
        }}
      />,
    );

    expect(screen.getByText('Section 4')).toBeTruthy();
    expect(screen.queryByText('Wrong Negative')).toBeNull();
    expect(screen.queryByText('Wrong Fractional')).toBeNull();
  });

  test('degrades without a timeline: no scrubber, estimate text instead', () => {
    render(
      <TTSPlayerSheet
        {...makeProps({
          hasTimeline: false,
          chapterRemainingSec: 300,
          onGetPlaybackInfo: vi.fn().mockReturnValue(null),
        })}
      />,
    );
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByText(/5:00 left in chapter/)).toBeTruthy();
  });

  test('transport buttons pass paragraph/sentence semantics', () => {
    const props = makeProps();
    render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Previous Paragraph'));
    expect(props.onBackward).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByLabelText('Previous Sentence'));
    expect(props.onBackward).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByLabelText('Next Sentence'));
    expect(props.onForward).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByLabelText('Next Paragraph'));
    expect(props.onForward).toHaveBeenCalledWith(false);
  });

  test('toggles sentence-by-sentence as a non-style view setting', () => {
    render(<TTSPlayerSheet {...makeProps()} />);
    const toggle = screen.getByLabelText('Pause After Each Sentence');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(saveViewSettings).toHaveBeenCalledWith(
      envConfig,
      'b1',
      'ttsPauseAfterSentence',
      true,
      false,
      false,
    );
  });

  test('the A-B button names its next step and toggles the loop', () => {
    const props = makeProps();
    const { rerender } = render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Set Repeat Start (A)'));
    expect(props.onToggleLoop).toHaveBeenCalledTimes(1);
    rerender(<TTSPlayerSheet {...props} loopState='a' />);
    expect(screen.getByLabelText('Set Repeat End (B)')).toBeTruthy();
    rerender(<TTSPlayerSheet {...props} loopState='ab' />);
    expect(screen.getByLabelText('Clear A-B Repeat')).toBeTruthy();
  });

  test('a paired audiobook has no sentence modes', () => {
    render(<TTSPlayerSheet {...makeProps({ audioTransport: true })} />);
    expect(screen.queryByLabelText('Pause After Each Sentence')).toBeNull();
    expect(screen.queryByLabelText('Set Repeat Start (A)')).toBeNull();
  });

  test('a paired audiobook gets seek and chapter transport with the same step semantics', () => {
    const props = makeProps({ audioTransport: true });
    render(<TTSPlayerSheet {...props} />);
    for (const label of [
      'Previous Paragraph',
      'Previous Sentence',
      'Next Sentence',
      'Next Paragraph',
    ]) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    fireEvent.click(screen.getByLabelText('Previous Chapter'));
    expect(props.onBackward).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByLabelText('Back 15 Seconds'));
    expect(props.onBackward).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByLabelText('Forward 30 Seconds'));
    expect(props.onForward).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByLabelText('Next Chapter'));
    expect(props.onForward).toHaveBeenCalledWith(false);
  });

  test('main view offers a close button since desktop has no drag handle', () => {
    const props = makeProps();
    render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(props.onClose).toHaveBeenCalled();
  });

  test('main view keeps the cover clear of the sheet top edge on desktop', () => {
    // The sheet content is pulled up (mt-[-4px]) to tuck under the mobile
    // drag handle; on sm+ the handle is hidden and the main view needs its
    // own top padding or the cover clips into the rounded top edge.
    getBookData.mockReturnValue({
      book: { title: 'Alice in Wonderland', coverImageUrl: 'blob:cover' },
    });
    const { container } = render(<TTSPlayerSheet {...makeProps()} />);
    const cover = container.querySelector('img');
    expect(cover).toBeTruthy();
    // The cover sits inside the artwork/title block, which the main view owns.
    expect(cover?.parentElement?.parentElement?.className).toContain('sm:pt-4');
  });

  test('rings the transport button while the engine has no audio out yet', () => {
    const { container, rerender } = render(<TTSPlayerSheet {...makeProps()} />);
    const button = screen.getByLabelText('Pause');
    expect(button.getAttribute('aria-busy')).toBe('false');
    expect(container.querySelector('svg circle')).toBeNull();

    rerender(<TTSPlayerSheet {...makeProps({ buffering: true })} />);
    const busy = screen.getByLabelText('Pause');
    expect(busy.getAttribute('aria-busy')).toBe('true');
    // The glyph stays: a reader must still be able to pause mid-fetch.
    expect(busy.querySelector('svg circle')).toBeTruthy();
  });

  test('an aligned engine swaps the cover billing for the lyric sheet', async () => {
    getBookData.mockReturnValue({
      book: { title: 'Alice in Wonderland', coverImageUrl: 'blob:cover' },
    });
    const { container } = render(
      <TTSPlayerSheet
        {...makeProps({
          supportsLyrics: true,
          onGetLyrics: vi
            .fn()
            .mockResolvedValue({ sectionIndex: 0, lines: ['Down the rabbit hole.'] }),
        })}
      />,
    );
    await waitFor(() => expect(screen.getByText('Down the rabbit hole.')).toBeTruthy());
    // The artwork steps aside into a thumbnail so the transcript gets the room.
    expect(container.querySelector('img')?.className).toContain('h-12');
  });

  test('A−/A+ step the lyric font size and the choice is kept', async () => {
    localStorage.removeItem('ttsLyricsFontSize');
    const props = makeProps({
      supportsLyrics: true,
      onGetLyrics: vi.fn().mockResolvedValue({ sectionIndex: 0, lines: ['Down the rabbit hole.'] }),
    });
    render(<TTSPlayerSheet {...props} />);
    const line = await waitFor(() => screen.getByText('Down the rabbit hole.'));
    const sheet = () => line.closest<HTMLElement>('[data-lyric-sheet]')!;
    expect(sheet().style.fontSize).toBe('14px');
    // Clear of the desktop close button in the top-end corner.
    expect(
      screen.getByRole('button', { name: 'Increase font size' }).parentElement!.className,
    ).toContain('sm:me-8');
    // Bottom-aligned with the cover thumbnail.
    expect(
      screen.getByRole('button', { name: 'Increase font size' }).parentElement!.className,
    ).toContain('self-end');
    // Plain icons, no round background, so the glyphs sit on the cover's bottom edge.
    expect(screen.getByRole('button', { name: 'Increase font size' }).className).not.toContain(
      'btn-circle',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Increase font size' }));
    expect(sheet().style.fontSize).toBe('16px');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease font size' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decrease font size' }));
    expect(sheet().style.fontSize).toBe('12px');
    // The smallest step disables A− rather than going on shrinking.
    expect(
      (screen.getByRole('button', { name: 'Decrease font size' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    cleanup();
    render(<TTSPlayerSheet {...props} />);
    const again = await waitFor(() => screen.getByText('Down the rabbit hole.'));
    expect(again.closest<HTMLElement>('[data-lyric-sheet]')!.style.fontSize).toBe('12px');
  });

  test('blocked storage leaves the lyric size and player size working in memory', async () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    try {
      render(
        <TTSPlayerSheet
          {...makeProps({
            supportsLyrics: true,
            onGetLyrics: vi
              .fn()
              .mockResolvedValue({ sectionIndex: 0, lines: ['Down the rabbit hole.'] }),
          })}
        />,
      );
      const line = await waitFor(() => screen.getByText('Down the rabbit hole.'));
      const sheet = line.closest<HTMLElement>('[data-lyric-sheet]')!;
      expect(sheet.style.fontSize).toBe('14px');
      fireEvent.click(screen.getByRole('button', { name: 'Increase font size' }));
      expect(sheet.style.fontSize).toBe('16px');

      const box = screen.getByRole('dialog');
      box.getBoundingClientRect = () => ({ width: 420, height: 500 }) as DOMRect;
      const grip = box.querySelector<HTMLElement>('[data-tts-player-resize]')!;
      fireEvent.pointerDown(grip, { clientX: 500, clientY: 500, pointerId: 1, button: 0 });
      fireEvent.pointerMove(grip, { clientX: 550, clientY: 560, pointerId: 1 });
      fireEvent.pointerUp(grip, { clientX: 550, clientY: 560, pointerId: 1 });
      expect(box.style.getPropertyValue('--tts-player-w')).toBe('520px');
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  test('a section with nothing to transcribe keeps the cover player', async () => {
    getBookData.mockReturnValue({
      book: { title: 'Alice in Wonderland', coverImageUrl: 'blob:cover' },
    });
    const onGetLyrics = vi.fn().mockResolvedValue(null);
    const { container } = render(
      <TTSPlayerSheet {...makeProps({ supportsLyrics: true, onGetLyrics })} />,
    );
    await waitFor(() => expect(onGetLyrics).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('img')?.className).toContain('h-32'));
  });

  test('an engine without sentence alignment never asks for a transcript', async () => {
    const onGetLyrics = vi.fn().mockResolvedValue({ sectionIndex: 0, lines: ['nope'] });
    render(<TTSPlayerSheet {...makeProps({ supportsLyrics: false, onGetLyrics })} />);
    await waitFor(() => expect(screen.getByText('Alice in Wonderland')).toBeTruthy());
    expect(onGetLyrics).not.toHaveBeenCalled();
  });

  test('the speed caption pads and truncates like its sibling captions', () => {
    // 'Geschwindigkeit' (de) overflows the compact button edge-to-edge
    // without the max-w-full/truncate/px-1 combo the other captions use.
    render(<TTSPlayerSheet {...makeProps()} />);
    const caption = screen.getByText('Speed');
    expect(caption.className).toContain('max-w-full');
    expect(caption.className).toContain('truncate');
    expect(caption.className).toContain('px-1');
  });

  test('speed button drills into the ruler and releasing a drag persists the rate', () => {
    const props = makeProps();
    render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Speed'));
    const slider = screen.getByRole('slider', { name: 'Speed' });
    fireEvent.change(slider, { target: { value: '1.5' } });
    expect(props.onSetRate).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(props.onSetRate).toHaveBeenCalledWith(1.5);
    expect(viewSettings['ttsRate']).toBe(1.5);
    expect(settings.globalViewSettings.ttsRate).toBe(1.5);
    expect(saveSettings).toHaveBeenCalled();
  });

  test('voice button drills into the voice list and selects a voice', async () => {
    const props = makeProps();
    render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Voice'));
    fireEvent.click(await waitFor(() => screen.getByText('Guy')));
    expect(props.onSetVoice).toHaveBeenCalledWith('guy', 'en-US', false);
    expect(viewSettings['ttsVoice']).toBe('guy');
  });

  test('timer button drills into the timer list and selects a timeout', async () => {
    const props = makeProps();
    render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Sleep Timer'));
    // The translation mock interpolates, so options render as real labels.
    fireEvent.click(screen.getByText('30 minutes'));
    expect(props.onSelectTimeout).toHaveBeenCalledWith('b1', 1800);
  });

  const makeDownloads = (over: Record<string, unknown> = {}) => ({
    supported: true,
    chapters: [{ key: 'c1', label: 'One', depth: 0, startSection: 0, endSection: 1 }],
    statuses: new Map(),
    cacheBytes: 0,
    clearing: false,
    items: [],
    itemFor: () => undefined,
    downloadChapter: vi.fn(),
    downloadAll: vi.fn(),
    cancelChapter: vi.fn(),
    cancelAll: vi.fn(),
    clearDownloads: vi.fn().mockResolvedValue(undefined),
    statusOf: vi.fn().mockReturnValue('complete'),
    refresh: vi.fn().mockResolvedValue(undefined),
    ...over,
  });

  test('offline audio row: a premium user has no badge and opens the chapters view', () => {
    mockQuota.userProfilePlan = 'pro';
    const props = makeProps({ downloads: makeDownloads() });
    render(<TTSPlayerSheet {...props} />);
    const row = screen.getByLabelText('Offline Audio');
    expect(screen.queryByText('Premium')).toBeNull();
    expect(screen.getByText('1 of 1 downloaded')).toBeTruthy();
    fireEvent.click(row);
    expect(screen.getByText('chapters-view')).toBeTruthy();
    expect(routerPush).not.toHaveBeenCalled();
  });

  test('offline audio row: a free user sees a Premium badge and is routed to upgrade', () => {
    mockQuota.userProfilePlan = 'free';
    const props = makeProps({ downloads: makeDownloads() });
    render(<TTSPlayerSheet {...props} />);
    expect(screen.getByText('Premium')).toBeTruthy();
    expect(screen.getByText('Download chapters for offline playback')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Offline Audio'));
    expect(routerPush).toHaveBeenCalledWith(expect.stringMatching(/^\/user\?redirect=/));
    expect(props.onClose).toHaveBeenCalled();
    // The premium chapters view must not open for a free user.
    expect(screen.queryByText('chapters-view')).toBeNull();
  });

  test('offline audio row: a signed-out user is routed to sign-in', () => {
    mockAuth.user = null;
    mockQuota.userProfilePlan = undefined;
    const props = makeProps({ downloads: makeDownloads() });
    render(<TTSPlayerSheet {...props} />);
    expect(screen.getByText('Premium')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Offline Audio'));
    expect(routerPush).toHaveBeenCalledWith(expect.stringContaining('/auth?redirect='));
    expect(screen.queryByText('chapters-view')).toBeNull();
  });

  // Books with recorded narration (EPUB 3 Media Overlays) surface the narrator
  // as a voice; there is nothing to pre-download while it is selected.
  const narrationGroups = [
    {
      id: 'media-overlay',
      name: 'Narration',
      voices: [{ id: 'media-overlay', name: 'Jane Reader', lang: 'en' }],
    },
    ...voiceGroups,
  ];

  test('offline audio row is hidden while the book own narration is playing', async () => {
    const props = makeProps({
      downloads: makeDownloads(),
      onGetVoices: vi.fn().mockResolvedValue(narrationGroups),
      onGetVoiceId: vi.fn().mockReturnValue('media-overlay'),
    });
    render(<TTSPlayerSheet {...props} />);
    expect(await waitFor(() => screen.getByText('Jane Reader'))).toBeTruthy();
    expect(screen.queryByLabelText('Offline Audio')).toBeNull();
  });

  test('choosing the narrator records the per-book narration preference', async () => {
    const props = makeProps({ onGetVoices: vi.fn().mockResolvedValue(narrationGroups) });
    render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Voice'));
    fireEvent.click(await waitFor(() => screen.getByText('Jane Reader')));

    expect(props.onSetVoice).toHaveBeenCalledWith('media-overlay', 'en', false);
    expect(viewSettings['ttsVoice']).toBe('media-overlay');
    expect(viewSettings['ttsUseNarration']).toBe(true);
  });

  test('choosing a synthetic voice opts this book out of its narration', async () => {
    const props = makeProps({ onGetVoices: vi.fn().mockResolvedValue(narrationGroups) });
    render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Voice'));
    fireEvent.click(await waitFor(() => screen.getByText('Guy')));

    expect(viewSettings['ttsVoice']).toBe('guy');
    expect(viewSettings['ttsUseNarration']).toBe(false);
  });

  test('a book without narration never writes the narration preference', async () => {
    const props = makeProps();
    render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Voice'));
    fireEvent.click(await waitFor(() => screen.getByText('Guy')));

    expect(viewSettings['ttsVoice']).toBe('guy');
    expect(viewSettings['ttsUseNarration']).toBeUndefined();
  });

  test('a voice row names its gender and language, and premium voices the plan', async () => {
    const groups = [
      {
        id: 'readest-tts',
        name: 'Readest Voice',
        engine: 'readest-tts',
        voices: [
          {
            id: 'omnivoice:xiaoyu',
            name: 'Xiaoyu',
            lang: 'zh-CN',
            tier: 'pro' as const,
            disabled: true,
          },
        ],
      },
      {
        id: 'edge-tts',
        name: 'Edge TTS',
        engine: 'edge-tts',
        voices: [
          {
            id: 'en-US-AvaMultilingualNeural',
            name: 'Ava',
            lang: 'en-US',
            variant: 'multilingual' as const,
            gender: 'female' as const,
          },
        ],
      },
    ];
    render(<TTSPlayerSheet {...makeProps({ onGetVoices: vi.fn().mockResolvedValue(groups) })} />);
    fireEvent.click(screen.getByLabelText('Voice'));
    const row = (name: string) => screen.getAllByText(name).at(-1)!.closest('button')!;
    const xiaoyu = await waitFor(() => row('Xiaoyu'));
    // A locked voice is greyed and badged with the plan that unlocks it.
    expect(xiaoyu.innerHTML).toContain('text-base-content/60');
    expect(xiaoyu.textContent).toContain('Pro');
    const ava = row('Ava');
    expect(ava.textContent).toContain('Female');
    expect(ava.textContent).toMatch(/English \(United States\) · Multilingual/);
    // Every engine is listed under its own heading, none folded away.
    expect(screen.getByRole('heading', { name: 'Readest Voice' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Edge TTS' })).toBeTruthy();
  });

  test("shows a service's voice name as given, translating only built-in names", async () => {
    const groups = [
      {
        id: 'custom',
        name: 'Cherry',
        literalName: true,
        engine: 'custom-tts',
        voices: [
          { id: 's1:cherry', name: 'Cherry', lang: 'mul', literalName: true },
          { id: 'cherry', name: 'Cherry', lang: 'mul' },
        ],
      },
    ];
    const props = makeProps({
      onGetVoices: vi.fn().mockResolvedValue(groups),
      onGetVoiceId: vi.fn().mockReturnValue('s1:cherry'),
    });
    render(<TTSPlayerSheet {...props} />);
    const voiceButton = screen.getByLabelText('Voice');
    await waitFor(() => expect(voiceButton.textContent).toBe('Cherry'));
    fireEvent.click(voiceButton);
    // The group is the user's service, named by them.
    expect((await waitFor(() => screen.getByRole('heading'))).textContent).toBe('Cherry');
    expect(screen.getByText('Cerise')).toBeTruthy();
    const current = screen.getAllByText('Cherry').at(-1)!.closest('button')!;
    expect(current.getAttribute('aria-current')).toBe('true');
  });

  test('filters the voices by gender, keeping the list at one height', async () => {
    render(<TTSPlayerSheet {...makeProps()} />);
    fireEvent.click(screen.getByLabelText('Voice'));
    fireEvent.click(await waitFor(() => screen.getByRole('radio', { name: 'Male' })));
    expect(screen.getByText('Guy')).toBeTruthy();
    expect(screen.queryByText('Ava')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    expect(screen.getByText('Ava')).toBeTruthy();
    const boxClass = screen.getByRole('dialog').getAttribute('data-box-class');
    expect(boxClass).toContain('sm:h-[var(--tts-player-h,85%)]!');
  });

  test('a preview plays a voice without picking it; tapping again stops it', async () => {
    const props = makeProps();
    render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Voice'));
    fireEvent.click(await waitFor(() => screen.getByLabelText('Preview Guy')));
    await waitFor(() => expect(preview.play).toHaveBeenCalledTimes(1));
    expect(preview.play.mock.calls[0]![0]).toMatchObject({
      engine: 'edge-tts',
      voiceId: 'guy',
      lang: 'en-US',
      text: expect.stringMatching(/^Hello!/),
    });
    const stop = await waitFor(() => screen.getByLabelText('Stop Preview'));
    expect(props.onSetVoice).not.toHaveBeenCalled();
    fireEvent.click(stop);
    expect((preview.play.mock.calls[0]![1] as AbortSignal).aborted).toBe(true);
    expect(screen.getByLabelText('Preview Guy')).toBeTruthy();
  });

  test('picking a voice after a preview stopped reading reads on with it', async () => {
    preview.suspend.mockResolvedValue(true);
    const props = makeProps({ isPlaying: false });
    render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Voice'));
    fireEvent.click(await waitFor(() => screen.getByLabelText('Preview Guy')));
    await waitFor(() => expect(preview.play).toHaveBeenCalled());
    await act(async () => preview.end());
    fireEvent.click(screen.getByText('Guy'));
    expect(props.onSetVoice).toHaveBeenCalledWith('guy', 'en-US', true);
  });

  test('leaving the voice list stops the preview', async () => {
    const props = makeProps();
    const { rerender } = render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Voice'));
    fireEvent.click(await waitFor(() => screen.getByLabelText('Preview Ava')));
    await waitFor(() => expect(preview.play).toHaveBeenCalled());
    rerender(<TTSPlayerSheet {...props} isOpen={false} />);
    expect((preview.play.mock.calls[0]![1] as AbortSignal).aborted).toBe(true);
  });

  test('recorded narration has nothing to preview', async () => {
    const props = makeProps({ onGetVoices: vi.fn().mockResolvedValue(narrationGroups) });
    render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Voice'));
    await waitFor(() => screen.getByText('Jane Reader'));
    expect(screen.queryByLabelText('Preview Jane Reader')).toBeNull();
    expect(screen.getByLabelText('Preview Guy')).toBeTruthy();
  });

  test('a Readest voice the plan lacks sends the reader to upgrade', async () => {
    const groups = [
      {
        id: 'readest-tts',
        name: 'Readest Voice',
        voices: [
          {
            id: 'omnivoice:clara',
            name: 'Clara',
            lang: 'en-US',
            tier: 'pro' as const,
            disabled: true,
          },
        ],
      },
    ];
    const props = makeProps({ onGetVoices: vi.fn().mockResolvedValue(groups) });
    render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Voice'));
    fireEvent.click(await waitFor(() => screen.getByText('Clara')));
    expect(props.onSetVoice).not.toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith(expect.stringMatching(/^\/user\?redirect=/));
    expect(props.onClose).toHaveBeenCalled();
  });

  test('a signed-out reader tapping a Readest voice is sent to sign in', async () => {
    mockAuth.user = null;
    const groups = [
      {
        id: 'readest-tts',
        name: 'Readest Voice',
        voices: [
          {
            id: 'kokoro:af_heart',
            name: 'Heart',
            lang: 'en-US',
            tier: 'plus' as const,
            disabled: true,
          },
        ],
      },
    ];
    const props = makeProps({ onGetVoices: vi.fn().mockResolvedValue(groups) });
    render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Voice'));
    fireEvent.click(await waitFor(() => screen.getByText('Heart')));
    expect(props.onSetVoice).not.toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith(expect.stringMatching(/^\/auth/));
  });

  test('reopening the sheet returns to the main view', async () => {
    const props = makeProps();
    const { rerender } = render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Voice'));
    expect(await waitFor(() => screen.getByText('Guy'))).toBeTruthy();
    rerender(<TTSPlayerSheet {...props} isOpen={false} />);
    rerender(<TTSPlayerSheet {...props} isOpen={true} />);
    expect(screen.getByLabelText('Previous Paragraph')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Guy' })).toBeNull();
  });
});
