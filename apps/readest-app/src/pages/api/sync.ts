import type { NextApiRequest, NextApiResponse } from 'next';
import { NextRequest, NextResponse } from 'next/server';
import { PostgrestError } from '@supabase/supabase-js';
import { createSupabaseClient } from '@/utils/supabase';
import { BookDataRecord } from '@/types/book';
import { transformBookConfigToDB } from '@/utils/transform';
import { transformBookNoteToDB } from '@/utils/transform';
import { transformBookToDB } from '@/utils/transform';
import { runMiddleware, corsAllMethods } from '@/utils/cors';
import {
  SyncData,
  SyncRecord,
  SyncResult,
  SyncType,
  StatBookRecord,
  StatPageRecord,
} from '@/libs/sync';
import { validateUserAndToken } from '@/utils/access';
import { DBBook, DBBookConfig } from '@/types/records';

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

/**
 * Field-level last-writer-wins for a books row's reading_status: return the
 * status fields with the newer reading_status_updated_at (ties → client). NULL
 * timestamp = epoch 0. Lets reading_status survive even when the whole row is
 * decided the other way by updated_at (which page-turn progress dominates) —
 * issue #4634.
 */
/**
 * `undefined` (the client omitted reading_status entirely — e.g. a locally
 * imported book that never had a status set) and `null` (the DB default) both
 * mean "no reading status". Collapse them so a statusless book never registers
 * as a status change. Without this, the `statusChanged` branch below rewrites
 * `updated_at = now()` on every push for such books, and since the 1-day
 * re-sync window re-pushes recently-touched books each cycle, they get a fresh
 * timestamp every sync and pin themselves to the top of the date-sorted
 * library.
 */
export const readingStatusChanged = (client?: string | null, server?: string | null): boolean =>
  (client ?? null) !== (server ?? null);

export function resolveReadingStatusMerge(
  client: Pick<DBBook, 'reading_status' | 'reading_status_updated_at'>,
  server: Pick<DBBook, 'reading_status' | 'reading_status_updated_at'>,
): Pick<DBBook, 'reading_status' | 'reading_status_updated_at'> {
  const ms = (s?: string | null) => (s ? new Date(s).getTime() : 0);
  return ms(client.reading_status_updated_at) >= ms(server.reading_status_updated_at)
    ? {
        reading_status: client.reading_status,
        reading_status_updated_at: client.reading_status_updated_at,
      }
    : {
        reading_status: server.reading_status,
        reading_status_updated_at: server.reading_status_updated_at,
      };
}

/**
 * Build the row written when the server wins a books row by `updated_at` but
 * the client's reading_status is the fresher one: graft the status onto the
 * server row and leave everything else — crucially `updated_at` — untouched.
 *
 * The `books_set_synced_at` trigger stamps `synced_at = now()` on this write,
 * so peers re-pull the status change via the synced_at cursor without the
 * date-read library (sorted by updated_at) jumping to sync-processing time.
 * Previously this rewrote `updated_at = now()` to force propagation, which was
 * the #4677 reorder symptom. See issue #4678.
 */
export function buildStatusPropagationRow(
  serverBook: DBBook,
  status: Pick<DBBook, 'reading_status' | 'reading_status_updated_at'>,
): DBBook {
  return {
    ...serverBook,
    reading_status: status.reading_status,
    reading_status_updated_at: status.reading_status_updated_at,
  };
}

/**
 * Field-level last-writer-wins for a books row's cover: return the
 * {cover_hash, cover_updated_at} with the newer cover_updated_at (ties →
 * client). NULL timestamp = epoch 0. A cover edit shares the row with
 * page-turn progress, so this lets the cover survive even when the whole row
 * is decided the other way by updated_at — the same #4634 hazard the
 * reading_status merge addresses (issue #4544).
 */
export function resolveCoverMerge(
  client: Pick<DBBook, 'cover_hash' | 'cover_updated_at'>,
  server: Pick<DBBook, 'cover_hash' | 'cover_updated_at'>,
): Pick<DBBook, 'cover_hash' | 'cover_updated_at'> {
  const ms = (s?: string | null) => (s ? new Date(s).getTime() : 0);
  return ms(client.cover_updated_at) >= ms(server.cover_updated_at)
    ? { cover_hash: client.cover_hash, cover_updated_at: client.cover_updated_at }
    : { cover_hash: server.cover_hash, cover_updated_at: server.cover_updated_at };
}

const transformsToDB = {
  books: transformBookToDB,
  book_notes: transformBookNoteToDB,
  book_configs: transformBookConfigToDB,
};

const DBSyncTypeMap = {
  books: 'books',
  book_notes: 'notes',
  book_configs: 'configs',
};

type TableName = keyof typeof transformsToDB;

type DBError = { table: TableName; error: PostgrestError };

export async function GET(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }
  const supabase = createSupabaseClient(token);

  const { searchParams } = new URL(req.url);
  const sinceParam = searchParams.get('since');
  const typeParam = searchParams.get('type') as SyncType | undefined;
  const bookParam = searchParams.get('book');
  const metaHashParam = searchParams.get('meta_hash');
  // Optional page size for `type=stats` (client-driven paged pull). Absent for
  // the koplugin, which keeps the full-delta response.
  const statsLimitParam = searchParams.get('limit');
  const statsLimit = statsLimitParam ? Math.max(1, Math.floor(Number(statsLimitParam))) : 0;

  if (!sinceParam) {
    return NextResponse.json({ error: '"since" query parameter is required' }, { status: 400 });
  }

  const since = new Date(Number(sinceParam));
  if (isNaN(since.getTime())) {
    return NextResponse.json({ error: 'Invalid "since" timestamp' }, { status: 400 });
  }

  const sinceIso = since.toISOString();

  try {
    const results: SyncResult = { books: [], configs: [], notes: [], statBooks: [], statPages: [] };
    const errors: Record<TableName, DBError | null> = {
      books: null,
      book_notes: null,
      book_configs: null,
    };

    const queryTables = async (table: TableName, dedupeKeys?: (keyof BookDataRecord)[]) => {
      const PAGE_SIZE = 1000;
      let allRecords: SyncRecord[] = [];
      let offset = 0;
      let hasMore = true;

      // books keys the pull on the server-assigned `synced_at` cursor, which a
      // trigger bumps on every write — including deletes — so a server-resolved
      // merge propagates without touching updated_at (the date-read sort key).
      // configs/notes have no server-side merge, so they stay on updated_at and
      // still need the explicit deleted_at clause. See issue #4678.
      const cursorColumn = table === 'books' ? 'synced_at' : 'updated_at';

      while (hasMore) {
        let query = supabase
          .from(table)
          .select('*')
          .eq('user_id', user.id)
          .range(offset, offset + PAGE_SIZE - 1);

        if (bookParam && metaHashParam) {
          query = query.or(`book_hash.eq.${bookParam},meta_hash.eq.${metaHashParam}`);
        } else if (bookParam) {
          query = query.eq('book_hash', bookParam);
        } else if (metaHashParam) {
          query = query.eq('meta_hash', metaHashParam);
        }

        if (cursorColumn === 'synced_at') {
          query = query.gt('synced_at', sinceIso);
        } else {
          query = query.or(`updated_at.gt.${sinceIso},deleted_at.gt.${sinceIso}`);
        }
        query = query.order(cursorColumn, { ascending: false });

        console.log('Querying table:', table, 'since:', sinceIso, 'offset:', offset);

        const { data, error } = await query;
        if (error) throw { table, error } as DBError;

        if (data && data.length > 0) {
          allRecords = allRecords.concat(data);
          offset += PAGE_SIZE;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }

      let records = allRecords;
      if (dedupeKeys && dedupeKeys.length > 0) {
        const seen = new Set<string>();
        records = records.filter((rec) => {
          const key = dedupeKeys
            .map((k) => rec[k])
            .filter(Boolean)
            .join('|');
          if (key && seen.has(key)) {
            return false;
          } else {
            seen.add(key);
            return true;
          }
        });
      }
      (results as unknown as Record<string, SyncRecord[]>)[DBSyncTypeMap[table]] = records || [];
    };

    if (!typeParam || typeParam === 'books') {
      await queryTables('books').catch((err) => (errors['books'] = err));
      // TODO: Remove this hotfix for the initial race condition for books sync
      if (results.books?.length === 0 && since.getTime() < 1000) {
        const dummyHash = '00000000000000000000000000000000';
        const now = Date.now();
        results.books.push({
          user_id: user.id,
          id: dummyHash,
          book_hash: dummyHash,
          deleted_at: now,
          updated_at: now,

          hash: dummyHash,
          title: 'Dummy Book',
          format: 'EPUB',
          author: '',
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
        });
      }
    }
    if (!typeParam || typeParam === 'configs') {
      await queryTables('book_configs').catch((err) => (errors['book_configs'] = err));
    }
    if (!typeParam || typeParam === 'notes') {
      await queryTables('book_notes', ['id']).catch((err) => (errors['book_notes'] = err));
    }
    if (!typeParam || typeParam === 'stats') {
      // PostgREST caps responses at ~1000 rows; stat_pages grows one row per page
      // event, so page through both tables (ordered by updated_at ascending for a
      // stable cursor) and accumulate every row — otherwise a device pulling >1000
      // events only gets the first page and then advances its cursor past the rest.
      //
      // Cursor is `updated_at > since` ONLY (no `OR deleted_at > since`). Every
      // stat push server-stamps `updated_at = now()` including deletes (see the
      // upserts below), so a delete always lands with updated_at greater than any
      // peer's max(updated_at) pull cursor — `updated_at > since` already returns
      // it. The redundant OR was the #1 query by total DB time: it defeats the
      // (user_id, updated_at) index range scan and forces a walk of the user's
      // entire page-event history on every incremental sync. Same rationale as the
      // books `synced_at` cursor (#4678); here updated_at is itself server-stamped.
      const PAGE = 1000;
      const fetchAll = async (table: 'stat_books' | 'stat_pages', filterBook: boolean) => {
        const all: Record<string, unknown>[] = [];
        let offset = 0;
        for (;;) {
          let q = supabase
            .from(table)
            .select('*')
            .eq('user_id', user.id)
            .gt('updated_at', sinceIso)
            .order('updated_at', { ascending: true })
            .range(offset, offset + PAGE - 1);
          if (filterBook && bookParam) q = q.eq('book_hash', bookParam);
          const { data, error } = await q;
          if (error) return { error };
          const rows = (data ?? []) as Record<string, unknown>[];
          all.push(...rows);
          if (rows.length < PAGE) break;
          offset += PAGE;
        }
        return { data: all };
      };
      // A single bounded page of stat_pages for the app's client-driven paged
      // pull, completed to the trailing updated_at millisecond so the client can
      // advance its cursor with a strict `> cursor` without skipping ties.
      const fetchPagedPages = async () => {
        let q = supabase
          .from('stat_pages')
          .select('*')
          .eq('user_id', user.id)
          .gt('updated_at', sinceIso)
          .order('updated_at', { ascending: true })
          .range(0, statsLimit - 1);
        if (bookParam) q = q.eq('book_hash', bookParam);
        const { data, error } = await q;
        if (error) return { error };
        const rows = (data ?? []) as Record<string, unknown>[];
        if (rows.length === statsLimit) {
          const lastUpdated = rows[rows.length - 1]!['updated_at'] as string;
          let eq = supabase
            .from('stat_pages')
            .select('*')
            .eq('user_id', user.id)
            .eq('updated_at', lastUpdated);
          if (bookParam) eq = eq.eq('book_hash', bookParam);
          const { data: extra, error: extraErr } = await eq;
          if (extraErr) return { error: extraErr };
          const keyOf = (r: Record<string, unknown>) =>
            `${r['book_hash']}|${r['page']}|${r['start_time']}`;
          const seen = new Set(rows.map(keyOf));
          for (const r of (extra ?? []) as Record<string, unknown>[]) {
            const k = keyOf(r);
            if (!seen.has(k)) {
              seen.add(k);
              rows.push(r);
            }
          }
        }
        return { data: rows };
      };
      // stat_books is always returned in full (one row per book, small); only
      // stat_pages pages when the client asks (the koplugin omits `limit`).
      const sb = await fetchAll('stat_books', false);
      const sp = statsLimit > 0 ? await fetchPagedPages() : await fetchAll('stat_pages', true);
      if (sb.error)
        return NextResponse.json(
          { error: `stat_books: ${sb.error.message || 'Unknown error'}` },
          { status: 500 },
        );
      if (sp.error)
        return NextResponse.json(
          { error: `stat_pages: ${sp.error.message || 'Unknown error'}` },
          { status: 500 },
        );
      // Attach updated_at_ms (epoch ms) so non-JS clients (the Lua koplugin) can
      // compute their pull cursor without parsing ISO-8601 timestamps.
      const withMs = <T extends { updated_at?: string }>(rows: T[]) =>
        rows.map((r) => ({
          ...r,
          updated_at_ms: r.updated_at ? new Date(r.updated_at).getTime() : 0,
        }));
      (
        results as unknown as { statBooks: StatBookRecord[]; statPages: StatPageRecord[] }
      ).statBooks = withMs((sb.data ?? []) as unknown as StatBookRecord[]);
      (
        results as unknown as { statBooks: StatBookRecord[]; statPages: StatPageRecord[] }
      ).statPages = withMs((sp.data ?? []) as unknown as StatPageRecord[]);
    }

    const dbErrors = Object.values(errors).filter((err) => err !== null);
    if (dbErrors.length > 0) {
      console.error('Errors occurred:', dbErrors);
      const errorMsg = dbErrors
        .map((err) => `${err.table}: ${err.error.message || 'Unknown error'}`)
        .join('; ');
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    const response = NextResponse.json(results, { status: 200 });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Pragma', 'no-cache');
    response.headers.delete('ETag');
    return response;
  } catch (error: unknown) {
    console.error(error);
    const errorMessage = (error as PostgrestError).message || 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }
  const supabase = createSupabaseClient(token);
  const body = await req.json();
  const { books = [], configs = [], notes = [], statBooks = [], statPages = [] } = body as SyncData;

  const BATCH_SIZE = 100;
  const upsertRecords = async (
    table: TableName,
    primaryKeys: (keyof BookDataRecord)[],
    records: BookDataRecord[],
  ) => {
    if (records.length === 0) return { data: [] };

    const allAuthoritativeRecords: BookDataRecord[] = [];

    // Process in batches
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);

      // Transform all records to DB format
      const dbRecords = batch.map((rec) => {
        const dbRec = transformsToDB[table](rec, user.id);
        rec.user_id = user.id;
        rec.book_hash = dbRec.book_hash;
        return { original: rec, db: dbRec };
      });

      // Build match conditions for batch
      const matchConditions = dbRecords.map(({ original }) => {
        const conditions: Record<string, string | number> = { user_id: user.id };
        for (const pk of primaryKeys) {
          conditions[pk] = original[pk]!;
        }
        return conditions;
      });

      // Fetch existing records for this batch
      const orConditions = matchConditions
        .map((cond) => {
          const parts = Object.entries(cond).map(([key, val]) => `${key}.eq.${val}`);
          return `and(${parts.join(',')})`;
        })
        .join(',');

      const { data: serverRecords, error: fetchError } = await supabase
        .from(table)
        .select()
        .or(orConditions);

      if (fetchError) {
        return { error: fetchError.message };
      }

      // Create lookup map
      const serverRecordsMap = new Map<string, BookDataRecord>();
      (serverRecords || []).forEach((record) => {
        const key = primaryKeys.map((pk) => record[pk]).join('|');
        serverRecordsMap.set(key, record);
      });

      // Separate into inserts and updates
      const toInsert: (DBBook | DBBookConfig | DBBookConfig)[] = [];
      const toUpdate: (DBBook | DBBookConfig | DBBookConfig)[] = [];
      const batchAuthoritativeRecords: BookDataRecord[] = [];

      for (const { original, db: dbRec } of dbRecords) {
        const key = primaryKeys.map((pk) => original[pk]).join('|');
        const serverData = serverRecordsMap.get(key);

        if (!serverData) {
          dbRec.updated_at = new Date().toISOString();
          toInsert.push(dbRec);
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
            // `dbRec` is DBBook | DBBookConfig; in the 'books' branch it is always DBBook.
            const clientBook = dbRec as DBBook;
            // `serverData` is BookDataRecord but the DB row carries the status +
            // cover columns at runtime — widen the type without going through `unknown`.
            const serverBook = serverData as BookDataRecord &
              Partial<
                Pick<
                  DBBook,
                  'reading_status' | 'reading_status_updated_at' | 'cover_hash' | 'cover_updated_at'
                >
              >;
            const status = resolveReadingStatusMerge(clientBook, serverBook);
            // Cover has its own field-level LWW so a page-turn can't clobber a
            // cover edit (issue #4544; mirrors reading_status / #4634).
            const cover = resolveCoverMerge(clientBook, serverBook);
            if (clientIsNewer) {
              // Client wins the row; graft the fresher status + cover onto it
              // (server's may be the newer one even though the row is older).
              clientBook.reading_status = status.reading_status;
              clientBook.reading_status_updated_at = status.reading_status_updated_at;
              clientBook.cover_hash = cover.cover_hash;
              clientBook.cover_updated_at = cover.cover_updated_at;
              toUpdate.push(clientBook);
            } else {
              // Only rewrite when a resolved field VALUE differs from the
              // server's — a timestamp-only difference on the same value is a
              // no-op, and rewriting it would churn updated_at + re-propagate.
              const statusChanged = readingStatusChanged(
                status.reading_status,
                serverBook.reading_status,
              );
              const coverChanged = (cover.cover_hash ?? null) !== (serverBook.cover_hash ?? null);
              if (statusChanged || coverChanged) {
                // Server wins the row, but the client's status and/or cover is
                // the fresher one. Graft the fresher fields onto the server row
                // and leave updated_at untouched; the books_set_synced_at
                // trigger advances synced_at so peers re-pull via the synced_at
                // cursor without reordering the date-read library (#4678, #4544).
                // The runtime DB row carries all DBBook columns; the static type
                // of `serverBook` is a narrower intersection so `unknown` is
                // required to bridge the gap at this one construction site.
                const propagated = buildStatusPropagationRow(
                  serverBook as unknown as DBBook,
                  status,
                );
                propagated.cover_hash = cover.cover_hash;
                propagated.cover_updated_at = cover.cover_updated_at;
                toUpdate.push(propagated);
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
      }

      // Batch insert
      if (toInsert.length > 0) {
        const { data: inserted, error: insertError } = await supabase
          .from(table)
          .insert(toInsert)
          .select();

        if (insertError) {
          console.log(`Failed to insert ${table} records:`, JSON.stringify(toInsert));
          return { error: insertError.message };
        }
        batchAuthoritativeRecords.push(...(inserted || []));
      }

      // Batch upsert
      if (toUpdate.length > 0) {
        const { data: updated, error: updateError } = await supabase
          .from(table)
          .upsert(toUpdate, {
            onConflict: ['user_id', ...primaryKeys].join(','),
          })
          .select();

        if (updateError) {
          console.log(`Failed to update ${table} records:`, JSON.stringify(toUpdate));
          return { error: updateError.message };
        }
        batchAuthoritativeRecords.push(...(updated || []));
      }

      allAuthoritativeRecords.push(...batchAuthoritativeRecords);
    }

    return { data: allAuthoritativeRecords };
  };

  try {
    const [booksResult, configsResult, notesResult] = await Promise.all([
      upsertRecords('books', ['book_hash'], books as BookDataRecord[]),
      upsertRecords('book_configs', ['book_hash'], configs as BookDataRecord[]),
      upsertRecords('book_notes', ['book_hash', 'id'], notes as BookDataRecord[]),
    ]);

    if (booksResult?.error) throw new Error(booksResult.error);
    if (configsResult?.error) throw new Error(configsResult.error);
    if (notesResult?.error) throw new Error(notesResult.error);

    // Piggyback the per-book reading progress from the configs push onto the
    // matching `books` row. Other devices' library pull-to-refresh reads
    // books.progress + books.updated_at, so without this the row would stay
    // stale until the user navigates back to the library and useBooksSync
    // re-pushes. The .lt('updated_at') predicate keeps last-writer-wins —
    // a concurrent newer books push is never downgraded — and a missing
    // row is a silent no-op (useBooksSync will insert it later).
    type BookProgressUpdate = {
      book_hash: string;
      progress: [number, number];
      updated_at: string;
    };
    const bookProgressUpdates: BookProgressUpdate[] = [];
    for (const rec of (configsResult.data ?? []) as unknown as DBBookConfig[]) {
      if (!rec.book_hash || !rec.updated_at || rec.progress == null) continue;
      let parsed: unknown;
      try {
        parsed = typeof rec.progress === 'string' ? JSON.parse(rec.progress) : rec.progress;
      } catch {
        continue;
      }
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 2 ||
        typeof parsed[0] !== 'number' ||
        typeof parsed[1] !== 'number'
      ) {
        continue;
      }
      bookProgressUpdates.push({
        book_hash: rec.book_hash,
        progress: [parsed[0], parsed[1]],
        updated_at: rec.updated_at,
      });
    }

    if (bookProgressUpdates.length > 0) {
      await Promise.all(
        bookProgressUpdates.map(async (u) => {
          const { error } = await supabase
            .from('books')
            .update({ progress: u.progress, updated_at: u.updated_at })
            .eq('user_id', user.id)
            .eq('book_hash', u.book_hash)
            .lt('updated_at', u.updated_at);
          if (error) {
            // Best-effort: never fail the configs push because of this side
            // effect — useBooksSync will reconcile the row later.
            console.warn('books.progress piggyback failed for', u.book_hash, error.message);
          }
        }),
      );
    }

    if (statBooks.length > 0) {
      const rows = statBooks.map((b: StatBookRecord) => ({
        user_id: user.id,
        book_hash: b.book_hash,
        title: b.title,
        authors: b.authors,
        updated_at: new Date().toISOString(),
        deleted_at: b.deleted_at ?? null,
      }));
      const { error } = await supabase
        .from('stat_books')
        .upsert(rows, { onConflict: 'user_id,book_hash' });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (statPages.length > 0) {
      // Process in batches so the "longer-duration-wins" merge stays correct at
      // scale: the existing-row fetch is scoped to each batch's (book_hash,
      // start_time) keys (not a book's whole history) and bounded under
      // PostgREST's ~1000-row cap — otherwise existing rows beyond 1000 are
      // invisible to pickWinningPages and a shorter duration could overwrite a
      // longer one.
      const BATCH = 500;
      for (let off = 0; off < statPages.length; off += BATCH) {
        const batch = statPages.slice(off, off + BATCH);
        const bookHashes = [...new Set(batch.map((p) => p.book_hash))];
        const startTimes = [...new Set(batch.map((p) => p.start_time))];
        const { data: existing, error: exErr } = await supabase
          .from('stat_pages')
          .select('*')
          .eq('user_id', user.id)
          .in('book_hash', bookHashes)
          .in('start_time', startTimes);
        if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
        const serverMap = new Map<string, StatPageRecord>();
        (existing ?? []).forEach((r) =>
          serverMap.set(pageKey(r as StatPageRecord), r as StatPageRecord),
        );
        const { toUpsert } = pickWinningPages(batch, serverMap);
        const rows = toUpsert.map((p) => ({
          user_id: user.id,
          book_hash: p.book_hash,
          page: p.page,
          start_time: p.start_time,
          duration: p.duration,
          total_pages: p.total_pages,
          ext: p.ext ?? null,
          updated_at: new Date().toISOString(),
          deleted_at: p.deleted_at ?? null,
        }));
        if (rows.length > 0) {
          const { error } = await supabase
            .from('stat_pages')
            .upsert(rows, { onConflict: 'user_id,book_hash,page,start_time' });
          if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        }
      }
    }

    return NextResponse.json(
      {
        books: booksResult?.data || [],
        configs: configsResult?.data || [],
        notes: notesResult?.data || [],
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error(error);
    const errorMessage = (error as PostgrestError).message || 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!req.url) {
    return res.status(400).json({ error: 'Invalid request URL' });
  }

  const protocol = process.env['PROTOCOL'] || 'http';
  const host = process.env['HOST'] || 'localhost:3000';
  const url = new URL(req.url, `${protocol}://${host}`);

  await runMiddleware(req, res, corsAllMethods);

  try {
    let response: Response;

    if (req.method === 'GET') {
      const nextReq = new NextRequest(url.toString(), {
        headers: new Headers(req.headers as Record<string, string>),
        method: 'GET',
      });
      response = await GET(nextReq);
    } else if (req.method === 'POST') {
      const nextReq = new NextRequest(url.toString(), {
        headers: new Headers(req.headers as Record<string, string>),
        method: 'POST',
        body: JSON.stringify(req.body), // Ensure the body is a string
      });
      response = await POST(nextReq);
    } else {
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    res.status(response.status);

    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.send(buffer);
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export default handler;
