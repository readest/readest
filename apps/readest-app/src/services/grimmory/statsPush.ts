import type { PageStatEvent } from '@/types/statistics';
import type { GrimmoryClient } from './GrimmoryClient';
import { GrimmoryRequestError } from './GrimmoryClient';
import type { GrimmorySyncStore } from './GrimmorySyncStore';

/** A pause longer than this between two page visits starts a new session. */
export const SESSION_GAP_SECONDS = 5 * 60;

export interface ReadingSessionDraft {
  bookMd5: string;
  /** Epoch seconds. */
  startTime: number;
  endTime: number;
  durationSeconds: number;
  /** 0-100. */
  startProgress: number;
  endProgress: number;
}

const percent = (value: number) => Math.round(value * 1000) / 10;

/** Page visits, ordered by start time, joined into reading sessions per book. */
export const groupReadingSessions = (events: PageStatEvent[]): ReadingSessionDraft[] => {
  const sessions: ReadingSessionDraft[] = [];
  const open = new Map<string, ReadingSessionDraft>();
  for (const event of events) {
    const end = event.startTime + event.duration;
    const progress = percent(event.page / event.totalPages);
    const current = open.get(event.bookMd5);
    if (current && event.startTime <= current.endTime + SESSION_GAP_SECONDS) {
      current.endTime = Math.max(current.endTime, end);
      current.durationSeconds += event.duration;
      current.endProgress = progress;
      continue;
    }
    const session: ReadingSessionDraft = {
      bookMd5: event.bookMd5,
      startTime: event.startTime,
      endTime: end,
      durationSeconds: event.duration,
      startProgress: percent((event.page - 1) / event.totalPages),
      endProgress: progress,
    };
    sessions.push(session);
    open.set(event.bookMd5, session);
  }
  return sessions;
};

type CursorKey = `grimmory-push:${string}`;

export interface GrimmoryStatsDb {
  getCursor(key: CursorKey): Promise<number>;
  setCursor(key: CursorKey, value: number): Promise<void>;
  getEventsForPush(sinceStartTime: number): Promise<{ events: PageStatEvent[] }>;
}

type PushParams = {
  db: GrimmoryStatsDb;
  client: Pick<GrimmoryClient, 'getReadingSessions' | 'recordReadingSession'>;
  store: Pick<GrimmorySyncStore, 'getBooks'>;
  account: string;
  /** Epoch seconds. */
  now: number;
  /** Hash of the book open in the reader, if any. */
  readingHash?: string;
};

const toSeconds = (startTime?: string | null) =>
  startTime ? Math.floor(Date.parse(startTime) / 1000) : 0;

/**
 * Start times of the book's sessions on the server, back to `since`.
 * Grimmory pages them newest first.
 */
const serverStartTimes = async (
  client: PushParams['client'],
  bookId: number,
  since: number,
): Promise<Set<number>> => {
  const starts = new Set<number>();
  for (let page = 0; ; page++) {
    const result = await client.getReadingSessions(bookId, page);
    const times = result.content.map((s) => toSeconds(s.startTime));
    for (const time of times) starts.add(time);
    const totalPages = result.page?.totalPages ?? 1;
    if (times.length === 0 || page + 1 >= totalPages || Math.min(...times) < since) return starts;
  }
};

const pushQueues = new Map<string, Promise<unknown>>();

/**
 * Sends the reading sessions recorded since the last push to Grimmory, for
 * the books matched to it. The book still being read keeps its last session
 * until it has ended, so one sitting isn't sent as many sessions. A session
 * the server already has (same start) is not sent again. Pushes to one
 * account take turns, so two of them can't both send the same session.
 */
export const pushStatsToGrimmory = (params: PushParams): Promise<void> => {
  const run = () => pushOnce(params);
  const result = (pushQueues.get(params.account) ?? Promise.resolve()).then(run, run);
  const settled = result.catch(() => undefined);
  pushQueues.set(params.account, settled);
  void settled.then(() => {
    if (pushQueues.get(params.account) === settled) pushQueues.delete(params.account);
  });
  return result;
};

const pushOnce = async (params: PushParams): Promise<void> => {
  const { db, client, store, account, now, readingHash } = params;
  const cursorKey: CursorKey = `grimmory-push:${account}`;
  const cursor = await db.getCursor(cursorKey);
  const { events: rawEvents } = await db.getEventsForPush(cursor);
  const events = rawEvents.filter((e) => e.startTime >= 1 && e.totalPages >= 1 && e.duration > 0);
  if (events.length === 0) return;

  const matches = await store.getBooks(account);
  const sessions = groupReadingSessions(events.filter((e) => matches.has(e.bookMd5)));
  const held = sessions.filter(
    (s) => s.bookMd5 === readingHash && s.endTime > now - SESSION_GAP_SECONDS,
  );
  const ready = sessions.filter((s) => !held.includes(s));

  const byBook = new Map<string, ReadingSessionDraft[]>();
  for (const session of ready) {
    byBook.set(session.bookMd5, [...(byBook.get(session.bookMd5) ?? []), session]);
  }
  for (const [hash, bookSessions] of byBook) {
    const match = matches.get(hash)!;
    try {
      const sent = await serverStartTimes(client, match.bookId, bookSessions[0]!.startTime);
      for (const session of bookSessions) {
        if (sent.has(session.startTime)) continue;
        await client.recordReadingSession({
          bookId: match.bookId,
          ...(match.bookType ? { bookType: match.bookType } : {}),
          startTime: new Date(session.startTime * 1000).toISOString(),
          endTime: new Date(session.endTime * 1000).toISOString(),
          durationSeconds: session.durationSeconds,
          startProgress: session.startProgress,
          endProgress: session.endProgress,
          progressDelta: percent((session.endProgress - session.startProgress) / 100),
        });
      }
    } catch (error) {
      // A book deleted from Grimmory must not hold every other book back.
      if (!(error instanceof GrimmoryRequestError && error.status === 404)) throw error;
    }
  }

  const next = held.length
    ? Math.min(...held.map((s) => s.startTime)) - 1
    : events[events.length - 1]!.startTime;
  if (next > cursor) await db.setCursor(cursorKey, next);
};
