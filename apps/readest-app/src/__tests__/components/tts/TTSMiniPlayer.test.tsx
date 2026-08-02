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
  visible: true,
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

  // #5310: the minimal card is down to one time. Elapsed is the half nobody
  // listens by, and carrying both got the pair chopped off at any UI font size
  // above 13px.
  test('minimal style shows only the remaining time, dropping elapsed, chapter, title and cover', () => {
    viewSettingsOverride = { ttsPlayerStyle: 'minimal' };
    getBookData.mockReturnValue({
      book: { title: 'Alice in Wonderland', coverImageUrl: 'blob:cover' },
    });
    const { container } = render(<TTSMiniPlayer {...makeProps()} />);
    expect(screen.queryByText('Chapter 5')).toBeNull();
    expect(screen.queryByText('Alice in Wonderland')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText(/0:10/)).toBeNull();
    expect(screen.getByText('-1:30')).toBeTruthy();
  });

  test('minimal style drops the seconds from the remaining time above an hour', () => {
    viewSettingsOverride = { ttsPlayerStyle: 'minimal' };
    // 2h01m30s left: the compact form keeps the row five columns wide.
    const info = { position: 100, duration: 7390, measuredFraction: 0.1 };
    render(<TTSMiniPlayer {...makeProps({ onGetPlaybackInfo: vi.fn().mockReturnValue(info) })} />);
    expect(screen.getByText('-2:01')).toBeTruthy();
  });

  test('full style keeps the elapsed and the long-form remaining time', () => {
    const info = { position: 100, duration: 7390, measuredFraction: 0.1 };
    render(<TTSMiniPlayer {...makeProps({ onGetPlaybackInfo: vi.fn().mockReturnValue(info) })} />);
    expect(screen.getByText('Chapter 5 · 0:01:40 · -2:01:30')).toBeTruthy();
  });

  test('minimal style stacks the sleep timer on a second line below the time', () => {
    vi.useFakeTimers();
    viewSettingsOverride = { ttsPlayerStyle: 'minimal' };
    render(<TTSMiniPlayer {...makeProps({ timeoutTimestamp: Date.now() + 90_000 })} />);
    const body = screen.getByLabelText('Open Read Aloud player');
    expect(body.className).toContain('flex-col');
    // Time row and timer chip are separate stacked children, so the timer
    // cannot squeeze the remaining time into truncation.
    const timer = screen.getByText(/^1:(2\d|30)$/);
    const remaining = screen.getByText('-1:30');
    expect(timer.parentElement).toBe(body);
    expect(remaining.parentElement).toBe(body);
    vi.useRealTimers();
  });

  test('minimal style centers the remaining time at full weight', () => {
    viewSettingsOverride = { ttsPlayerStyle: 'minimal' };
    render(<TTSMiniPlayer {...makeProps()} />);
    const body = screen.getByLabelText('Open Read Aloud player');
    expect(body.className).toContain('justify-center');
    const remaining = screen.getByText('-1:30');
    expect(remaining.className).toContain('font-medium');
    expect(remaining.className).not.toContain('text-base-content/60');
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

  // #5310: an accidental hit on a sixth crowded glyph ends the session, and
  // stopping already lives on the toolbar TTS button that started it.
  test('minimal style has no stop button, leaving five transport glyphs', () => {
    viewSettingsOverride = { ttsPlayerStyle: 'minimal' };
    render(<TTSMiniPlayer {...makeProps()} />);
    expect(screen.queryByLabelText('Stop reading aloud')).toBeNull();
    const transport = screen.getByLabelText('Next Sentence').closest('[dir="ltr"]');
    expect(transport?.querySelectorAll('button')).toHaveLength(5);
  });

  // The transport, not the time, takes the row's slack -- otherwise the glyphs
  // stay crammed against the right edge while the middle sits empty (#5310).
  test('minimal style spreads the transport across the row', () => {
    viewSettingsOverride = { ttsPlayerStyle: 'minimal' };
    render(<TTSMiniPlayer {...makeProps()} />);
    const transport = screen.getByLabelText('Next Sentence').closest('[dir="ltr"]');
    expect(transport?.className).toContain('flex-1');
    expect(transport?.className).toContain('justify-between');
  });

  // A content-sized box would re-center every glyph as the label narrows on
  // "-10:00" -> "-9:59", so the time gets a fixed one.
  test('minimal style gives the time a fixed box so the glyphs never shift', () => {
    viewSettingsOverride = { ttsPlayerStyle: 'minimal' };
    const width = (seconds: number) => {
      const info = { position: 0, duration: seconds, measuredFraction: 0 };
      render(
        <TTSMiniPlayer {...makeProps({ onGetPlaybackInfo: vi.fn().mockReturnValue(info) })} />,
      );
      const time = screen.getByLabelText('Open Read Aloud player');
      expect(time.className).not.toContain('flex-1');
      const cls = time.className;
      cleanup();
      return cls;
    };
    // Same box class for a short and a long label; nothing is content-sized.
    expect(width(83)).toContain('w-14');
    expect(width(3599)).toContain('w-14');
  });

  test('minimal style shows a bare countdown when there is no playback timeline', () => {
    viewSettingsOverride = { ttsPlayerStyle: 'minimal' };
    render(
      <TTSMiniPlayer
        {...makeProps({
          hasTimeline: false,
          chapterRemainingSec: 300,
          onGetPlaybackInfo: vi.fn().mockReturnValue(null),
        })}
      />,
    );
    // The wordy full-style phrasing does not fit the one slot the minimal card
    // has, and the sign keeps it reading as the same quantity as the timeline
    // case rather than a different one.
    expect(screen.queryByText(/left in chapter/)).toBeNull();
    expect(screen.getByText('-5:00')).toBeTruthy();
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

  // The full card fades out with the reader chrome (#5310); it stays mounted so
  // the opacity transition can run, hence the pointer-events lockout.
  test('fades out and stops taking taps once hidden', () => {
    render(<TTSMiniPlayer {...makeProps({ visible: false })} />);
    const card = screen.getByRole('status');
    expect(card.className).toContain('opacity-0');
    expect(card.className).toContain('pointer-events-none');
    expect(card.className).not.toContain('opacity-100');
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
