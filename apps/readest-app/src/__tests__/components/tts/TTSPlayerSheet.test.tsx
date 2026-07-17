import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, opts?: Record<string, unknown>) =>
    opts ? Object.entries(opts).reduce((s, [k, v]) => s.replace(`{{${k}}}`, String(v)), key) : key,
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
  }: {
    isOpen: boolean;
    header?: React.ReactNode;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div role='dialog'>
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
  useBookDataStore: () => ({ getBookData }),
}));

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({ sectionLabel: 'Chapter 5' }),
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

const voiceGroups = [
  {
    id: 'edge',
    name: 'Edge TTS',
    voices: [
      { id: 'ava', name: 'Ava', lang: 'en-US', disabled: false },
      { id: 'guy', name: 'Guy', lang: 'en-US', disabled: false },
    ],
  },
];

const makeProps = (overrides: Record<string, unknown> = {}) => ({
  bookKey: 'b1',
  isOpen: true,
  ttsLang: 'en',
  isPlaying: true,
  hasTimeline: true,
  hasGapControl: false,
  timeoutOption: 0,
  timeoutTimestamp: 0,
  chapterRemainingSec: null as number | null,
  onClose: vi.fn(),
  onTogglePlay: vi.fn(),
  onBackward: vi.fn(),
  onForward: vi.fn(),
  onSetRate: vi.fn(),
  onSetSentenceGap: vi.fn(),
  onSetParagraphGap: vi.fn(),
  onGetVoices: vi.fn().mockResolvedValue(voiceGroups),
  onSetVoice: vi.fn(),
  onGetVoiceId: vi.fn().mockReturnValue('ava'),
  onSelectTimeout: vi.fn(),
  onSeek: vi.fn().mockResolvedValue(undefined),
  onSeekPreview: vi.fn(),
  onGetPlaybackInfo: vi
    .fn()
    .mockReturnValue({ position: 10, duration: 100, measuredFraction: 0.4 }),
  downloads: {
    supported: false,
    chapters: [],
    statuses: new Map(),
    cacheBytes: 0,
    download: { activeChapterKey: null, done: 0, total: 0 },
    downloadChapter: vi.fn().mockResolvedValue(undefined),
    downloadAll: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
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
    getBookData.mockReturnValue({
      book: { title: 'Alice in Wonderland', coverImageUrl: null },
    });
    // Default: signed-in premium user (the row-less tests never hit the gate).
    mockAuth.user = { id: 'u' };
    mockQuota.userProfilePlan = 'pro';
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
    expect(await screen.findByText('Ava')).toBeTruthy(); // voice button caption
    // The main view carries no header label (vertical space).
    expect(screen.queryByText('Read Aloud')).toBeNull();
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
    expect(cover?.parentElement?.className).toContain('sm:pt-4');
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

  test('gap control is absent for a non-Edge client (hasGapControl false)', () => {
    const props = makeProps({ hasGapControl: false });
    render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Speed'));
    expect(screen.queryByText(/Sentence Pause/)).toBeNull();
    expect(screen.queryByRole('slider', { name: 'Sentence Pause' })).toBeNull();
  });

  test('sentence pause ruler shows for an Edge client and a drag persists the gap', () => {
    const props = makeProps({ hasGapControl: true });
    render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Speed'));
    expect(screen.getByText(/Sentence Pause/)).toBeTruthy();
    const slider = screen.getByRole('slider', { name: 'Sentence Pause' });
    fireEvent.change(slider, { target: { value: '0.4' } });
    expect(props.onSetSentenceGap).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(props.onSetSentenceGap).toHaveBeenCalledWith(0.4);
    expect(viewSettings['ttsSentenceGap']).toBe(0.4);
    expect(settings.globalViewSettings.ttsSentenceGap).toBe(0.4);
    expect(saveSettings).toHaveBeenCalled();
  });

  test('the speed view carries the paragraph pause ruler for every client', () => {
    const props = makeProps({ hasGapControl: false });
    render(<TTSPlayerSheet {...props} />);
    // No dedicated sub-view or main-row button anymore.
    expect(screen.queryByLabelText('Paragraph Gap')).toBeNull();
    fireEvent.click(screen.getByLabelText('Speed'));
    expect(screen.getByText(/Paragraph Pause/)).toBeTruthy();
    const slider = screen.getByRole('slider', { name: 'Paragraph Pause' });
    fireEvent.change(slider, { target: { value: '0.75' } });
    fireEvent.pointerUp(slider);
    expect(props.onSetParagraphGap).toHaveBeenCalledWith(0.75);
    expect(viewSettings['ttsParagraphGap']).toBe(0.75);
    expect(saveSettings).toHaveBeenCalled();
  });

  test('voice button drills into the voice list and selects a voice', async () => {
    const props = makeProps();
    render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Voice'));
    fireEvent.click(await screen.findByText('Guy'));
    expect(props.onSetVoice).toHaveBeenCalledWith('guy', 'en-US');
    expect(viewSettings['ttsVoice']).toBe('guy');
  });

  test('timer button drills into the timer list and selects a timeout', async () => {
    const props = makeProps();
    render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Sleep Timer'));
    // The translation mock interpolates, so options render as real labels.
    fireEvent.click(await screen.findByText('30 minutes'));
    expect(props.onSelectTimeout).toHaveBeenCalledWith('b1', 1800);
  });

  const makeDownloads = (over: Record<string, unknown> = {}) => ({
    supported: true,
    chapters: [{ key: 'c1', label: 'One', depth: 0, startSection: 0, endSection: 1 }],
    statuses: new Map(),
    cacheBytes: 0,
    download: { activeChapterKey: null, done: 0, total: 0 },
    downloadChapter: vi.fn().mockResolvedValue(undefined),
    downloadAll: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
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
    expect(routerPush).toHaveBeenCalledWith('/user');
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

  test('reopening the sheet returns to the main view', async () => {
    const props = makeProps();
    const { rerender } = render(<TTSPlayerSheet {...props} />);
    fireEvent.click(screen.getByLabelText('Voice'));
    expect(await screen.findByText('Guy')).toBeTruthy();
    rerender(<TTSPlayerSheet {...props} isOpen={false} />);
    rerender(<TTSPlayerSheet {...props} isOpen={true} />);
    expect(screen.getByLabelText('Previous Paragraph')).toBeTruthy();
    expect(screen.queryByText('Guy')).toBeNull();
  });
});
