'use client';

import { createRef } from 'react';
import { render, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import RSVPControl, { type RSVPControlHandle } from '@/app/reader/components/rsvp/RSVPControl';
import { eventDispatcher } from '@/utils/event';

// Mounts the real RSVPControl with a mocked RSVPController + stores and asserts
// that the slice-5 subscription routes tts-position / tts-playback-state to the
// controller correctly (engage, word-sync, decouple, re-engage).

const BOOK_KEY = 'hash123-session456';

let primaryIndex = 2;
let isFixedLayout = false;
const controllerEventListeners = new Map<string, EventListener[]>();
let controllerMock: ReturnType<typeof makeControllerMock>;

function makeControllerMock() {
  return {
    seedPosition: vi.fn(),
    setCurrentCfi: vi.fn(),
    requestStart: vi.fn(() => {
      const event = new CustomEvent('rsvp-start-choice', {
        detail: { hasSavedPosition: false, hasSelection: false },
      });
      (controllerEventListeners.get('rsvp-start-choice') ?? []).forEach((h) => h(event));
    }),
    startFromCurrentPosition: vi.fn(),
    stop: vi.fn(),
    loadNextPageContent: vi.fn(),
    setExternallyDriven: vi.fn(),
    stopEstimator: vi.fn(),
    syncToCfi: vi.fn(() => true),
    driveEstimatedFromCfi: vi.fn(() => true),
    getStoredPosition: vi.fn(() => null),
    get currentState() {
      return { active: true };
    },
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (!controllerEventListeners.has(type)) controllerEventListeners.set(type, []);
      controllerEventListeners.get(type)!.push(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      const arr = controllerEventListeners.get(type) ?? [];
      controllerEventListeners.set(
        type,
        arr.filter((l) => l !== listener),
      );
    }),
  };
}

vi.mock('@/app/reader/components/rsvp/RSVPOverlay', () => ({
  default: () => null,
}));
vi.mock('@/app/reader/components/rsvp/RSVPStartDialog', () => ({ default: () => null }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));

vi.mock('@/store/readerStore', () => {
  const state = {
    getView: () => mockView,
    getProgress: () => ({ location: 'epubcfi(/6/6!/4/1:0)', sectionHref: 'ch2.xhtml' }),
    getViewSettings: () => ({
      ttsRate: 1.0,
      defaultFont: 'serif',
      serifFont: 'Georgia',
      sansSerifFont: 'Arial',
      monospaceFont: 'Menlo',
      defaultCJKFont: 'Noto',
    }),
  };
  return {
    useReaderStore: <R,>(selector?: (s: typeof state) => R) => (selector ? selector(state) : state),
  };
});

vi.mock('@/store/bookDataStore', () => {
  const state = {
    getBookData: () => ({ book: { format: 'EPUB' }, bookDoc: { toc: [] }, isFixedLayout }),
    getConfig: () => null,
    setConfig: vi.fn(),
    saveConfig: vi.fn(),
  };
  return {
    useBookDataStore: <R,>(selector?: (s: typeof state) => R) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ themeCode: { primary: '#000' } }),
}));

vi.mock('@/services/rsvp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/rsvp')>();
  return {
    ...actual,
    // eslint-disable-next-line prefer-arrow-callback
    RSVPController: Object.assign(
      vi.fn(function RSVPControllerMock() {
        return controllerMock;
      }),
      { estimatedWpmFromRate: vi.fn(() => 190) },
    ),
    buildRsvpExitConfigUpdate: vi.fn(() => ({})),
  };
});

const mockView = {
  renderer: {
    get primaryIndex() {
      return primaryIndex;
    },
    get atEnd() {
      return false;
    },
    goTo: vi.fn(),
    getContents: vi.fn(() => []),
  },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  book: { format: 'EPUB' },
  getCFI: vi.fn(() => null),
  addAnnotation: vi.fn(),
  resolveCFI: vi.fn(),
};

const wordPos = (over: Record<string, unknown> = {}) => ({
  bookKey: BOOK_KEY,
  cfi: 'epubcfi(/6/6!/4/2/1:0)',
  kind: 'word',
  sectionIndex: 2,
  ...over,
});

async function startSession() {
  await act(async () => {
    eventDispatcher.dispatch('rsvp-start', { bookKey: BOOK_KEY });
    await new Promise<void>((r) => setTimeout(r, 20));
  });
}

describe('RSVPControl — TTS sync wiring (slice 5, #3235)', () => {
  beforeEach(() => {
    primaryIndex = 2;
    isFixedLayout = false;
    controllerEventListeners.clear();
    controllerMock = makeControllerMock();
  });

  afterEach(() => cleanup());

  test('engages following on playing and syncs Edge word positions', async () => {
    render(
      <RSVPControl bookKey={BOOK_KEY} gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }} />,
    );
    await startSession();

    await act(async () => {
      await eventDispatcher.dispatch('tts-playback-state', { bookKey: BOOK_KEY, state: 'playing' });
    });
    expect(controllerMock.setExternallyDriven).toHaveBeenLastCalledWith(true);

    await act(async () => {
      await eventDispatcher.dispatch('tts-position', wordPos({ sequence: 1 }));
    });
    expect(controllerMock.syncToCfi).toHaveBeenCalledWith('epubcfi(/6/6!/4/2/1:0)');
  });

  test('drops stale sequences and positions for other books', async () => {
    render(
      <RSVPControl bookKey={BOOK_KEY} gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }} />,
    );
    await startSession();
    await act(async () => {
      await eventDispatcher.dispatch('tts-playback-state', { bookKey: BOOK_KEY, state: 'playing' });
    });

    await act(async () => {
      await eventDispatcher.dispatch('tts-position', wordPos({ sequence: 5 }));
      await eventDispatcher.dispatch('tts-position', wordPos({ sequence: 3 })); // stale
      await eventDispatcher.dispatch('tts-position', wordPos({ sequence: 5, bookKey: 'other' }));
    });
    // Only the first (seq 5) maps; the stale and other-book events are dropped.
    expect(controllerMock.syncToCfi).toHaveBeenCalledTimes(1);
  });

  test('sentence positions drive the estimator', async () => {
    render(
      <RSVPControl bookKey={BOOK_KEY} gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }} />,
    );
    await startSession();
    await act(async () => {
      await eventDispatcher.dispatch('tts-playback-state', { bookKey: BOOK_KEY, state: 'playing' });
      await eventDispatcher.dispatch('tts-position', wordPos({ kind: 'sentence', sequence: 1 }));
    });
    expect(controllerMock.driveEstimatedFromCfi).toHaveBeenCalledWith(
      'epubcfi(/6/6!/4/2/1:0)',
      190,
    );
  });

  test('paused disengages: stops estimator + restores controller pacing', async () => {
    render(
      <RSVPControl bookKey={BOOK_KEY} gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }} />,
    );
    await startSession();
    await act(async () => {
      await eventDispatcher.dispatch('tts-playback-state', { bookKey: BOOK_KEY, state: 'playing' });
    });

    controllerMock.setExternallyDriven.mockClear();
    await act(async () => {
      await eventDispatcher.dispatch('tts-playback-state', { bookKey: BOOK_KEY, state: 'paused' });
    });
    expect(controllerMock.stopEstimator).toHaveBeenCalled();
    expect(controllerMock.setExternallyDriven).toHaveBeenLastCalledWith(false);

    // While disengaged, positions are ignored.
    controllerMock.syncToCfi.mockClear();
    await act(async () => {
      await eventDispatcher.dispatch('tts-position', wordPos({ sequence: 99 }));
    });
    expect(controllerMock.syncToCfi).not.toHaveBeenCalled();
  });

  test('a manual nav decouples; following resumes on the next playing', async () => {
    render(
      <RSVPControl bookKey={BOOK_KEY} gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }} />,
    );
    await startSession();
    await act(async () => {
      await eventDispatcher.dispatch('tts-playback-state', { bookKey: BOOK_KEY, state: 'playing' });
    });

    // User skips: controller emits rsvp-manual-nav -> decouple.
    await act(async () => {
      (controllerEventListeners.get('rsvp-manual-nav') ?? []).forEach((h) =>
        h(new CustomEvent('rsvp-manual-nav')),
      );
    });

    controllerMock.syncToCfi.mockClear();
    await act(async () => {
      await eventDispatcher.dispatch('tts-position', wordPos({ sequence: 50 }));
    });
    expect(controllerMock.syncToCfi).not.toHaveBeenCalled(); // decoupled

    // Re-engage on next playing, then a fresh position syncs again.
    await act(async () => {
      await eventDispatcher.dispatch('tts-playback-state', { bookKey: BOOK_KEY, state: 'playing' });
      await eventDispatcher.dispatch('tts-position', wordPos({ sequence: 60 }));
    });
    expect(controllerMock.syncToCfi).toHaveBeenCalledWith('epubcfi(/6/6!/4/2/1:0)');
  });

  test('cleans up subscriptions on unmount', async () => {
    const { unmount } = render(
      <RSVPControl bookKey={BOOK_KEY} gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }} />,
    );
    await startSession();
    await act(async () => {
      await eventDispatcher.dispatch('tts-playback-state', { bookKey: BOOK_KEY, state: 'playing' });
    });

    act(() => unmount());

    controllerMock.syncToCfi.mockClear();
    await act(async () => {
      await eventDispatcher.dispatch('tts-position', wordPos({ sequence: 200 }));
    });
    expect(controllerMock.syncToCfi).not.toHaveBeenCalled();
  });

  // ─── Fixed-layout gate + ttsSyncStatus (slice 8b, #3235) ───────────────
  describe('fixed-layout gate (D7)', () => {
    test('playing does NOT engage and positions do NOT drive the controller', async () => {
      isFixedLayout = true;
      render(
        <RSVPControl bookKey={BOOK_KEY} gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }} />,
      );
      await startSession();

      await act(async () => {
        await eventDispatcher.dispatch('tts-playback-state', {
          bookKey: BOOK_KEY,
          state: 'playing',
        });
      });
      // Never engage external driving for fixed-layout.
      expect(controllerMock.setExternallyDriven).not.toHaveBeenCalledWith(true);

      await act(async () => {
        await eventDispatcher.dispatch('tts-position', wordPos({ sequence: 1 }));
        await eventDispatcher.dispatch('tts-position', wordPos({ kind: 'sentence', sequence: 2 }));
      });
      expect(controllerMock.syncToCfi).not.toHaveBeenCalled();
      expect(controllerMock.driveEstimatedFromCfi).not.toHaveBeenCalled();
    });

    test('exposes ttsSyncStatus="unsupported" via the imperative handle', async () => {
      isFixedLayout = true;
      const handle = createRef<RSVPControlHandle>();
      render(
        <RSVPControl
          ref={handle}
          bookKey={BOOK_KEY}
          gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
        />,
      );
      await startSession();
      await act(async () => {
        await eventDispatcher.dispatch('tts-playback-state', {
          bookKey: BOOK_KEY,
          state: 'playing',
        });
      });
      expect(handle.current?.ttsSyncStatus).toBe('unsupported');
    });
  });

  describe('ttsSyncStatus transitions (reflowable)', () => {
    test('idle → following on playing → idle on stopped', async () => {
      const handle = createRef<RSVPControlHandle>();
      render(
        <RSVPControl
          ref={handle}
          bookKey={BOOK_KEY}
          gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
        />,
      );
      await startSession();
      // Not playing yet.
      expect(handle.current?.ttsSyncStatus).toBe('idle');

      await act(async () => {
        await eventDispatcher.dispatch('tts-playback-state', {
          bookKey: BOOK_KEY,
          state: 'playing',
        });
      });
      expect(handle.current?.ttsSyncStatus).toBe('following');

      await act(async () => {
        await eventDispatcher.dispatch('tts-playback-state', {
          bookKey: BOOK_KEY,
          state: 'stopped',
        });
      });
      expect(handle.current?.ttsSyncStatus).toBe('idle');
    });

    test('decoupled on a manual nav while playing', async () => {
      const handle = createRef<RSVPControlHandle>();
      render(
        <RSVPControl
          ref={handle}
          bookKey={BOOK_KEY}
          gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
        />,
      );
      await startSession();
      await act(async () => {
        await eventDispatcher.dispatch('tts-playback-state', {
          bookKey: BOOK_KEY,
          state: 'playing',
        });
      });
      expect(handle.current?.ttsSyncStatus).toBe('following');

      await act(async () => {
        (controllerEventListeners.get('rsvp-manual-nav') ?? []).forEach((h) =>
          h(new CustomEvent('rsvp-manual-nav')),
        );
      });
      expect(handle.current?.ttsSyncStatus).toBe('decoupled');
    });
  });
});
