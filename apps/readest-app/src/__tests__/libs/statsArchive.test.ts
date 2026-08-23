import { describe, it, expect } from 'vitest';
import {
  SEGMENT_VERSION,
  segmentKey,
  encodeSegment,
  decodeSegment,
  takePage,
  guardArchiveRequest,
  isCompactionEnabled,
  readCompactConfig,
  tsToMs,
  type ArchivedPageRow,
  type StatsSegment,
} from '@/libs/statsArchive';

describe('tsToMs', () => {
  it('parses PostgREST timestamptz strings, truncating microseconds to the millisecond', () => {
    expect(tsToMs('2026-07-01T00:00:00.123456+00:00')).toBe(Date.parse('2026-07-01T00:00:00.123Z'));
    expect(tsToMs('2026-07-01T00:00:01.5+00:00')).toBe(Date.parse('2026-07-01T00:00:01.500Z'));
    expect(tsToMs('1970-01-01T00:00:00+00:00')).toBe(0);
    expect(tsToMs('2026-07-01T02:00:00.999999+02:00')).toBe(Date.parse('2026-07-01T00:00:00.999Z'));
  });
});

const row = (updated_at_ms: number, over: Partial<ArchivedPageRow> = {}): ArchivedPageRow => ({
  book_hash: 'h1',
  page: 1,
  start_time: updated_at_ms,
  duration: 5,
  total_pages: 10,
  ext: null,
  deleted_at: null,
  updated_at_ms,
  ...over,
});

const segment = (rows: ArchivedPageRow[]): StatsSegment => ({
  v: SEGMENT_VERSION,
  user_id: 'u1',
  updated_from_ms: 0,
  updated_to_ms: rows.reduce((m, r) => Math.max(m, r.updated_at_ms), 0),
  rows,
});

describe('statsArchive segment codec', () => {
  it('names objects by user and updated_to_ms', () => {
    expect(segmentKey('u1', 1787454881000)).toBe('stats/v1/u1/1787454881000.json');
  });

  it('round-trips a segment with a stable key order and sorted rows', () => {
    const text = encodeSegment(segment([row(200), row(100, { ext: { src: 'tts' } })]));
    // rows sorted by (updated_at_ms, book_hash, page, start_time); keys in wire order
    expect(text).toBe(
      '{"v":1,"user_id":"u1","updated_from_ms":0,"updated_to_ms":200,"rows":[' +
        '{"book_hash":"h1","page":1,"start_time":100,"duration":5,"total_pages":10,"ext":{"src":"tts"},"deleted_at":null,"updated_at_ms":100},' +
        '{"book_hash":"h1","page":1,"start_time":200,"duration":5,"total_pages":10,"ext":null,"deleted_at":null,"updated_at_ms":200}]}',
    );
    const back = decodeSegment(text);
    expect(back.rows.map((r) => r.updated_at_ms)).toEqual([100, 200]);
    expect(back.rows[0]!.ext).toEqual({ src: 'tts' });
  });

  it('rejects unknown versions and malformed rows', () => {
    expect(() =>
      decodeSegment('{"v":2,"user_id":"u1","updated_from_ms":0,"updated_to_ms":1,"rows":[]}'),
    ).toThrow(/version/);
    expect(() =>
      decodeSegment(
        '{"v":1,"user_id":"u1","updated_from_ms":0,"updated_to_ms":1,"rows":[{"page":1}]}',
      ),
    ).toThrow(/row/);
    expect(() => decodeSegment('not json')).toThrow();
  });
});

describe('takePage', () => {
  const rows = [
    row(100),
    row(200),
    row(300, { page: 1 }),
    row(300, { page: 2 }),
    row(300, { page: 3 }),
    row(400),
  ];

  it('returns rows strictly after since, up to limit, extended to the trailing millisecond', () => {
    // limit 2 from since=100 -> 200, 300(p1); 300 has ties -> include all of 300
    expect(takePage(rows, 100, 2).map((r) => [r.updated_at_ms, r.page])).toEqual([
      [200, 1],
      [300, 1],
      [300, 2],
      [300, 3],
    ]);
  });

  it('honors the book filter and returns an empty page when nothing matches', () => {
    expect(takePage(rows, 0, 10, 'other')).toEqual([]);
    expect(takePage(rows, 0, 10, 'h1')).toHaveLength(6);
    expect(takePage(rows, 400, 10)).toEqual([]);
  });

  it('returns everything after since when limit is 0 (unpaginated)', () => {
    expect(takePage(rows, 200, 0).map((r) => r.updated_at_ms)).toEqual([300, 300, 300, 400]);
  });
});

describe('guardArchiveRequest', () => {
  const bucket = {} as never;
  const req = (token?: string) =>
    new Request('https://web.readest.com/api/stats/compact', {
      method: 'POST',
      headers: token ? { 'x-compact-token': token } : {},
    });

  it('reports 503 before 401 when the feature is not configured', () => {
    expect(guardArchiveRequest(req('t'), {}, 'compact')).toMatchObject({ ok: false, status: 503 });
    expect(guardArchiveRequest(req('x'), { STATS_ARCHIVE_R2: bucket }, 'compact')).toMatchObject({
      ok: false,
      status: 503,
    }); // no token: 503 even with a wrong header
    expect(
      guardArchiveRequest(
        req('t'),
        { STATS_COMPACT_TOKEN: 't', STATS_COMPACT_ENABLED: 'true' },
        'compact',
      ),
    ).toMatchObject({ ok: false, status: 503 }); // no bucket
  });

  it('rejects a wrong token with 401 and accepts the right one, whether or not compaction is enabled', () => {
    const base = { STATS_COMPACT_TOKEN: 't', STATS_ARCHIVE_R2: bucket };
    for (const env of [base, { ...base, STATS_COMPACT_ENABLED: 'true' }]) {
      expect(guardArchiveRequest(req('nope'), env, 'compact')).toMatchObject({
        ok: false,
        status: 401,
      });
      expect(guardArchiveRequest(req(), env, 'compact')).toMatchObject({ ok: false, status: 401 });
      expect(guardArchiveRequest(req('t'), env, 'compact')).toMatchObject({ ok: true });
    }
    // the kill switch is the route's business, not the guard's
    expect(isCompactionEnabled(base)).toBe(false);
    expect(isCompactionEnabled({ ...base, STATS_COMPACT_ENABLED: 'true' })).toBe(true);
    expect(isCompactionEnabled({ ...base, STATS_COMPACT_ENABLED: 'TRUE' })).toBe(false);
  });

  it('restore works while compaction is disabled and refuses with 409 while it is enabled', () => {
    const base = { STATS_COMPACT_TOKEN: 't', STATS_ARCHIVE_R2: bucket };
    expect(guardArchiveRequest(req('t'), base, 'restore')).toMatchObject({ ok: true });
    expect(
      guardArchiveRequest(req('t'), { ...base, STATS_COMPACT_ENABLED: 'true' }, 'restore'),
    ).toMatchObject({ ok: false, status: 409 });
    expect(guardArchiveRequest(req('x'), base, 'restore')).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(guardArchiveRequest(req('t'), { STATS_COMPACT_TOKEN: 't' }, 'restore')).toMatchObject({
      ok: false,
      status: 503,
    });
  });
});

describe('readCompactConfig', () => {
  it('uses the documented defaults', () => {
    expect(readCompactConfig({})).toEqual({
      usersPerRun: 50,
      windowDays: 7,
      minRows: 500,
      maxAgeDays: 30,
      hotCap: 20000,
      segmentsPerUser: 5,
      segmentRows: 10000,
    });
  });

  it('accepts integer overrides and falls back on garbage or out-of-range values', () => {
    expect(
      readCompactConfig({
        STATS_COMPACT_USERS_PER_RUN: '10',
        STATS_COMPACT_WINDOW_DAYS: '14',
        STATS_COMPACT_MIN_ROWS: 'abc',
        STATS_COMPACT_MAX_AGE_DAYS: '0',
        STATS_COMPACT_HOT_CAP: '-5',
        STATS_COMPACT_SEGMENTS_PER_USER: '2',
        STATS_COMPACT_SEGMENT_ROWS: '2.5',
      }),
    ).toEqual({
      usersPerRun: 10,
      windowDays: 14,
      minRows: 500,
      maxAgeDays: 30,
      hotCap: 20000,
      segmentsPerUser: 2,
      segmentRows: 10000,
    });
  });

  it('falls back on digit strings beyond the safe integer range', () => {
    expect(
      readCompactConfig({
        STATS_COMPACT_SEGMENT_ROWS: '99999999999999999999',
        STATS_COMPACT_USERS_PER_RUN: '9007199254740993',
      }),
    ).toMatchObject({ segmentRows: 10000, usersPerRun: 50 });
  });
});
