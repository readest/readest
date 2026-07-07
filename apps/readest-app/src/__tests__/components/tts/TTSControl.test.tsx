import React from 'react';
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

vi.mock('@/app/reader/components/tts/TTSMiniPlayer', () => ({
  __esModule: true,
  TTS_MINI_PLAYER_CLEARANCE: 64,
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
      handleSupportsPlaybackInfo: vi.fn().mockReturnValue(true),
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

  test('renders nothing before the clients are initialized', () => {
    Object.assign(ttsState, { showIndicator: false, ttsClientsInited: false });
    render(<TTSControl bookKey='b1' gridInsets={gridInsets} />);
    expect(screen.queryByTestId('mini-player')).toBeNull();
  });

  test('expanding the mini player opens the sheet', () => {
    render(<TTSControl bookKey='b1' gridInsets={gridInsets} />);
    fireEvent.click(screen.getByTestId('mini-player'));
    expect(screen.getByTestId('player-sheet')).toBeTruthy();
  });

  test('shows the back-to-TTS-location pill when reading has drifted', () => {
    Object.assign(ttsState, { showBackToCurrentTTSLocation: true });
    render(<TTSControl bookKey='b1' gridInsets={gridInsets} />);
    expect(screen.getByText('Back to TTS Location')).toBeTruthy();
  });
});
