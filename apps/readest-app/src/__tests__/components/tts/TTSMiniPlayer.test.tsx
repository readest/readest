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

let viewSettingsOverride: Record<string, unknown> = {};
const readerState = {
  hoveredBookKey: '',
  bottomBarTab: '',
  setHoveredBookKey: vi.fn(),
  getViewSettings: () => ({
    ...DEFAULT_VIEW_CONFIG,
    ...DEFAULT_BOOK_LAYOUT,
    ...DEFAULT_TTS_CONFIG,
    ...viewSettingsOverride,
  }),
};
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => readerState,
}));

const progressState: { sectionLabel: string | undefined } = { sectionLabel: 'Chapter 5' };
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => progressState,
}));

const getBookData = vi.fn();
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData }),
}));

import TTSMiniPlayer from '@/app/reader/components/tts/TTSMiniPlayer';
import { DEFAULT_BOOK_LAYOUT, DEFAULT_TTS_CONFIG, DEFAULT_VIEW_CONFIG } from '@/services/constants';

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
    viewSettingsOverride = {};
    readerState.hoveredBookKey = '';
    readerState.bottomBarTab = '';
    progressState.sectionLabel = 'Chapter 5';
    getBookData.mockReturnValue({ book: { title: 'Alice in Wonderland', coverImageUrl: null } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test('minimal style shows only the time info, dropping chapter, title and cover', () => {
    viewSettingsOverride = { ttsPlayerStyle: 'minimal' };
    getBookData.mockReturnValue({
      book: { title: 'Alice in Wonderland', coverImageUrl: 'blob:cover' },
    });
    const { container } = render(<TTSMiniPlayer {...makeProps()} />);
    expect(screen.queryByText('Chapter 5')).toBeNull();
    expect(screen.queryByText('Alice in Wonderland')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/0:10/)).toBeTruthy();
    expect(screen.getByText(/-1:30/)).toBeTruthy();
  });

  test('minimal style stacks the sleep timer on a second line below the time', () => {
    vi.useFakeTimers();
    viewSettingsOverride = { ttsPlayerStyle: 'minimal' };
    render(<TTSMiniPlayer {...makeProps({ timeoutTimestamp: Date.now() + 90_000 })} />);
    const body = screen.getByLabelText('Open Read Aloud player');
    expect(body.className).toContain('flex-col');
    // Time row and timer chip are separate stacked children, so the timer
    // cannot squeeze the elapsed time into truncation.
    const timer = screen.getByText(/^1:(2\d|30)$/);
    const elapsed = screen.getByText('0:10');
    expect(timer.parentElement).toBe(body);
    expect(elapsed.parentElement?.parentElement).toBe(body);
    vi.useRealTimers();
  });

  test('minimal style centers the time and emphasizes elapsed over remaining', () => {
    viewSettingsOverride = { ttsPlayerStyle: 'minimal' };
    render(<TTSMiniPlayer {...makeProps()} />);
    const body = screen.getByLabelText('Open Read Aloud player');
    expect(body.className).toContain('justify-center');
    const elapsed = screen.getByText('0:10');
    expect(elapsed.className).toContain('font-medium');
    expect(screen.getByText(/-1:30/).className).toContain('text-base-content/60');
  });

  test('sentence and paragraph skips and play/pause drive the transport callbacks', () => {
    viewSettingsOverride = { ttsPlayerStyle: 'minimal' };
    const props = makeProps();
    render(<TTSMiniPlayer {...props} />);
    fireEvent.click(screen.getByLabelText('Previous Sentence'));
    expect(props.onBackward).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByLabelText('Next Sentence'));
    expect(props.onForward).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByLabelText('Previous Paragraph'));
    expect(props.onBackward).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByLabelText('Next Paragraph'));
    expect(props.onForward).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByLabelText('Pause'));
    expect(props.onTogglePlay).toHaveBeenCalled();
    expect(screen.getByLabelText('Next Sentence').closest('[dir="ltr"]')).toBeTruthy();
    expect(screen.getByLabelText('Next Paragraph').closest('[dir="ltr"]')).toBeTruthy();
  });

  test('play and pause glyphs share a size so toggling does not shift the row', () => {
    viewSettingsOverride = { ttsPlayerStyle: 'minimal' };
    const { rerender } = render(<TTSMiniPlayer {...makeProps({ isPlaying: true })} />);
    const pauseWidth = screen.getByLabelText('Pause').querySelector('svg')?.getAttribute('width');
    rerender(<TTSMiniPlayer {...makeProps({ isPlaying: false })} />);
    const playWidth = screen.getByLabelText('Play').querySelector('svg')?.getAttribute('width');
    expect(pauseWidth).toBeTruthy();
    expect(playWidth).toBe(pauseWidth);
  });

  test('stop button stops without expanding', () => {
    const props = makeProps();
    render(<TTSMiniPlayer {...props} />);
    fireEvent.click(screen.getByLabelText('Stop reading aloud'));
    expect(props.onStop).toHaveBeenCalled();
    expect(props.onExpand).not.toHaveBeenCalled();
  });

  test('tapping the body expands the player sheet', () => {
    viewSettingsOverride = { ttsPlayerStyle: 'minimal' };
    const props = makeProps();
    render(<TTSMiniPlayer {...props} />);
    fireEvent.click(screen.getByLabelText('Open Read Aloud player'));
    expect(props.onExpand).toHaveBeenCalled();
  });

  test('the settings affordance shows the speed and opens the full player', () => {
    viewSettingsOverride = { ttsPlayerStyle: 'minimal' };
    const props = makeProps();
    render(<TTSMiniPlayer {...props} />);
    const btn = screen.getByLabelText('Playback settings');
    expect(btn.textContent).toBe('1.3×'); // DEFAULT_VIEW_CONFIG ttsRate
    fireEvent.click(btn);
    expect(props.onExpand).toHaveBeenCalled();
  });

  test('rides above the bottom bar while it is up for this book', () => {
    readerState.hoveredBookKey = 'b1';
    render(<TTSMiniPlayer {...makeProps()} />);
    const card = screen.getByRole('status');
    // Desktop footer bar (52px) + 8px gap; the card stays interactive.
    expect(card.style.bottom).toBe('60px');
    expect(card.className).not.toContain('pointer-events-none');
  });

  test('rides above an expanded action panel while one is open', () => {
    readerState.hoveredBookKey = 'b1';
    readerState.bottomBarTab = 'font';
    const cell = document.createElement('div');
    cell.id = 'gridcell-b1';
    const panel = document.createElement('div');
    panel.className = 'footerbar-font-mobile';
    cell.appendChild(panel);
    document.body.appendChild(cell);
    cell.getBoundingClientRect = () => ({ bottom: 800, top: 0, height: 800 }) as DOMRect;
    // Panel settled at 600..736 above the nav bar; no transform in jsdom.
    panel.getBoundingClientRect = () => ({ top: 600, bottom: 736, height: 136 }) as DOMRect;
    try {
      render(<TTSMiniPlayer {...makeProps()} />);
      // 800 - 600 + 8px gap; beats the plain above-the-bar offset.
      expect(screen.getByRole('status').style.bottom).toBe('208px');
    } finally {
      cell.remove();
    }
  });

  test('rests above the footer info band once the bar is dismissed', () => {
    render(<TTSMiniPlayer {...makeProps()} />);
    expect(screen.getByRole('status').style.bottom).toBe(`${DEFAULT_BOOK_LAYOUT.marginBottomPx}px`);
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

  // Player Style 'full': the pre-#5162 card (0.11.18) with book cover, book
  // title, chapter + timestamps line, and the sentence-only transport.
  test('full style is the default and shows cover, book title, chapter and timestamps', () => {
    getBookData.mockReturnValue({
      book: { title: 'Alice in Wonderland', coverImageUrl: 'blob:cover' },
    });
    const { container } = render(<TTSMiniPlayer {...makeProps()} />);
    expect(screen.getByText('Alice in Wonderland')).toBeTruthy();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:cover');
    expect(screen.getByText('Chapter 5 · 0:10 · -1:30')).toBeTruthy();
  });

  test('full style keeps the sentence-only transport without minimal chrome', () => {
    const props = makeProps();
    render(<TTSMiniPlayer {...props} />);
    fireEvent.click(screen.getByLabelText('Previous Sentence'));
    expect(props.onBackward).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByLabelText('Next Sentence'));
    expect(props.onForward).toHaveBeenCalledWith(true);
    expect(screen.queryByLabelText('Previous Paragraph')).toBeNull();
    expect(screen.queryByLabelText('Next Paragraph')).toBeNull();
    expect(screen.queryByLabelText('Playback settings')).toBeNull();
  });

  test('full style expands the sheet from the book info area', () => {
    getBookData.mockReturnValue({
      book: { title: 'Alice in Wonderland', coverImageUrl: 'blob:cover' },
    });
    const props = makeProps();
    render(<TTSMiniPlayer {...props} />);
    fireEvent.click(screen.getByLabelText('Open Read Aloud player'));
    expect(props.onExpand).toHaveBeenCalled();
  });
});
