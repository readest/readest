import { Book, BookConfig, BookNote, HardcoverBookLink } from '@/types/book';
import { getContentMd5 } from '@/utils/misc';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { HardcoverSyncMapStore } from './HardcoverSyncMapStore';
import {
  QUERY_GET_USER_ID,
  QUERY_SEARCH_BOOKS,
  QUERY_GET_EDITION,
  QUERY_GET_BOOKS,
  MUTATION_INSERT_USER_BOOK,
  MUTATION_UPDATE_USER_BOOK,
  MUTATION_INSERT_READ,
  MUTATION_UPDATE_READ,
  MUTATION_INSERT_JOURNAL,
  MUTATION_UPDATE_JOURNAL,
} from './hardcover-graphql';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type HardcoverSettingsLike = {
  accessToken: string;
};

type BookContext = {
  // Null when no real Hardcover edition is known (e.g. a title-search match with
  // no featured edition and no user-selected edition). Never fall back to the
  // book id here — Hardcover rejects a book id used as an edition_id (#4792).
  editionId: number | null;
  pages: number | null;
  bookId: number;
  bookPages: number | null;
  title: string;
  userBook: {
    id: number;
    status_id: number;
    user_book_reads: Array<{ id: number; started_at: string | null }>;
  } | null;
};

type ActiveRead = { id: number; started_at: string | null };

type EditionRow = { id: number; pages: number | null; reading_format_id?: number | null };

type UserBookRow = {
  id: number;
  status_id: number;
  edition?: EditionRow | null;
  user_book_reads?: Array<{ id: number; started_at: string | null; edition?: EditionRow | null }>;
};

// One row of QUERY_GET_BOOKS. `editions` holds at most the top readable
// (non-audiobook) edition; `user_books` is the caller's shelf entry, if any.
type BookRow = {
  id: number;
  title?: string | null;
  pages?: number | null;
  release_year?: number | null;
  users_read_count?: number | null;
  cached_image?: { url?: string | null } | null;
  cached_contributors?: Array<{
    author?: { name?: string | null } | null;
    contribution?: string | null;
  }> | null;
  editions?: EditionRow[] | null;
  user_books?: UserBookRow[] | null;
};

/** A Hardcover book as presented in the "Link Book" picker. */
export interface HardcoverBookCandidate {
  bookId: number;
  title: string;
  authors: string[];
  coverUrl: string | null;
  releaseYear: number | null;
  pages: number | null;
  readersCount: number | null;
  /** Has at least one non-audiobook edition. */
  readable: boolean;
  /** Already in the user's Hardcover library, in any status. */
  onShelf: boolean;
}

/**
 * Automatic-match rule shared by sync and the picker (#5846): the first hit
 * the user already shelved that has a readable edition, else the first
 * readable hit. Audiobook-only entries never receive text progress, even when
 * an earlier mis-match already put one on the shelf.
 */
export const pickAutoMatch = <T extends { onShelf: boolean; readable: boolean }>(
  candidates: T[],
): T | null =>
  candidates.find((c) => c.onShelf && c.readable) ?? candidates.find((c) => c.readable) ?? null;

const rowFlags = (row: BookRow) => ({
  readable: (row.editions?.length ?? 0) > 0,
  onShelf: (row.user_books?.length ?? 0) > 0,
});

export class HardcoverClient {
  private minRequestIntervalMs = 1150;
  private directEndpoint = 'https://api.hardcover.app/v1/graphql';
  private proxyEndpoint = '/api/hardcover/graphql';
  private token: string;
  private mapStore: HardcoverSyncMapStore;
  private userId: number | null = null;
  private lastRequestTime = 0;
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(settings: HardcoverSettingsLike, mapStore: HardcoverSyncMapStore) {
    // Normalize token: Hardcover expects "Bearer <jwt>"; accept both formats
    const raw = settings.accessToken.trim();
    this.token = raw.startsWith('Bearer ') ? raw : `Bearer ${raw}`;
    this.mapStore = mapStore;
  }

  private get endpoint() {
    return isTauriAppPlatform() ? this.directEndpoint : this.proxyEndpoint;
  }

  private formatDate(date: Date): string {
    return date.toISOString().replace(/\.\d+/, '').replace('Z', '+00:00');
  }

  private formatDay(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private isReadableEdition(
    edition?: {
      id: number;
      pages: number | null;
      reading_format_id?: number | null;
    } | null,
  ): edition is { id: number; pages: number | null; reading_format_id?: number | null } {
    return !!edition && edition.reading_format_id !== 2;
  }

  private getHardcoverProgressPages(
    current: number,
    total: number,
    context: BookContext,
  ): number | null {
    const boundedCurrent = Math.min(Math.max(current, 0), total);
    const hardcoverTotal = context.pages ?? context.bookPages ?? 0;
    if (total <= 0 || hardcoverTotal <= 0) {
      return null;
    }

    const scaledPages = Math.round((boundedCurrent / total) * hardcoverTotal);
    if (boundedCurrent <= 0) {
      return 0;
    }

    return Math.min(Math.max(scaledPages, 1), hardcoverTotal);
  }

  private normalizeNoteDedupCfi(cfi: string | null | undefined): string {
    return cfi ? cfi.replace(/:\d+/g, '') : '';
  }

  private getNoteDedupKey(note: BookNote): string {
    const text = note.text?.trim() || '';
    const normalizedCfi = this.normalizeNoteDedupCfi(note.cfi);
    return `${normalizedCfi}|${text}`;
  }

  private async throttleRequest() {
    const queued = this.requestQueue
      .catch(() => undefined)
      .then(async () => {
        const now = Date.now();
        const elapsed = now - this.lastRequestTime;
        if (elapsed < this.minRequestIntervalMs) {
          await sleep(this.minRequestIntervalMs - elapsed);
        }
        this.lastRequestTime = Date.now();
      });

    this.requestQueue = queued;
    await queued;
  }

  private async request<TVariables, TData>(
    query: string,
    variables: TVariables,
    retries = 3,
    backoffMs = 2000,
  ): Promise<TData> {
    await this.throttleRequest();

    const fetchFn = isTauriAppPlatform() ? tauriFetch : window.fetch;
    const res = await fetchFn(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: this.token,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 429) {
      if (retries > 0) {
        console.warn(`[Hardcover] 429 Rate Limit hit. Retrying in ${backoffMs}ms...`);
        await sleep(backoffMs);
        return this.request(query, variables, retries - 1, backoffMs * 2);
      }
      throw new Error('Hardcover Rate Limit (429) Exceeded and exhausted retries');
    }

    if (!res.ok) {
      throw new Error(`Hardcover API Error: ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    if (json.errors) {
      throw new Error(`GraphQL Errors: ${JSON.stringify(json.errors)}`);
    }

    return json.data as TData;
  }

  async validateToken(): Promise<{ valid: boolean; isNetworkError?: boolean }> {
    try {
      await this.authenticate();
      return { valid: true };
    } catch (error) {
      const msg = String(error instanceof Error ? error.message : error);
      if (/Failed to fetch|NetworkError|network/i.test(msg)) {
        return { valid: false, isNetworkError: true };
      }
      return { valid: false };
    }
  }

  private async authenticate() {
    if (this.userId) return;
    const data = await this.request<
      Record<string, never>,
      { me: { id: number } | Array<{ id: number }> }
    >(QUERY_GET_USER_ID, {});
    const me = Array.isArray(data.me) ? data.me[0] : data.me;
    if (!me?.id) {
      throw new Error('Invalid Hardcover token: user ID not found');
    }
    this.userId = me.id;
  }

  private normalizeIdentifier(identifier: string): string {
    if (identifier.includes('urn:')) {
      return identifier.match(/[^:]+$/)?.[0] || '';
    }
    if (identifier.includes(':')) {
      return identifier.match(/^[^:]+:(.+)$/)?.[1] || '';
    }
    return identifier;
  }

  private extractISBN(book: Book): string | null {
    const metadata = book.metadata;
    if (!metadata) return null;

    if (metadata.isbn) {
      const normalizedIsbn = metadata.isbn.replace(/[-\s]/g, '');
      if (/^\d{10}(\d{3})?$/.test(normalizedIsbn)) {
        return normalizedIsbn;
      }
    }

    const identifiers: Array<{ scheme?: string; value: string }> = [];
    const pushMaybe = (value?: string, scheme?: string) => {
      if (!value) return;
      identifiers.push({ scheme, value });
    };

    const collect = (raw: unknown) => {
      if (!raw) return;
      if (typeof raw === 'string') {
        pushMaybe(raw);
      } else if (Array.isArray(raw)) {
        for (const item of raw) {
          if (typeof item === 'string') {
            pushMaybe(item);
          } else if (item && typeof item === 'object') {
            const obj = item as { scheme?: string; value?: string };
            pushMaybe(obj.value, obj.scheme);
          }
        }
      } else if (raw && typeof raw === 'object') {
        const obj = raw as { scheme?: string; value?: string };
        pushMaybe(obj.value, obj.scheme);
      }
    };

    collect(metadata.identifier);
    collect(metadata.altIdentifier);

    for (const identifier of identifiers) {
      const scheme = (identifier.scheme || '').toLowerCase();
      const normalized = this.normalizeIdentifier(identifier.value).replace(/[-\s]/g, '');
      const looksLikeISBN = /^\d{10}(\d{3})?$/.test(normalized);
      if (scheme === 'isbn' || identifier.value.toLowerCase().includes('isbn') || looksLikeISBN) {
        return normalized;
      }
    }

    return null;
  }

  private async searchBookIds(query: string): Promise<number[]> {
    const data = await this.request<
      { query: string },
      { search?: { ids?: Array<string | number> | null } | null }
    >(QUERY_SEARCH_BOOKS, { query });
    return (data.search?.ids ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  }

  // Hydrates books by id in the caller's order (search rank); Hasura's `_in`
  // returns rows in arbitrary order.
  private async hydrateBooks(ids: number[]): Promise<BookRow[]> {
    if (ids.length === 0 || !this.userId) return [];
    const data = await this.request<
      { ids: number[]; user_id: number },
      { books?: BookRow[] | null }
    >(QUERY_GET_BOOKS, { ids, user_id: this.userId });
    const byId = new Map((data.books ?? []).map((row) => [Number(row.id), row]));
    const rows: BookRow[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (row) rows.push(row);
    }
    return rows;
  }

  private toBookContext(row: BookRow): BookContext {
    const userBook = row.user_books?.[0];
    const activeRead = userBook?.user_book_reads?.[0];
    const selectedEdition =
      (this.isReadableEdition(activeRead?.edition) ? activeRead?.edition : null) ??
      (this.isReadableEdition(userBook?.edition) ? userBook?.edition : null) ??
      row.editions?.[0] ??
      null;
    const bookPages = row.pages ?? null;

    return {
      // Null when the book has no readable edition and the user picked none —
      // never the book id (#4792).
      editionId: selectedEdition?.id ?? null,
      pages: selectedEdition?.pages ?? bookPages,
      bookId: Number(row.id),
      bookPages,
      title: row.title ?? '',
      userBook: userBook
        ? {
            id: userBook.id,
            status_id: userBook.status_id,
            user_book_reads: userBook.user_book_reads ?? [],
          }
        : null,
    };
  }

  private toCandidate(row: BookRow): HardcoverBookCandidate {
    const contributors = (row.cached_contributors ?? []).filter((c) => c?.author?.name);
    // Plain authors first; narrators, translators, etc. only when nothing else.
    const credited = contributors.filter(
      (c) => !c.contribution || /^author$/i.test(c.contribution),
    );
    const authors: string[] = [];
    for (const contributor of credited.length ? credited : contributors) {
      const name = contributor.author?.name?.trim();
      if (name && !authors.includes(name)) authors.push(name);
    }

    return {
      bookId: Number(row.id),
      title: row.title ?? '',
      authors,
      coverUrl: row.cached_image?.url ?? null,
      releaseYear: row.release_year ?? null,
      pages: row.pages ?? null,
      readersCount: row.users_read_count ?? null,
      ...rowFlags(row),
    };
  }

  /** Search Hardcover for the "Link Book" picker; results keep the search rank. */
  async searchBooks(query: string): Promise<HardcoverBookCandidate[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    await this.authenticate();
    const rows = await this.hydrateBooks(await this.searchBookIds(trimmed));
    return rows.map((row) => this.toCandidate(row));
  }

  private async fetchBookContext(
    book: Book,
    link?: HardcoverBookLink | null,
  ): Promise<BookContext | null> {
    await this.authenticate();

    // A linked book (chosen by the user, or recorded from an earlier match)
    // wins over every heuristic below (#5846).
    if (link) {
      const [row] = await this.hydrateBooks([link.bookId]);
      return row ? this.toBookContext(row) : null;
    }

    const isbn = this.extractISBN(book);
    if (isbn && this.userId) {
      const data = await this.request<
        { isbn: string[]; user_id: number },
        {
          editions?: Array<
            EditionRow & {
              book: {
                id: number;
                title?: string | null;
                pages: number | null;
                user_books?: UserBookRow[];
              };
            }
          >;
        }
      >(QUERY_GET_EDITION, {
        isbn: [isbn],
        user_id: this.userId,
      });

      const edition = data.editions?.[0];
      if (edition) {
        const userBook = edition.book.user_books?.[0];
        const activeRead = userBook?.user_book_reads?.[0];
        const selectedEdition =
          (this.isReadableEdition(activeRead?.edition) ? activeRead?.edition : null) ??
          (this.isReadableEdition(userBook?.edition) ? userBook?.edition : null) ??
          (this.isReadableEdition(edition) ? edition : null);

        return {
          editionId: selectedEdition?.id ?? edition.id,
          pages: selectedEdition?.pages ?? edition.pages,
          bookId: edition.book.id,
          bookPages: edition.book.pages,
          title: edition.book.title || book.title || '',
          userBook: userBook
            ? {
                ...userBook,
                user_book_reads: userBook.user_book_reads ?? [],
              }
            : null,
        };
      }
    }

    if (book.title && book.author) {
      const rows = await this.hydrateBooks(
        await this.searchBookIds(`${book.title} ${book.author}`.trim()),
      );
      const picked = pickAutoMatch(rows.map((row) => ({ row, ...rowFlags(row) })));
      return picked ? this.toBookContext(picked.row) : null;
    }

    return null;
  }

  private hydrateUserBookReads(
    context: BookContext,
    reads?: Array<{ id: number; started_at: string | null }> | null,
  ): void {
    if (!context.userBook) return;
    context.userBook.user_book_reads = reads ?? [];
  }

  private async updateUserBookStatus(context: BookContext, statusId: number): Promise<void> {
    if (!context.userBook || context.userBook.status_id === statusId) return;

    const data = await this.request<
      { user_book_id: number; object: { status_id: number } },
      {
        update_user_book?: {
          user_book?: {
            user_book_reads?: ActiveRead[];
          };
        };
      }
    >(MUTATION_UPDATE_USER_BOOK, {
      user_book_id: context.userBook.id,
      object: { status_id: statusId },
    });

    context.userBook.status_id = statusId;
    this.hydrateUserBookReads(context, data.update_user_book?.user_book?.user_book_reads);
  }

  private async ensureBookInLibrary(
    book: Book,
    link?: HardcoverBookLink | null,
  ): Promise<BookContext | null> {
    const context = await this.fetchBookContext(book, link);
    if (!context) return null;

    if (context.userBook) return context;

    const data = await this.request<
      { object: { book_id: number; edition_id?: number; status_id: number } },
      {
        insert_user_book: {
          error?: string | null;
          user_book: {
            id: number;
            user_book_reads?: ActiveRead[];
          } | null;
        };
      }
    >(MUTATION_INSERT_USER_BOOK, {
      object: {
        book_id: context.bookId,
        // Omit edition_id entirely when unknown so Hardcover falls back to the
        // book's default edition instead of rejecting an invalid one (#4792).
        ...(context.editionId != null ? { edition_id: context.editionId } : {}),
        status_id: 2,
      },
    });

    const newUserBook = data.insert_user_book?.user_book;
    if (!newUserBook?.id) {
      throw new Error(
        `Hardcover insert_user_book failed: ${data.insert_user_book?.error ?? 'no user_book returned'}`,
      );
    }

    return {
      ...context,
      userBook: {
        id: newUserBook.id,
        status_id: 2,
        user_book_reads: newUserBook.user_book_reads ?? [],
      },
    };
  }

  /**
   * Pushes reading progress and returns the Hardcover book it went to, so the
   * caller can remember the match. Throws when no book resolves — a silent
   * return here used to let the UI report a sync that never happened.
   */
  async pushProgress(book: Book, config: BookConfig): Promise<HardcoverBookLink> {
    const context = await this.ensureBookInLibrary(book, config.hardcover);
    const userBook = context?.userBook;
    if (!context || !userBook) {
      throw new Error('Unable to resolve this book in Hardcover');
    }
    const link: HardcoverBookLink = { bookId: context.bookId, title: context.title };

    await this.updateUserBookStatus(context, 2);

    const current = config.progress?.[0] ?? book.progress?.[0] ?? 0;
    const total =
      config.progress?.[1] ?? book.progress?.[1] ?? context.pages ?? context.bookPages ?? 0;
    if (total <= 0) return link;

    const localPagesRead = Math.min(Math.max(current, 0), total);
    const percent = total > 0 ? (localPagesRead / total) * 100 : 0;
    const progressPages = this.getHardcoverProgressPages(current, total, context);
    if (progressPages === null) {
      // Nothing can be scaled onto Hardcover's pages, so nothing is sent; the
      // caller must not report (or remember) a sync that never happened.
      throw new Error('Hardcover has no page count for this book');
    }
    const activeRead = userBook.user_book_reads?.[0];
    const startedAt = this.formatDay(new Date(book.createdAt || Date.now()));

    if (activeRead?.id) {
      await this.request(MUTATION_UPDATE_READ, {
        id: activeRead.id,
        progress_pages: progressPages,
        edition_id: context.editionId,
        started_at: activeRead.started_at || startedAt,
      });
    } else {
      await this.request(MUTATION_INSERT_READ, {
        user_book_id: userBook.id,
        edition_id: context.editionId,
        progress_pages: progressPages,
        started_at: startedAt,
      });
    }

    if (percent >= 100) {
      await this.updateUserBookStatus(context, 3);
    }

    return link;
  }

  private buildJournalPayload(note: BookNote, config: BookConfig, context: BookContext) {
    const totalPages = config.progress?.[1] ?? context.pages ?? context.bookPages ?? 0;
    const fallbackPage = config.progress?.[0] ?? 0;
    const page = note.page && note.page > 0 ? note.page : fallbackPage;
    const boundedPage = Math.max(0, Math.min(page, totalPages || page));
    const percent = totalPages > 0 ? (boundedPage / totalPages) * 100 : 0;

    let entry = '';
    if (note.text?.trim()) {
      entry += note.text.trim();
    }
    if (note.note) {
      if (entry) {
        entry += '\n\n━━━\n\n';
      }
      entry += note.note;
    }

    const finalEntry = entry.trim();

    return {
      event: note.note ? 'note' : 'quote',
      entry: finalEntry,
      page: boundedPage,
      possible: totalPages || Math.max(boundedPage, 1),
      percent,
      action_at: this.formatDate(new Date(note.updatedAt || note.createdAt || Date.now())),
      privacy_setting_id: 3,
    };
  }

  private async insertJournal(
    context: BookContext,
    payload: Record<string, unknown>,
  ): Promise<number> {
    const data = await this.request<
      Record<string, unknown>,
      { insert_reading_journal?: { id?: number; errors?: unknown } }
    >(MUTATION_INSERT_JOURNAL, {
      book_id: context.bookId,
      edition_id: context.editionId,
      ...payload,
    });

    const id = data.insert_reading_journal?.id;
    if (!id) {
      throw new Error('Hardcover insert_reading_journal returned no id');
    }
    return id;
  }

  private async updateJournal(journalId: number, payload: Record<string, unknown>): Promise<void> {
    await this.request(MUTATION_UPDATE_JOURNAL, {
      id: journalId,
      ...payload,
    });
  }

  private isMissingJournalError(error: unknown): boolean {
    const message = String(error instanceof Error ? error.message : error).toLowerCase();
    return (
      message.includes('not found') ||
      message.includes('does not exist') ||
      message.includes('null value')
    );
  }

  async syncBookNotes(
    book: Book,
    config: BookConfig,
  ): Promise<{ inserted: number; updated: number; skipped: number; link: HardcoverBookLink }> {
    const context = await this.ensureBookInLibrary(book, config.hardcover);
    if (!context) {
      throw new Error('Unable to resolve this book in Hardcover');
    }
    const link: HardcoverBookLink = { bookId: context.bookId, title: context.title };

    const rawNotes = (config.booknotes ?? []).filter(
      (note) => (note.type === 'annotation' || note.type === 'excerpt') && !note.deletedAt,
    );

    // Readest can keep both an excerpt (quote) and an annotation (quote + note)
    // for the same highlight. We normalize EPUB CFI range offsets so the same
    // range with small trailing offset differences still dedupes, while keeping
    // the rest of the range path intact.
    const annotationWithNoteKeys = new Set<string>();
    for (const note of rawNotes) {
      if (note.type === 'annotation' && note.note?.trim()) {
        annotationWithNoteKeys.add(this.getNoteDedupKey(note));
      }
    }

    const notes = rawNotes.filter((note) => {
      const key = this.getNoteDedupKey(note);
      if (!annotationWithNoteKeys.has(key)) return true;

      // When a note-bearing annotation exists for the same location and text,
      // suppress quote-like duplicates from both excerpt rows and
      // empty-note annotation rows.
      if (note.type === 'excerpt') return false;
      if (note.type === 'annotation' && !note.note?.trim()) return false;

      return true;
    });

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    try {
      for (const note of notes) {
        const payload = this.buildJournalPayload(note, config, context);
        if (!payload.entry) {
          skipped += 1;
          continue;
        }

        const payloadHash = getContentMd5(payload);
        const existing = await this.mapStore.getMapping(book.hash, note.id);

        if (!existing) {
          const samePayload = await this.mapStore.getMappingByPayloadHash(book.hash, payloadHash);
          if (samePayload) {
            await this.mapStore.upsertMapping(
              book.hash,
              note.id,
              samePayload.hardcover_journal_id,
              payloadHash,
            );
            skipped += 1;
            continue;
          }

          const journalId = await this.insertJournal(context, payload);
          await this.mapStore.upsertMapping(book.hash, note.id, journalId, payloadHash);
          inserted += 1;
          continue;
        }

        if (existing.payload_hash === payloadHash) {
          skipped += 1;
          continue;
        }

        try {
          await this.updateJournal(existing.hardcover_journal_id, payload);
          await this.mapStore.upsertMapping(
            book.hash,
            note.id,
            existing.hardcover_journal_id,
            payloadHash,
          );
          updated += 1;
        } catch (error) {
          if (!this.isMissingJournalError(error)) {
            throw error;
          }
          const journalId = await this.insertJournal(context, payload);
          await this.mapStore.upsertMapping(book.hash, note.id, journalId, payloadHash);
          inserted += 1;
        }
      }
    } finally {
      await this.mapStore.flush();
    }

    return { inserted, updated, skipped, link };
  }
}
