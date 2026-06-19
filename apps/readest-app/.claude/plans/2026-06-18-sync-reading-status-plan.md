# Sync Reading Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a book's reading status (unread / reading / finished / abandoned) sync reliably across Readest devices and round-trip with KOReader.

**Architecture:** Reading status is merged by a dedicated per-field timestamp (`reading_status_updated_at`) on both the server upsert and the client pull-merge, independent of the row's `updated_at`, so a high-frequency progress update can never clobber an intentional status change. A new `abandoned` ("On hold") status is added to Readest so KOReader's status set maps losslessly. The `readest.koplugin` bridges its `LibraryStore.reading_status` to KOReader's native `summary.status` via one pure reconcile function used by both the apply (cloud→KOReader) and capture (KOReader→cloud) directions.

**Tech Stack:** TypeScript / Next.js 16 (web + Tauri), Supabase Postgres, Zustand, Vitest + jsdom, `@testing-library/react`; LuaJIT (`readest.koplugin`) with busted specs.

**Spec:** `apps/readest-app/.claude/plans/2026-06-18-sync-reading-status-design.md`

## Global Constraints

- **Status value set:** `ReadingStatus = 'unread' | 'reading' | 'finished' | 'abandoned'`; `undefined`/absent = no explicit status (plain progress bar). Copy these strings verbatim.
- **Readest ⇄ KOReader map:** `finished↔complete`, `reading↔reading`, `abandoned↔abandoned`, `unread→`clear `summary.status` (KOReader "New"); KOReader "New"/absent contributes no status (never overrides Readest).
- **Field-level LWW:** merge `reading_status` by `reading_status_updated_at` (ms), independent of `updated_at`; missing timestamp = `0` (oldest). Runs on **both** server upsert and client pull-merge.
- **Stamping rule:** set `reading_status_updated_at = now` **only when the status value actually changes** — never on a pure progress update.
- **`abandoned` is a visible badge** (label "On hold"), treated like `finished` (not like the intentionally badge-less `unread`).
- **TypeScript:** never use `any` (use `unknown`/proper types). Strict mode, ES2022.
- **TDD:** write the failing test first, watch it fail, implement minimally, watch it pass, commit. Frequent commits.
- **DB migration** is additive + nullable; new migration file number follows `014_add_reading_stats.sql` → `015_…`.
- **i18n:** new user-facing strings use the key-as-content `_()` flow; run `pnpm i18n:extract` and fill placeholders.
- **Verification gates:** `pnpm test`, `pnpm lint`; `pnpm lint:lua` + `pnpm test:lua` (koplugin changed). No `src-tauri/` changes (skip Rust gates).
- **Branch:** all work lands on `feat/sync-reading-status` (one PR). Implement A → B → C.

---

## Part A — Cloud field-level LWW

### Task A1: Types, transform mapping, and DB migration

**Files:**
- Modify: `apps/readest-app/src/types/book.ts:19` (ReadingStatus), `:114` (Book field)
- Modify: `apps/readest-app/src/types/records.ts:13` (DBBook field)
- Modify: `apps/readest-app/src/utils/transform.ts:66-105` (toDB), `:107-144` (fromDB)
- Modify: `docker/volumes/db/init/schema.sql:19`
- Create: `docker/volumes/db/migrations/015_add_reading_status_updated_at.sql`
- Test: `apps/readest-app/src/__tests__/utils/transform.test.ts` (add a describe block)

**Interfaces:**
- Produces: `ReadingStatus` now includes `'abandoned'`; `Book.readingStatusUpdatedAt?: number`; `DBBook.reading_status_updated_at?: string`; `transformBookToDB`/`transformBookFromDB` round-trip both new fields.

- [ ] **Step 1: Write the failing test** — append to `transform.test.ts`:

```ts
import { transformBookToDB, transformBookFromDB } from '@/utils/transform';
import type { Book } from '@/types/book';

describe('transformBook readingStatus + readingStatusUpdatedAt', () => {
  const userId = 'user-1';
  const baseBook: Book = {
    hash: 'h1',
    format: 'EPUB',
    title: 'T',
    author: 'A',
    createdAt: 1,
    updatedAt: 2,
  };

  it('serializes abandoned status + timestamp to ISO in the DB record', () => {
    const ts = Date.UTC(2026, 5, 18, 12, 0, 0);
    const db = transformBookToDB({ ...baseBook, readingStatus: 'abandoned', readingStatusUpdatedAt: ts }, userId);
    expect(db.reading_status).toBe('abandoned');
    expect(db.reading_status_updated_at).toBe(new Date(ts).toISOString());
  });

  it('leaves reading_status_updated_at null when unset', () => {
    const db = transformBookToDB({ ...baseBook, readingStatus: 'finished' }, userId);
    expect(db.reading_status_updated_at).toBeNull();
  });

  it('round-trips abandoned + timestamp back to the client shape', () => {
    const ts = Date.UTC(2026, 5, 18, 12, 0, 0);
    const db = transformBookToDB({ ...baseBook, readingStatus: 'abandoned', readingStatusUpdatedAt: ts }, userId);
    const back = transformBookFromDB(db);
    expect(back.readingStatus).toBe('abandoned');
    expect(back.readingStatusUpdatedAt).toBe(ts);
  });

  it('reads undefined readingStatusUpdatedAt when the DB column is null', () => {
    const back = transformBookFromDB({
      user_id: userId, book_hash: 'h1', format: 'EPUB', title: 'T', author: 'A',
      reading_status: 'finished', reading_status_updated_at: null as unknown as undefined,
      created_at: new Date(1).toISOString(), updated_at: new Date(2).toISOString(),
    });
    expect(back.readingStatusUpdatedAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/readest-app && pnpm test -- src/__tests__/utils/transform.test.ts`
Expected: FAIL — `reading_status_updated_at` is `undefined`/not mapped (and TS may error on the new fields).

- [ ] **Step 3: Extend the types**

In `src/types/book.ts` line 19:

```ts
export type ReadingStatus = 'unread' | 'reading' | 'finished' | 'abandoned';
```

In `src/types/book.ts`, directly after the `readingStatus?: ReadingStatus;` line (114):

```ts
  readingStatus?: ReadingStatus;
  readingStatusUpdatedAt?: number; // ms; bumped only when readingStatus changes
```

In `src/types/records.ts`, directly after `reading_status?: string;` (13):

```ts
  reading_status?: string;
  reading_status_updated_at?: string;
```

- [ ] **Step 4: Map both directions in `transform.ts`**

In `transformBookToDB`, add `readingStatusUpdatedAt` to the destructure (after `readingStatus,`) and add to the returned object (after the `reading_status: readingStatus,` line):

```ts
    reading_status: readingStatus,
    reading_status_updated_at: readingStatusUpdatedAt
      ? new Date(readingStatusUpdatedAt).toISOString()
      : null,
```

In `transformBookFromDB`, add `reading_status_updated_at` to the destructure (after `reading_status,`) and add to the returned object (after the `readingStatus: reading_status as ReadingStatus,` line):

```ts
    readingStatus: reading_status as ReadingStatus,
    readingStatusUpdatedAt: reading_status_updated_at
      ? new Date(reading_status_updated_at).getTime()
      : undefined,
```

- [ ] **Step 5: Add the schema column + migration**

In `docker/volumes/db/init/schema.sql`, add after the `reading_status text NULL,` line (19):

```sql
  reading_status text NULL,
  reading_status_updated_at timestamp with time zone NULL,
```

Create `docker/volumes/db/migrations/015_add_reading_status_updated_at.sql`:

```sql
-- Migration 015: Add `reading_status_updated_at` to books
--
-- Field-level last-writer-wins for reading_status. The books row carries
-- both reading_status (rare, intentional) and a denormalized progress
-- (every page turn) under one updated_at, so whole-row LWW lets progress
-- updates clobber a status change across devices (issue #4634). A dedicated
-- per-field timestamp lets the merge resolve reading_status independently.
-- Additive + nullable; NULL is treated as epoch 0 (oldest) by the merge.

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS reading_status_updated_at timestamp with time zone NULL;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/readest-app && pnpm test -- src/__tests__/utils/transform.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/readest-app/src/types/book.ts apps/readest-app/src/types/records.ts \
  apps/readest-app/src/utils/transform.ts apps/readest-app/src/__tests__/utils/transform.test.ts \
  docker/volumes/db/init/schema.sql docker/volumes/db/migrations/015_add_reading_status_updated_at.sql
git commit -m "feat(sync): add reading_status_updated_at for field-level status LWW (#4634)"
```

---

### Task A2: Stamp the status timestamp only on a real status change

**Files:**
- Modify: `apps/readest-app/src/store/libraryStore.ts:105-122` (`updateBookProgress`)
- Test: `apps/readest-app/src/__tests__/store/library-store.test.ts` (add to the `updateBookProgress` describe)

**Interfaces:**
- Consumes: `Book.readingStatusUpdatedAt` (Task A1).
- Produces: `updateBookProgress(hash, progress, readingStatus)` sets `readingStatusUpdatedAt = Date.now()` iff `readingStatus !== book.readingStatus`, else preserves the prior value.

- [ ] **Step 1: Write the failing test** — add inside `describe('updateBookProgress', …)`:

```ts
    test('stamps readingStatusUpdatedAt when the status changes', () => {
      useLibraryStore.getState().setLibrary([makeBook({ hash: 'a', readingStatus: undefined })]);
      useLibraryStore.getState().updateBookProgress('a', [100, 100], 'finished');
      const book = useLibraryStore.getState().getBookByHash('a');
      expect(book?.readingStatus).toBe('finished');
      expect(book?.readingStatusUpdatedAt).toBeGreaterThan(0);
    });

    test('does NOT change readingStatusUpdatedAt on a progress-only update', () => {
      useLibraryStore.getState().setLibrary([
        makeBook({ hash: 'a', readingStatus: 'reading', readingStatusUpdatedAt: 111 }),
      ]);
      useLibraryStore.getState().updateBookProgress('a', [50, 100], 'reading');
      const book = useLibraryStore.getState().getBookByHash('a');
      expect(book?.readingStatusUpdatedAt).toBe(111);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/readest-app && pnpm test -- src/__tests__/store/library-store.test.ts`
Expected: FAIL — `readingStatusUpdatedAt` is `undefined` (not stamped / not preserved).

- [ ] **Step 3: Update `updateBookProgress`**

Replace the `updatedBook` construction in `libraryStore.ts` (105-122):

```ts
  updateBookProgress: (hash, progress, readingStatus) => {
    const { library, hashIndex } = get();
    const idx = hashIndex.get(hash);
    if (idx === undefined) return;
    const book = library[idx]!;
    const statusChanged = readingStatus !== book.readingStatus;
    const updatedBook: Book = {
      ...book,
      progress,
      readingStatus,
      readingStatusUpdatedAt: statusChanged ? Date.now() : book.readingStatusUpdatedAt,
      updatedAt: Date.now(),
    };
    const newLibrary = library.slice();
    newLibrary[idx] = updatedBook;
    set({
      library: newLibrary,
      visibleLibrary: newLibrary.filter((b) => !b.deletedAt),
    });
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/readest-app && pnpm test -- src/__tests__/store/library-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/store/libraryStore.ts apps/readest-app/src/__tests__/store/library-store.test.ts
git commit -m "feat(sync): stamp readingStatusUpdatedAt on status change in updateBookProgress"
```

---

### Task A3: `withReadingStatus` helper + wire explicit edits

**Files:**
- Modify: `apps/readest-app/src/app/library/utils/libraryUtils.ts` (add helper near `getBookContextMenuItemIds`)
- Modify: `apps/readest-app/src/app/library/components/Bookshelf.tsx:545` and `:560`
- Test: `apps/readest-app/src/__tests__/app/library/book-context-menu.test.ts` (or a new `reading-status-helper.test.ts`)

**Interfaces:**
- Produces: `withReadingStatus(book: Book, status: ReadingStatus | undefined): Book` — returns a copy with `readingStatus`, `readingStatusUpdatedAt`, and `updatedAt` all set to the new status / `Date.now()`.

- [ ] **Step 1: Write the failing test** — create `apps/readest-app/src/__tests__/app/library/reading-status-helper.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { withReadingStatus } from '@/app/library/utils/libraryUtils';
import type { Book } from '@/types/book';

const book: Book = {
  hash: 'h1', format: 'EPUB', title: 'T', author: 'A',
  createdAt: 1, updatedAt: 2, readingStatus: undefined,
};

describe('withReadingStatus', () => {
  it('sets status, stamps readingStatusUpdatedAt = updatedAt, and does not mutate input', () => {
    const out = withReadingStatus(book, 'abandoned');
    expect(out.readingStatus).toBe('abandoned');
    expect(out.readingStatusUpdatedAt).toBe(out.updatedAt);
    expect(out.readingStatusUpdatedAt).toBeGreaterThan(0);
    expect(book.readingStatus).toBeUndefined(); // input untouched
  });

  it('clears the status when undefined is passed but still stamps the timestamp', () => {
    const out = withReadingStatus({ ...book, readingStatus: 'finished' }, undefined);
    expect(out.readingStatus).toBeUndefined();
    expect(out.readingStatusUpdatedAt).toBe(out.updatedAt);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/readest-app && pnpm test -- src/__tests__/app/library/reading-status-helper.test.ts`
Expected: FAIL — `withReadingStatus` is not exported.

- [ ] **Step 3: Add the helper** — in `libraryUtils.ts`, just above `export const getBookContextMenuItemIds` (the `Book` and `ReadingStatus` types are already imported there; if `ReadingStatus` is not imported, add it to the existing `@/types/book` import):

```ts
/**
 * Build a new Book with an explicit reading status. Stamps both `updatedAt`
 * (so the library sync picks it up) and `readingStatusUpdatedAt` (so the
 * field-level merge resolves status independently of progress). Use this for
 * every deliberate status edit so the timestamp is never forgotten.
 */
export const withReadingStatus = (book: Book, status: ReadingStatus | undefined): Book => {
  const now = Date.now();
  return { ...book, readingStatus: status, readingStatusUpdatedAt: now, updatedAt: now };
};
```

- [ ] **Step 4: Wire `Bookshelf.tsx`** — replace the body of `updateBooksStatus`'s push (line 545):

```ts
        booksToUpdate.push(withReadingStatus(book, status));
```

and `handleUpdateReadingStatus` (line 560):

```ts
      const updatedBook = withReadingStatus(book, status);
```

Add `withReadingStatus` to the existing `@/app/library/utils/libraryUtils` import in `Bookshelf.tsx`.

- [ ] **Step 5: Run test + typecheck**

Run: `cd apps/readest-app && pnpm test -- src/__tests__/app/library/reading-status-helper.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/readest-app/src/app/library/utils/libraryUtils.ts \
  apps/readest-app/src/app/library/components/Bookshelf.tsx \
  apps/readest-app/src/__tests__/app/library/reading-status-helper.test.ts
git commit -m "feat(sync): stamp status timestamp on explicit library status edits"
```

---

### Task A4: Client pull-merge resolves status by its own timestamp

**Files:**
- Modify: `apps/readest-app/src/app/library/utils/libraryUtils.ts` (add `pickFresherReadingStatus`)
- Modify: `apps/readest-app/src/app/library/hooks/useBooksSync.ts:122-135` (`processOldBook`)
- Test: `apps/readest-app/src/__tests__/app/library/reading-status-helper.test.ts`

**Interfaces:**
- Consumes: `withReadingStatus` (A3).
- Produces: `pickFresherReadingStatus(a, b): { readingStatus?: ReadingStatus; readingStatusUpdatedAt?: number }` — returns the status side with the greater `readingStatusUpdatedAt` (ties → `a`). Used by `processOldBook` after the whole-object LWW.

- [ ] **Step 1: Write the failing test** — append to `reading-status-helper.test.ts`:

```ts
import { pickFresherReadingStatus } from '@/app/library/utils/libraryUtils';

describe('pickFresherReadingStatus', () => {
  it('keeps the status whose timestamp is newer, even if the other object is newer overall', () => {
    const local = { readingStatus: 'finished' as const, readingStatusUpdatedAt: 200 };
    const remote = { readingStatus: undefined, readingStatusUpdatedAt: 100 };
    expect(pickFresherReadingStatus(local, remote)).toEqual({
      readingStatus: 'finished', readingStatusUpdatedAt: 200,
    });
  });

  it('treats a missing timestamp as oldest', () => {
    const local = { readingStatus: undefined, readingStatusUpdatedAt: undefined };
    const remote = { readingStatus: 'abandoned' as const, readingStatusUpdatedAt: 5 };
    expect(pickFresherReadingStatus(local, remote)).toEqual({
      readingStatus: 'abandoned', readingStatusUpdatedAt: 5,
    });
  });

  it('prefers the first argument on a timestamp tie', () => {
    const a = { readingStatus: 'reading' as const, readingStatusUpdatedAt: 50 };
    const b = { readingStatus: 'finished' as const, readingStatusUpdatedAt: 50 };
    expect(pickFresherReadingStatus(a, b).readingStatus).toBe('reading');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/readest-app && pnpm test -- src/__tests__/app/library/reading-status-helper.test.ts`
Expected: FAIL — `pickFresherReadingStatus` is not exported.

- [ ] **Step 3: Add the helper** — in `libraryUtils.ts`, below `withReadingStatus`:

```ts
type ReadingStatusFields = Pick<Book, 'readingStatus' | 'readingStatusUpdatedAt'>;

/**
 * Field-level last-writer-wins for reading status: return whichever side's
 * status was set more recently (ties → `a`). Missing timestamp = epoch 0.
 * The book row's `updatedAt` is dominated by page-turn progress, so status
 * must be resolved by its own timestamp or progress would clobber it.
 */
export const pickFresherReadingStatus = (
  a: ReadingStatusFields,
  b: ReadingStatusFields,
): ReadingStatusFields => {
  const at = (x: ReadingStatusFields) => x.readingStatusUpdatedAt ?? 0;
  const winner = at(a) >= at(b) ? a : b;
  return { readingStatus: winner.readingStatus, readingStatusUpdatedAt: winner.readingStatusUpdatedAt };
};
```

- [ ] **Step 4: Wire `processOldBook`** — in `useBooksSync.ts`, replace the `mergedBook` return (122-135) so the field-level status override runs after the whole-object LWW. Add `pickFresherReadingStatus` to the `@/app/library/utils/libraryUtils` import (create the import if absent):

```ts
    const processOldBook = async (oldBook: Book) => {
      const matchingBook = syncedBooks.find((newBook) => newBook.hash === oldBook.hash);
      if (matchingBook) {
        if (!matchingBook.deletedAt && matchingBook.uploadedAt && !oldBook.coverDownloadedAt) {
          oldBook.coverImageUrl = await appService?.generateCoverImageUrl(oldBook);
        }
        const mergedBook =
          matchingBook.updatedAt >= oldBook.updatedAt
            ? { ...oldBook, ...matchingBook, syncedAt: Date.now() }
            : { ...matchingBook, ...oldBook, syncedAt: Date.now() };
        // Status is resolved by its own timestamp, independent of the row's
        // updatedAt (which page-turn progress dominates) — see #4634.
        const status = pickFresherReadingStatus(oldBook, matchingBook);
        mergedBook.readingStatus = status.readingStatus;
        mergedBook.readingStatusUpdatedAt = status.readingStatusUpdatedAt;
        return mergedBook;
      }
      return oldBook;
    };
```

- [ ] **Step 5: Run test + full suite**

Run: `cd apps/readest-app && pnpm test -- src/__tests__/app/library/reading-status-helper.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/readest-app/src/app/library/utils/libraryUtils.ts \
  apps/readest-app/src/app/library/hooks/useBooksSync.ts \
  apps/readest-app/src/__tests__/app/library/reading-status-helper.test.ts
git commit -m "feat(sync): resolve reading status by its own timestamp in client pull-merge"
```

---

### Task A5: Server upsert resolves status by its own timestamp

**Files:**
- Modify: `apps/readest-app/src/pages/api/sync.ts` (add `resolveReadingStatusMerge` near `pickWinningPages`; wire the `books` branch of `upsertRecords`)
- Test: `apps/readest-app/src/__tests__/pages/api/sync-reading-status.test.ts` (new)

**Interfaces:**
- Consumes: `DBBook` (A1).
- Produces: `resolveReadingStatusMerge(client, server): { reading_status?: string; reading_status_updated_at?: string }` — returns the status fields with the greater `reading_status_updated_at` (ties → client). Exported for tests.

- [ ] **Step 1: Write the failing test** — create `apps/readest-app/src/__tests__/pages/api/sync-reading-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveReadingStatusMerge } from '@/pages/api/sync';

const iso = (ms: number) => new Date(ms).toISOString();

describe('resolveReadingStatusMerge', () => {
  it('keeps the client status when its status timestamp is newer', () => {
    const out = resolveReadingStatusMerge(
      { reading_status: 'finished', reading_status_updated_at: iso(200) },
      { reading_status: 'reading', reading_status_updated_at: iso(100) },
    );
    expect(out).toEqual({ reading_status: 'finished', reading_status_updated_at: iso(200) });
  });

  it('keeps the server status when its status timestamp is newer', () => {
    const out = resolveReadingStatusMerge(
      { reading_status: 'reading', reading_status_updated_at: iso(100) },
      { reading_status: 'finished', reading_status_updated_at: iso(300) },
    );
    expect(out).toEqual({ reading_status: 'finished', reading_status_updated_at: iso(300) });
  });

  it('treats a missing timestamp as oldest (server wins over an unstamped client)', () => {
    const out = resolveReadingStatusMerge(
      { reading_status: undefined, reading_status_updated_at: undefined },
      { reading_status: 'abandoned', reading_status_updated_at: iso(1) },
    );
    expect(out.reading_status).toBe('abandoned');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/readest-app && pnpm test -- src/__tests__/pages/api/sync-reading-status.test.ts`
Expected: FAIL — `resolveReadingStatusMerge` is not exported.

- [ ] **Step 3: Add the helper** — in `sync.ts`, after `pickWinningPages` (38):

```ts
/**
 * Field-level last-writer-wins for a books row's reading_status: return the
 * status fields with the newer reading_status_updated_at (ties → client). NULL
 * timestamp = epoch 0. Lets reading_status survive even when the whole row is
 * decided the other way by updated_at (which page-turn progress dominates) —
 * issue #4634.
 */
export function resolveReadingStatusMerge(
  client: Pick<DBBook, 'reading_status' | 'reading_status_updated_at'>,
  server: Pick<DBBook, 'reading_status' | 'reading_status_updated_at'>,
): Pick<DBBook, 'reading_status' | 'reading_status_updated_at'> {
  const ms = (s?: string | null) => (s ? new Date(s).getTime() : 0);
  return ms(client.reading_status_updated_at) >= ms(server.reading_status_updated_at)
    ? { reading_status: client.reading_status, reading_status_updated_at: client.reading_status_updated_at }
    : { reading_status: server.reading_status, reading_status_updated_at: server.reading_status_updated_at };
}
```

- [ ] **Step 4: Wire the `books` branch of `upsertRecords`** — in `sync.ts`, replace the `else` block that compares `clientIsNewer` (the block at ~369-386) so `books` resolves status independently. Use this exact structure:

```ts
        } else {
          const clientUpdatedAt = dbRec.updated_at ? new Date(dbRec.updated_at).getTime() : 0;
          const serverUpdatedAt = serverData.updated_at
            ? new Date(serverData.updated_at).getTime()
            : 0;
          const clientDeletedAt = dbRec.deleted_at ? new Date(dbRec.deleted_at).getTime() : 0;
          const serverDeletedAt = serverData.deleted_at
            ? new Date(serverData.deleted_at).getTime()
            : 0;
          const clientIsNewer =
            clientDeletedAt > serverDeletedAt || clientUpdatedAt > serverUpdatedAt;

          if (table === 'books') {
            const status = resolveReadingStatusMerge(dbRec as DBBook, serverData as DBBook);
            if (clientIsNewer) {
              // Client wins the row; graft the fresher status onto it (server's
              // status may be the newer one even though the row is older).
              (dbRec as DBBook).reading_status = status.reading_status;
              (dbRec as DBBook).reading_status_updated_at = status.reading_status_updated_at;
              toUpdate.push(dbRec);
            } else {
              const sd = serverData as DBBook;
              // Only rewrite when the resolved status VALUE differs from the
              // server's — a timestamp-only difference on the same value is a
              // no-op, and rewriting it would churn updated_at + re-propagate.
              const statusChanged = status.reading_status !== sd.reading_status;
              if (statusChanged) {
                // Server wins the row, but the client's status is newer. Write
                // server's row with the fresher status and bump updated_at so
                // peers re-pull the status change.
                toUpdate.push({
                  ...sd,
                  reading_status: status.reading_status,
                  reading_status_updated_at: status.reading_status_updated_at,
                  updated_at: new Date().toISOString(),
                } as DBBook);
              } else {
                batchAuthoritativeRecords.push(serverData);
              }
            }
          } else if (clientIsNewer) {
            toUpdate.push(dbRec);
          } else {
            batchAuthoritativeRecords.push(serverData);
          }
        }
```

- [ ] **Step 5: Run test + full suite**

Run: `cd apps/readest-app && pnpm test -- src/__tests__/pages/api/sync-reading-status.test.ts && pnpm test`
Expected: PASS (and no regressions).

- [ ] **Step 6: Commit**

```bash
git add apps/readest-app/src/pages/api/sync.ts apps/readest-app/src/__tests__/pages/api/sync-reading-status.test.ts
git commit -m "feat(sync): resolve reading status by its own timestamp in server upsert (#4634)"
```

---

## Part B — `abandoned` status in the Readest UI

### Task B1: Render the `abandoned` badge

**Files:**
- Modify: `apps/readest-app/src/app/library/components/StatusBadge.tsx`
- Modify: `apps/readest-app/src/app/library/components/ReadingProgress.tsx:28-46`
- Test: `apps/readest-app/src/__tests__/app/library/status-badge.test.tsx` (new)

**Interfaces:**
- Consumes: `ReadingStatus` incl. `'abandoned'` (A1).
- Produces: `StatusBadge` renders for `finished | unread | abandoned` (returns `null` otherwise); `ReadingProgress` shows the "On hold" badge for `abandoned`.

- [ ] **Step 1: Write the failing test** — create `status-badge.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import StatusBadge from '@/app/library/components/StatusBadge';

describe('StatusBadge', () => {
  it('renders children for the abandoned status', () => {
    const { queryByText } = render(<StatusBadge status='abandoned'>On hold</StatusBadge>);
    expect(queryByText('On hold')).not.toBeNull();
  });

  it('renders nothing for the reading status', () => {
    const { container } = render(<StatusBadge status='reading'>x</StatusBadge>);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/readest-app && pnpm test -- src/__tests__/app/library/status-badge.test.tsx`
Expected: FAIL — `abandoned` returns `null` (guard excludes it).

- [ ] **Step 3: Update `StatusBadge.tsx`** — replace the early return and the class block so `abandoned` is supported. Replace the body from `if (status !== 'finished' && status !== 'unread') return null;` through the closing of the `clsx(...)` call with:

```tsx
  if (status !== 'finished' && status !== 'unread' && status !== 'abandoned') return null;

  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center',
        'rounded-[1px] px-0.5',
        'text-[8px] font-bold uppercase leading-none tracking-wider',
        'h-3.5',
        status === 'finished' && 'status-badge-finished',
        status === 'unread' && 'status-badge-unread',
        status === 'abandoned' && 'status-badge-abandoned',
        // finished: green/emerald
        status === 'finished' && 'bg-emerald-100 dark:bg-emerald-900/90',
        status === 'finished' && 'border border-emerald-300/50 dark:border-emerald-700/50',
        status === 'finished' && 'text-emerald-700 dark:text-emerald-300',
        // unread: pastel yellow/amber
        status === 'unread' && 'bg-amber-100 dark:bg-amber-900/80',
        status === 'unread' && 'border border-amber-300/50 dark:border-amber-700/50',
        status === 'unread' && 'text-amber-700 dark:text-amber-300',
        // abandoned / on hold: slate
        status === 'abandoned' && 'bg-slate-100 dark:bg-slate-800/80',
        status === 'abandoned' && 'border border-slate-300/50 dark:border-slate-600/50',
        status === 'abandoned' && 'text-slate-700 dark:text-slate-300',
        className,
      )}
      role='status'
    >
      <span className='relative top-[0.5px]'>{children}</span>
    </span>
  );
```

(Remove the now-unused `const isFinished = …` line.)

- [ ] **Step 4: Update `ReadingProgress.tsx`** — add an `abandoned` branch directly after the `finished` branch (before the `unread` branch). Show the badge alongside the percentage so the on-hold book keeps its progress:

```tsx
    if (book.readingStatus === 'abandoned') {
      return (
        <div
          className='text-neutral-content/70 flex items-center justify-between gap-2 text-xs'
          role='status'
        >
          <StatusBadge status={book.readingStatus}>{_('On hold')}</StatusBadge>
          {progressPercentage !== null && !Number.isNaN(progressPercentage) && (
            <span>{progressPercentage}%</span>
          )}
        </div>
      );
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/readest-app && pnpm test -- src/__tests__/app/library/status-badge.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/readest-app/src/app/library/components/StatusBadge.tsx \
  apps/readest-app/src/app/library/components/ReadingProgress.tsx \
  apps/readest-app/src/__tests__/app/library/status-badge.test.tsx
git commit -m "feat(library): render the 'On hold' (abandoned) status badge"
```

---

### Task B2: Context-menu + batch actions for `abandoned`, plus i18n

**Files:**
- Modify: `apps/readest-app/src/app/library/utils/libraryUtils.ts` (`BookContextMenuItemId`, `getBookContextMenuItemIds`)
- Modify: `apps/readest-app/src/app/library/components/BookshelfItem.tsx:243-263`
- Modify: `apps/readest-app/src/app/library/components/SetStatusAlert.tsx:24-43`
- Test: `apps/readest-app/src/__tests__/app/library/book-context-menu.test.ts`

**Interfaces:**
- Consumes: `withReadingStatus` (A3), `'abandoned'` status (A1).
- Produces: `'markAbandoned'` menu id; offered when `readingStatus !== 'abandoned'`; `clearStatus` now also offered for `abandoned`.

- [ ] **Step 1: Write the failing test** — update existing cases and add an abandoned case in `book-context-menu.test.ts`. Replace the "local downloaded book" and "finished book" expectations and add a new test:

```ts
  it('returns a deterministic order for a local downloaded book', () => {
    const book = createBook({ downloadedAt: 1 });
    expect(getBookContextMenuItemIds(book)).toEqual([
      'select', 'group', 'markFinished', 'markAbandoned',
      'showDetails', 'showInFinder', 'searchGoodreads', 'upload', 'share', 'delete',
    ]);
  });

  it('shows markUnread + markAbandoned + clearStatus for a finished book', () => {
    const book = createBook({ downloadedAt: 1, readingStatus: 'finished' });
    expect(getBookContextMenuItemIds(book)).toEqual([
      'select', 'group', 'markUnread', 'markAbandoned', 'clearStatus',
      'showDetails', 'showInFinder', 'searchGoodreads', 'upload', 'share', 'delete',
    ]);
  });

  it('hides markAbandoned but offers markFinished + clearStatus for an abandoned book', () => {
    const book = createBook({ downloadedAt: 1, readingStatus: 'abandoned' });
    expect(getBookContextMenuItemIds(book)).toEqual([
      'select', 'group', 'markFinished', 'clearStatus',
      'showDetails', 'showInFinder', 'searchGoodreads', 'upload', 'share', 'delete',
    ]);
  });
```

(Update the existing "unread book" case to include `'markAbandoned'` after `'markFinished'`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/readest-app && pnpm test -- src/__tests__/app/library/book-context-menu.test.ts`
Expected: FAIL — `markAbandoned` not produced.

- [ ] **Step 3: Update `libraryUtils.ts`** — add `| 'markAbandoned'` to the `BookContextMenuItemId` union (after `'markUnread'`), and update `getBookContextMenuItemIds`:

```ts
export const getBookContextMenuItemIds = (book: Book): BookContextMenuItemId[] => {
  const ids: BookContextMenuItemId[] = ['select', 'group'];
  ids.push(book.readingStatus === 'finished' ? 'markUnread' : 'markFinished');
  if (book.readingStatus !== 'abandoned') ids.push('markAbandoned');
  // "Clear Status" is offered only when the book has an explicit status set.
  if (
    book.readingStatus === 'finished' ||
    book.readingStatus === 'unread' ||
    book.readingStatus === 'abandoned'
  ) {
    ids.push('clearStatus');
  }
  ids.push('showDetails', 'showInFinder', 'searchGoodreads');
  if (book.uploadedAt && !book.downloadedAt) ids.push('download');
  if (!book.uploadedAt && book.downloadedAt) ids.push('upload');
  if (book.downloadedAt || book.uploadedAt) ids.push('share');
  ids.push('delete');
  return ids;
};
```

- [ ] **Step 4: Add the menu entry** — in `BookshelfItem.tsx`, after the `markUnread` entry (254-257):

```ts
      markAbandoned: {
        text: _('Mark as On hold'),
        action: async () => {
          handleUpdateReadingStatus(book, 'abandoned');
        },
      },
```

- [ ] **Step 5: Add the batch button** — in `SetStatusAlert.tsx`, insert into `statusButtons` before the "Clear Status" entry:

```ts
    {
      label: _('Mark as On hold'),
      status: 'abandoned' as ReadingStatus,
      className:
        'not-eink:bg-slate-500/15 not-eink:text-slate-600 dark:not-eink:text-slate-300 not-eink:border-slate-500/20 eink-bordered',
    },
```

- [ ] **Step 6: Run the context-menu test**

Run: `cd apps/readest-app && pnpm test -- src/__tests__/app/library/book-context-menu.test.ts`
Expected: PASS.

- [ ] **Step 7: Extract i18n strings**

Run: `cd apps/readest-app && pnpm i18n:extract`
Then open the locale files under `src/locales/*/translation.json`, find the new `__STRING_NOT_TRANSLATED__` placeholders for `"On hold"` and `"Mark as On hold"`, and translate them (or invoke the project `/i18n` skill which fills placeholders). English (`en`) is key-as-content, so its value equals the key.

- [ ] **Step 8: Commit**

```bash
git add apps/readest-app/src/app/library/utils/libraryUtils.ts \
  apps/readest-app/src/app/library/components/BookshelfItem.tsx \
  apps/readest-app/src/app/library/components/SetStatusAlert.tsx \
  apps/readest-app/src/__tests__/app/library/book-context-menu.test.ts \
  apps/readest-app/src/locales
git commit -m "feat(library): add 'Mark as On hold' actions + i18n for abandoned status"
```

---

## Part C — KOReader status bridge (readest.koplugin)

### Task C1: `readingstatus.lua` — mapping + reconcile (pure)

**Files:**
- Create: `apps/readest.koplugin/library/readingstatus.lua`
- Test: `apps/readest.koplugin/spec/library/readingstatus_spec.lua` (new)

**Interfaces:**
- Produces:
  - `readest_to_ko(status) → "complete"|"reading"|"abandoned"|nil`
  - `ko_to_readest(status) → "finished"|"reading"|"abandoned"|nil`
  - `parse_modified_ms("YYYY-MM-DD") → ms|nil`
  - `reconcile(cloud, ko) → { action = "none"|"apply_to_ko"|"apply_to_store", readest_status, ko_status, ts }` where `cloud = { reading_status, reading_status_updated_at }` (ms) and `ko = { status, ts }` (ko summary.status + ms).

- [ ] **Step 1: Write the failing spec** — create `spec/library/readingstatus_spec.lua`:

```lua
-- readingstatus_spec.lua — contract for library/readingstatus.lua
require("spec_helper")
local RS = require("library.readingstatus")

describe("readingstatus mapping", function()
  it("maps Readest -> KOReader", function()
    assert.are.equal("complete", RS.readest_to_ko("finished"))
    assert.are.equal("reading", RS.readest_to_ko("reading"))
    assert.are.equal("abandoned", RS.readest_to_ko("abandoned"))
    assert.is_nil(RS.readest_to_ko("unread"))
    assert.is_nil(RS.readest_to_ko(nil))
  end)

  it("maps KOReader -> Readest", function()
    assert.are.equal("finished", RS.ko_to_readest("complete"))
    assert.are.equal("reading", RS.ko_to_readest("reading"))
    assert.are.equal("abandoned", RS.ko_to_readest("abandoned"))
    assert.is_nil(RS.ko_to_readest(nil))   -- "new"/no status -> no opinion
  end)

  it("parses summary.modified to day ms", function()
    assert.are.equal(os.time({ year = 2026, month = 6, day = 18, hour = 0, min = 0, sec = 0 }) * 1000,
      RS.parse_modified_ms("2026-06-18"))
    assert.is_nil(RS.parse_modified_ms(nil))
    assert.is_nil(RS.parse_modified_ms("garbage"))
  end)
end)

describe("readingstatus reconcile", function()
  it("returns none when both sides already agree", function()
    local r = RS.reconcile({ reading_status = "finished", reading_status_updated_at = 100 },
                           { status = "complete", ts = 50 })
    assert.are.equal("none", r.action)
  end)

  it("applies cloud to KOReader when cloud status is newer", function()
    local r = RS.reconcile({ reading_status = "finished", reading_status_updated_at = 300 },
                           { status = "reading", ts = 100 })
    assert.are.equal("apply_to_ko", r.action)
    assert.are.equal("complete", r.ko_status)
    assert.are.equal("finished", r.readest_status)
    assert.are.equal(300, r.ts)
  end)

  it("applies KOReader to the store when the sidecar status is newer", function()
    local r = RS.reconcile({ reading_status = "reading", reading_status_updated_at = 100 },
                           { status = "complete", ts = 300 })
    assert.are.equal("apply_to_store", r.action)
    assert.are.equal("finished", r.readest_status)
    assert.are.equal(300, r.ts)
  end)

  it("never lets a KOReader 'new'/no-status book override an existing Readest status", function()
    local r = RS.reconcile({ reading_status = "finished", reading_status_updated_at = 10 },
                           { status = nil, ts = 9999 })
    assert.are.equal("apply_to_ko", r.action)  -- push cloud status down, KO has no opinion
  end)

  it("captures a KOReader status when Readest has none", function()
    local r = RS.reconcile({ reading_status = nil, reading_status_updated_at = nil },
                           { status = "abandoned", ts = 5 })
    assert.are.equal("apply_to_store", r.action)
    assert.are.equal("abandoned", r.readest_status)
  end)

  it("converges: after applying the winner to both sides, reconcile is a no-op", function()
    local r = RS.reconcile({ reading_status = "reading", reading_status_updated_at = 100 },
                           { status = "complete", ts = 300 })
    -- emulate equalization: store now holds the winner, sidecar already had it
    local r2 = RS.reconcile({ reading_status = r.readest_status, reading_status_updated_at = r.ts },
                            { status = "complete", ts = 300 })
    assert.are.equal("none", r2.action)
  end)
end)
```

- [ ] **Step 2: Run spec to verify it fails**

Run: `cd apps/readest-app && pnpm test:lua -- spec/library/readingstatus_spec.lua` (or from repo root `pnpm test:lua`)
Expected: FAIL — module `library.readingstatus` not found.

- [ ] **Step 3: Implement `library/readingstatus.lua`**

```lua
-- readingstatus.lua — pure bidirectional mapping + reconcile between
-- Readest's reading_status and KOReader's summary.status. No KOReader globals
-- so it unit-tests cleanly under busted.
local M = {}

local READEST_TO_KO = { finished = "complete", reading = "reading", abandoned = "abandoned" }
local KO_TO_READEST = { complete = "finished", reading = "reading", abandoned = "abandoned" }

-- Readest reading_status -> KOReader summary.status (nil = clear / "New").
function M.readest_to_ko(status)
    if status == nil then return nil end
    return READEST_TO_KO[status]  -- 'unread' -> nil (not in the table)
end

-- KOReader summary.status -> Readest reading_status (nil = KO has no opinion).
function M.ko_to_readest(status)
    if status == nil then return nil end
    return KO_TO_READEST[status]
end

-- "YYYY-MM-DD" -> unix ms at local midnight; nil if unparseable.
function M.parse_modified_ms(s)
    if type(s) ~= "string" then return nil end
    local y, mo, d = s:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)")
    if not y then return nil end
    local t = os.time({ year = tonumber(y), month = tonumber(mo), day = tonumber(d),
                        hour = 0, min = 0, sec = 0 })
    if not t then return nil end
    return t * 1000
end

-- Decide what (if anything) to write. cloud = { reading_status,
-- reading_status_updated_at(ms) }; ko = { status(ko summary.status), ts(ms) }.
-- Returns { action, readest_status, ko_status, ts }. The caller equalizes both
-- sides to (readest_status, ts) so the next reconcile is a no-op (convergence).
function M.reconcile(cloud, ko)
    cloud = cloud or {}
    ko = ko or {}
    local cloud_status = cloud.reading_status
    local ko_readest = M.ko_to_readest(ko.status)  -- nil if KO has no explicit status

    if cloud_status == ko_readest then
        return { action = "none" }
    end

    -- KO has no opinion (new/nil): push the cloud status down if one exists.
    if ko_readest == nil then
        if cloud_status == nil then return { action = "none" } end
        return {
            action = "apply_to_ko",
            readest_status = cloud_status,
            ko_status = M.readest_to_ko(cloud_status),
            ts = cloud.reading_status_updated_at or 0,
        }
    end

    -- Readest has no status but KO does: capture it.
    if cloud_status == nil then
        return { action = "apply_to_store", readest_status = ko_readest, ts = ko.ts or 0 }
    end

    -- Both have differing explicit statuses: newer timestamp wins (tie → cloud).
    local cloud_ts = cloud.reading_status_updated_at or 0
    local ko_ts = ko.ts or 0
    if cloud_ts >= ko_ts then
        return {
            action = "apply_to_ko",
            readest_status = cloud_status,
            ko_status = M.readest_to_ko(cloud_status),
            ts = cloud_ts,
        }
    end
    return { action = "apply_to_store", readest_status = ko_readest, ts = ko_ts }
end

return M
```

- [ ] **Step 4: Run spec to verify it passes**

Run: `cd apps/readest-app && pnpm test:lua -- spec/library/readingstatus_spec.lua`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/readest.koplugin/library/readingstatus.lua apps/readest.koplugin/spec/library/readingstatus_spec.lua
git commit -m "feat(koplugin): add reading-status mapping + reconcile between Readest and KOReader"
```

---

### Task C2: `LibraryStore` column + migration + wire `reading_status_updated_at`

**Files:**
- Modify: `apps/readest.koplugin/library/librarystore.lua` (SCHEMA_SQL, SCHEMA_VERSION, BOOK_COLS, NUMERIC_COLS, `M.new` migration, `parseSyncRow`)
- Modify: `apps/readest.koplugin/library/syncbooks.lua` (`row_to_wire`)
- Test: `apps/readest.koplugin/spec/library/librarystore_spec.lua`, `apps/readest.koplugin/spec/library/syncbooks_spec.lua`

**Interfaces:**
- Consumes: nothing new.
- Produces: `books.reading_status_updated_at` (INTEGER ms) persisted + round-tripped; `parseSyncRow` reads it from the server wire; `row_to_wire` emits `readingStatusUpdatedAt` (ms).

- [ ] **Step 1: Write the failing specs**

In `spec/library/librarystore_spec.lua`, add:

```lua
describe("reading_status_updated_at", function()
  it("round-trips reading_status_updated_at through upsert + read", function()
    local store = LibraryStore.new({ user_id = "u1", db_path = ":memory:" })
    store:upsertBook({ hash = "h1", title = "T", reading_status = "finished",
                       reading_status_updated_at = 1750000000000, local_present = 1 })
    local row = store:_getRowRaw("h1")
    assert.are.equal("finished", row.reading_status)
    assert.are.equal(1750000000000, row.reading_status_updated_at)
    store:close()
  end)

  it("parseSyncRow reads reading_status_updated_at from the server ISO field", function()
    local parsed = LibraryStore.parseSyncRow({
      book_hash = "h2", title = "T", reading_status = "abandoned",
      reading_status_updated_at = "2026-06-18T00:00:00+00:00", updated_at = "2026-06-18T00:00:00+00:00",
    })
    assert.is_truthy(parsed.reading_status_updated_at)
    assert.are.equal("abandoned", parsed.reading_status)
  end)
end)
```

In `spec/library/syncbooks_spec.lua`, add (using the existing `M._row_to_wire` export):

```lua
it("emits readingStatusUpdatedAt in the wire payload", function()
  local wire = syncbooks._row_to_wire({ hash = "h1", title = "T",
    reading_status = "finished", reading_status_updated_at = 1750000000000 })
  assert.are.equal("finished", wire.readingStatus)
  assert.are.equal(1750000000000, wire.readingStatusUpdatedAt)
end)
```

- [ ] **Step 2: Run specs to verify they fail**

Run: `cd apps/readest-app && pnpm test:lua`
Expected: FAIL — column/field missing.

- [ ] **Step 3: Update the schema + version + column lists** in `librarystore.lua`:

Set `local SCHEMA_VERSION = 2`. In `SCHEMA_SQL`, add after `reading_status   TEXT,`:

```sql
    reading_status   TEXT,
    reading_status_updated_at INTEGER,
```

Add `"reading_status_updated_at"` to `BOOK_COLS` (after `"reading_status"`) and `reading_status_updated_at = true` to `NUMERIC_COLS`.

- [ ] **Step 4: Add the migration in `M.new`** — replace the schema-init lines in `M.new`:

```lua
    self.db = SQ3.open(self.db_path)
    local prev = self:getUserVersion() or 0
    self.db:exec(SCHEMA_SQL)
    -- v1 -> v2: add reading_status_updated_at to existing DBs. CREATE TABLE
    -- IF NOT EXISTS won't add a column, so ALTER it in (pcall guards a DB that
    -- somehow already has the column).
    if prev >= 1 and prev < 2 then
        pcall(function()
            self.db:exec("ALTER TABLE books ADD COLUMN reading_status_updated_at INTEGER;")
        end)
    end
    self.db:exec(string.format("PRAGMA user_version = %d;", SCHEMA_VERSION))
```

- [ ] **Step 5: Read the field in `parseSyncRow`** — in `librarystore.lua`, after the `out.reading_status = …` line:

```lua
    out.reading_status = dbRow.readingStatus or dbRow.reading_status
    -- ms; server sends it as a timestamptz ISO string (iso_to_ms also passes
    -- through a raw number when a caller already supplied ms).
    out.reading_status_updated_at = iso_to_ms(dbRow.reading_status_updated_at)
        or iso_to_ms(dbRow.readingStatusUpdatedAt)
```

- [ ] **Step 6: Emit the field in `row_to_wire`** — in `syncbooks.lua`, add to the `out` table (after `readingStatus = row.reading_status,`):

```lua
        readingStatus = row.reading_status,
        readingStatusUpdatedAt = num(row.reading_status_updated_at),
```

- [ ] **Step 7: Run specs to verify they pass**

Run: `cd apps/readest-app && pnpm test:lua`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/readest.koplugin/library/librarystore.lua apps/readest.koplugin/library/syncbooks.lua \
  apps/readest.koplugin/spec/library/librarystore_spec.lua apps/readest.koplugin/spec/library/syncbooks_spec.lua
git commit -m "feat(koplugin): persist + sync reading_status_updated_at in LibraryStore"
```

---

### Task C3: `statussync.lua` — apply + capture, wired into the library sync

**Files:**
- Create: `apps/readest.koplugin/library/statussync.lua`
- Modify: `apps/readest.koplugin/library/librarywidget.lua` (`runCloudSync`)
- Test: `apps/readest.koplugin/spec/library/statussync_spec.lua` (new)

**Interfaces:**
- Consumes: `readingstatus.reconcile` (C1), `LibraryStore` rows incl. `reading_status_updated_at`, `file_path`, `local_present` (C2), `touchBook` (existing).
- Produces: `reconcileLocalStatuses(store, deps)` — for each local-present row, reads the sidecar `summary` via `deps.open_summary(file_path)`, runs `reconcile`, and on a winner: writes the sidecar (apply) via `deps.write_status(file_path, ko_status)` and/or `store:touchBook(hash, { reading_status, reading_status_updated_at })` (capture). `deps` is injected so the IO is stubbable in tests; production passes a DocSettings-backed `deps`.

- [ ] **Step 1: Write the failing spec** — create `spec/library/statussync_spec.lua`:

```lua
require("spec_helper")
local StatusSync = require("library.statussync")
local LibraryStore = require("library.librarystore")

local function fake_deps(summaries, writes)
  return {
    now_ms = function() return 1750000000000 end,
    open_summary = function(path) return summaries[path] end,           -- {status, modified}
    write_status = function(path, ko_status) writes[path] = ko_status end,
  }
end

describe("statussync.reconcileLocalStatuses", function()
  it("applies a newer cloud status down to the sidecar", function()
    local store = LibraryStore.new({ user_id = "u1", db_path = ":memory:" })
    store:upsertBook({ hash = "h1", title = "T", file_path = "/b1.epub", local_present = 1,
                       reading_status = "finished", reading_status_updated_at = 1760000000000 })
    local summaries = { ["/b1.epub"] = { status = "reading", modified = "2026-01-01" } }
    local writes = {}
    StatusSync.reconcileLocalStatuses(store, fake_deps(summaries, writes))
    assert.are.equal("complete", writes["/b1.epub"])
    store:close()
  end)

  it("captures a newer sidecar status into the store and bumps updated_at", function()
    local store = LibraryStore.new({ user_id = "u1", db_path = ":memory:" })
    store:upsertBook({ hash = "h2", title = "T", file_path = "/b2.epub", local_present = 1,
                       reading_status = "reading", reading_status_updated_at = 100 })
    local summaries = { ["/b2.epub"] = { status = "complete", modified = "2026-06-18" } }
    StatusSync.reconcileLocalStatuses(store, fake_deps(summaries, {}))
    local row = store:_getRowRaw("h2")
    assert.are.equal("finished", row.reading_status)
    assert.is_truthy(row.updated_at)  -- touched => dirty for push
    store:close()
  end)

  it("skips rows without a local file", function()
    local store = LibraryStore.new({ user_id = "u1", db_path = ":memory:" })
    store:upsertBook({ hash = "h3", title = "T", uploaded_at = 1, local_present = 0,
                       reading_status = "finished", reading_status_updated_at = 1 })
    local writes = {}
    StatusSync.reconcileLocalStatuses(store, fake_deps({}, writes))
    assert.are.same({}, writes)
    store:close()
  end)
end)
```

- [ ] **Step 2: Run spec to verify it fails**

Run: `cd apps/readest-app && pnpm test:lua -- spec/library/statussync_spec.lua`
Expected: FAIL — module `library.statussync` not found.

- [ ] **Step 3: Implement `library/statussync.lua`**

```lua
-- statussync.lua — bridge LibraryStore.reading_status <-> KOReader's per-book
-- summary.status. The decision is delegated to the pure readingstatus.reconcile;
-- this module only walks local-present rows and performs the chosen IO. The IO
-- is injected via `deps` so it unit-tests without DocSettings; production wires
-- a DocSettings-backed deps in librarywidget.
local readingstatus = require("library.readingstatus")

local M = {}

-- deps: { now_ms(), open_summary(file_path) -> {status, modified}|nil,
--         write_status(file_path, ko_status_or_nil) }
function M.reconcileLocalStatuses(store, deps)
    if not store or not deps then return 0 end
    local changed = 0
    local rows = store:listBooks({})
    for _, row in ipairs(rows) do
        if row.local_present == 1 and row.file_path then
            local summary = deps.open_summary(row.file_path) or {}
            local ko_ts = readingstatus.parse_modified_ms(summary.modified) or deps.now_ms()
            local r = readingstatus.reconcile(
                { reading_status = row.reading_status,
                  reading_status_updated_at = row.reading_status_updated_at },
                { status = summary.status, ts = ko_ts })
            if r.action == "apply_to_ko" then
                deps.write_status(row.file_path, r.ko_status)  -- ko_status may be nil (clear)
                changed = changed + 1
            elseif r.action == "apply_to_store" then
                store:touchBook(row.hash, {
                    reading_status = r.readest_status,
                    reading_status_updated_at = r.ts,
                })
                changed = changed + 1
            end
        end
    end
    return changed
end

return M
```

- [ ] **Step 4: Run spec to verify it passes**

Run: `cd apps/readest-app && pnpm test:lua -- spec/library/statussync_spec.lua`
Expected: PASS.

- [ ] **Step 5: Wire production IO into `runCloudSync`** — in `librarywidget.lua`, build a DocSettings-backed `deps` and run reconcile after pull / before push. Replace the `runCloudSync` body's `syncbooks.syncBooks(...)` call with:

```lua
local function runCloudSync(opts, store)
    local mode = opts.settings.auto_sync and "both" or "pull"
    local DocSettings = require("docsettings")
    local BookList = require("ui/widget/booklist")
    local statussync = require("library.statussync")
    local readingstatus = require("library.readingstatus")
    local deps = {
        now_ms = function() return os.time() * 1000 end,
        open_summary = function(file_path)
            local ok, ds = pcall(DocSettings.open, DocSettings, file_path)
            if not ok or not ds then return nil end
            return ds:readSetting("summary")
        end,
        write_status = function(file_path, ko_status)
            local ok, ds = pcall(DocSettings.open, DocSettings, file_path)
            if not ok or not ds then return end
            local summary = ds:readSetting("summary") or {}
            summary.status = ko_status  -- nil clears -> KOReader "New"
            summary.modified = os.date("%Y-%m-%d", os.time())
            ds:saveSetting("summary", summary)
            ds:flush()
            BookList.setBookInfoCacheProperty(file_path, "status", ko_status)
        end,
    }
    local function reconcile() statussync.reconcileLocalStatuses(store, deps) end

    logger.info("ReadestLibrary runCloudSync: mode=" .. mode
        .. " auto_sync=" .. tostring(opts.settings.auto_sync))

    local function done(success, msg, status)
        logger.info("ReadestLibrary runCloudSync[" .. mode .. "] done: success="
            .. tostring(success) .. " msg=" .. tostring(msg) .. " status=" .. tostring(status))
        M.refresh()
    end

    if mode == "both" then
        -- before_push runs after pull, before push: apply pulled statuses to
        -- sidecars and capture sidecar changes into the store so they're pushed.
        syncbooks.syncBooks({
            sync_auth = opts.sync_auth, sync_path = opts.sync_path,
            settings = opts.settings, store = store,
        }, "both", done, reconcile)
    else
        syncbooks.syncBooks({
            sync_auth = opts.sync_auth, sync_path = opts.sync_path,
            settings = opts.settings, store = store,
        }, "pull", function(success, msg, status)
            reconcile()  -- apply cloud statuses to sidecars even when auto_sync is off
            done(success, msg, status)
        end)
    end
end
```

(Keep the surrounding `M.open` scheduling unchanged — only `runCloudSync` changes.)

- [ ] **Step 6: Run the koplugin lint + tests**

Run: `cd apps/readest-app && pnpm lint:lua && pnpm test:lua`
Expected: PASS.

- [ ] **Step 7: Manual verification (live KOReader — not unit-testable IO)**

1. Install the koplugin on a device with the Readest Library configured + `auto_sync` on.
2. On a Readest device, mark a synced book **Finished**; let it sync.
3. In KOReader, open the Readest Library (triggers `runCloudSync`); confirm the book now shows **Finished** in KOReader (file browser status). 
4. In KOReader, set a book to **On hold**; reopen the Readest Library; confirm Readest shows the **On hold** badge after its next library sync.
5. Reopen the Library twice with no changes; confirm no oscillation (status stays put).

- [ ] **Step 8: Commit**

```bash
git add apps/readest.koplugin/library/statussync.lua \
  apps/readest.koplugin/library/librarywidget.lua \
  apps/readest.koplugin/spec/library/statussync_spec.lua
git commit -m "feat(koplugin): bridge reading status to KOReader summary.status on library sync (#4634)"
```

---

## Final verification

- [ ] `cd apps/readest-app && pnpm test` — all unit tests pass.
- [ ] `cd apps/readest-app && pnpm lint` — Biome + tsgo clean.
- [ ] `cd apps/readest-app && pnpm lint:lua && pnpm test:lua` — koplugin clean.
- [ ] Confirm no `src-tauri/` files changed (`git diff --name-only origin/main -- src-tauri` empty) → Rust gates skipped.
- [ ] Re-read `docs/superpowers`/spec mapping table against `readingstatus.lua` to confirm the four mappings match.

## Spec coverage map

- Root-cause clobber fix → Tasks A2 (stamp), A4 (client merge), A5 (server merge).
- Schema/migration → A1 (web), C2 (koplugin store).
- `abandoned` status + UI → A1 (type), B1 (badge), B2 (menu/batch/i18n).
- Readest⇄KOReader mapping + reconcile/convergence → C1.
- Whole-library apply + capture via `file_path`/`local_present` → C3.
- Known limitations (unread→"New", day-granularity) → encoded in `readingstatus.lua` mapping + reconcile (C1) and documented in the spec.

---

## Addendum (first-sync redesign — supersedes the C1/C3 reconcile above)

After review, the Part C reconcile was redesigned to handle the never-synced
"first sync" between the two libraries safely. See the design spec's updated
"Readest ⇄ KOReader status mapping", "First-sync transfer graph", and
"First sync & failure handling" sections. Key changes vs the original C1/C3:

- **Decisive-only mapping.** `ko_to_readest` returns a status ONLY for
  `complete`→finished and `abandoned`→abandoned; KOReader `reading` (auto-set on
  open), `New`, and unknown → `nil` (no opinion, never captured). Readest
  `reading`/`undefined` are non-decisive. New helper `readest_decisive`.
- **`reconcile(cloud, ko, now_ms)`** returns
  `{ write_ko, write_store, readest_status, ts, ko_status }` (replacing the old
  `action` field). It picks the winning decisive status W: only-one-decisive →
  that side; both-agree → that status; both-conflict → Readest-authoritative when
  `cloud.reading_status_updated_at == 0` (bootstrap), else recency LWW.
- **Bootstrap exit:** when the Readest ts is `0`, the resolved status is stamped
  with `now_ms` (via `write_store`) so subsequent syncs use steady-state LWW.
- **`statussync.reconcileLocalStatuses`** captures `now_ms` once, passes it to
  `reconcile`, and drives on `write_ko`/`write_store` instead of `action`.
- **Tests** rewritten to cover the decisive-only mappings, the full transfer
  graph, bootstrap vs steady, both reported cases, and convergence.

No web/TS changes — Parts A and B are unaffected. koplugin-only.
