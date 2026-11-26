import { describe, expect, it } from 'vitest';
import {
  describeUserAgent,
  groupSessionsByDevice,
  isDeviceLimitReached,
  type AuthSessionRow,
} from '@/utils/syncDevices';

const UA = {
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  chromeMacNewer:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  safariIPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  appIPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  appIPad:
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  appMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  appAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36',
  chromeAndroidReduced:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  koreader: 'KOReader/v2025.08 (Kindle Paperwhite 5; Linux; arm) LuaSocket/3.0.0',
};

describe('describeUserAgent', () => {
  it.each([
    ['chromeMac', 'Chrome', 'macOS'],
    ['safariIPhone', 'Safari', 'iPhone'],
    ['appIPhone', 'Readest', 'iPhone'],
    ['appIPad', 'Readest', 'iPad'],
    ['appMac', 'Readest', 'macOS'],
    ['appAndroid', 'Readest', 'Pixel 7'],
    ['chromeAndroidReduced', 'Chrome', 'Android'],
    ['edgeWindows', 'Edge', 'Windows'],
    ['firefoxLinux', 'Firefox', 'Linux'],
    ['koreader', 'KOReader', 'Kindle Paperwhite 5'],
  ] as const)('names %s as %s on %s', (key, client, os) => {
    expect(describeUserAgent(UA[key])).toEqual({ client, os });
  });

  it.each([null, '', 'node', 'Go-http-client/1.1'])('knows nothing of %j', (ua) => {
    expect(describeUserAgent(ua)).toBeNull();
  });
});

const session = (
  id: string,
  userAgent: string | null,
  createdAt: string,
  lastActiveAt = createdAt,
): AuthSessionRow => ({
  id,
  user_agent: userAgent,
  created_at: createdAt,
  last_active_at: lastActiveAt,
});

describe('groupSessionsByDevice', () => {
  it('lists two sessions of one kind of device once, across browser versions', () => {
    const devices = groupSessionsByDevice(
      [
        session('a', UA.chromeMac, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'),
        session('b', UA.chromeMacNewer, '2026-03-01T00:00:00Z', '2026-03-05T00:00:00Z'),
      ],
      null,
    );
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      client: 'Chrome',
      os: 'macOS',
      sessionIds: ['a', 'b'],
      firstSeenAt: '2026-01-01T00:00:00Z',
      lastActiveAt: '2026-03-05T00:00:00Z',
      current: false,
    });
  });

  it('keeps every session with an unknown agent as its own device', () => {
    const devices = groupSessionsByDevice(
      [session('a', null, '2026-01-01T00:00:00Z'), session('b', '', '2026-01-02T00:00:00Z')],
      null,
    );
    expect(devices.map((d) => d.sessionIds)).toEqual([['b'], ['a']]);
    expect(devices.every((d) => d.client === null && d.os === null)).toBe(true);
  });

  it('puts this device first, then the most recently active', () => {
    const devices = groupSessionsByDevice(
      [
        session('old', UA.edgeWindows, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
        session('mine', UA.appIPhone, '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z'),
        session('recent', UA.firefoxLinux, '2026-01-01T00:00:00Z', '2026-01-09T00:00:00Z'),
      ],
      'mine',
    );
    expect(devices.map((d) => [d.sessionIds[0], d.current])).toEqual([
      ['mine', true],
      ['recent', false],
      ['old', false],
    ]);
  });
});

describe('isDeviceLimitReached', () => {
  const three = [
    session('a', UA.chromeMac, '2026-01-01T00:00:00Z'),
    session('b', UA.appAndroid, '2026-01-02T00:00:00Z'),
    session('c', UA.koreader, '2026-01-03T00:00:00Z'),
  ];
  const limitFor = (rows: AuthSessionRow[], current: string, limit: number | null) =>
    isDeviceLimitReached(groupSessionsByDevice(rows, current), limit);

  it('blocks a new session once three other devices are signed in', () => {
    const rows = [...three, session('new', UA.appIPhone, '2026-01-04T00:00:00Z')];
    expect(limitFor(rows, 'new', 3)).toBe(true);
  });

  it('lets a new session in while fewer than three other devices are signed in', () => {
    const rows = [...three.slice(0, 2), session('new', UA.appIPhone, '2026-01-04T00:00:00Z')];
    expect(limitFor(rows, 'new', 3)).toBe(false);
  });

  it('lets a device sign in again where it already has a session', () => {
    const rows = [...three, session('new', UA.chromeMacNewer, '2026-01-04T00:00:00Z')];
    expect(limitFor(rows, 'new', 3)).toBe(false);
  });

  // Only devices signed in before this session count, so a device that was
  // signed in first is never sent away by devices that came after it.
  it('never blocks one of the first three devices', () => {
    const rows = [...three, session('d', UA.appIPhone, '2026-01-04T00:00:00Z')];
    expect(limitFor(rows, 'a', 3)).toBe(false);
    expect(limitFor(rows, 'c', 3)).toBe(false);
    expect(limitFor(rows, 'd', 3)).toBe(true);
  });

  // Device A signs in again while a fourth device's sign-in is held: A keeps
  // its place from its first sign-in, and the held device stays out.
  it('keeps the place of a device that signs in again', () => {
    const rows = [
      ...three,
      session('held', UA.appIPhone, '2026-01-04T00:00:00Z'),
      session('a-again', UA.chromeMacNewer, '2026-01-05T00:00:00Z'),
    ];
    expect(limitFor(rows, 'a-again', 3)).toBe(false);
    expect(limitFor(rows, 'held', 3)).toBe(true);
  });

  it('never blocks without a limit', () => {
    const rows = [...three, session('new', UA.appIPhone, '2026-01-04T00:00:00Z')];
    expect(limitFor(rows, 'new', null)).toBe(false);
  });
});
