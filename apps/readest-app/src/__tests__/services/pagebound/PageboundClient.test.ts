import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { Book, BookConfig } from '@/types/book';

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: [string, RequestInit?]) => fetchMock(...args),
}));

import { PageboundClient, loginPagebound } from '@/services/pagebound';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Route = (url: string, init?: RequestInit) => Response | undefined;

const authOk: Route = (url) =>
  url.includes('/auth/get_authed_user') ? json({ user: { id: 1 } }) : undefined;

/** Answers with the first matching route; the session check passes unless overridden. */
const route = (...routes: Route[]) =>
  fetchMock.mockImplementation(async (url, init) => {
    for (const r of [...routes, authOk]) {
      const res = r(url, init);
      if (res) return res;
    }
    throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`);
  });

const on =
  (method: string, path: string, respond: (init?: RequestInit) => Response): Route =>
  (url, init) =>
    (init?.method ?? 'GET') === method && url.includes(path) ? respond(init) : undefined;

const calls = (method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => (init?.method ?? 'GET') === method && url.includes(path),
  );

const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body));

/** Body of the first matching request. */
const sent = (method: string, path: string) => bodyOf(calls(method, path)[0]?.[1]);

const cfg = (config: Partial<BookConfig>) => ({ updatedAt: 0, ...config }) as BookConfig;

const book = { hash: 'h', title: 'Project Hail Mary', author: 'Andy Weir' } as Book;
const LINK = { bookId: 4412, uuid: 'pb-uuid', title: 'Project Hail Mary' };
const remoteBook = { id: 4412, uuid: 'pb-uuid', title: 'Project Hail Mary', page_count: 500 };
const currentUserBook = {
  id: 77,
  uuid: 'ub-uuid',
  status: 'current',
  current_reading_instance: { id: 9, current: true },
};

const newClient = (onSession = vi.fn()) =>
  new PageboundClient({ refreshToken: 'refresh', apiToken: 'api' }, onSession);

describe('loginPagebound', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  test('exchanges the Firebase sign-in for a Pagebound API token', async () => {
    route(
      on('POST', 'accounts:signInWithPassword', () =>
        json({ idToken: 'id-1', refreshToken: 'refresh-1' }),
      ),
      on('POST', '/auth/firebase_auth', () => json({ token: 'api-1' })),
    );

    await expect(loginPagebound('a@b.c', 'pw')).resolves.toEqual({
      refreshToken: 'refresh-1',
      apiToken: 'api-1',
    });
    expect(sent('POST', 'accounts:signInWithPassword')).toMatchObject({
      email: 'a@b.c',
      password: 'pw',
    });
    expect(sent('POST', '/auth/firebase_auth')).toEqual({ id_token: 'id-1' });
  });

  test('surfaces the Firebase error for bad credentials', async () => {
    route(
      on('POST', 'accounts:signInWithPassword', () =>
        json({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, 400),
      ),
    );
    await expect(loginPagebound('a@b.c', 'bad')).rejects.toThrow('INVALID_LOGIN_CREDENTIALS');
    expect(calls('POST', '/auth/firebase_auth')).toHaveLength(0);
  });
});

describe('PageboundClient', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  test('searchBooks maps Typesense hits', async () => {
    route(
      on('GET', 'typesense.net', () =>
        json({
          hits: [
            {
              document: {
                id: '4412',
                uuid: 'pb-uuid',
                title: 'Project Hail Mary',
                author_name: 'Andy Weir',
                image_url: 'https://cdn/x.webp',
              },
            },
          ],
        }),
      ),
    );
    const results = newClient().searchBooks('hail mary');
    await expect(results).resolves.toEqual([
      {
        bookId: 4412,
        uuid: 'pb-uuid',
        title: 'Project Hail Mary',
        author: 'Andy Weir',
        coverUrl: 'https://cdn/x.webp',
      },
    ]);
    const params = new URL(calls('GET', 'typesense.net')[0]![0]).searchParams;
    expect(params.get('sort_by')).toBe('rating_count:desc');
  });

  test('pushes progress scaled onto the Pagebound page count of a linked book', async () => {
    route(
      on('GET', '/books/pb-uuid', () => json({ book: remoteBook, user_book: currentUserBook })),
      on('POST', '/reading_updates', () => json({}, 201)),
    );
    const config = cfg({ progress: [50, 200], pagebound: LINK });

    await expect(newClient().pushProgress(book, config, { broadcast: false })).resolves.toEqual(
      LINK,
    );

    expect(calls('GET', 'typesense.net')).toHaveLength(0);
    expect(sent('POST', '/reading_updates')).toMatchObject({
      reading_update: {
        user_book_id: 77,
        reading_instance_id: 9,
        total_progress: 25,
        total_pages_read: 125,
      },
      user_book: { current_page: 125, total_page_count: 500 },
      no_broadcast: true,
      progress_method: 'pages',
    });
    expect(calls('PUT', '/user_books/')).toHaveLength(0);
  });

  test('falls back to percent when Pagebound has no page count', async () => {
    route(
      on('GET', '/books/pb-uuid', () =>
        json({ book: { ...remoteBook, page_count: null }, user_book: currentUserBook }),
      ),
      on('POST', '/reading_updates', () => json({}, 201)),
    );
    await newClient().pushProgress(book, cfg({ progress: [30, 120], pagebound: LINK }), {
      broadcast: true,
    });
    expect(sent('POST', '/reading_updates')).toMatchObject({
      reading_update: { total_progress: 25, total_pages_read: null },
      no_broadcast: false,
      progress_method: 'percent',
    });
  });

  test('auto-matches by title and author, and shelves an untracked book as current', async () => {
    let shelved = false;
    route(
      on('GET', 'typesense.net', () =>
        json({ hits: [{ document: { id: '4412', uuid: 'pb-uuid', title: 'Project Hail Mary' } }] }),
      ),
      on('GET', '/books/pb-uuid', () =>
        json({ book: remoteBook, user_book: shelved ? currentUserBook : null }),
      ),
      on('POST', '/user_books', () => {
        shelved = true;
        return json({}, 201);
      }),
      on('POST', '/reading_updates', () => json({}, 201)),
    );

    await expect(
      newClient().pushProgress(book, cfg({ progress: [1, 100] }), { broadcast: false }),
    ).resolves.toEqual(LINK);

    expect(new URL(calls('GET', 'typesense.net')[0]![0]).searchParams.get('q')).toBe(
      'Project Hail Mary',
    );
    expect(sent('POST', '/user_books')).toMatchObject({
      user_book: { book_id: 4412, status: 'current' },
      format: 'digital',
      finished_reading_at: null,
      total_page_count: 500,
    });
    expect(calls('POST', '/reading_updates')).toHaveLength(1);
  });

  test('auto-match only accepts a title match, trying each part of a "Series: Title"', async () => {
    const doc = (uuid: string, title: string) => ({ document: { id: '7', uuid, title } });
    const searched: string[] = [];
    const typesense: Route = (url) => {
      const { hostname, searchParams } = new URL(url);
      if (!hostname.endsWith('.typesense.net')) return undefined;
      const q = searchParams.get('q')!;
      searched.push(q);
      return q === 'the final empire'
        ? json({ hits: [doc('final-empire', 'The Final Empire'), doc('x', 'Mistborn')] })
        : json({
            hits: [
              doc('', 'Mistborn: The Final Empire'),
              doc('drama', 'The Final Empire (1 of 3) [Dramatized Adaptation]'),
            ],
          });
    };
    route(
      typesense,
      on('GET', '/books/final-empire', () =>
        json({ book: remoteBook, user_book: currentUserBook }),
      ),
      on('POST', '/reading_updates', () => json({}, 201)),
    );
    const mistborn = { ...book, title: 'Mistborn: The Final Empire', author: 'Brandon Sanderson' };

    const link = await newClient().pushProgress(mistborn, cfg({ progress: [1, 100] }), {
      broadcast: false,
    });

    expect(link.uuid).toBe(remoteBook.uuid);
    expect(calls('GET', '/books/drama')).toHaveLength(0);
    expect(searched).toEqual(['Mistborn: The Final Empire', 'mistborn', 'the final empire']);
  });

  // Pagebound spells authors its own way ("J.R.R. Tolkien"), and Typesense
  // needs every query word to match, so the author never goes in the query.
  test('auto-match searches by title and prefers the same author however it is spelled', async () => {
    const hit = (uuid: string, author: string) => ({
      document: { id: '5', uuid, title: 'The Hobbit', author_name: author },
    });
    route(
      on('GET', 'typesense.net', () =>
        json({ hits: [hit('dixon', 'Chuck Dixon'), hit('tolkien', 'J.R.R. Tolkien')] }),
      ),
      on('GET', '/books/tolkien', () => json({ book: remoteBook, user_book: currentUserBook })),
      on('POST', '/reading_updates', () => json({}, 201)),
    );
    const hobbit = { ...book, title: 'The Hobbit', author: 'J. R. R. Tolkien' };

    await newClient().pushProgress(hobbit, cfg({ progress: [1, 100] }), { broadcast: false });

    expect(new URL(calls('GET', 'typesense.net')[0]![0]).searchParams.get('q')).toBe('The Hobbit');
    expect(calls('GET', '/api/v1/books/dixon')).toHaveLength(0);
  });

  test('auto-match fails over to Link Book when no title matches', async () => {
    route(
      on('GET', 'typesense.net', () =>
        json({
          hits: [{ document: { id: '9', uuid: 'guide', title: 'Project Hail Mary: Study Guide' } }],
        }),
      ),
    );
    await expect(
      newClient().pushProgress(book, cfg({ progress: [1, 100] }), { broadcast: false }),
    ).rejects.toThrow(/Link Book/);
    expect(calls('GET', '/api/v1/books/')).toHaveLength(0);
  });

  test('moves a shelved book to current before updating progress', async () => {
    let status = 'interested';
    route(
      on('GET', '/books/pb-uuid', () =>
        json({
          book: remoteBook,
          user_book: status === 'current' ? currentUserBook : { id: 77, uuid: 'ub-uuid', status },
        }),
      ),
      on('PUT', '/user_books/ub-uuid', (init) => {
        status = bodyOf(init).status;
        return json({});
      }),
      on('POST', '/reading_updates', () => json({}, 201)),
    );
    await newClient().pushProgress(book, cfg({ progress: [10, 100], pagebound: LINK }), {
      broadcast: false,
    });
    expect(status).toBe('current');
    expect(calls('POST', '/reading_updates')).toHaveLength(1);
  });

  test('marks the book finished at the last page', async () => {
    route(
      on('GET', '/books/pb-uuid', () => json({ book: remoteBook, user_book: currentUserBook })),
      on('POST', '/reading_updates', () => json({}, 201)),
      on('PUT', '/user_books/ub-uuid', () => json({})),
    );
    await newClient().pushProgress(book, cfg({ progress: [100, 100], pagebound: LINK }), {
      broadcast: false,
    });
    expect(sent('PUT', '/user_books/ub-uuid')).toMatchObject({ status: 'finished' });
  });

  test('never reopens a book finished on Pagebound', async () => {
    route(
      on('GET', '/books/pb-uuid', () =>
        json({ book: remoteBook, user_book: { ...currentUserBook, status: 'finished' } }),
      ),
    );
    await expect(
      newClient().pushProgress(book, cfg({ progress: [3, 100], pagebound: LINK }), {
        broadcast: false,
      }),
    ).rejects.toThrow(/finished/);
    expect(calls('PUT', '/user_books/')).toHaveLength(0);
    expect(calls('POST', '/reading_updates')).toHaveLength(0);
  });

  // Pagebound never answers a stale token with 401: public reads such as a
  // book come back anonymous (no user_book) and writes fail validation.
  test('renews a stale API token before syncing and reports the new session', async () => {
    const valid = 'api-2';
    const authed = (init?: RequestInit) =>
      (init?.headers as Record<string, string>)['Authorization'] === `Bearer ${valid}`;
    route(
      on('GET', '/auth/get_authed_user', (init) =>
        authed(init) ? json({ user: { id: 1 } }) : json({}, 500),
      ),
      on('GET', '/books/pb-uuid', (init) =>
        json({ book: remoteBook, user_book: authed(init) ? currentUserBook : null }),
      ),
      on('POST', '/user_books', () => json({ error: 'Validation failed: User must exist' }, 422)),
      on('POST', 'securetoken.googleapis.com', () =>
        json({ id_token: 'id-2', refresh_token: 'refresh-2' }),
      ),
      on('POST', '/auth/firebase_auth', () => json({ token: valid })),
      on('POST', '/reading_updates', () => json({}, 201)),
    );
    const onSession = vi.fn();

    await newClient(onSession).pushProgress(book, cfg({ progress: [10, 100], pagebound: LINK }), {
      broadcast: false,
    });

    expect(onSession).toHaveBeenCalledWith({ refreshToken: 'refresh-2', apiToken: 'api-2' });
    expect(calls('POST', '/user_books')).toHaveLength(0);
    expect(calls('POST', '/reading_updates')).toHaveLength(1);
  });

  test('asks to sign in again when the refresh token is revoked', async () => {
    route(
      on('GET', '/auth/get_authed_user', () => json({}, 500)),
      on('POST', 'securetoken.googleapis.com', () =>
        json({ error: { message: 'TOKEN_EXPIRED' } }, 400),
      ),
    );
    await expect(
      newClient().pushProgress(book, cfg({ progress: [1, 10], pagebound: LINK }), {
        broadcast: false,
      }),
    ).rejects.toThrow(/Sign in again/);
    expect(calls('GET', '/api/v1/books/')).toHaveLength(0);
  });
});
