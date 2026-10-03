import { describe, expect, it, vi } from 'vitest';

// Audio must never be relayed through Readest's own proxy: an audiobook is
// hundreds of MB of the user's private, self-hosted library, and a shared
// deployment has no business carrying it. These tests pin that policy.
vi.mock('@/app/opds/utils/opdsReq', () => ({
  needsProxy: (url: string) => url.startsWith('http') && h.isWeb,
  probeAuth: async () => h.probeImpl(),
  createBasicAuth: (u: string, p: string) => 'Basic ' + btoa(`${u}:${p}`),
  withOriginSuppressed: (v: Record<string, string>) => v,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ settings: { opdsCatalogs: h.catalog ? [h.catalog] : [] } }),
  },
}));

const h = vi.hoisted(() => ({
  isWeb: false,
  probeImpl: (): string | null => null,
  catalog: undefined as Record<string, unknown> | undefined,
}));

const { buildOpdsAudioUrl, canStreamOpdsAudio, needsAudioAuth, opdsAudioBlocker } = await import(
  '@/services/opds/audioStream'
);

const CATALOG = 'https://books.example.com/opds/7/download?fileId=8';
const ORIGIN = 'https://books.example.com';
const open = { authHeader: null, customHeaders: {}, hasCredentials: false, origin: ORIGIN };
const authed = {
  authHeader: 'Basic abc',
  customHeaders: {},
  hasCredentials: true,
  origin: ORIGIN,
};
const headered = {
  authHeader: null,
  customHeaders: { 'CF-Access-Client-Id': 'x' },
  hasCredentials: false,
  origin: ORIGIN,
};

describe('buildOpdsAudioUrl', () => {
  it('always hands back the catalog URL, never a proxied one', () => {
    h.isWeb = true;
    expect(buildOpdsAudioUrl(CATALOG)).toBe(CATALOG);
    h.isWeb = false;
    expect(buildOpdsAudioUrl(CATALOG)).toBe(CATALOG);
  });
});

describe('needsAudioAuth', () => {
  it('counts custom headers as credentials, not just basic auth', () => {
    expect(needsAudioAuth(open)).toBe(false);
    expect(needsAudioAuth(authed)).toBe(true);
    expect(needsAudioAuth(headered)).toBe(true);
  });
});

describe('canStreamOpdsAudio', () => {
  it('streams only what the media element can fetch unaided', () => {
    expect(canStreamOpdsAudio(open)).toBe(true);
    expect(canStreamOpdsAudio(authed)).toBe(false);
  });
});

describe('opdsAudioBlocker', () => {
  it('blocks an authenticated catalog on web, where no route remains', () => {
    h.isWeb = true;
    expect(opdsAudioBlocker(CATALOG, authed)).toBe('web-auth');
    expect(opdsAudioBlocker(CATALOG, headered)).toBe('web-auth');
  });

  it('allows an open catalog on web -- the element fetches it directly', () => {
    h.isWeb = true;
    expect(opdsAudioBlocker(CATALOG, open)).toBeNull();
  });

  it('allows an authenticated catalog on native, which can fetch with headers', () => {
    h.isWeb = false;
    expect(opdsAudioBlocker(CATALOG, authed)).toBeNull();
  });
});

// #6224: the catalog's stored OPDS credentials must be what decides the
// playback path. If a probe fails -- or the user saved only a username -- we
// must NOT fall through to an unauthenticated request: the server answers 401
// and the WebView pops its own Basic-auth dialog, asking the user for
// credentials they already entered when adding the catalog.
describe('resolveOpdsAudioAuth credential handling', () => {
  const load = async (catalog: Record<string, unknown> | undefined) => {
    vi.resetModules();
    h.catalog = catalog;
    return (await import('@/services/opds/audioStream')).resolveOpdsAudioAuth(
      'cat-1',
      'https://books.example.com/opds/7/download',
    );
  };

  it('still authenticates when the auth probe throws', async () => {
    h.probeImpl = () => {
      throw new Error('network down');
    };
    const auth = await load({ id: 'cat-1', url: CATALOG, username: 'u', password: 'p' });

    expect(auth.authHeader).toBe('Basic ' + btoa('u:p'));
    expect(needsAudioAuth(auth)).toBe(true);
  });

  it('still authenticates when only a username is stored', async () => {
    h.probeImpl = () => null;
    const auth = await load({ id: 'cat-1', url: CATALOG, username: 'u', password: '' });

    expect(auth.authHeader).toBeTruthy();
    expect(needsAudioAuth(auth)).toBe(true);
  });

  it('leaves a genuinely open catalog unauthenticated', async () => {
    h.probeImpl = () => null;
    const auth = await load({ id: 'cat-1', url: CATALOG });

    expect(auth.authHeader).toBeNull();
    expect(needsAudioAuth(auth)).toBe(false);
  });
});

// Duration must come from the file header when it can: the media-element probe
// downloads whole tracks on a server that ignores Range, which is what made a
// 12-part audiobook cost 284 MB before the first second played (#6224).
describe('probeAudioDurationFromHead', () => {
  // MPEG1 Layer III, 64 kbps, 44.1 kHz, mono -- a LibriVox chapter's shape.
  const head = new Uint8Array([0xff, 0xfb, 0x50, 0xc0, ...new Array(2048).fill(0)]);

  const respond = (init: { status: number; headers: Record<string, string>; stream?: boolean }) =>
    ({
      ok: true,
      status: init.status,
      headers: { get: (k: string) => init.headers[k] ?? init.headers[k.toLowerCase()] ?? null },
      body: init.stream
        ? {
            getReader: () => {
              let sent = false;
              return {
                read: async () => {
                  if (sent) return { done: true };
                  sent = true;
                  return { done: false, value: head };
                },
              };
            },
          }
        : null,
      arrayBuffer: async () => head.buffer,
    }) as unknown as Response;

  it('reads the duration from a ranged response without downloading the file', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond({
          status: 206,
          headers: { 'Content-Range': 'bytes 0-16383/31255480' },
          stream: true,
        }),
      ),
    );
    const { probeAudioDurationFromHead } = await import('@/services/opds/audioStream');

    const seconds = await probeAudioDurationFromHead('http://host/a.mp3', open);

    // 31255480 bytes at 64 kbps is ~3907s, which is what ffprobe reports.
    expect(seconds).toBeGreaterThan(3890);
    expect(seconds).toBeLessThan(3920);
    vi.unstubAllGlobals();
  });

  it('refuses to buffer a whole track when the server ignores Range', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond({ status: 200, headers: { 'Content-Length': '31255480' }, stream: false }),
      ),
    );
    const { probeAudioDurationFromHead } = await import('@/services/opds/audioStream');

    // No stream to stop and no range honoured: give up rather than pull 30 MB.
    expect(Number.isNaN(await probeAudioDurationFromHead('http://host/a.mp3', open))).toBe(true);
    vi.unstubAllGlobals();
  });
});

// A feed is remote data: an entry can point its acquisition link at any host,
// and the catalog's password or Cloudflare Access headers must not follow it
// there.
describe('credential scoping', () => {
  const capture = () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
        calls.push({ url, headers: init.headers });
        return {
          ok: true,
          status: 206,
          headers: { get: () => null },
          body: null,
          arrayBuffer: async () => new Uint8Array(0).buffer,
        } as unknown as Response;
      }),
    );
    return calls;
  };

  it('sends the catalog credentials to the catalog itself', async () => {
    const calls = capture();
    const { fetchOpdsAudioBlob } = await import('@/services/opds/audioStream');

    await fetchOpdsAudioBlob(CATALOG, authed, 'audio/mpeg');

    expect(calls[0]!.headers['Authorization']).toBe('Basic abc');
    vi.unstubAllGlobals();
  });

  it('withholds them from a track hosted somewhere else', async () => {
    const calls = capture();
    const { fetchOpdsAudioBlob } = await import('@/services/opds/audioStream');

    await fetchOpdsAudioBlob('https://evil.example.net/track.mp3', authed, 'audio/mpeg');

    expect(calls[0]!.headers['Authorization']).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('withholds custom headers from a foreign origin too', async () => {
    const calls = capture();
    const { probeAudioDurationFromHead } = await import('@/services/opds/audioStream');

    await probeAudioDurationFromHead('https://evil.example.net/track.mp3', headered);

    expect(calls[0]!.headers['CF-Access-Client-Id']).toBeUndefined();
    vi.unstubAllGlobals();
  });

  // The auth probe is itself a credentialed request against a feed-chosen URL.
  it('does not probe auth against a foreign origin', async () => {
    vi.resetModules();
    h.catalog = { id: 'cat-1', url: CATALOG, username: 'u', password: 'p' };
    let probed = false;
    h.probeImpl = () => {
      probed = true;
      return 'Digest xyz';
    };
    const { resolveOpdsAudioAuth } = await import('@/services/opds/audioStream');

    const auth = await resolveOpdsAudioAuth('cat-1', 'https://evil.example.net/track.mp3');

    expect(probed).toBe(false);
    expect(auth.authHeader).toBe('Basic ' + btoa('u:p'));
  });
});

// The media element cannot send credentials, so falling back to it on an
// authenticated catalog means a 401 and the WebView's own Basic-auth dialog.
describe('probeAudioDurations fallback', () => {
  it('reports an unknown duration rather than media-probing an authed track', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response),
    );
    const audioCtor = vi.fn();
    vi.stubGlobal('Audio', audioCtor);
    const { probeAudioDurations } = await import('@/services/opds/audioStream');

    const durations = await probeAudioDurations([CATALOG], [{ href: CATALOG, auth: authed }]);

    expect(Number.isNaN(durations[0]!)).toBe(true);
    expect(audioCtor).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

// Embedded cover art routinely pushes an ID3v2 tag past the probe window, so
// the first read holds no frame header at all. Falling through to the media
// element there is what downloads the whole track.
describe('probeAudioDurationFromHead with an oversized ID3 tag', () => {
  const frame = [0xff, 0xfb, 0x50, 0xc0];

  // A 40 KB tag: "ID3", version, flags, then a synchsafe size of 40950.
  const tagHeader = [0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x02, 0x7f, 0x76];
  const TAG_TOTAL = 10 + ((0x02 << 14) | (0x7f << 7) | 0x76);

  it('re-reads at the first audio byte instead of giving up', async () => {
    const ranges: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
        ranges.push(init.headers['Range']!);
        const first = ranges.length === 1;
        const bytes = new Uint8Array(
          first
            ? [...tagHeader, ...new Array(2048).fill(0)]
            : [...frame, ...new Array(2048).fill(0)],
        );
        return {
          ok: true,
          status: 206,
          headers: {
            get: (k: string) =>
              k.toLowerCase() === 'content-range' ? `bytes 0-16383/${TAG_TOTAL + 31255480}` : null,
          },
          body: null,
          arrayBuffer: async () => bytes.buffer,
        } as unknown as Response;
      }),
    );
    const { probeAudioDurationFromHead } = await import('@/services/opds/audioStream');

    const seconds = await probeAudioDurationFromHead('http://host/a.mp3', open);

    expect(ranges).toHaveLength(2);
    expect(ranges[1]).toBe(`bytes=${TAG_TOTAL}-${TAG_TOTAL + 16383}`);
    // The audio is everything after the tag, so the duration matches the
    // untagged file: ~3907s of 64 kbps mono.
    expect(seconds).toBeGreaterThan(3890);
    expect(seconds).toBeLessThan(3920);
    vi.unstubAllGlobals();
  });
});
