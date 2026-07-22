import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    hoveredBookKey: '',
    getViewSettings: () => ({ isEink: false, rtl: false }),
  }),
}));

const ttsState: Record<string, unknown> = {};
vi.mock('@/app/reader/hooks/useTTSControl', () => ({
  useTTSControl: () => ttsState,
}));

vi.mock('@/app/reader/hooks/useTTSDownloads', () => ({
  useTTSDownloads: () => ({
    supported: false,
    chapters: [],
    statuses: new Map(),
    cacheBytes: 0,
    download: { activeChapterKey: null, done: 0, total: 0 },
    downloadChapter: vi.fn(),
    downloadAll: vi.fn(),
    cancel: vi.fn(),
    statusOf: () => 'none',
    refresh: vi.fn(),
  }),
}));

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({ index: 0 }),
}));

vi.mock('@/app/reader/components/tts/TTSMiniPlayer', () => ({
  __esModule: true,
  default: ({ onExpand }: { onExpand: () => void }) => (
    <div data-testid='mini-player' onClick={onExpand} />
  ),
}));

vi.mock('@/app/reader/components/tts/TTSPlayerSheet', () => ({
  __esModule: true,
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid='player-sheet' /> : null,
}));

import TTSControl from '@/app/reader/components/tts/TTSControl';

const gridInsets = { top: 0, right: 0, bottom: 0, left: 0 };

describe('TTSControl', () => {
  beforeEach(() => {
    Object.assign(ttsState, {
      isPlaying: true,
      ttsLang: 'en',
      ttsClientsInited: true,
      showIndicator: true,
      showBackToCurrentTTSLocation: false,
      getController: () => null,
      timeoutOption: 0,
      timeoutTimestamp: 0,
      chapterRemainingSec: null,
      handleTogglePlay: vi.fn(),
      handleBackward: vi.fn(),
      handleForward: vi.fn(),
      handleSetRate: vi.fn(),
      handleGetVoices: vi.fn(),
      handleSetVoice: vi.fn(),
      handleGetVoiceId: vi.fn().mockReturnValue(''),
      handleSelectTimeout: vi.fn(),
      handleBackToCurrentTTSLocation: vi.fn(),
      handleSeekTo: vi.fn(),
      handleGetPlaybackInfo: vi.fn().mockReturnValue(null),
      handleSetSentenceGap: vi.fn(),
      handleSupportsPlaybackInfo: vi.fn().mockReturnValue(true),
      handleSupportsGapControl: vi.fn().mockReturnValue(false),
      refreshTtsLang: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test('mounts the mini player while a session is active', () => {
    render(<TTSControl bookKey='b1' gridInsets={gridInsets} />);
    expect(screen.getByTestId('mini-player')).toBeTruthy();
    expect(screen.queryByTestId('player-sheet')).toBeNull();
  });

  test('renders nothing while no session is active', () => {
    Object.assign(ttsState, { showIndicator: false, ttsClientsInited: false });
    render(<TTSControl bookKey='b1' gridInsets={gridInsets} />);
    expect(screen.queryByTestId('mini-player')).toBeNull();
    expect(screen.queryByTestId('player-sheet')).toBeNull();
  });

  test('mounts the mini player immediately, before the clients are initialized', () => {
    Object.assign(ttsState, { showIndicator: true, ttsClientsInited: false });
    render(<TTSControl bookKey='b1' gridInsets={gridInsets} />);
    expect(screen.getByTestId('mini-player')).toBeTruthy();
    // Expanding needs initialized clients; taps are ignored until then.
    fireEvent.click(screen.getByTestId('mini-player'));
    expect(screen.queryByTestId('player-sheet')).toBeNull();
    expect(screen.getByTestId('mini-player')).toBeTruthy();
  });

  test('expanding the mini player opens the sheet and hides the mini player', () => {
    render(<TTSControl bookKey='b1' gridInsets={gridInsets} />);
    fireEvent.click(screen.getByTestId('mini-player'));
    expect(screen.getByTestId('player-sheet')).toBeTruthy();
    // The two surfaces never show at the same time.
    expect(screen.queryByTestId('mini-player')).toBeNull();
  });

  test('shows the back-to-TTS-location pill when reading has drifted', () => {
    Object.assign(ttsState, { showBackToCurrentTTSLocation: true });
    render(<TTSControl bookKey='b1' gridInsets={gridInsets} />);
    expect(screen.getByText('Back to TTS Location')).toBeTruthy();
  });
});
