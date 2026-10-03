import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { Book, BookConfig, PageboundBookLink } from '@/types/book';

// Pagebound has no public API. These are the endpoints and public client keys
// its own web app uses (https://pagebound.co): Firebase email/password auth,
// exchanged for a Pagebound API token, and a search-only Typesense key. The
// API sends no CORS headers, so this only runs through the native HTTP client.
const API_URL = 'https://prod-pagebound-api.onrender.com/api/v1';
const FIREBASE_API_KEY = 'AIzaSyDCfBJ51pRZgHueBfBz0KNDiPNev1ClnGg';
const SIGN_IN_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
const REFRESH_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
const TYPESENSE_URL =
  'https://hztadco4ku1vqi6lp.a1.typesense.net/collections/books/documents/search';
const TYPESENSE_API_KEY = 'SgSrp2Vx4V4wjJAwnME6uWUufNdi9BxM';

export interface PageboundSession {
  refreshToken: string;
  apiToken: string;
}

export interface PageboundBookCandidate {
  bookId: number;
  uuid: string;
  title: string;
  author: string;
  coverUrl: string | null;
}

type ReadingInstance = { id: number; current?: boolean };

type UserBook = {
  id: number;
  uuid: string;
  status: string;
  total_page_count?: number | string | null;
  current_reading_instance?: ReadingInstance | null;
  reading_instances?: ReadingInstance[] | null;
};

type BookResponse = {
  book: { id: number; uuid: string; title: string; page_count?: number | null };
  user_book?: UserBook | null;
};

// Pagebound dates are M/D/YYYY in local time, as its web app sends them.
const today = () => {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
};

const normalizeTitle = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

// "J. R. R. Tolkien" and "J.R.R. Tolkien" are the same author.
const compactName = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const readJson = async (res: Response): Promise<Record<string, unknown> | null> => {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const errorMessage = (data: Record<string, unknown> | null, fallback: string) => {
  const error = data?.['error'];
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return fallback;
};

const exchangeIdToken = async (idToken: string): Promise<string> => {
  const res = await tauriFetch(`${API_URL}/auth/firebase_auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken }),
  });
  const data = await readJson(res);
  if (!res.ok || typeof data?.['token'] !== 'string') {
    throw new Error(errorMessage(data, `Pagebound sign-in failed (HTTP ${res.status})`));
  }
  return data['token'];
};

/** Signs in with a Pagebound email and password; the password is not kept. */
export const loginPagebound = async (email: string, password: string) => {
  const res = await tauriFetch(SIGN_IN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await readJson(res);
  if (!res.ok || typeof data?.['idToken'] !== 'string') {
    throw new Error(errorMessage(data, `Pagebound sign-in failed (HTTP ${res.status})`));
  }
  const apiToken = await exchangeIdToken(data['idToken']);
  return { refreshToken: String(data['refreshToken']), apiToken } satisfies PageboundSession;
};

export class PageboundClient {
  private session: PageboundSession;
  private onSessionChange: (session: PageboundSession) => void | Promise<void>;

  constructor(
    session: PageboundSession,
    onSessionChange: (session: PageboundSession) => void | Promise<void>,
  ) {
    this.session = { ...session };
    this.onSessionChange = onSessionChange;
  }

  private async renewSession() {
    const res = await tauriFetch(REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(this.session.refreshToken)}`,
    });
    const data = await readJson(res);
    if (!res.ok || typeof data?.['id_token'] !== 'string') {
      throw new Error('Pagebound session expired. Sign in again in Settings.');
    }
    this.session = {
      refreshToken: String(data['refresh_token'] ?? this.session.refreshToken),
      apiToken: await exchangeIdToken(data['id_token']),
    };
    await this.onSessionChange(this.session);
  }

  private fetchApi(path: string, method = 'GET', body?: unknown) {
    return tauriFetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.session.apiToken}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  // Pagebound never answers a stale token with 401: a book comes back as if
  // anonymous (no shelf entry) and writes fail validation. So check the token
  // up front and renew it when Pagebound no longer knows the user.
  private async ensureSession() {
    const res = await this.fetchApi('/auth/get_authed_user');
    if (!res.ok) await this.renewSession();
  }

  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const res = await this.fetchApi(path, method, body);
    const data = await readJson(res);
    if (!res.ok) {
      throw new Error(errorMessage(data, `Pagebound API error (HTTP ${res.status})`));
    }
    return data as T;
  }

  /** Search Pagebound's catalog, most-rated first as on pagebound.co. */
  async searchBooks(query: string): Promise<PageboundBookCandidate[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const params = new URLSearchParams({
      q: trimmed,
      query_by: 'title,author_name',
      limit: '10',
      num_typos: '2',
      // Without it, study guides and companions outrank the book itself.
      sort_by: 'rating_count:desc',
    });
    const res = await tauriFetch(`${TYPESENSE_URL}?${params}`, {
      headers: { 'X-TYPESENSE-API-KEY': TYPESENSE_API_KEY },
    });
    const data = (await readJson(res)) as {
      hits?: Array<{ document: Record<string, string | undefined> }>;
    } | null;
    if (!res.ok || !data?.hits) throw new Error(`Pagebound search failed (HTTP ${res.status})`);
    return data.hits.map(({ document: doc }) => ({
      bookId: Number(doc['id']),
      uuid: doc['uuid'] ?? '',
      title: doc['title'] ?? '',
      author: doc['author_name'] ?? '',
      coverUrl: doc['image_url'] || null,
    }));
  }

  // Search ranks by popularity, not title, so a hit is only taken when its
  // title matches, preferring the same author. The author stays out of the
  // query: Pagebound spells names its own way ("J.R.R. Tolkien") and Typesense
  // needs every query word to match. Pagebound often drops a "Series:" prefix
  // or a subtitle, so each part of a "Series: Title" is searched for too.
  private async resolveLink(book: Book, config: BookConfig): Promise<PageboundBookLink> {
    if (config.pagebound) return config.pagebound;
    const parts = book.title.includes(':')
      ? book.title.split(':').map(normalizeTitle).filter(Boolean)
      : [];
    const titles = new Set([normalizeTitle(book.title), ...parts]);
    for (const query of [book.title, ...parts]) {
      const matches = (await this.searchBooks(query)).filter(
        (hit) => hit.uuid && Number.isFinite(hit.bookId) && titles.has(normalizeTitle(hit.title)),
      );
      const author = compactName(book.author);
      const match = matches.find((hit) => compactName(hit.author) === author) ?? matches[0];
      if (match) return { bookId: match.bookId, uuid: match.uuid, title: match.title };
    }
    throw new Error('Unable to find this book on Pagebound. Use Link Book to choose it.');
  }

  private getBook(uuid: string) {
    return this.request<BookResponse>(`/books/${encodeURIComponent(uuid)}`);
  }

  private setStatus(userBook: UserBook, status: 'current' | 'finished') {
    const date = today();
    return this.request(`/user_books/${encodeURIComponent(userBook.uuid)}`, 'PUT', {
      status,
      date,
      ...(status === 'current' ? { started_reading_at: date } : { finished_reading_at: date }),
    });
  }

  /**
   * Pushes reading progress and returns the Pagebound book it went to, so the
   * caller can remember the match. `broadcast` shares the update with the
   * user's followers, as Pagebound's own progress dialog does by default.
   */
  async pushProgress(
    book: Book,
    config: BookConfig,
    { broadcast }: { broadcast: boolean },
  ): Promise<PageboundBookLink> {
    await this.ensureSession();
    const link = await this.resolveLink(book, config);
    let { book: remote, user_book: userBook } = await this.getBook(link.uuid);
    // Reopening a finished book here would start a new read on Pagebound and
    // rewrite the user's stats; a re-read is the user's call, made there.
    if (userBook?.status === 'finished') {
      throw new Error('This book is already marked as finished on Pagebound');
    }

    if (!userBook || userBook.status !== 'current') {
      if (userBook) {
        await this.setStatus(userBook, 'current');
      } else {
        const date = today();
        await this.request('/user_books', 'POST', {
          user_book: { book_id: remote.id, status: 'current', owned: false, muted: false },
          shelf_ids: [],
          date,
          started_reading_at: date,
          // Empty strings here make Pagebound fail with a 500.
          finished_reading_at: null,
          challenge_year: null,
          format: 'digital',
          tracking_mode: 'pages',
          total_page_count: remote.page_count || null,
          total_minutes: null,
        });
      }
      ({ book: remote, user_book: userBook } = await this.getBook(link.uuid));
    }

    const instance =
      userBook?.current_reading_instance ?? userBook?.reading_instances?.find((r) => r.current);
    if (!userBook || !instance) throw new Error('No active Pagebound reading session');

    const [current = 0, total = 0] = config.progress ?? book.progress ?? [];
    const fraction = total > 0 ? Math.min(Math.max(current / total, 0), 1) : 0;
    const percent = Math.floor(fraction * 100);
    // Readest's page count is its own layout; scale onto Pagebound's edition.
    const remotePages = Number(userBook.total_page_count) || Number(remote.page_count) || 0;
    const page = remotePages > 0 ? Math.round(fraction * remotePages) : null;

    await this.request('/reading_updates', 'POST', {
      reading_update: {
        user_book_id: userBook.id,
        date: today(),
        total_progress: percent,
        total_pages_read: page,
        reading_instance_id: instance.id,
      },
      user_book: {
        current_page: page,
        total_page_count: remotePages || null,
        current_minute: null,
        total_minutes: null,
      },
      no_broadcast: !broadcast,
      progress_method: page === null ? 'percent' : 'pages',
    });

    if (percent >= 100) await this.setStatus(userBook, 'finished');

    return { bookId: remote.id, uuid: remote.uuid, title: remote.title };
  }
}
