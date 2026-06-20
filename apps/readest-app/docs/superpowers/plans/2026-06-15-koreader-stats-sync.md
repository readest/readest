# KOReader-compatible reading statistics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track reading time as KOReader-style per-page events in a cross-platform Turso `statistics.db`, and sync those events across all Readest **and** KOReader devices over the existing `/api/sync` transport.

**Architecture:** Local source of truth is a Turso `statistics.db` holding KOReader's exact schema (`book` + `page_stat_data`). A per-book reader component flushes immutable page-read events on page-change/idle/hidden/close. Cross-device sync rides the legacy `/api/sync` endpoint as a new `stats` type backed by two self-contained Supabase tables (`stat_books`, `stat_pages`), union-merged by `book_hash`. The `apps/readest.koplugin` plugin syncs KOReader devices through the same endpoint.

**Tech Stack:** TypeScript / React (Next.js 16), Zustand, the Turso `DatabaseService` abstraction, Supabase (Postgres + RLS), Lua (KOReader plugin), vitest + busted.

**Design spec:** `docs/superpowers/specs/2026-06-15-koreader-stats-sync-design.md`

---

## Conventions for this plan

- Run a single test file with: `pnpm test <path>` (no `--`).
- Full gate before finishing a phase: `pnpm test` + `pnpm lint`. Lua phase also: `pnpm lint:lua` + `pnpm test:lua`.
- Units: `start_time` and `duration` are **Unix seconds** (matches KOReader). `page` is **1-based**.
- Book identity is `book_hash` = `Book.hash` = `partialMD5(file)` (byte-identical to KOReader's `util.partialMD5`).
- This plan has **three phases**, each independently shippable. Stop and review at each "▣ Phase checkpoint".

---

# Phase 1 — Local store + page-event tracking

Produces working local stats (recorded to `statistics.db`) with no sync yet.

## File structure (Phase 1)

- Create `src/types/statistics.ts` — event/book/config types.
- Modify `src/services/database/migrations/index.ts` — add the `statistics` schema (KOReader DDL + extension tables + sync-state table).
- Create `src/services/statistics/statisticsDb.ts` — typed DB wrapper (upsert book, insert event, recompute totals, cursors, push/apply helpers).
- Create `src/services/statistics/trackerCore.ts` — pure flush/idle state machine (no React), so it is unit-testable.
- Create `src/app/reader/components/ReadingStatsTracker.tsx` — per-`bookKey` React component wiring `trackerCore` to progress + visibility + unmount.
- Modify `src/app/reader/components/BooksGrid.tsx` — mount `ReadingStatsTracker` per book (same place PR #3156 mounted its tracker).
- Modify `src/app/reader/components/ReaderContent.tsx` — open `statistics.db` on mount.
- Tests: `src/__tests__/statistics/statisticsDb.test.ts`, `src/__tests__/statistics/trackerCore.test.ts`.

---

### Task 1: Statistics types

**Files:**
- Create: `src/types/statistics.ts`

- [ ] **Step 1: Write the file**

```typescript
// KOReader-compatible reading-statistics types.
//
// The canonical unit is the per-page read event (KOReader's page_stat_data
// row). Aggregates (sessions, streaks, totals) are DERIVED via SQL, never
// stored as separate records. Times are Unix seconds; pages are 1-based.

/** One immutable page-read event — a KOReader `page_stat_data` row. */
export interface PageStatEvent {
  bookMd5: string; // = Book.hash = KOReader book.md5
  page: number; // 1-based
  startTime: number; // Unix seconds
  duration: number; // seconds
  totalPages: number;
}

/** KOReader book identity — the only book metadata that syncs. */
export interface StatBook {
  bookMd5: string;
  title: string;
  authors: string; // KOReader stores authors as a single text field
}

/** Tunables for the tracker's flush/idle behavior. KOReader-aligned defaults. */
export interface StatsTrackingConfig {
  /** Seconds of inactivity before the current page event is flushed + paused. */
  idleTimeoutSeconds: number;
  /** Hard per-event duration cap (safety net if a visibility event is missed). */
  maxEventSeconds: number;
  /** Events shorter than this are dropped (ignore sub-second page flips). */
  minEventSeconds: number;
}

export const DEFAULT_STATS_TRACKING_CONFIG: StatsTrackingConfig = {
  idleTimeoutSeconds: 120,
  maxEventSeconds: 120,
  minEventSeconds: 3,
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm lint`
Expected: PASS (no usages yet; file compiles).

- [ ] **Step 3: Commit**

```bash
git add src/types/statistics.ts
git commit -m "feat(stats): add KOReader-compatible statistics types"
```

---

### Task 2: `statistics` migration schema (KOReader DDL + extensions)

**Files:**
- Modify: `src/services/database/migrations/index.ts`
- Test: `src/__tests__/statistics/statisticsDb.test.ts` (created here; grows in Task 3)

- [ ] **Step 1: Write the failing test** (migration creates the KOReader schema)

Create `src/__tests__/statistics/statisticsDb.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import type { DatabaseService } from '@/types/database';

async function freshStatsDb(): Promise<DatabaseService> {
  // In-memory libsql DB; run the same migrations production uses.
  const db = await NodeDatabaseService.open(':memory:');
  await migrate(db, getMigrations('statistics'));
  return db;
}

describe('statistics migration', () => {
  let db: DatabaseService;
  beforeEach(async () => {
    db = await freshStatsDb();
  });

  it('creates KOReader book + page_stat_data tables and extension tables', async () => {
    const tables = await db.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name`,
    );
    const names = tables.map((t) => t.name);
    expect(names).toContain('book');
    expect(names).toContain('page_stat_data');
    expect(names).toContain('numbers');
    expect(names).toContain('page_stat'); // the rescaling view
    expect(names).toContain('readest_page_ext');
    expect(names).toContain('readest_book_ext');
    expect(names).toContain('readest_stat_sync_state');
  });

  it('seeds the numbers helper table 1..1000', async () => {
    const rows = await db.select<{ c: number }>(`SELECT COUNT(*) AS c FROM numbers`);
    expect(rows[0]!.c).toBe(1000);
  });

  it('enforces the page_stat_data uniqueness key', async () => {
    await db.execute(`INSERT INTO book (title, authors, md5) VALUES ('T','A','m')`);
    const id = (await db.select<{ id: number }>(`SELECT id FROM book LIMIT 1`))[0]!.id;
    await db.execute(
      `INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) VALUES (?,?,?,?,?)`,
      [id, 5, 1000, 10, 100],
    );
    await db.execute(
      `INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages)
       VALUES (?,?,?,?,?)
       ON CONFLICT(id_book, page, start_time) DO UPDATE SET duration = max(duration, excluded.duration)`,
      [id, 5, 1000, 25, 100],
    );
    const rows = await db.select<{ duration: number; c: number }>(
      `SELECT duration, COUNT(*) OVER () AS c FROM page_stat_data`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.duration).toBe(25);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/statistics/statisticsDb.test.ts`
Expected: FAIL — `getMigrations('statistics')` returns `[]`, so no tables exist.

- [ ] **Step 3: Add the `statistics` schema**

In `src/services/database/migrations/index.ts`, add a new key to the `migrations` record (after the `reedy` entry, before the closing `}`). The DDL is KOReader's verbatim, plus Readest extension tables and a sync-cursor table. `numbers` is seeded 1..1000 via a recursive CTE so the `page_stat` view's rescale join works.

```typescript
  statistics: [
    {
      name: '2026061501_statistics_koreader_schema',
      sql: `
        CREATE TABLE IF NOT EXISTS book (
          id integer PRIMARY KEY autoincrement,
          title text, authors text, notes integer, last_open integer,
          highlights integer, pages integer, series text, language text,
          md5 text, total_read_time integer, total_read_pages integer
        );

        CREATE UNIQUE INDEX IF NOT EXISTS book_title_authors_md5 ON book(title, authors, md5);

        CREATE TABLE IF NOT EXISTS page_stat_data (
          id_book integer,
          page integer NOT NULL DEFAULT 0,
          start_time integer NOT NULL DEFAULT 0,
          duration integer NOT NULL DEFAULT 0,
          total_pages integer NOT NULL DEFAULT 0,
          UNIQUE (id_book, page, start_time)
        );

        CREATE INDEX IF NOT EXISTS page_stat_data_start_time ON page_stat_data(start_time);

        CREATE TABLE IF NOT EXISTS numbers (number INTEGER PRIMARY KEY);

        INSERT OR IGNORE INTO numbers(number)
          WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 1000)
          SELECT n FROM c;

        CREATE VIEW IF NOT EXISTS page_stat AS
          SELECT id_book, first_page + idx - 1 AS page, start_time, duration / (last_page - first_page + 1) AS duration
          FROM (
            SELECT id_book, page, total_pages, pages, start_time, duration,
              ((page - 1) * pages) / total_pages + 1 AS first_page,
              max(((page - 1) * pages) / total_pages + 1, (page * pages) / total_pages) AS last_page,
              idx
            FROM page_stat_data
            JOIN book ON book.id = id_book
            JOIN (SELECT number as idx FROM numbers) AS N ON idx <= (last_page - first_page + 1)
          );

        CREATE TABLE IF NOT EXISTS readest_page_ext (
          book_hash text NOT NULL, page integer NOT NULL, start_time integer NOT NULL,
          ext text, PRIMARY KEY (book_hash, page, start_time)
        );

        CREATE TABLE IF NOT EXISTS readest_book_ext (
          book_hash text PRIMARY KEY, ext text
        );

        CREATE TABLE IF NOT EXISTS readest_stat_sync_state (
          key text PRIMARY KEY, value integer NOT NULL DEFAULT 0
        );
      `,
    },
  ],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/__tests__/statistics/statisticsDb.test.ts`
Expected: PASS (all three migration tests green). If the `page_stat` view or recursive CTE errors on the Node libsql build, that is a real compatibility finding — report it; do not silently drop the view.

- [ ] **Step 5: Commit**

```bash
git add src/services/database/migrations/index.ts src/__tests__/statistics/statisticsDb.test.ts
git commit -m "feat(stats): add KOReader-compatible statistics.db schema migration"
```

---

### Task 3: `StatisticsDb` wrapper

**Files:**
- Create: `src/services/statistics/statisticsDb.ts`
- Test: `src/__tests__/statistics/statisticsDb.test.ts` (extend)

- [ ] **Step 1: Write the failing tests** (append to the existing test file)

Append to `src/__tests__/statistics/statisticsDb.test.ts`:

```typescript
import { StatisticsDb } from '@/services/statistics/statisticsDb';

describe('StatisticsDb', () => {
  let stats: StatisticsDb;
  beforeEach(async () => {
    stats = StatisticsDb.from(await freshStatsDb());
  });

  it('upserts a book by md5 and returns a stable id_book', async () => {
    const id1 = await stats.upsertBook({ bookMd5: 'm1', title: 'T1', authors: 'A1' });
    const id2 = await stats.upsertBook({ bookMd5: 'm1', title: 'T1', authors: 'A1' });
    expect(id1).toBe(id2);
  });

  it('inserts page events and keeps the longer duration on re-flush', async () => {
    const id = await stats.upsertBook({ bookMd5: 'm1', title: 'T1', authors: 'A1' });
    await stats.insertPageEvent(id, { page: 3, startTime: 100, duration: 10, totalPages: 50 });
    await stats.insertPageEvent(id, { page: 3, startTime: 100, duration: 30, totalPages: 50 });
    await stats.insertPageEvent(id, { page: 4, startTime: 140, duration: 12, totalPages: 50 });
    await stats.recomputeBookTotals(id);
    const book = await stats.getBookByMd5('m1');
    expect(book!.total_read_time).toBe(42); // 30 + 12
    expect(book!.total_read_pages).toBe(2); // distinct pages 3,4
    expect(book!.last_open).toBe(152); // max(start_time + duration) = 140 + 12
  });

  it('returns events for push after a start_time cursor, joined with md5', async () => {
    const id = await stats.upsertBook({ bookMd5: 'm1', title: 'T1', authors: 'A1' });
    await stats.insertPageEvent(id, { page: 1, startTime: 100, duration: 5, totalPages: 9 });
    await stats.insertPageEvent(id, { page: 2, startTime: 200, duration: 5, totalPages: 9 });
    const { events } = await stats.getEventsForPush(150);
    expect(events.map((e) => e.startTime)).toEqual([200]);
    expect(events[0]!.bookMd5).toBe('m1');
  });

  it('applies remote events idempotently via upsert', async () => {
    const remoteBooks = [{ bookMd5: 'm2', title: 'T2', authors: 'A2' }];
    const remoteEvents = [
      { bookMd5: 'm2', page: 1, startTime: 300, duration: 8, totalPages: 20 },
      { bookMd5: 'm2', page: 1, startTime: 300, duration: 8, totalPages: 20 }, // dup
    ];
    await stats.applyRemoteEvents(remoteBooks, remoteEvents);
    await stats.applyRemoteEvents(remoteBooks, remoteEvents); // again — still idempotent
    const book = await stats.getBookByMd5('m2');
    expect(book!.total_read_time).toBe(8);
  });

  it('reads and writes sync cursors', async () => {
    expect(await stats.getCursor('push')).toBe(0);
    await stats.setCursor('push', 1234);
    expect(await stats.getCursor('push')).toBe(1234);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/__tests__/statistics/statisticsDb.test.ts`
Expected: FAIL — `@/services/statistics/statisticsDb` does not exist.

- [ ] **Step 3: Implement `StatisticsDb`**

Create `src/services/statistics/statisticsDb.ts`:

```typescript
import type { AppService } from '@/services/appService';
import type { DatabaseService, DatabaseRow } from '@/types/database';
import type { PageStatEvent, StatBook } from '@/types/statistics';

interface BookRow extends DatabaseRow {
  id: number;
  title: string;
  authors: string;
  md5: string;
  total_read_time: number;
  total_read_pages: number;
  last_open: number;
  pages: number;
}

type CursorKey = 'push' | 'pull';

/**
 * Typed wrapper over the KOReader-compatible `statistics.db`. All identity is
 * keyed on `book_hash` (= Book.hash); the local autoincrement `id_book` never
 * leaves this class.
 */
export class StatisticsDb {
  private constructor(private readonly db: DatabaseService) {}

  /** Production entry point — opens + migrates statistics.db. */
  static async open(appService: AppService): Promise<StatisticsDb> {
    const db = await appService.openDatabase('statistics', 'statistics.db', 'Data');
    return new StatisticsDb(db);
  }

  /** Test/advanced entry point — wrap an already-migrated DatabaseService. */
  static from(db: DatabaseService): StatisticsDb {
    return new StatisticsDb(db);
  }

  async upsertBook(book: StatBook): Promise<number> {
    await this.db.execute(
      `INSERT INTO book (title, authors, md5, notes, last_open, highlights, pages, total_read_time, total_read_pages)
       VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0)
       ON CONFLICT(title, authors, md5) DO NOTHING`,
      [book.title, book.authors, book.bookMd5],
    );
    const rows = await this.db.select<BookRow>(
      `SELECT id FROM book WHERE title = ? AND authors = ? AND md5 = ? LIMIT 1`,
      [book.title, book.authors, book.bookMd5],
    );
    return rows[0]!.id;
  }

  async insertPageEvent(
    idBook: number,
    e: { page: number; startTime: number; duration: number; totalPages: number },
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id_book, page, start_time)
       DO UPDATE SET duration = max(duration, excluded.duration), total_pages = excluded.total_pages`,
      [idBook, e.page, e.startTime, e.duration, e.totalPages],
    );
  }

  async recomputeBookTotals(idBook: number): Promise<void> {
    await this.db.execute(
      `UPDATE book SET
         total_read_time  = COALESCE((SELECT SUM(duration) FROM page_stat_data WHERE id_book = ?), 0),
         total_read_pages = COALESCE((SELECT COUNT(DISTINCT page) FROM page_stat_data WHERE id_book = ?), 0),
         last_open        = COALESCE((SELECT MAX(start_time + duration) FROM page_stat_data WHERE id_book = ?), last_open),
         pages            = COALESCE((SELECT total_pages FROM page_stat_data WHERE id_book = ? ORDER BY start_time DESC LIMIT 1), pages)
       WHERE id = ?`,
      [idBook, idBook, idBook, idBook, idBook],
    );
  }

  async getBookByMd5(md5: string): Promise<BookRow | null> {
    const rows = await this.db.select<BookRow>(`SELECT * FROM book WHERE md5 = ? LIMIT 1`, [md5]);
    return rows[0] ?? null;
  }

  /** Events with start_time > cursor, joined to their md5, for pushing. */
  async getEventsForPush(
    sinceStartTime: number,
  ): Promise<{ events: PageStatEvent[]; books: StatBook[] }> {
    const rows = await this.db.select<DatabaseRow>(
      `SELECT b.md5 AS bookMd5, b.title AS title, b.authors AS authors,
              p.page AS page, p.start_time AS startTime, p.duration AS duration, p.total_pages AS totalPages
       FROM page_stat_data p JOIN book b ON b.id = p.id_book
       WHERE p.start_time > ?
       ORDER BY p.start_time ASC`,
      [sinceStartTime],
    );
    const events: PageStatEvent[] = rows.map((r) => ({
      bookMd5: String(r['bookMd5']),
      page: Number(r['page']),
      startTime: Number(r['startTime']),
      duration: Number(r['duration']),
      totalPages: Number(r['totalPages']),
    }));
    const bookMap = new Map<string, StatBook>();
    for (const r of rows) {
      const md5 = String(r['bookMd5']);
      if (!bookMap.has(md5)) {
        bookMap.set(md5, { bookMd5: md5, title: String(r['title']), authors: String(r['authors']) });
      }
    }
    return { events, books: [...bookMap.values()] };
  }

  async applyRemoteEvents(books: StatBook[], events: PageStatEvent[]): Promise<void> {
    const idByMd5 = new Map<string, number>();
    for (const b of books) idByMd5.set(b.bookMd5, await this.upsertBook(b));
    // Books referenced only by events (no metadata record) get a placeholder row.
    const touched = new Set<number>();
    for (const e of events) {
      let id = idByMd5.get(e.bookMd5);
      if (id === undefined) {
        id = await this.upsertBook({ bookMd5: e.bookMd5, title: e.bookMd5, authors: '' });
        idByMd5.set(e.bookMd5, id);
      }
      await this.insertPageEvent(id, e);
      touched.add(id);
    }
    for (const id of touched) await this.recomputeBookTotals(id);
  }

  async getCursor(key: CursorKey): Promise<number> {
    const rows = await this.db.select<{ value: number }>(
      `SELECT value FROM readest_stat_sync_state WHERE key = ?`,
      [key],
    );
    return rows[0]?.value ?? 0;
  }

  async setCursor(key: CursorKey, value: number): Promise<void> {
    await this.db.execute(
      `INSERT INTO readest_stat_sync_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/__tests__/statistics/statisticsDb.test.ts`
Expected: PASS (all StatisticsDb tests green).

- [ ] **Step 5: Commit**

```bash
git add src/services/statistics/statisticsDb.ts src/__tests__/statistics/statisticsDb.test.ts
git commit -m "feat(stats): add StatisticsDb wrapper over the KOReader schema"
```

---

### Task 4: `trackerCore` flush/idle state machine

**Files:**
- Create: `src/services/statistics/trackerCore.ts`
- Test: `src/__tests__/statistics/trackerCore.test.ts`

The core is pure: it receives `(page, totalPages, nowSeconds)` notifications plus idle/visibility/close signals and returns the page events to persist. No timers, no DB — the React layer drives `now` and schedules idle.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/statistics/trackerCore.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { TrackerCore } from '@/services/statistics/trackerCore';
import { DEFAULT_STATS_TRACKING_CONFIG } from '@/types/statistics';

const cfg = DEFAULT_STATS_TRACKING_CONFIG;

describe('TrackerCore', () => {
  it('emits an event when the page changes', () => {
    const t = new TrackerCore(cfg);
    expect(t.onPage(5, 100, 1000)).toEqual([]); // first page, nothing to flush yet
    const out = t.onPage(6, 100, 1030); // moved off page 5 after 30s
    expect(out).toEqual([{ page: 5, startTime: 1000, duration: 30, totalPages: 100 }]);
  });

  it('caps duration at maxEventSeconds', () => {
    const t = new TrackerCore(cfg);
    t.onPage(1, 10, 0);
    const out = t.onPage(2, 10, 10_000); // way over the 120s cap
    expect(out[0]!.duration).toBe(cfg.maxEventSeconds);
  });

  it('drops sub-minimum events', () => {
    const t = new TrackerCore(cfg);
    t.onPage(1, 10, 0);
    expect(t.onPage(2, 10, 1)).toEqual([]); // 1s < minEventSeconds (3)
  });

  it('flushes and pauses on idle, then resumes with a new start_time', () => {
    const t = new TrackerCore(cfg);
    t.onPage(1, 10, 0);
    expect(t.onIdle(50)).toEqual([{ page: 1, startTime: 0, duration: 50, totalPages: 10 }]);
    // After idle, the same page resumes as a fresh event.
    expect(t.onPage(1, 10, 200)).toEqual([]); // resume marker, no flush
    expect(t.onPage(2, 10, 230)).toEqual([{ page: 1, startTime: 200, duration: 30, totalPages: 10 }]);
  });

  it('flushes on hide and on close without double-counting', () => {
    const t = new TrackerCore(cfg);
    t.onPage(7, 10, 0);
    expect(t.onHide(40)).toEqual([{ page: 7, startTime: 0, duration: 40, totalPages: 10 }]);
    expect(t.onClose(99)).toEqual([]); // already flushed + paused by hide
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/__tests__/statistics/trackerCore.test.ts`
Expected: FAIL — `@/services/statistics/trackerCore` does not exist.

- [ ] **Step 3: Implement `TrackerCore`**

Create `src/services/statistics/trackerCore.ts`:

```typescript
import type { StatsTrackingConfig } from '@/types/statistics';

interface PendingEvent {
  page: number;
  startTime: number; // Unix seconds
  totalPages: number;
}

export interface FlushedEvent {
  page: number;
  startTime: number;
  duration: number;
  totalPages: number;
}

/**
 * Pure page-dwell tracker. The React layer feeds it `nowSeconds` and the
 * current `(page, totalPages)`; it returns zero-or-one immutable events to
 * persist. Events end on page-change / idle / hide / close. Each returned
 * event is final — its start_time and duration never change afterwards, which
 * lets sync use a simple start_time high-water cursor.
 */
export class TrackerCore {
  private pending: PendingEvent | null = null;

  constructor(private readonly cfg: StatsTrackingConfig) {}

  /** Notify the current page at `now`. Returns events flushed by leaving the prior page. */
  onPage(page: number, totalPages: number, now: number): FlushedEvent[] {
    if (this.pending && this.pending.page === page) {
      // Same page (e.g. resume after idle, or a no-op relocate): keep dwelling.
      return [];
    }
    const flushed = this.flush(now);
    this.pending = { page, startTime: now, totalPages };
    return flushed;
  }

  onIdle(now: number): FlushedEvent[] {
    return this.flush(now); // flush + pause (pending cleared)
  }

  onHide(now: number): FlushedEvent[] {
    return this.flush(now);
  }

  onClose(now: number): FlushedEvent[] {
    return this.flush(now);
  }

  private flush(now: number): FlushedEvent[] {
    const p = this.pending;
    this.pending = null;
    if (!p) return [];
    const raw = now - p.startTime;
    const duration = Math.min(Math.max(raw, 0), this.cfg.maxEventSeconds);
    if (duration < this.cfg.minEventSeconds) return [];
    return [{ page: p.page, startTime: p.startTime, duration, totalPages: p.totalPages }];
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/__tests__/statistics/trackerCore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/statistics/trackerCore.ts src/__tests__/statistics/trackerCore.test.ts
git commit -m "feat(stats): add pure page-dwell tracker core"
```

---

### Task 5: `ReadingStatsTracker` React component + mount

**Files:**
- Create: `src/app/reader/components/ReadingStatsTracker.tsx`
- Modify: `src/app/reader/components/BooksGrid.tsx`
- Reference: `src/store/readerStore.ts` (the `viewStates[bookKey].progress` selector PR #3156 used: `progress.pageinfo.{current,total}`, `progress.location`)

This component holds no business logic — it wires `TrackerCore` to: progress changes (`onPage`), an idle timer (`onIdle`), `document.visibilitychange` (`onHide`), and unmount (`onClose`), persisting each flushed event via `StatisticsDb`.

- [ ] **Step 1: Implement the component**

Create `src/app/reader/components/ReadingStatsTracker.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useEnv } from '@/context/EnvContext';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { TrackerCore, type FlushedEvent } from '@/services/statistics/trackerCore';
import { DEFAULT_STATS_TRACKING_CONFIG } from '@/types/statistics';

const nowSec = () => Math.floor(Date.now() / 1000);

export default function ReadingStatsTracker({ bookKey }: { bookKey: string }) {
  const { appService } = useEnv();
  const progress = useReaderStore((state) => state.viewStates[bookKey]?.progress);
  const bookData = useBookDataStore((state) => state.booksData[bookKey]);
  const coreRef = useRef(new TrackerCore(DEFAULT_STATS_TRACKING_CONFIG));
  const dbRef = useRef<StatisticsDb | null>(null);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bookMd5 = bookData?.book?.hash;
  const title = bookData?.book?.title ?? '';
  const author = bookData?.book?.author ?? '';

  useEffect(() => {
    if (!appService) return;
    let cancelled = false;
    StatisticsDb.open(appService).then((db) => {
      if (!cancelled) dbRef.current = db;
    });
    return () => {
      cancelled = true;
    };
  }, [appService]);

  // Persist flushed events.
  const persist = (events: FlushedEvent[]) => {
    const db = dbRef.current;
    if (!db || !bookMd5 || events.length === 0) return;
    void (async () => {
      const idBook = await db.upsertBook({ bookMd5, title, authors: author });
      for (const e of events) await db.insertPageEvent(idBook, e);
      await db.recomputeBookTotals(idBook);
    })();
  };

  const armIdle = () => {
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(
      () => persist(coreRef.current.onIdle(nowSec())),
      DEFAULT_STATS_TRACKING_CONFIG.idleTimeoutSeconds * 1000,
    );
  };

  // Progress (page) changes drive the tracker.
  useEffect(() => {
    const info = progress?.pageinfo;
    if (!info) return;
    const page = (info.current ?? 0) + 1;
    const total = info.total || 1;
    persist(coreRef.current.onPage(page, total, nowSec()));
    armIdle();
  }, [progress?.pageinfo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tab/window visibility.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        if (idleRef.current) clearTimeout(idleRef.current);
        persist(coreRef.current.onHide(nowSec()));
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [bookMd5]); // eslint-disable-line react-hooks/exhaustive-deps

  // Book close (unmount).
  useEffect(() => {
    return () => {
      if (idleRef.current) clearTimeout(idleRef.current);
      persist(coreRef.current.onClose(nowSec()));
    };
  }, [bookMd5]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
```

- [ ] **Step 2: Mount it per book**

In `src/app/reader/components/BooksGrid.tsx`, locate where each book view is rendered per `bookKey` (PR #3156 mounted `BookSessionTracker` here). Add the import and render the tracker alongside the existing per-book content:

```tsx
import ReadingStatsTracker from './ReadingStatsTracker';
```

Inside the per-`bookKey` map, render `<ReadingStatsTracker bookKey={bookKey} />` next to the existing viewer for that key.

- [ ] **Step 3: Verify build + lint**

Run: `pnpm lint`
Expected: PASS. Then sanity-check the field paths against the real stores: confirm `useBookDataStore().booksData[bookKey].book.hash/title/author` and `useReaderStore().viewStates[bookKey].progress.pageinfo` exist (grep `booksData` and `pageinfo` if unsure). Fix selector paths to match the actual stores if they differ.

- [ ] **Step 4: Manual smoke (dev-web)**

Run: `pnpm dev-web`, open a book, turn a few pages, wait > 3s per page, close the book. Then in devtools confirm `statistics.db` has rows (OPFS on web), or add a temporary `console.log` of `getBookByMd5`. Remove the log before committing.

- [ ] **Step 5: Commit**

```bash
git add src/app/reader/components/ReadingStatsTracker.tsx src/app/reader/components/BooksGrid.tsx
git commit -m "feat(stats): track per-page reading events into statistics.db"
```

### ▣ Phase 1 checkpoint

Run `pnpm test` and `pnpm lint` — both green. Local reading stats now record to a KOReader-compatible `statistics.db`. **Stop and review before Phase 2.**

---

# Phase 2 — Cross-device sync (Supabase + app client)

Adds `/api/sync type=stats` and the Readest-app push/pull. Ships Readest↔Readest stats sync.

## File structure (Phase 2)

- Create `docker/volumes/db/migrations/014_add_reading_stats.sql` — `stat_books` + `stat_pages` tables + RLS.
- Modify `src/libs/sync.ts` — extend `SyncType`, `SyncData`, `SyncResult` with stats.
- Modify `src/pages/api/sync.ts` — GET + POST `stats` branches (longer-duration-wins merge).
- Modify `src/types/settings.ts` — add `'stats'` to `SyncCategory` + `SYNC_CATEGORIES`.
- Modify `src/services/sync/syncCategories.ts` — map the `stats` id.
- Create `src/services/statistics/statsSync.ts` — app-side push/pull orchestration over `StatisticsDb`.
- Modify `src/app/reader/components/ReadingStatsTracker.tsx` — trigger push after persist; pull on mount.
- Tests: `src/__tests__/statistics/statsSync.test.ts`, `src/__tests__/api/statsSyncMerge.test.ts`.

---

### Task 6: Supabase tables + RLS

**Files:**
- Create: `docker/volumes/db/migrations/014_add_reading_stats.sql`

- [ ] **Step 1: Write the migration**

Create `docker/volumes/db/migrations/014_add_reading_stats.sql` (RLS pattern mirrors `002_add_book_shares.sql`):

```sql
-- Migration 014: reading statistics sync (KOReader-compatible page events)

CREATE TABLE IF NOT EXISTS public.stat_books (
  user_id uuid NOT NULL,
  book_hash text NOT NULL,
  title text NOT NULL DEFAULT '',
  authors text NOT NULL DEFAULT '',
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone NULL,
  CONSTRAINT stat_books_pkey PRIMARY KEY (user_id, book_hash),
  CONSTRAINT stat_books_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_stat_books_user_updated ON public.stat_books (user_id, updated_at);

CREATE TABLE IF NOT EXISTS public.stat_pages (
  user_id uuid NOT NULL,
  book_hash text NOT NULL,
  page integer NOT NULL,
  start_time bigint NOT NULL,
  duration integer NOT NULL DEFAULT 0,
  total_pages integer NOT NULL DEFAULT 0,
  ext jsonb NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone NULL,
  CONSTRAINT stat_pages_pkey PRIMARY KEY (user_id, book_hash, page, start_time),
  CONSTRAINT stat_pages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_stat_pages_user_updated ON public.stat_pages (user_id, updated_at);

ALTER TABLE public.stat_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stat_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY stat_books_select ON public.stat_books FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_books_insert ON public.stat_books FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_books_update ON public.stat_books FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_books_delete ON public.stat_books FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY stat_pages_select ON public.stat_pages FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_pages_insert ON public.stat_pages FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_pages_update ON public.stat_pages FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_pages_delete ON public.stat_pages FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
```

- [ ] **Step 2: Apply locally** (if the local Supabase stack is running)

Run: `psql "$SUPABASE_DB_URL" -f docker/volumes/db/migrations/014_add_reading_stats.sql` (or whatever the repo's migration-apply step is — check `docker/` README). If no local stack, note that it applies on next stack bring-up.

- [ ] **Step 3: Commit**

```bash
git add docker/volumes/db/migrations/014_add_reading_stats.sql
git commit -m "feat(stats): add stat_books/stat_pages Supabase tables with RLS"
```

---

### Task 7: Sync wire types

**Files:**
- Modify: `src/libs/sync.ts`

- [ ] **Step 1: Extend the types**

In `src/libs/sync.ts`:

```typescript
export type SyncType = 'books' | 'configs' | 'notes' | 'stats';
```

Add the wire record shapes and extend `SyncData` / `SyncResult`:

```typescript
export interface StatBookRecord {
  user_id?: string;
  book_hash: string;
  title: string;
  authors: string;
  updated_at?: string;
  updated_at_ms?: number; // epoch ms, attached by the GET response for cursor math
  deleted_at?: string | null;
}

export interface StatPageRecord {
  user_id?: string;
  book_hash: string;
  page: number;
  start_time: number;
  duration: number;
  total_pages: number;
  ext?: unknown;
  updated_at?: string;
  updated_at_ms?: number; // epoch ms, attached by the GET response for cursor math
  deleted_at?: string | null;
}
```

In `SyncData` add: `statBooks?: StatBookRecord[]; statPages?: StatPageRecord[];`
In `SyncResult` add: `statBooks?: StatBookRecord[] | null; statPages?: StatPageRecord[] | null;`

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS (additive; existing call sites unaffected).

- [ ] **Step 3: Commit**

```bash
git add src/libs/sync.ts
git commit -m "feat(stats): add stats records to the sync wire types"
```

---

### Task 8: `/api/sync` stats merge (server)

**Files:**
- Modify: `src/pages/api/sync.ts`
- Test: `src/__tests__/api/statsSyncMerge.test.ts`

The stats merge is custom (not the generic LWW `upsertRecords`): `stat_pages` keeps the **greater duration** on conflict; `stat_books` is LWW by `updated_at`. Extract the page-merge decision into a pure function so it is unit-testable without Supabase.

- [ ] **Step 1: Write the failing test** (pure merge decision)

Create `src/__tests__/api/statsSyncMerge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { pickWinningPages } from '@/pages/api/sync';
import type { StatPageRecord } from '@/libs/sync';

const mk = (start: number, duration: number): StatPageRecord => ({
  book_hash: 'm', page: 1, start_time: start, duration, total_pages: 10,
});

describe('pickWinningPages', () => {
  it('inserts pages the server has not seen', () => {
    const { toUpsert } = pickWinningPages([mk(100, 5)], new Map());
    expect(toUpsert).toHaveLength(1);
  });

  it('keeps the longer duration on conflict', () => {
    const server = new Map([['m|1|100', mk(100, 5)]]);
    const win = pickWinningPages([mk(100, 9)], server);
    expect(win.toUpsert[0]!.duration).toBe(9);
  });

  it('drops an incoming page whose duration is not longer', () => {
    const server = new Map([['m|1|100', mk(100, 9)]]);
    const win = pickWinningPages([mk(100, 5)], server);
    expect(win.toUpsert).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/__tests__/api/statsSyncMerge.test.ts`
Expected: FAIL — `pickWinningPages` is not exported from `@/pages/api/sync`.

- [ ] **Step 3: Implement the merge + wire GET/POST**

In `src/pages/api/sync.ts`, add the exported pure helper near the top (after imports):

```typescript
import type { StatPageRecord, StatBookRecord } from '@/libs/sync';

const pageKey = (r: StatPageRecord) => `${r.book_hash}|${r.page}|${r.start_time}`;

/**
 * Decide which incoming page events to write: new keys always win; existing
 * keys win only when the incoming duration is strictly longer (union/upsert
 * semantics — KOReader-compatible).
 */
export function pickWinningPages(
  incoming: StatPageRecord[],
  server: Map<string, StatPageRecord>,
): { toUpsert: StatPageRecord[] } {
  const toUpsert: StatPageRecord[] = [];
  for (const rec of incoming) {
    const existing = server.get(pageKey(rec));
    if (!existing || rec.duration > existing.duration) toUpsert.push(rec);
  }
  return { toUpsert };
}
```

In the GET handler, after the existing `notes` branch, add (mirrors the `since`/`book` filtering already used for other tables):

```typescript
if (!typeParam || typeParam === 'stats') {
  const statBooks = await supabase
    .from('stat_books')
    .select('*')
    .eq('user_id', user.id)
    .or(`updated_at.gt.${sinceIso},deleted_at.gt.${sinceIso}`);
  let pagesQuery = supabase
    .from('stat_pages')
    .select('*')
    .eq('user_id', user.id)
    .or(`updated_at.gt.${sinceIso},deleted_at.gt.${sinceIso}`);
  if (bookParam) pagesQuery = pagesQuery.eq('book_hash', bookParam);
  const statPages = await pagesQuery;
  if (statBooks.error) throw { table: 'stat_books', error: statBooks.error } as DBError;
  if (statPages.error) throw { table: 'stat_pages', error: statPages.error } as DBError;
  // Attach updated_at_ms (epoch ms) so non-JS clients (the Lua koplugin) can
  // compute their pull cursor without parsing ISO-8601 timestamps.
  const withMs = <T extends { updated_at?: string }>(rows: T[]) =>
    rows.map((r) => ({ ...r, updated_at_ms: r.updated_at ? new Date(r.updated_at).getTime() : 0 }));
  results.statBooks = withMs(statBooks.data ?? []);
  results.statPages = withMs(statPages.data ?? []);
}
```

Add `statBooks: [], statPages: []` to the initial `results` object, and widen its type to include them. (`updated_at_ms` is already on the wire types from Task 7.)

In the POST handler, destructure and handle stats after the existing books/configs/notes upserts:

```typescript
const { books = [], configs = [], notes = [], statBooks = [], statPages = [] } = body as SyncData;

// ... existing books/configs/notes handling ...

if (statBooks.length > 0) {
  const rows = statBooks.map((b: StatBookRecord) => ({
    user_id: user.id, book_hash: b.book_hash, title: b.title, authors: b.authors,
    updated_at: new Date().toISOString(), deleted_at: b.deleted_at ?? null,
  }));
  const { error } = await supabase.from('stat_books').upsert(rows, { onConflict: 'user_id,book_hash' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
}

if (statPages.length > 0) {
  const { data: existing } = await supabase
    .from('stat_pages').select('*').eq('user_id', user.id).in('book_hash', statPages.map((p) => p.book_hash));
  const serverMap = new Map<string, StatPageRecord>();
  (existing ?? []).forEach((r) => serverMap.set(pageKey(r as StatPageRecord), r as StatPageRecord));
  const { toUpsert } = pickWinningPages(statPages, serverMap);
  const rows = toUpsert.map((p) => ({
    user_id: user.id, book_hash: p.book_hash, page: p.page, start_time: p.start_time,
    duration: p.duration, total_pages: p.total_pages, ext: p.ext ?? null,
    updated_at: new Date().toISOString(), deleted_at: p.deleted_at ?? null,
  }));
  if (rows.length > 0) {
    const { error } = await supabase.from('stat_pages').upsert(rows, { onConflict: 'user_id,book_hash,page,start_time' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

(If the POST handler returns a combined result object, include `statBooks`/`statPages` echoes consistent with the existing return shape.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/__tests__/api/statsSyncMerge.test.ts`
Expected: PASS. Then `pnpm lint` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/sync.ts src/__tests__/api/statsSyncMerge.test.ts
git commit -m "feat(stats): merge stats in /api/sync (longer-duration-wins)"
```

---

### Task 9: Sync category `stats`

**Files:**
- Modify: `src/types/settings.ts`
- Modify: `src/services/sync/syncCategories.ts`

- [ ] **Step 1: Add the category**

In `src/types/settings.ts`, add `| 'stats'` to the `SyncCategory` union and `'stats',` to the `SYNC_CATEGORIES` array.

In `src/services/sync/syncCategories.ts`, the `toCategory` mapper already returns a matching `SyncCategory` for ids present in `SYNC_CATEGORIES`, so `'stats'` maps to itself automatically. No change needed unless a legacy alias is introduced.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/types/settings.ts src/services/sync/syncCategories.ts
git commit -m "feat(stats): add 'stats' sync category (default on)"
```

---

### Task 10: App-side push/pull (`statsSync.ts`)

**Files:**
- Create: `src/services/statistics/statsSync.ts`
- Test: `src/__tests__/statistics/statsSync.test.ts`

- [ ] **Step 1: Write the failing test** (push reads new events; pull applies + advances cursor)

Create `src/__tests__/statistics/statsSync.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { pushStats, pullStats } from '@/services/statistics/statsSync';

async function db() {
  const d = await NodeDatabaseService.open(':memory:');
  await migrate(d, getMigrations('statistics'));
  return StatisticsDb.from(d);
}

describe('statsSync', () => {
  it('pushes only events past the cursor and advances it', async () => {
    const stats = await db();
    const id = await stats.upsertBook({ bookMd5: 'm', title: 'T', authors: 'A' });
    await stats.insertPageEvent(id, { page: 1, startTime: 100, duration: 5, totalPages: 9 });
    await stats.insertPageEvent(id, { page: 2, startTime: 200, duration: 6, totalPages: 9 });
    const client = { pushChanges: vi.fn().mockResolvedValue({}) };
    await pushStats(stats, client as never);
    const sent = client.pushChanges.mock.calls[0]![0];
    expect(sent.statPages.map((p: { start_time: number }) => p.start_time)).toEqual([100, 200]);
    expect(await stats.getCursor('push')).toBe(200);
  });

  it('applies pulled events and advances the pull cursor', async () => {
    const stats = await db();
    const client = {
      pullChanges: vi.fn().mockResolvedValue({
        statBooks: [{ book_hash: 'm', title: 'T', authors: 'A' }],
        statPages: [{ book_hash: 'm', page: 1, start_time: 300, duration: 7, total_pages: 9, updated_at_ms: 1_750_000_000_000 }],
      }),
    };
    await pullStats(stats, client as never);
    const book = await stats.getBookByMd5('m');
    expect(book!.total_read_time).toBe(7);
    expect(await stats.getCursor('pull')).toBe(1_750_000_000_000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/__tests__/statistics/statsSync.test.ts`
Expected: FAIL — `@/services/statistics/statsSync` does not exist.

- [ ] **Step 3: Implement `statsSync`**

Create `src/services/statistics/statsSync.ts`:

```typescript
import type { StatisticsDb } from './statisticsDb';
import type { SyncClient, StatPageRecord, StatBookRecord } from '@/libs/sync';
import type { PageStatEvent, StatBook } from '@/types/statistics';

type PushClient = Pick<SyncClient, 'pushChanges'>;
type PullClient = Pick<SyncClient, 'pullChanges'>;

const toWirePage = (e: PageStatEvent): StatPageRecord => ({
  book_hash: e.bookMd5, page: e.page, start_time: e.startTime,
  duration: e.duration, total_pages: e.totalPages,
});
const toWireBook = (b: StatBook): StatBookRecord => ({
  book_hash: b.bookMd5, title: b.title, authors: b.authors,
});

/** Push local events newer than the push cursor; advance it to the max start_time sent. */
export async function pushStats(stats: StatisticsDb, client: PushClient): Promise<void> {
  const cursor = await stats.getCursor('push');
  const { events, books } = await stats.getEventsForPush(cursor);
  if (events.length === 0) return;
  await client.pushChanges({ statBooks: books.map(toWireBook), statPages: events.map(toWirePage) });
  const maxStart = events.reduce((m, e) => Math.max(m, e.startTime), cursor);
  await stats.setCursor('push', maxStart);
}

/** Pull events since the pull cursor; apply + advance cursor to newest updated_at. */
export async function pullStats(stats: StatisticsDb, client: PullClient): Promise<void> {
  const since = await stats.getCursor('pull');
  const res = await client.pullChanges(since, 'stats');
  const wireBooks = (res.statBooks ?? []) as StatBookRecord[];
  const wirePages = (res.statPages ?? []) as StatPageRecord[];
  const books: StatBook[] = wireBooks.map((b) => ({ bookMd5: b.book_hash, title: b.title, authors: b.authors }));
  const events: PageStatEvent[] = wirePages.map((p) => ({
    bookMd5: p.book_hash, page: p.page, startTime: p.start_time, duration: p.duration, totalPages: p.total_pages,
  }));
  await stats.applyRemoteEvents(books, events);
  // The server attaches updated_at_ms (epoch ms) precisely so the cursor is a
  // plain number both JS and the Lua koplugin can advance the same way.
  const newest = wirePages.reduce((m, p) => Math.max(m, p.updated_at_ms ?? 0), since);
  if (newest > since) await stats.setCursor('pull', newest);
}
```

Note: `pullChanges(since, type)` matches the existing `SyncClient.pullChanges(since, type, book?, metaHash?)` signature in `src/libs/sync.ts`. If the real signature differs, adapt the call (the test mocks it, so align the test's mock with the real signature).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/__tests__/statistics/statsSync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/statistics/statsSync.ts src/__tests__/statistics/statsSync.test.ts
git commit -m "feat(stats): app-side stats push/pull over /api/sync"
```

---

### Task 11: Trigger sync from the tracker

**Files:**
- Modify: `src/app/reader/components/ReadingStatsTracker.tsx`

- [ ] **Step 1: Wire pull-on-open + debounced push-after-persist**

Add imports to `ReadingStatsTracker.tsx`:

```tsx
import { SyncClient } from '@/libs/sync';
import { pushStats, pullStats } from '@/services/statistics/statsSync';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import { useAuth } from '@/context/AuthContext';
```

Inside the component, read auth and add a push-debounce ref:

```tsx
const { user } = useAuth();
const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const syncEnabled = () => !!user && isSyncCategoryEnabled('stats');

const schedulePush = () => {
  if (!syncEnabled()) return;
  if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
  pushTimerRef.current = setTimeout(() => {
    const db = dbRef.current;
    if (db) void pushStats(db, new SyncClient());
  }, 10_000); // trailing debounce so rapid page turns don't spam the endpoint
};
```

In the open effect, after `dbRef.current = db`, pull once:

```tsx
StatisticsDb.open(appService).then((db) => {
  if (cancelled) return;
  dbRef.current = db;
  if (syncEnabled()) void pullStats(db, new SyncClient());
});
```

At the end of `persist`'s async block (after `recomputeBookTotals`), call `schedulePush()`. In the unmount cleanup, also flush a push: `if (pushTimerRef.current) clearTimeout(pushTimerRef.current);` then `if (syncEnabled() && dbRef.current) void pushStats(dbRef.current, new SyncClient());`.

Every network call is guarded by `syncEnabled()` — logged-out users and users who disabled the `stats` category still get local-only recording.

- [ ] **Step 2: Lint + manual two-client smoke**

Run: `pnpm lint` — PASS. Then optionally verify with two logged-in dev sessions that events created in one appear in the other after pull.

- [ ] **Step 3: Commit**

```bash
git add src/app/reader/components/ReadingStatsTracker.tsx
git commit -m "feat(stats): sync reading stats across Readest devices"
```

### ▣ Phase 2 checkpoint

`pnpm test` + `pnpm lint` green. Readest↔Readest stats sync works. **Stop and review before Phase 3.**

---

# Phase 3 — KOReader plugin sync (`apps/readest.koplugin`)

Adds `readest_syncstats.lua` so KOReader devices push/pull the same `type=stats` endpoint, reading/writing their native `statistics.sqlite3`.

## File structure (Phase 3)

- Create `apps/readest.koplugin/readest_syncstats.lua` — push/pull modeled on `readest_syncconfig.lua`.
- Modify `apps/readest.koplugin/main.lua` — wire syncstats into the sync flow + menu.
- Create `apps/readest.koplugin/spec/syncstats_spec.lua` — busted unit tests.
- i18n: run `/i18n-koplugin` to extract new `_()` strings.

---

### Task 12: `readest_syncstats.lua`

**Files:**
- Create: `apps/readest.koplugin/readest_syncstats.lua`
- Reference: `apps/readest.koplugin/readest_syncconfig.lua` (push/pull shape, auth-fail handling), `apps/readest.koplugin/readest_syncclient.lua` (client API), KOReader `plugins/statistics.koplugin/main.lua` (the `statistics.sqlite3` location + schema)

KOReader's stats DB lives at `DataStorage:getSettingsDir() .. "/statistics.sqlite3"`. The plugin opens it read/write with the bundled `lua-ljsqlite3` (`require("lua-ljsqlite3/init")`), the same module KOReader's statistics plugin uses.

- [ ] **Step 1: Implement the module**

Create `apps/readest.koplugin/readest_syncstats.lua`:

```lua
local DataStorage = require("datastorage")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local SQ3 = require("lua-ljsqlite3/init")
local _ = require("readest_i18n")

local SyncStats = {}

local function db_path()
    return DataStorage:getSettingsDir() .. "/statistics.sqlite3"
end

-- Read book md5/title/authors + page events with start_time > cursor.
-- Uses prepare/reset/bind/step — the same idiom as plugins/statistics.koplugin
-- (`stmt:reset():bind(...):step()`, step() returns a 1-indexed row or nil).
function SyncStats:collectSince(cursor)
    local conn = SQ3.open(db_path())
    local books, pages, seen = {}, {}, {}
    local stmt = conn:prepare([[
        SELECT b.md5, b.title, b.authors, p.page, p.start_time, p.duration, p.total_pages
        FROM page_stat_data p JOIN book b ON b.id = p.id_book
        WHERE p.start_time > ? ORDER BY p.start_time ASC]])
    stmt:reset():bind(tonumber(cursor) or 0)
    local row = stmt:step()
    while row ~= nil do
        local md5 = row[1]
        if md5 and not seen[md5] then
            seen[md5] = true
            table.insert(books, { book_hash = md5, title = row[2] or "", authors = row[3] or "" })
        end
        table.insert(pages, {
            book_hash = md5,
            page = tonumber(row[4]),
            start_time = tonumber(row[5]),
            duration = tonumber(row[6]),
            total_pages = tonumber(row[7]),
        })
        row = stmt:step()
    end
    stmt:close()
    conn:close()
    return books, pages
end

-- Upsert pulled rows into the local statistics.sqlite3 (union / longer-duration).
function SyncStats:applyRemote(books, pages)
    local conn = SQ3.open(db_path())
    conn:exec("BEGIN;")
    local insert_book = conn:prepare("INSERT OR IGNORE INTO book (title, authors, md5) VALUES (?, ?, ?);")
    for _, b in ipairs(books or {}) do
        insert_book:reset():bind(b.title or "", b.authors or "", b.book_hash):step()
    end
    insert_book:close()
    local find_id = conn:prepare("SELECT id FROM book WHERE md5 = ? LIMIT 1;")
    local insert_page = conn:prepare([[
        INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id_book, page, start_time)
        DO UPDATE SET duration = max(duration, excluded.duration);]])
    local id_cache = {}
    for _, p in ipairs(pages or {}) do
        local id = id_cache[p.book_hash]
        if not id then
            local r = find_id:reset():bind(p.book_hash):step()
            if r ~= nil then id = tonumber(r[1]); id_cache[p.book_hash] = id end
        end
        if id then
            insert_page:reset():bind(id, p.page, p.start_time, p.duration, p.total_pages):step()
        end
    end
    find_id:close()
    insert_page:close()
    conn:exec("COMMIT;")
    conn:close()
end

function SyncStats:push(settings, client, interactive)
    local cursor = settings:readSetting("stats_push_cursor") or 0
    local books, pages = self:collectSince(cursor)
    if #pages == 0 then return end
    local max_start = cursor
    for _, p in ipairs(pages) do if p.start_time > max_start then max_start = p.start_time end end
    client:pushChanges(
        { statBooks = books, statPages = pages },
        function(success)
            if success then
                settings:saveSetting("stats_push_cursor", max_start)
            elseif interactive then
                UIManager:show(InfoMessage:new{ text = _("Failed to push reading statistics"), timeout = 2 })
            end
        end)
end

function SyncStats:pull(settings, client, interactive, logout_fn)
    local since = settings:readSetting("stats_pull_cursor") or 0
    -- pullChanges requires since/type/book/meta_hash params (readest-sync-api.json).
    client:pullChanges(
        { since = since, type = "stats", book = "", meta_hash = "" },
        function(success, response, status)
            if not success then
                if status == 401 or status == 403 then
                    if logout_fn then logout_fn() end
                end
                if interactive then
                    UIManager:show(InfoMessage:new{ text = _("Failed to pull reading statistics"), timeout = 2 })
                end
                return
            end
            self:applyRemote(response.statBooks, response.statPages)
            local newest = since
            for _, p in ipairs(response.statPages or {}) do
                local u = tonumber(p.updated_at_ms) or 0
                if u > newest then newest = u end
            end
            if newest > since then settings:saveSetting("stats_pull_cursor", newest) end
        end)
end

return SyncStats
```

API note: `SQ3.open` / `conn:exec` / `conn:prepare` / `stmt:reset():bind(...):step()` and 1-indexed row access are exactly the idioms in KOReader's `plugins/statistics.koplugin/main.lua` (the authoritative example) and are supported by the busted SQ3 shim in `spec/spec_helper.lua`. No `SQ3.quote` is used.

- [ ] **Step 1b: Declare the new payload fields in the Spore spec**

`client:pushChanges` only sends body keys listed in the Spore spec's `payload`. In `apps/readest.koplugin/readest-sync-api.json`, extend the `pushChanges` entry:

```json
"pushChanges": {
  "path": "/sync",
  "method": "POST",
  "required_params": ["books", "notes", "configs"],
  "payload": ["books", "notes", "configs", "statBooks", "statPages"],
  "expected_status": [200, 201, 301, 400, 401, 403]
}
```

(`pullChanges` already passes `type`/`since`/`book`/`meta_hash` as params, so `type=stats` needs no spec change.)

- [ ] **Step 2: Wire into `main.lua`**

In `apps/readest.koplugin/main.lua`, find where `readest_syncconfig` is required and invoked during the sync cycle and add the parallel calls:

```lua
local SyncStats = require("readest_syncstats")
-- in the push path:
SyncStats:push(self.settings, self.sync_client, interactive)
-- in the pull path (on sync / on book open):
SyncStats:pull(self.settings, self.sync_client, interactive, logout_fn)
```

Add a menu toggle "Sync reading statistics" mirroring the existing config/annotations sync menu entries.

- [ ] **Step 3: Extract i18n**

Run: `/i18n-koplugin` (or `node apps/readest.koplugin/scripts/extract-i18n.js`) to sync the `.po` catalogs with the new `_()` strings.

- [ ] **Step 4: Commit**

```bash
git add apps/readest.koplugin/readest_syncstats.lua apps/readest.koplugin/main.lua \
        apps/readest.koplugin/readest-sync-api.json apps/readest.koplugin/locales
git commit -m "feat(koplugin): sync reading statistics with Readest"
```

---

### Task 13: koplugin busted specs

**Files:**
- Create: `apps/readest.koplugin/spec/syncstats_spec.lua`
- Reference: `apps/readest.koplugin/spec/syncannotations_spec.lua` (mocking style, spec_helper)

- [ ] **Step 1: Write the spec**

`spec/spec_helper.lua` already shims `lua-ljsqlite3/init` over `lsqlite3complete` and fakes `DataStorage` with a temp settings dir. So the spec seeds a real on-disk `statistics.sqlite3` at `DataStorage:getSettingsDir() .. "/statistics.sqlite3"` and drives the module directly.

Create `apps/readest.koplugin/spec/syncstats_spec.lua`:

```lua
require("spec_helper")

-- Minimal KOReader UI stubs the module pulls at require-time.
package.preload["ui/widget/infomessage"] = function() return { new = function() return {} end } end
package.preload["ui/uimanager"] = function() return { show = function() end } end
package.preload["readest_i18n"] = function() return function(s) return s end end

local SQ3 = require("lua-ljsqlite3/init")
local DataStorage = require("datastorage")

local function statsDbPath()
    return DataStorage:getSettingsDir() .. "/statistics.sqlite3"
end

local function seedDb()
    local conn = SQ3.open(statsDbPath())
    conn:exec([[
        CREATE TABLE IF NOT EXISTS book (
            id integer PRIMARY KEY autoincrement, title text, authors text, notes integer,
            last_open integer, highlights integer, pages integer, series text, language text,
            md5 text, total_read_time integer, total_read_pages integer);
        CREATE UNIQUE INDEX IF NOT EXISTS book_title_authors_md5 ON book(title, authors, md5);
        CREATE TABLE IF NOT EXISTS page_stat_data (
            id_book integer, page integer NOT NULL DEFAULT 0, start_time integer NOT NULL DEFAULT 0,
            duration integer NOT NULL DEFAULT 0, total_pages integer NOT NULL DEFAULT 0,
            UNIQUE (id_book, page, start_time));
    ]])
    conn:close()
end

describe("readest_syncstats", function()
    local SyncStats

    before_each(function()
        os.remove(statsDbPath())
        seedDb()
        package.loaded["readest_syncstats"] = nil
        SyncStats = require("readest_syncstats")
    end)

    it("collects only events past the cursor, joined with md5", function()
        local conn = SQ3.open(statsDbPath())
        conn:exec("INSERT INTO book (title, authors, md5) VALUES ('T', 'A', 'md5-1');")
        conn:exec("INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) VALUES (1, 1, 100, 5, 9);")
        conn:exec("INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) VALUES (1, 2, 200, 6, 9);")
        conn:close()

        local books, pages = SyncStats:collectSince(150)
        assert.are.equal(1, #pages)
        assert.are.equal(200, pages[1].start_time)
        assert.are.equal("md5-1", pages[1].book_hash)
        assert.are.equal("md5-1", books[1].book_hash)
    end)

    it("keeps the longer duration when applying remote events", function()
        SyncStats:applyRemote(
            { { book_hash = "md5-2", title = "T2", authors = "A2" } },
            {
                { book_hash = "md5-2", page = 1, start_time = 300, duration = 8, total_pages = 20 },
                { book_hash = "md5-2", page = 1, start_time = 300, duration = 20, total_pages = 20 },
            })

        local conn = SQ3.open(statsDbPath())
        local count = conn:rowexec("SELECT COUNT(*) FROM page_stat_data;")
        local dur = conn:rowexec("SELECT duration FROM page_stat_data WHERE start_time = 300;")
        conn:close()
        assert.are.equal(1, tonumber(count))
        assert.are.equal(20, tonumber(dur))
    end)
end)
```

If the local `lsqlite3complete` build rejects `ON CONFLICT ... DO UPDATE` (very old SQLite), report it — do not weaken the merge; bump the test SQLite instead.

- [ ] **Step 2: Run the Lua tests**

Run: `pnpm test:lua`
Expected: PASS (soft-skips if luajit/busted unavailable — then run on a machine that has them).

- [ ] **Step 3: Lint Lua**

Run: `pnpm lint:lua`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/readest.koplugin/spec/syncstats_spec.lua
git commit -m "test(koplugin): cover readest_syncstats collect/apply/cursor"
```

### ▣ Phase 3 checkpoint

`pnpm test` + `pnpm lint` + `pnpm lint:lua` + `pnpm test:lua` green. KOReader devices now sync stats with Readest end-to-end.

---

## Final verification

- [ ] `pnpm test` — all unit tests pass.
- [ ] `pnpm lint` — Biome + tsgo clean.
- [ ] `pnpm lint:lua` + `pnpm test:lua` — koplugin Lua clean (Phase 3).
- [ ] End-to-end: read on Readest device A → stats appear on Readest device B after pull; read on a KOReader device → events appear in Readest after the koplugin pushes; and a Readest-originated book's events show up in KOReader's own statistics view.
- [ ] Remove PR #3156 leftovers if present in the branch base: `better-sqlite3` / `@types/better-sqlite3` deps, the `onlyBuiltDependencies` block, `statistics.json` code, and the session-based `statisticsStore`/`BookSessionTracker` if they were merged.
