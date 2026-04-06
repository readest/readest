import { Book, BookConfig, BookNote } from '@/types/book';
import { getContentMd5 } from '@/utils/misc';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { HardcoverSyncMapStore } from './HardcoverSyncMapStore';
import {
  QUERY_GET_USER_ID,
  QUERY_SEARCH_BOOK,
  QUERY_GET_EDITION,
  QUERY_GET_BOOK_USER_DATA,
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
  editionId: number;
  pages: number | null;
  bookId: number;
  bookPages: number | null;
  userBook: {
    id: number;
    status_id: number;
    user_book_reads: Array<{ id: number; started_at: string | null }>;
  } | null;
};

type ActiveRead = { id: number; started_at: string | null };

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

  private async searchBookByTitle(title: string, author: string): Promise<BookContext | null> {
    await this.authenticate();
    const query = `${title} ${author}`.trim();
    const data = await this.request<{ query: string }, { search?: { results?: unknown } }>(
      QUERY_SEARCH_BOOK,
      { query },
    );

    const rawResults = data.search?.results;
    let hits: unknown[] = [];
    if (typeof rawResults === 'string') {
      try {
        hits = JSON.parse(rawResults);
      } catch {
        hits = [];
      }
    } else if (
      rawResults &&
      typeof rawResults === 'object' &&
      'hits' in rawResults &&
      Array.isArray((rawResults as { hits?: unknown[] }).hits)
    ) {
      hits = (rawResults as { hits: unknown[] }).hits;
    } else if (Array.isArray(rawResults)) {
      hits = rawResults;
    }

    const hit = (hits[0] || {}) as {
      id?: number;
      pages?: number;
      featured_edition_id?: number;
      document?: { id?: number; pages?: number; featured_edition_id?: number };
    };

    const rawBookId = hit.id ?? hit.document?.id;
    if (!rawBookId) return null;

    const bookId = Number(rawBookId);
    const editionId = Number(
      hit.featured_edition_id ?? hit.document?.featured_edition_id ?? bookId,
    );
    const pages =
      hit.pages != null
        ? Number(hit.pages)
        : hit.document?.pages != null
          ? Number(hit.document.pages)
          : null;

    return {
      editionId,
      pages,
      bookId,
      bookPages: pages,
      userBook: null,
    };
  }

  private async fetchBookContext(book: Book): Promise<BookContext | null> {
    await this.authenticate();
    const isbn = this.extractISBN(book);

    if (isbn && this.userId) {
      const data = await this.request<
        { isbn: string[]; user_id: number },
        {
          editions?: Array<{
            id: number;
            pages: number | null;
            reading_format_id?: number | null;
            book: {
              id: number;
              pages: number | null;
              user_books?: Array<{
                id: number;
                status_id: number;
                edition?: {
                  id: number;
                  pages: number | null;
                  reading_format_id?: number | null;
                } | null;
                user_book_reads?: Array<{
                  id: number;
                  started_at: string | null;
                  edition?: {
                    id: number;
                    pages: number | null;
                    reading_format_id?: number | null;
                  } | null;
                }>;
              }>;
            };
          }>;
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
      const titleContext = await this.searchBookByTitle(book.title, book.author);
      if (!titleContext || !this.userId) return titleContext;

      const bookResult = await this.request<
        { book_id: number; user_id: number },
        {
          editions?: Array<{
            book: {
              id: number;
              pages: number | null;
              user_books?: Array<{
                id: number;
                status_id: number;
                edition?: {
                  id: number;
                  pages: number | null;
                  reading_format_id?: number | null;
                } | null;
                user_book_reads?: Array<{
                  id: number;
                  started_at: string | null;
                  edition?: {
                    id: number;
                    pages: number | null;
                    reading_format_id?: number | null;
                  } | null;
                }>;
              }>;
            };
          }>;
        }
      >(QUERY_GET_BOOK_USER_DATA, { book_id: titleContext.bookId, user_id: this.userId });

      const bookData = bookResult.editions?.[0]?.book;
      if (!bookData) return titleContext;

      const userBook = bookData.user_books?.[0];
      const activeRead = userBook?.user_book_reads?.[0];
      const selectedEdition =
        (this.isReadableEdition(activeRead?.edition) ? activeRead?.edition : null) ??
        (this.isReadableEdition(userBook?.edition) ? userBook?.edition : null);

      return {
        ...titleContext,
        editionId: selectedEdition?.id ?? titleContext.editionId,
        pages: selectedEdition?.pages ?? titleContext.pages,
        bookPages: bookData.pages ?? titleContext.bookPages,
        userBook: userBook
          ? { ...userBook, user_book_reads: userBook.user_book_reads ?? [] }
          : null,
      };
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

  private async ensureBookInLibrary(book: Book, isReading = true): Promise<BookContext | null> {
    const context = await this.fetchBookContext(book);
    if (!context) return null;

    if (context.userBook) return context;

    const data = await this.request<
      { object: { book_id: number; edition_id: number; status_id: number } },
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
        edition_id: context.editionId,
        status_id: isReading ? 2 : 1,
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
        status_id: isReading ? 2 : 1,
        user_book_reads: newUserBook.user_book_reads ?? [],
      },
    };
  }

  async pushProgress(book: Book, config: BookConfig): Promise<void> {
    const context = await this.ensureBookInLibrary(book, true);
    if (!context?.userBook) return;

    await this.updateUserBookStatus(context, 2);

    const current = config.progress?.[0] ?? book.progress?.[0] ?? 0;
    const total =
      config.progress?.[1] ?? book.progress?.[1] ?? context.pages ?? context.bookPages ?? 0;
    if (total <= 0) return;

    const localPagesRead = Math.min(Math.max(current, 0), total);
    const percent = total > 0 ? (localPagesRead / total) * 100 : 0;
    const progressPages = this.getHardcoverProgressPages(current, total, context);
    if (progressPages === null) return;
    const activeRead = context.userBook.user_book_reads?.[0];
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
        user_book_id: context.userBook.id,
        edition_id: context.editionId,
        progress_pages: progressPages,
        started_at: startedAt,
      });
    }

    if (percent >= 100) {
      await this.updateUserBookStatus(context, 3);
    }
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
  ): Promise<{ inserted: number; updated: number; skipped: number }> {
    const context = await this.ensureBookInLibrary(book, true);
    if (!context) {
      throw new Error('Unable to resolve this book in Hardcover');
    }

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

    return { inserted, updated, skipped };
  }
}
