import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, right: 0, bottom: 20, left: 0 } }),
}));

const getBookData = vi.fn();
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData }),
}));

const navigateToReader = vi.fn();
vi.mock('@/utils/nav', () => ({
  navigateToReader: (...args: unknown[]) => navigateToReader(...args),
}));

const mockManager = vi.hoisted(() => {
  class MockSessionManager extends EventTarget {
    session: {
      bookHash: string;
      bookKey: string;
      controller: {
        state: string;
        pause: ReturnType<typeof vi.fn>;
        start: ReturnType<typeof vi.fn>;
      };
    } | null = null;
    sleepTimer: { timeoutSec: number; firesAt: number } | null = null;
    stopActive = vi.fn().mockResolvedValue(undefined);
    getActiveSession() {
      return this.session;
    }
    getSleepTimer() {
      return this.sleepTimer;
    }
    emitSessionChanged(reason: string) {
      this.dispatchEvent(
        new CustomEvent('session-changed', { detail: { session: this.session, reason } }),
      );
    }
  }
  return new MockSessionManager();
});
vi.mock('@/services/tts', () => ({
  ttsSessionManager: mockManager,
}));

import { eventDispatcher } from '@/utils/event';
import NowPlayingBar from '@/app/library/components/NowPlayingBar';

const makeSession = (state = 'playing') => ({
  bookHash: 'hashA',
  bookKey: 'hashA-r1',
  controller: {
    state,
    pause: vi.fn().mockResolvedValue(true),
    start: vi.fn().mockResolvedValue(undefined),
  },
});

describe('NowPlayingBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockManager.session = null;
    mockManager.sleepTimer = null;
    getBookData.mockReturnValue({
      book: { title: 'Alice in Wonderland', coverImageUrl: null },
    });
  });

  afterEach(() => {
    cleanup();
  });

  test('renders nothing without an active session', () => {
    const { container } = render(<NowPlayingBar isSelectMode={false} />);
    expect(container.firstChild).toBeNull();
  });

  test('shows the book title while a session is active', () => {
    mockManager.session = makeSession();
    render(<NowPlayingBar isSelectMode={false} />);
    expect(screen.getByText('Alice in Wonderland')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  test('hides in select mode even with an active session', () => {
    mockManager.session = makeSession();
    const { container } = render(<NowPlayingBar isSelectMode={true} />);
    expect(container.firstChild).toBeNull();
  });

  test('play/pause button drives the session controller without opening the book', () => {
    const session = makeSession('playing');
    mockManager.session = session;
    render(<NowPlayingBar isSelectMode={false} />);
    fireEvent.click(screen.getByLabelText('Pause'));
    expect(session.controller.pause).toHaveBeenCalled();
    expect(navigateToReader).not.toHaveBeenCalled();
  });

  test('glyph follows the relayed tts-playback-state channel', async () => {
    mockManager.session = makeSession('playing');
    render(<NowPlayingBar isSelectMode={false} />);
    expect(screen.getByLabelText('Pause')).toBeTruthy();
    await act(async () => {
      await eventDispatcher.dispatch('tts-playback-state', {
        bookKey: 'hashA-r1',
        state: 'paused',
      });
    });
    expect(screen.getByLabelText('Play')).toBeTruthy();
  });

  test('stop hides the bar optimistically and stops the session', () => {
    mockManager.session = makeSession();
    const { container } = render(<NowPlayingBar isSelectMode={false} />);
    fireEvent.click(screen.getByLabelText('Stop reading aloud'));
    expect(mockManager.stopActive).toHaveBeenCalledWith('user');
    expect(container.firstChild).toBeNull();
  });

  test('tapping the body opens the book in the SAME window', () => {
    mockManager.session = makeSession();
    render(<NowPlayingBar isSelectMode={false} />);
    fireEvent.click(screen.getByText('Alice in Wonderland'));
    expect(navigateToReader).toHaveBeenCalledWith(expect.anything(), ['hashA']);
  });

  test('disappears when the manager reports the session stopped', () => {
    mockManager.session = makeSession();
    const { container } = render(<NowPlayingBar isSelectMode={false} />);
    expect(container.firstChild).not.toBeNull();
    act(() => {
      mockManager.session = null;
      mockManager.emitSessionChanged('stopped');
    });
    expect(container.firstChild).toBeNull();
  });

  test('shows a sleep timer countdown chip when a timer is armed', () => {
    mockManager.session = makeSession();
    mockManager.sleepTimer = { timeoutSec: 600, firesAt: Date.now() + 90_000 };
    render(<NowPlayingBar isSelectMode={false} />);
    expect(screen.getByText(/^1:(2\d|30)$/)).toBeTruthy();
  });
});
