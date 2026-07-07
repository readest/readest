import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, opts?: Record<string, unknown>) =>
    opts ? Object.entries(opts).reduce((s, [k, v]) => s.replace(`{{${k}}}`, String(v)), key) : key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: { isMobile: false, hasSafeAreaInset: false },
  }),
}));

const readerState = { hoveredBookKey: '', setHoveredBookKey: vi.fn() };
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => readerState,
}));

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({ sectionLabel: 'Chapter 5' }),
}));

const getBookData = vi.fn();
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData }),
}));

import TTSMiniPlayer from '@/app/reader/components/tts/TTSMiniPlayer';

const gridInsets = { top: 0, right: 0, bottom: 0, left: 0 };

const makeProps = (overrides: Record<string, unknown> = {}) => ({
  bookKey: 'b1',
  isPlaying: true,
  isEink: false,
  hasTimeline: true,
  timeoutTimestamp: 0,
  chapterRemainingSec: null as number | null,
  gridInsets,
  onTogglePlay: vi.fn(),
  onBackward: vi.fn(),
  onForward: vi.fn(),
  onStop: vi.fn(),
  onExpand: vi.fn(),
  onGetPlaybackInfo: vi
    .fn()
    .mockReturnValue({ position: 10, duration: 100, measuredFraction: 0.4 }),
  ...overrides,
});

describe('TTSMiniPlayer', () => {
  beforeEach(() => {
    readerState.hoveredBookKey = '';
    getBookData.mockReturnValue({ book: { title: 'Alice in Wonderland', coverImageUrl: null } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test('shows title, section label, and elapsed/remaining time', () => {
    render(<TTSMiniPlayer {...makeProps()} />);
    expect(screen.getByText('Alice in Wonderland')).toBeTruthy();
    expect(screen.getByText(/Chapter 5/)).toBeTruthy();
    expect(screen.getByText(/0:10/)).toBeTruthy();
    expect(screen.getByText(/-1:30/)).toBeTruthy();
  });

  test('sentence skips and play/pause drive the transport callbacks', () => {
    const props = makeProps();
    render(<TTSMiniPlayer {...props} />);
    fireEvent.click(screen.getByLabelText('Previous Sentence'));
    expect(props.onBackward).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByLabelText('Next Sentence'));
    expect(props.onForward).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByLabelText('Pause'));
    expect(props.onTogglePlay).toHaveBeenCalled();
  });

  test('stop button stops without expanding', () => {
    const props = makeProps();
    render(<TTSMiniPlayer {...props} />);
    fireEvent.click(screen.getByLabelText('Stop reading aloud'));
    expect(props.onStop).toHaveBeenCalled();
    expect(props.onExpand).not.toHaveBeenCalled();
  });

  test('tapping the body expands the player sheet', () => {
    const props = makeProps();
    render(<TTSMiniPlayer {...props} />);
    fireEvent.click(screen.getByText('Alice in Wonderland'));
    expect(props.onExpand).toHaveBeenCalled();
  });

  test('fades out while the footer bar is up for this book', () => {
    readerState.hoveredBookKey = 'b1';
    render(<TTSMiniPlayer {...makeProps()} />);
    expect(screen.getByRole('status').className).toContain('pointer-events-none');
  });

  test('without a timeline shows the estimated chapter remaining instead', () => {
    render(
      <TTSMiniPlayer
        {...makeProps({
          hasTimeline: false,
          chapterRemainingSec: 300,
          onGetPlaybackInfo: vi.fn().mockReturnValue(null),
        })}
      />,
    );
    expect(screen.getByText(/5:00 left in chapter/)).toBeTruthy();
    expect(screen.queryByText(/-1:30/)).toBeNull();
  });

  test('shows a countdown chip while a sleep timer is armed', () => {
    vi.useFakeTimers();
    render(<TTSMiniPlayer {...makeProps({ timeoutTimestamp: Date.now() + 90_000 })} />);
    expect(screen.getByText(/^1:(2\d|30)$/)).toBeTruthy();
    vi.useRealTimers();
  });
});
