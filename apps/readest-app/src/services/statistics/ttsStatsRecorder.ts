// Reading statistics for listening.
//
// The reading tracker (ReadingStatsTracker) has exactly one input: page turns
// reported by a laid-out view. TTS only ever reached it indirectly, through the
// relocations auto-follow happens to produce - so listening with follow
// suppressed, or with the book closed entirely (mini player, lock screen,
// CarPlay), recorded nothing at all.
//
// This recorder gives listening its own clock, on the rule that the page being
// narrated is the page being read. It writes the same KOReader
// `page_stat_data` rows through the same StatisticsDb, so listening and
// reading are indistinguishable downstream - which is the point.
//
// While it is running the reading tracker stands down (see
// ReadingStatsTracker's tts-playback-state handler); exactly one of the two
// owns the clock at any moment.

import * as foliateProgress from 'foliate-js/progress.js';
import env from '@/services/environment';
import { SyncClient } from '@/libs/sync';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import { useBookDataStore } from '@/store/bookDataStore';
import { getBookProgress } from '@/store/readerProgressStore';
import { DEFAULT_STATS_TRACKING_CONFIG, type StatBook } from '@/types/statistics';
import type { TTSSession } from '@/services/tts/TTSSessionManager';
import type { FoliateView } from '@/types/view';
import { getAccessToken } from '@/utils/access';
import { StatisticsDb } from './statisticsDb';
import { pushStats } from './statsSync';
import { TrackerCore, type FlushedEvent } from './trackerCore';

/** How often playback is sampled. Also the renewal granularity below. */
export const TTS_STATS_HEARTBEAT_MS = 30_000;

// Close and reopen the current event once its dwell reaches this, so a page
// whose narration runs long never hits TrackerCore's maxEventSeconds cap.
// Sixty seconds against a 120s cap leaves a full heartbeat of slack, so even a
// throttled background timer loses nothing.
const RENEW_AFTER_SEC = 60;

const PUSH_DEBOUNCE_MS = 10_000;

// The same constants foliate's view passes to its own SectionProgress
// (view.js: `new SectionProgress(book.sections, 1500, 1600)`). Reusing them
// keeps a headless fraction on exactly the scale an attached view would report.
const SIZE_PER_LOC = 1500;
const SIZE_PER_TIME_UNIT = 1600;

interface SectionPosition {
  index: number;
  fraction: number;
}

interface BookPosition {
  fraction: number;
  location: { current: number; total: number };
}

// foliate/progress.js is untyped JS; these are the two constructors we use.
interface ProgressModule {
  PageProgress: new (
    book: FoliateView['book'],
    resolveNavigation: FoliateView['resolveCFI'],
  ) => { getProgress(cfi: string): Promise<SectionPosition | null> };
  SectionProgress: new (
    sections: FoliateView['book']['sections'],
    sizePerLoc: number,
    sizePerTimeUnit: number,
  ) => { getProgress(index: number, fractionInSection: number): BookPosition };
}

interface HeadlessResolver {
  toSectionPosition(cfi: string): Promise<SectionPosition | null>;
  toBookPosition(index: number, fractionInSection: number): BookPosition;
}

const nowSec = () => Math.floor(Date.now() / 1000);

// Statistics are best-effort telemetry, and this recorder runs headless where
// nothing is watching: a failed write must never surface as an unhandled
// rejection or disturb playback.
const runBestEffort = (work: Promise<unknown>): void => {
  void work.catch((err) => console.warn('[stats] TTS background operation failed:', err));
};

/**
 * Map a book-level progress fraction onto a 1-based page in a layout of
 * `totalPages`. Used only when no view is attached, where foliate's size-domain
 * fraction is the only position signal available.
 */
export const pageFromFraction = (fraction: number, totalPages: number): number => {
  if (!Number.isFinite(fraction) || totalPages <= 0) return 1;
  return Math.min(Math.max(Math.floor(fraction * totalPages) + 1, 1), totalPages);
};

interface ResolvedPage {
  page: number;
  totalPages: number;
}

export class TtsStatsRecorder {
  readonly #session: TTSSession;
  readonly #core = new TrackerCore(DEFAULT_STATS_TRACKING_CONFIG);
  #db: StatisticsDb | null = null;
  #dbPromise: Promise<StatisticsDb | null> | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #pushTimer: ReturnType<typeof setTimeout> | null = null;
  #playing = false;
  #ticking = false;
  #currentPage: number | null = null;
  #dwellStartedAt = 0;
  #lastCfi: string | null = null;
  #resolvedCfi: string | null = null;
  #resolvedPage: ResolvedPage | null = null;
  #headless: HeadlessResolver | null = null;
  #headlessUnavailable = false;

  constructor(session: TTSSession) {
    this.#session = session;
  }

  onPlaybackState(state: 'playing' | 'paused'): void {
    if (state === 'playing') {
      if (this.#playing) return;
      this.#playing = true;
      // No idle timer, deliberately: reading arms one because a stationary page
      // probably means the reader walked away, but audible narration is proof
      // they did not. The heartbeat is the only timer here.
      this.#heartbeat ??= setInterval(() => void this.#tick(), TTS_STATS_HEARTBEAT_MS);
      void this.#tick();
      return;
    }
    if (!this.#playing) return;
    this.#playing = false;
    this.#stopHeartbeat();
    this.#flush();
  }

  /** The controller's canonical position signal, one per spoken sentence. */
  onMark(cfi: string): void {
    if (!cfi || this.#lastCfi === cfi) return;
    this.#lastCfi = cfi;
    // Credit a page turn as it happens rather than up to a heartbeat late - but
    // only where the page is free to read. Headless it costs a section document
    // load, so there it waits for the heartbeat.
    if (this.#playing && this.#session.controller.isViewAttached) void this.#tick();
  }

  async stop(): Promise<void> {
    this.#playing = false;
    this.#stopHeartbeat();
    if (this.#pushTimer) {
      clearTimeout(this.#pushTimer);
      this.#pushTimer = null;
    }
    this.#currentPage = null;
    await this.#persist(this.#core.onClose(nowSec()));
    await this.#push();
  }

  #stopHeartbeat(): void {
    if (!this.#heartbeat) return;
    clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }

  #flush(): void {
    const events = this.#core.onIdle(nowSec());
    // Drop the page too, so resuming opens a fresh dwell instead of measuring
    // from a start time that stopped advancing while playback was paused.
    this.#currentPage = null;
    runBestEffort(this.#persist(events));
  }

  async #tick(): Promise<void> {
    if (!this.#playing || this.#ticking) return;
    this.#ticking = true;
    try {
      const resolved = await this.#resolvePage();
      if (!resolved || !this.#playing) return;
      const now = nowSec();
      if (resolved.page !== this.#currentPage) {
        await this.#persist(this.#core.onPage(resolved.page, resolved.totalPages, now));
        this.#currentPage = resolved.page;
        this.#dwellStartedAt = now;
        return;
      }
      if (now - this.#dwellStartedAt < RENEW_AFTER_SEC) return;
      // Renewal: TrackerCore caps one event at maxEventSeconds and discards the
      // rest, which is the right safety net for a page someone walked away
      // from. Reopening on the same page with a later start_time keeps the time
      // without weakening that cap - the primary key is (book, page, start).
      await this.#persist(this.#core.onIdle(now));
      await this.#persist(this.#core.onPage(resolved.page, resolved.totalPages, now));
      this.#dwellStartedAt = now;
    } finally {
      this.#ticking = false;
    }
  }

  async #resolvePage(): Promise<ResolvedPage | null> {
    const { bookKey, controller } = this.#session;
    if (controller.isViewAttached) {
      // A laid-out view knows the real page, in the same domain the reading
      // tracker writes. Foliate's fraction is a size domain and does not map
      // linearly onto screen pages, so prefer this wherever it exists.
      const info = getBookProgress(bookKey)?.pageinfo;
      if (info) return { page: (info.current ?? 0) + 1, totalPages: info.total || 1 };
    }
    const cfi = this.#lastCfi;
    if (!cfi) return null;
    if (this.#resolvedCfi === cfi) return this.#resolvedPage;

    const resolver = this.#getHeadlessResolver();
    if (!resolver) return null;

    let position: SectionPosition | null = null;
    try {
      position = await resolver.toSectionPosition(cfi);
    } catch (err) {
      console.warn('[stats] failed to resolve the TTS position to a page:', err);
      return null;
    }
    if (!position || position.index < 0) {
      console.warn('[stats] could not place the TTS position in the book:', cfi);
      return null;
    }

    const resolved = this.#pageFromProgress(
      resolver.toBookPosition(position.index, position.fraction),
    );
    this.#resolvedCfi = cfi;
    this.#resolvedPage = resolved;
    return resolved;
  }

  /**
   * Build a progress resolver that survives the book being closed.
   *
   * `view.getCFIProgress` is not usable here: `view.close()` nulls the
   * `#sectionProgress`/`#cfiProgress` helpers it reads (foliate view.js), so it
   * returns null exactly when a headless session needs it. The book itself and
   * `resolveCFI` (which delegates to `book.resolveCFI`) both survive, and they
   * are all foliate's own progress classes require - so rebuild the same
   * computation on top of those.
   */
  #getHeadlessResolver(): HeadlessResolver | null {
    if (this.#headless || this.#headlessUnavailable) return this.#headless;
    const view = this.#session.controller.view;
    const book = view?.book;
    if (!book?.sections?.length) {
      console.warn('[stats] no book available to place the TTS position');
      this.#headlessUnavailable = true;
      return null;
    }
    try {
      const { PageProgress, SectionProgress } = foliateProgress as unknown as ProgressModule;
      const cfiProgress = new PageProgress(book, (cfi: string) => view.resolveCFI(cfi));
      const sectionProgress = new SectionProgress(book.sections, SIZE_PER_LOC, SIZE_PER_TIME_UNIT);
      this.#headless = {
        toSectionPosition: (cfi) => cfiProgress.getProgress(cfi),
        toBookPosition: (index, fraction) => sectionProgress.getProgress(index, fraction),
      };
    } catch (err) {
      console.warn('[stats] failed to build the headless progress resolver:', err);
      this.#headlessUnavailable = true;
    }
    return this.#headless;
  }

  #pageFromProgress(progress: BookPosition): ResolvedPage | null {
    // Stay on the layout's own scale so listening rows and reading rows remain
    // comparable, which is what makes COUNT(DISTINCT page) meaningful.
    const layoutPages = useBookDataStore.getState().getConfig(this.#session.bookKey)?.progress?.[1];
    if (layoutPages && layoutPages > 0) {
      return { page: pageFromFraction(progress.fraction, layoutPages), totalPages: layoutPages };
    }
    // Never laid out on this device: fall back to foliate's layout-independent
    // locations. A different scale, but the alternative is recording nothing.
    const { current, total } = progress.location;
    if (total <= 0) return null;
    return { page: Math.min(Math.max(current + 1, 1), total), totalPages: total };
  }

  #getStatBook(): StatBook | null {
    const book = useBookDataStore.getState().getBookData(this.#session.bookKey)?.book;
    if (!book?.hash) return null;
    return { bookMd5: book.hash, title: book.title ?? '', authors: book.author ?? '' };
  }

  async #getDb(): Promise<StatisticsDb | null> {
    if (this.#db) return this.#db;
    // A failed open resolves null and stays cached: the recorder disables
    // itself for the rest of the session rather than retrying every heartbeat.
    this.#dbPromise ??= (async () => {
      try {
        const appService = await env.getAppService();
        this.#db = await StatisticsDb.open(appService);
        return this.#db;
      } catch (err) {
        console.warn('[stats] failed to open the statistics database for TTS:', err);
        return null;
      }
    })();
    return this.#dbPromise;
  }

  async #persist(events: FlushedEvent[]): Promise<void> {
    if (events.length === 0) return;
    const book = this.#getStatBook();
    if (!book) return;
    const db = await this.#getDb();
    if (!db) return;
    try {
      const idBook = await db.upsertBook(book);
      for (const e of events) await db.insertPageEvent(idBook, e);
      await db.recomputeBookTotals(idBook);
      this.#schedulePush();
    } catch (err) {
      // The statistics DB can be closed mid-write on app teardown; log and
      // never reject (Sentry READEST-6).
      console.warn('[stats] failed to persist TTS listening events:', err);
    }
  }

  #schedulePush(): void {
    // Trailing debounce that is never restarted: a multi-hour headless session
    // must reach the server as it goes, not only when playback stops.
    if (this.#pushTimer) return;
    this.#pushTimer = setTimeout(() => {
      this.#pushTimer = null;
      runBestEffort(this.#push());
    }, PUSH_DEBOUNCE_MS);
  }

  async #push(): Promise<void> {
    const db = this.#db;
    if (!db || !isSyncCategoryEnabled('stats')) return;
    // No AuthContext headless, so the session token stands in for `user`.
    const token = await getAccessToken().catch(() => null);
    if (!token) return;
    try {
      await pushStats(db, new SyncClient());
    } catch (err) {
      console.warn('[stats] failed to push TTS listening events:', err);
    }
  }
}
