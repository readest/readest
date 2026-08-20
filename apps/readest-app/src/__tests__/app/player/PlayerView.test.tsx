import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Book } from '@/types/book';
import type { ABSChapter, ABSEpisode } from '@/types/audiobookshelf';
import type { AudiobookController } from '@/services/audiobook/AudiobookController';

// A real render of PlayerView (unlike src/app/player/page.test.tsx, which
// mocks PlayerView out entirely - that file's harness cannot exercise
// anything PlayerView itself does). This file carried two prior regressions
// in the route that hosts it (StrictMode double-invoke, spurious resume on
// an unrelated store write - see page.tsx), so its own session-ended
// episode guard (PlayerView.tsx's `if (controller.getEpisodeId()) return;`)
// and the tap-a-different-episode pending state deserve the same direct
// coverage rather than staying reachable only through the mocked-out route.

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
}));

const envConfig = { getAppService: vi.fn() };
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig, appService: null }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalViewSettings: { isEink: false } } }),
}));

vi.mock('@/app/reader/components/tts/TTSScrubber', () => ({
  default: () => <div data-testid='scrubber' />,
}));

const mocks = vi.hoisted(() => ({
  getSessionByHash: vi.fn(() => null as { bookKey: string; controller: unknown } | null),
  sessionListeners: new Set<() => void>(),
  loadAbsEpisodes: vi.fn(),
}));

vi.mock('@/services/tts/TTSSessionManager', () => ({
  TTS_STOP_AT_CHAPTER_END: -1,
  ttsSessionManager: {
    getSessionByHash: mocks.getSessionByHash,
    getStopAtChapterEnd: () => false,
    getSleepTimer: () => null,
    setStopAtChapterEnd: vi.fn(),
    setSleepTimer: vi.fn(),
    addEventListener: (_type: string, fn: () => void) => {
      mocks.sessionListeners.add(fn);
    },
    removeEventListener: (_type: string, fn: () => void) => {
      mocks.sessionListeners.delete(fn);
    },
  },
}));

vi.mock('@/services/audiobook/openAudiobook', () => ({
  loadAbsEpisodes: mocks.loadAbsEpisodes,
}));

import PlayerView from '@/app/player/components/PlayerView';

const book: Book = {
  hash: 'h1',
  format: 'ABS',
  filePath: 'abs://srv1/show1',
  title: 'The Daily Show',
  author: 'A Network',
  absMediaType: 'podcast',
  createdAt: 0,
  updatedAt: 0,
};

// Minimal fake satisfying only the surface PlayerView actually touches. Cast
// to AudiobookController at the call site - the real class's private fields
// make it impossible to satisfy structurally, same as the plain-object
// controller mocks already used in page.test.tsx.
class FakeController extends EventTarget {
  readonly kind = 'audiobook' as const;
  state = 'playing';
  rate = 1;
  #episodeId?: string;
  constructor(episodeId?: string) {
    super();
    this.#episodeId = episodeId;
  }
  getCurrentChapter(): ABSChapter | null {
    return null;
  }
  getChapters(): ABSChapter[] {
    return [];
  }
  getEpisodeId(): string | undefined {
    return this.#episodeId;
  }
  getTitle(): string {
    return 'Episode Title';
  }
  getPlaybackInfo() {
    return null;
  }
  async start() {}
  async pause() {}
  async backward() {}
  async forward() {}
  async setRate() {}
  async seekToTime() {}
  async seekToChapter() {}
}

const asController = (c: FakeController) => c as unknown as AudiobookController;

describe('PlayerView session-ended guard', () => {
  beforeEach(() => {
    mocks.getSessionByHash.mockReturnValue(null);
    mocks.sessionListeners.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('does not call onGoBack when the session ends while playing a podcast episode', () => {
    const onGoBack = vi.fn();
    const controller = new FakeController('ep1');

    render(
      <PlayerView
        book={book}
        bookKey='h1-ep1'
        controller={asController(controller)}
        onGoBack={onGoBack}
        onSelectEpisode={vi.fn()}
        pendingEpisodeId={null}
      />,
    );

    mocks.getSessionByHash.mockReturnValue(null);
    act(() => {
      mocks.sessionListeners.forEach((fn) => fn());
    });

    expect(onGoBack).not.toHaveBeenCalled();
  });

  it('calls onGoBack when the session ends for a plain audiobook (no episodeId)', () => {
    const onGoBack = vi.fn();
    const controller = new FakeController(undefined);

    render(
      <PlayerView
        book={book}
        bookKey='h1-book'
        controller={asController(controller)}
        onGoBack={onGoBack}
        onSelectEpisode={vi.fn()}
        pendingEpisodeId={null}
      />,
    );

    mocks.getSessionByHash.mockReturnValue(null);
    act(() => {
      mocks.sessionListeners.forEach((fn) => fn());
    });

    expect(onGoBack).toHaveBeenCalledTimes(1);
  });
});

describe('PlayerView rate re-sync', () => {
  beforeEach(() => {
    mocks.getSessionByHash.mockReturnValue(null);
    mocks.sessionListeners.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('re-syncs the displayed speed when the controller is swapped for a new episode', () => {
    const controller1 = new FakeController('ep1');
    controller1.rate = 1;

    const { rerender } = render(
      <PlayerView
        book={book}
        bookKey='h1-ep1'
        controller={asController(controller1)}
        onGoBack={vi.fn()}
        onSelectEpisode={vi.fn()}
        pendingEpisodeId={null}
      />,
    );

    expect(screen.getByLabelText('Speed').textContent).toContain('1×');

    // page.tsx's handleSelectEpisode carries the old rate onto the new
    // controller's clock (setRate), so by the time this component receives
    // the swapped controller its .rate already reflects that - this only
    // has to re-read it instead of leaving the display frozen on the
    // PREVIOUS controller's rate.
    const controller2 = new FakeController('ep2');
    controller2.rate = 1.5;

    rerender(
      <PlayerView
        book={book}
        bookKey='h1-ep2'
        controller={asController(controller2)}
        onGoBack={vi.fn()}
        onSelectEpisode={vi.fn()}
        pendingEpisodeId={null}
      />,
    );

    expect(screen.getByLabelText('Speed').textContent).toContain('1.5×');
  });
});

describe('PlayerView embedded Episodes subview', () => {
  const episode1: ABSEpisode = {
    id: 'ep1',
    title: 'Episode One',
    publishedAt: 2000,
    duration: 600,
  };
  const episode2: ABSEpisode = {
    id: 'ep2',
    title: 'Episode Two',
    publishedAt: 1000,
    duration: 500,
  };

  beforeEach(() => {
    mocks.getSessionByHash.mockReturnValue(null);
    mocks.sessionListeners.clear();
    mocks.loadAbsEpisodes.mockResolvedValue({
      episodes: [episode1, episode2],
      progressByEpisodeId: new Map(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  // pendingEpisodeId is owned by page.tsx now, not PlayerView (only the
  // parent knows a claim's outcome - see page.tsx's handleSelectEpisode).
  // These tests drive it via `rerender`, the same way the real parent
  // would: set it synchronously alongside the tap (page.tsx does this
  // BEFORE the claim's first await), then land it on a matching controller
  // once the claim succeeds.
  it('stays on the Episodes subview with a pending row until the parent hands down a controller for the tapped episode', async () => {
    const onSelectEpisode = vi.fn();
    const controller1 = new FakeController('ep1');

    const { rerender } = render(
      <PlayerView
        book={book}
        bookKey='h1-ep1'
        controller={asController(controller1)}
        onGoBack={vi.fn()}
        onSelectEpisode={onSelectEpisode}
        pendingEpisodeId={null}
      />,
    );

    fireEvent.click(screen.getByLabelText('Episodes'));
    await waitFor(() => expect(screen.getByText('Episode Two')).toBeTruthy());

    fireEvent.click(screen.getByText('Episode Two'));
    expect(onSelectEpisode).toHaveBeenCalledWith(episode2);

    // The parent (page.tsx) sets pendingEpisodeId synchronously on tap,
    // before the claim's first await - simulated here as an immediate
    // rerender with the SAME (stale) controller.
    rerender(
      <PlayerView
        book={book}
        bookKey='h1-ep1'
        controller={asController(controller1)}
        onGoBack={vi.fn()}
        onSelectEpisode={onSelectEpisode}
        pendingEpisodeId='ep2'
      />,
    );

    // Still on the Episodes subview (now a Dialog sheet) - not the stale
    // transport for episode one - with the tapped row marked pending. The
    // transport underneath stays mounted the whole time the sheet is open,
    // so the scrubber is still in the DOM.
    expect(screen.getByText('Episode Two')).toBeTruthy();
    expect(screen.queryByTestId('scrubber')).toBeTruthy();
    const pendingRow = screen.getByText('Episode Two').closest('button');
    expect(pendingRow?.getAttribute('aria-busy')).toBe('true');

    // The claim lands: the parent hands down a controller for episode two,
    // with pendingEpisodeId still 'ep2' (page.tsx's own matching effect
    // clears it a render later, same as here).
    const controller2 = new FakeController('ep2');
    rerender(
      <PlayerView
        book={book}
        bookKey='h1-ep2'
        controller={asController(controller2)}
        onGoBack={vi.fn()}
        onSelectEpisode={onSelectEpisode}
        pendingEpisodeId='ep2'
      />,
    );

    await waitFor(() => expect(screen.getByTestId('scrubber')).toBeTruthy());
    expect(screen.queryByText('Episode Two')).toBeNull();
  });

  it('switches back to the transport view immediately when re-tapping the already-playing episode', async () => {
    const onSelectEpisode = vi.fn();
    const controller = new FakeController('ep1');

    const { rerender } = render(
      <PlayerView
        book={book}
        bookKey='h1-ep1'
        controller={asController(controller)}
        onGoBack={vi.fn()}
        onSelectEpisode={onSelectEpisode}
        pendingEpisodeId={null}
      />,
    );

    fireEvent.click(screen.getByLabelText('Episodes'));
    await waitFor(() => expect(screen.getByText('Episode One')).toBeTruthy());

    fireEvent.click(screen.getByText('Episode One'));

    // The controller reference never changes for this case
    // (openAudiobookSession's reuse path resolves against the SAME
    // controller) - only pendingEpisodeId needs to land, matching it
    // immediately.
    rerender(
      <PlayerView
        book={book}
        bookKey='h1-ep1'
        controller={asController(controller)}
        onGoBack={vi.fn()}
        onSelectEpisode={onSelectEpisode}
        pendingEpisodeId='ep1'
      />,
    );

    await waitFor(() => expect(screen.getByTestId('scrubber')).toBeTruthy());
  });

  it('clears the pending row without switching views when pendingEpisodeId is cleared for a failed claim', async () => {
    const onSelectEpisode = vi.fn();
    const controller = new FakeController('ep1');

    const { rerender } = render(
      <PlayerView
        book={book}
        bookKey='h1-ep1'
        controller={asController(controller)}
        onGoBack={vi.fn()}
        onSelectEpisode={onSelectEpisode}
        pendingEpisodeId={null}
      />,
    );

    fireEvent.click(screen.getByLabelText('Episodes'));
    await waitFor(() => expect(screen.getByText('Episode Two')).toBeTruthy());

    fireEvent.click(screen.getByText('Episode Two'));
    rerender(
      <PlayerView
        book={book}
        bookKey='h1-ep1'
        controller={asController(controller)}
        onGoBack={vi.fn()}
        onSelectEpisode={onSelectEpisode}
        pendingEpisodeId='ep2'
      />,
    );
    expect(screen.getByText('Episode Two').closest('button')?.getAttribute('aria-busy')).toBe(
      'true',
    );

    // The claim failed (page.tsx clears pendingEpisodeId directly on a null
    // result or a throw, WITHOUT ever handing down a new controller).
    rerender(
      <PlayerView
        book={book}
        bookKey='h1-ep1'
        controller={asController(controller)}
        onGoBack={vi.fn()}
        onSelectEpisode={onSelectEpisode}
        pendingEpisodeId={null}
      />,
    );

    expect(screen.getByText('Episode Two').closest('button')?.getAttribute('aria-busy')).toBe(
      'false',
    );
    // Still on the Episodes subview (sheet stays open) - a failed claim must
    // not switch views. The transport underneath stays mounted regardless.
    expect(screen.getByText('Episode Two')).toBeTruthy();
    expect(screen.queryByTestId('scrubber')).toBeTruthy();
  });
});

describe('PlayerView picker sheets', () => {
  beforeEach(() => {
    mocks.getSessionByHash.mockReturnValue(null);
    mocks.sessionListeners.clear();
  });

  afterEach(() => {
    cleanup();
  });

  const audiobookOf = (episodeId?: string) => {
    const controller = new FakeController(episodeId);
    controller.getChapters = () => [
      { id: 1, title: 'Chapter One', start: 0, end: 120 },
      { id: 2, title: 'Chapter Two', start: 120, end: 240 },
    ];
    return controller;
  };

  it('opens the Speed picker in a dialog over the still-mounted transport, and applies live', () => {
    const controller = audiobookOf('ep1');
    const setRateSpy = vi.spyOn(controller, 'setRate');
    render(
      <PlayerView
        book={book}
        bookKey='h1-ep1'
        controller={asController(controller)}
        onGoBack={vi.fn()}
        onSelectEpisode={vi.fn()}
        pendingEpisodeId={null}
      />,
    );

    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByLabelText('Speed'));

    expect(screen.getByRole('dialog')).toBeTruthy();
    // Transport (scrubber, cover) stays mounted underneath the sheet.
    expect(screen.getByTestId('scrubber')).toBeTruthy();

    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '1.5' } });
    fireEvent.pointerUp(slider);
    // Speed applies live, straight to the controller - no "confirm" step.
    expect(setRateSpy).toHaveBeenCalledWith(1.5);
  });

  it('dismissing the Speed sheet returns to the transport', () => {
    const controller = audiobookOf('ep1');
    render(
      <PlayerView
        book={book}
        bookKey='h1-ep1'
        controller={asController(controller)}
        onGoBack={vi.fn()}
        onSelectEpisode={vi.fn()}
        pendingEpisodeId={null}
      />,
    );

    fireEvent.click(screen.getByLabelText('Speed'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    // Matches the Settings-sheet dismissal convention: the Dialog's own
    // close affordance calls onClose. The default header renders both a
    // mobile back-styled button and a desktop pill, both labeled 'Close'.
    fireEvent.click(screen.getAllByLabelText('Close')[0]!);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('scrubber')).toBeTruthy();
  });

  it('opens the Sleep Timer picker and selecting an option applies it and closes the sheet', () => {
    const controller = audiobookOf('ep1');
    render(
      <PlayerView
        book={book}
        bookKey='h1-ep1'
        controller={asController(controller)}
        onGoBack={vi.fn()}
        onSelectEpisode={vi.fn()}
        pendingEpisodeId={null}
      />,
    );

    fireEvent.click(screen.getByLabelText('Sleep Timer'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.click(screen.getByText('End of Chapter'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('scrubber')).toBeTruthy();
  });

  it('opens the Chapters picker and tapping a chapter seeks and closes the sheet', () => {
    const controller = audiobookOf('ep1');
    const seekSpy = vi.spyOn(controller, 'seekToChapter');
    render(
      <PlayerView
        book={book}
        bookKey='h1-ep1'
        controller={asController(controller)}
        onGoBack={vi.fn()}
        onSelectEpisode={vi.fn()}
        pendingEpisodeId={null}
      />,
    );

    fireEvent.click(screen.getByLabelText('Chapters'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.click(screen.getByText('Chapter Two'));

    expect(seekSpy).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('scrubber')).toBeTruthy();
  });

  it('opens the Episodes picker in a dialog over the transport', async () => {
    mocks.loadAbsEpisodes.mockResolvedValue({
      episodes: [
        { id: 'ep1', title: 'Episode One', publishedAt: 2000, duration: 600 },
        { id: 'ep2', title: 'Episode Two', publishedAt: 1000, duration: 500 },
      ],
      progressByEpisodeId: new Map(),
    });
    const controller = audiobookOf('ep1');
    render(
      <PlayerView
        book={book}
        bookKey='h1-ep1'
        controller={asController(controller)}
        onGoBack={vi.fn()}
        onSelectEpisode={vi.fn()}
        pendingEpisodeId={null}
      />,
    );

    fireEvent.click(screen.getByLabelText('Episodes'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByTestId('scrubber')).toBeTruthy();

    await waitFor(() => expect(screen.getByText('Episode One')).toBeTruthy());
  });
});
