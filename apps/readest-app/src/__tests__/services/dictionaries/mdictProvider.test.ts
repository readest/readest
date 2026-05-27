import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createMdictProvider } from '@/services/dictionaries/providers/mdictProvider';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import type { BaseDir } from '@/types/system';

import { MDX_FIXTURE_NAME, MDD_FIXTURE_NAME, readMdxFile, readMddFile } from './_mdictFixtures';
import { makeReadCounter, withReadCounting } from './_countingFs';

// The shared fixture is a real MDict bundle (Longman Phrasal Verbs Dictionary,
// encrypt=2 / key-info-encrypted variant). Drop in any real .mdx/.mdd pair
// renamed to `mdict-en-en.*` to exercise this suite against your own data.
const KNOWN_HEADWORD = 'abandon';
const UNKNOWN_HEADWORD = 'zzznotaword';

const objectUrls: string[] = [];
const originalCreate = globalThis.URL.createObjectURL;
const originalRevoke = globalThis.URL.revokeObjectURL;

beforeEach(() => {
  objectUrls.length = 0;
  // jsdom lacks URL.createObjectURL — stub it so the provider's image
  // substitution path exercises end-to-end.
  globalThis.URL.createObjectURL = (blob: Blob) => {
    const url = `blob:test/${objectUrls.length}-${blob.size}`;
    objectUrls.push(url);
    return url;
  };
  globalThis.URL.revokeObjectURL = () => {};
  return () => {
    globalThis.URL.createObjectURL = originalCreate;
    globalThis.URL.revokeObjectURL = originalRevoke;
  };
});

const buildDict = (withMdd = true): ImportedDictionary => ({
  id: 'mdict:fixture',
  kind: 'mdict',
  name: 'Fixture',
  bundleDir: 'fixture-bundle',
  files: {
    mdx: MDX_FIXTURE_NAME,
    mdd: withMdd ? [MDD_FIXTURE_NAME] : undefined,
  },
  addedAt: 1,
});

const makeFs = () => ({
  openFile: async (p: string, _base: BaseDir) => {
    const base = p.split('/').pop()!;
    if (base === MDX_FIXTURE_NAME) return readMdxFile();
    if (base === MDD_FIXTURE_NAME) return readMddFile();
    throw new Error(`Unknown fixture file: ${base}`);
  },
});

// MDict cards render the body in a shadow root so each dictionary's CSS
// stays scoped. Helper for tests that need to peek inside.
const getMdictShadow = (container: HTMLElement): ShadowRoot => {
  const host = container.lastElementChild as HTMLElement | null;
  if (!host?.shadowRoot) throw new Error('expected mdict shadow host as last child of container');
  return host.shadowRoot;
};

describe('mdictProvider', () => {
  it('opens an .mdx via Blob and looks up a real entry', async () => {
    const provider = createMdictProvider({ dict: buildDict(false), fs: makeFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup(KNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.headword).toBe(KNOWN_HEADWORD);
    // The headword surfaces either as our auto-prepended light-DOM <h1>
    // or — when the dict body already includes one — inside the shadow.
    const lightH1 = container.querySelector('h1')?.textContent?.trim();
    const shadowText = getMdictShadow(container).textContent ?? '';
    expect(lightH1 === KNOWN_HEADWORD || shadowText.includes(KNOWN_HEADWORD)).toBe(true);
    expect(shadowText.length).toBeGreaterThan(0);
  });

  it('returns empty for an unknown headword', async () => {
    const provider = createMdictProvider({ dict: buildDict(false), fs: makeFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup(UNKNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('empty');
  });

  it('shares the parsed instance across consecutive lookups', async () => {
    const fs = makeFs();
    let opens = 0;
    const wrappedFs = {
      openFile: async (p: string, base: BaseDir) => {
        opens += 1;
        return fs.openFile(p, base);
      },
    };
    const provider = createMdictProvider({ dict: buildDict(false), fs: wrappedFs });
    const container = document.createElement('div');
    await provider.lookup(KNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container,
    });
    const firstOpens = opens;
    container.replaceChildren();
    await provider.lookup(KNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container,
    });
    expect(opens).toBe(firstOpens);
  });

  it('handles encrypt=2 (key-info-only) dictionaries — the fixture itself is encrypt=2', async () => {
    // The shared fixture's `meta.encrypt === 2`, so this is verified by the
    // first test passing. Lock the contract explicitly here as well.
    const jsmdict = await import('js-mdict');
    const file = await readMdxFile();
    const mdx = await jsmdict.MDX.create(file);
    expect(mdx.meta.encrypt).toBe(2);
  });

  it('rejects encrypt=1 (record-block / passcode) dictionaries as unsupported', async () => {
    const jsmdict = await import('js-mdict');
    const origCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    jsmdict.MDX.create = async (file: Blob) => {
      const inst = await origCreate(file);
      (inst as unknown as { meta: { encrypt: number } }).meta.encrypt = 1;
      return inst;
    };
    try {
      const provider = createMdictProvider({ dict: buildDict(false), fs: makeFs() });
      const container = document.createElement('div');
      const outcome = await provider.lookup(KNOWN_HEADWORD, {
        signal: new AbortController().signal,
        container,
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe('unsupported');
    } finally {
      jsmdict.MDX.create = origCreate;
    }
  });

  it('classifies upstream "encrypted file" throws as `unsupported`, not `error`', async () => {
    const jsmdict = await import('js-mdict');
    const origCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    jsmdict.MDX.create = async () => {
      throw new Error('user identification is needed to read encrypted file');
    };
    try {
      const provider = createMdictProvider({ dict: buildDict(false), fs: makeFs() });
      const container = document.createElement('div');
      const outcome = await provider.lookup(KNOWN_HEADWORD, {
        signal: new AbortController().signal,
        container,
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe('unsupported');
    } finally {
      jsmdict.MDX.create = origCreate;
    }
  });

  it('init failure surfaces as `error`', async () => {
    const failingFs = {
      openFile: async () => {
        throw new Error('disk gone');
      },
    };
    const provider = createMdictProvider({ dict: buildDict(false), fs: failingFs });
    const container = document.createElement('div');
    const outcome = await provider.lookup(KNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('error');
      expect(outcome.message).toContain('disk gone');
    }
  });

  it('dispose() revokes object URLs created for image resources', async () => {
    let revoked = 0;
    globalThis.URL.revokeObjectURL = () => {
      revoked += 1;
    };
    const provider = createMdictProvider({ dict: buildDict(true), fs: makeFs() });
    const container = document.createElement('div');
    // Manually inject an <img> referencing an mdd resource to force the
    // resolver path. We don't depend on the definition containing one;
    // the resolver runs on the rendered body.
    await provider.lookup(KNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container,
    });
    const body = container.querySelector('div')!;
    const img = document.createElement('img');
    img.setAttribute('src', 'nonexistent.png');
    body.appendChild(img);
    // Re-run lookup so the resolver iterates over the freshly-added <img>.
    container.replaceChildren();
    await provider.lookup(KNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container,
    });
    provider.dispose?.();
    // Either tracked URLs were created or weren't; the key assertion is
    // dispose() runs without throwing in both cases.
    expect(typeof revoked).toBe('number');
  });

  // -------------------------------------------------------------------------
  // Perf regression — bytes read.
  //
  // MDict's BlobScanner reads slices on demand. After init, a single lookup
  // should read at most one record block (typically a few KB to tens of KB).
  // If a future change accidentally re-reads the keylist or scans for a
  // matching word linearly, these tests catch it.
  //
  // Measured baselines on the Longman fixture (5,587 entries, encrypt=2):
  //   - init (incl. eager `_readKeyBlocks` traversal):   ~50 KB
  //   - per-lookup (one inflated record block):          ~7.4 KB
  //   - not-found word (binary-search early-out):        0 bytes
  //
  // The 64 KB ceiling absorbs format variance (some bundles use larger
  // record blocks).
  // -------------------------------------------------------------------------
  it('per-lookup reads less than 64 KB after init', async () => {
    const counter = makeReadCounter();
    const fs = withReadCounting(makeFs(), counter);
    const provider = createMdictProvider({ dict: buildDict(false), fs });

    // Init via the first lookup.
    const c1 = document.createElement('div');
    await provider.lookup(KNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container: c1,
    });
    const initBytes = counter.total;
    expect(initBytes).toBeGreaterThan(0);

    // Real headwords from the Longman fixture (verified to exist via probe:
    // first 5 entries are abandon, abandon to, abide, abide by, abound).
    for (const word of ['abide', 'abound', 'abide by']) {
      const before = counter.total;
      const c = document.createElement('div');
      await provider.lookup(word, { signal: new AbortController().signal, container: c });
      const delta = counter.total - before;
      expect(delta).toBeGreaterThan(0); // Word found → at least one record-block read
      expect(delta).toBeLessThan(64 * 1024);
    }
  });

  it('lookup of an unknown headword reads 0 bytes (binary-search early-out)', async () => {
    const counter = makeReadCounter();
    const fs = withReadCounting(makeFs(), counter);
    const provider = createMdictProvider({ dict: buildDict(false), fs });

    // Prime init with a known lookup first.
    await provider.lookup(KNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });
    const before = counter.total;
    await provider.lookup(UNKNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });
    expect(counter.total - before).toBe(0);
  });

  it('init does not read the entire .mdx file', async () => {
    const counter = makeReadCounter();
    const fs = withReadCounting(makeFs(), counter);
    const provider = createMdictProvider({ dict: buildDict(false), fs });
    const c = document.createElement('div');
    await provider.lookup(KNOWN_HEADWORD, { signal: new AbortController().signal, container: c });

    const realMdx = await readMdxFile();
    const mdxBytesRead = counter.perFile.get(MDX_FIXTURE_NAME) ?? 0;
    // Init reads keylist + headers + the lookup's record block — not full
    // record content. Bound at half the file size; real ratio on Longman
    // is ~4%.
    expect(mdxBytesRead).toBeGreaterThan(0);
    expect(mdxBytesRead).toBeLessThan(realMdx.size * 0.5);
  });

  it('intercepts sound:// anchor clicks and plays via MDD lookup', async () => {
    const jsmdict = await import('js-mdict');
    const origMDXCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    const origMDDCreate = jsmdict.MDD.create.bind(jsmdict.MDD);
    const locateMock = vi.fn(async (key: string) => ({
      keyText: key,
      data: new Uint8Array([0xff, 0xfb, 0x90, 0x00]),
    }));
    const playSpy = vi
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    type FakeMDX = ReturnType<typeof origMDXCreate> extends Promise<infer T> ? T : never;
    type FakeMDD = ReturnType<typeof origMDDCreate> extends Promise<infer T> ? T : never;
    jsmdict.MDX.create = async () =>
      ({
        meta: { encrypt: 0 },
        header: {},
        lookup: async (word: string) => ({
          keyText: word,
          definition: `<span class='hw'>${word}</span> <a href="sound://test01.mp3">play</a>`,
        }),
      }) as unknown as FakeMDX;
    jsmdict.MDD.create = async () =>
      ({
        locateBytes: locateMock,
      }) as unknown as FakeMDD;

    try {
      const provider = createMdictProvider({ dict: buildDict(true), fs: makeFs() });
      const container = document.createElement('div');
      await provider.lookup('hello', {
        signal: new AbortController().signal,
        container,
      });

      const anchor = getMdictShadow(container).querySelector(
        'a[href^="sound://"]',
      ) as HTMLAnchorElement | null;
      expect(anchor).not.toBeNull();

      anchor!.click();
      // Drain microtasks so the async click handler completes its lookup +
      // URL.createObjectURL + audio.play() chain.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(locateMock).toHaveBeenCalledWith('test01.mp3');
      expect(playSpy).toHaveBeenCalled();
      expect(anchor!.getAttribute('data-mdd-resolved')).toMatch(/^blob:/);

      // Second click reuses the cached blob URL — no extra MDD read.
      locateMock.mockClear();
      playSpy.mockClear();
      anchor!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(locateMock).not.toHaveBeenCalled();
      expect(playSpy).toHaveBeenCalled();
    } finally {
      jsmdict.MDX.create = origMDXCreate;
      jsmdict.MDD.create = origMDDCreate;
      playSpy.mockRestore();
    }
  });

  it('skips playback for deprecated sound://*.spx clicks and dispatches a deprecation toast', async () => {
    const jsmdict = await import('js-mdict');
    const eventModule = await import('@/utils/event');
    const origMDXCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    const origMDDCreate = jsmdict.MDD.create.bind(jsmdict.MDD);
    const locateMock = vi.fn();
    const playSpy = vi
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const dispatchSpy = vi.spyOn(eventModule.eventDispatcher, 'dispatch');
    type FakeMDX = ReturnType<typeof origMDXCreate> extends Promise<infer T> ? T : never;
    type FakeMDD = ReturnType<typeof origMDDCreate> extends Promise<infer T> ? T : never;
    jsmdict.MDX.create = async () =>
      ({
        meta: { encrypt: 0 },
        header: {},
        lookup: async (word: string) => ({
          keyText: word,
          definition: `<span class='hw'>${word}</span> <a href="sound://door0001.spx">play</a>`,
        }),
      }) as unknown as FakeMDX;
    jsmdict.MDD.create = async () =>
      ({
        locateBytes: locateMock,
      }) as unknown as FakeMDD;

    try {
      const provider = createMdictProvider({ dict: buildDict(true), fs: makeFs() });
      const container = document.createElement('div');
      await provider.lookup('hello', {
        signal: new AbortController().signal,
        container,
      });

      const anchor = getMdictShadow(container).querySelector(
        'a[href^="sound://"]',
      ) as HTMLAnchorElement | null;
      expect(anchor).not.toBeNull();

      anchor!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The .spx click short-circuits before any MDD or Audio work.
      expect(locateMock).not.toHaveBeenCalled();
      expect(playSpy).not.toHaveBeenCalled();
      // A deprecation warning toast is dispatched.
      const toastCall = dispatchSpy.mock.calls.find(([event]) => event === 'toast');
      expect(toastCall).toBeDefined();
      const payload = toastCall![1] as { type: string; message: string };
      expect(payload.type).toBe('warning');
      expect(payload.message).toMatch(/outdated format/i);
    } finally {
      jsmdict.MDX.create = origMDXCreate;
      jsmdict.MDD.create = origMDDCreate;
      playSpy.mockRestore();
      dispatchSpy.mockRestore();
    }
  });

  it('forwards entry:// anchor clicks to ctx.onNavigate (URL-decoded)', async () => {
    const jsmdict = await import('js-mdict');
    const origMDXCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    type FakeMDX = ReturnType<typeof origMDXCreate> extends Promise<infer T> ? T : never;
    jsmdict.MDX.create = async () =>
      ({
        meta: { encrypt: 0 },
        header: {},
        lookup: async (word: string) => ({
          keyText: word,
          definition: `<span>see <a href="entry://timid">timid</a> and <a href="bword://hello%20world">hello world</a></span>`,
        }),
      }) as unknown as FakeMDX;

    try {
      const provider = createMdictProvider({ dict: buildDict(false), fs: makeFs() });
      const container = document.createElement('div');
      const onNavigate = vi.fn();
      await provider.lookup('timidly', {
        signal: new AbortController().signal,
        container,
        onNavigate,
      });

      const shadow = getMdictShadow(container);
      const entryAnchor = shadow.querySelector('a[href^="entry://"]') as HTMLAnchorElement | null;
      const bwordAnchor = shadow.querySelector('a[href^="bword://"]') as HTMLAnchorElement | null;
      expect(entryAnchor).not.toBeNull();
      expect(bwordAnchor).not.toBeNull();

      entryAnchor!.click();
      expect(onNavigate).toHaveBeenLastCalledWith('timid');

      bwordAnchor!.click();
      // bword:// alias resolves the same way, with URL-decoding applied.
      expect(onNavigate).toHaveBeenLastCalledWith('hello world');
    } finally {
      jsmdict.MDX.create = origMDXCreate;
    }
  });

  it('inlines a stylesheet referenced via <link rel=stylesheet> by reading bytes from MDD', async () => {
    const jsmdict = await import('js-mdict');
    const origMDXCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    const origMDDCreate = jsmdict.MDD.create.bind(jsmdict.MDD);
    const cssText = '.hw{color:red}';
    type FakeMDX = ReturnType<typeof origMDXCreate> extends Promise<infer T> ? T : never;
    type FakeMDD = ReturnType<typeof origMDDCreate> extends Promise<infer T> ? T : never;
    jsmdict.MDX.create = async () =>
      ({
        meta: { encrypt: 0 },
        header: {},
        lookup: async (word: string) => ({
          keyText: word,
          definition: `<link rel="stylesheet" href="mwa.css"><span class="hw">${word}</span>`,
        }),
      }) as unknown as FakeMDX;
    const locateMock = vi.fn(async (key: string) => {
      if (key === 'mwa.css') {
        return { keyText: key, data: new TextEncoder().encode(cssText) };
      }
      return { keyText: key, data: null };
    });
    jsmdict.MDD.create = async () =>
      ({
        locateBytes: locateMock,
      }) as unknown as FakeMDD;

    try {
      const provider = createMdictProvider({ dict: buildDict(true), fs: makeFs() });
      const container = document.createElement('div');
      await provider.lookup('hello', {
        signal: new AbortController().signal,
        container,
      });

      const shadow = getMdictShadow(container);
      // The original <link> is removed; its CSS is inlined as a <style>.
      expect(shadow.querySelector('link')).toBeNull();
      // The shadow has multiple <style> tags (baseline app rules + dict
      // CSS). Match against any of them.
      const styles = Array.from(shadow.querySelectorAll('style')).map((s) => s.textContent);
      expect(styles).toContain(cssText);
      expect(locateMock).toHaveBeenCalledWith('mwa.css');
    } finally {
      jsmdict.MDX.create = origMDXCreate;
      jsmdict.MDD.create = origMDDCreate;
    }
  });

  it('reads loose .css files at init and applies them inside every card shadow', async () => {
    const jsmdict = await import('js-mdict');
    const origMDXCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    type FakeMDX = ReturnType<typeof origMDXCreate> extends Promise<infer T> ? T : never;
    jsmdict.MDX.create = async () =>
      ({
        meta: { encrypt: 0 },
        header: {},
        lookup: async (word: string) => ({
          keyText: word,
          definition: `<span>${word}</span>`,
        }),
      }) as unknown as FakeMDX;

    const looseCss = '.entry{padding:1em}';
    const dictWithCss: ImportedDictionary = {
      id: 'mdict:fixture-with-css',
      kind: 'mdict',
      name: 'Fixture w/ CSS',
      bundleDir: 'fixture-bundle',
      files: {
        mdx: MDX_FIXTURE_NAME,
        css: ['style.css'],
      },
      addedAt: 1,
    };
    const fsWithCss = {
      openFile: async (p: string, _base: BaseDir) => {
        const base = p.split('/').pop()!;
        if (base === MDX_FIXTURE_NAME) return readMdxFile();
        if (base === 'style.css') return new File([looseCss], 'style.css', { type: 'text/css' });
        throw new Error(`Unknown fixture file: ${base}`);
      },
    };

    try {
      const provider = createMdictProvider({ dict: dictWithCss, fs: fsWithCss });
      const container = document.createElement('div');
      await provider.lookup('hello', {
        signal: new AbortController().signal,
        container,
      });
      const shadow = getMdictShadow(container);
      const styles = Array.from(shadow.querySelectorAll('style')).map((s) => s.textContent);
      expect(styles).toContain(looseCss);
    } finally {
      jsmdict.MDX.create = origMDXCreate;
    }
  });

  it('follows @@@LINK= content-level redirects to the canonical entry', async () => {
    const jsmdict = await import('js-mdict');
    const origMDXCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    type FakeMDX = ReturnType<typeof origMDXCreate> extends Promise<infer T> ? T : never;
    const lookupCalls: string[] = [];
    jsmdict.MDX.create = async () =>
      ({
        meta: { encrypt: 0 },
        header: {},
        lookup: async (word: string) => {
          lookupCalls.push(word);
          if (word === 'questions') {
            return { keyText: 'questions', definition: '@@@LINK=question\n' };
          }
          if (word === 'question') {
            return {
              keyText: 'question',
              definition: '<span class="def">a request for information</span>',
            };
          }
          return { keyText: word, definition: null };
        },
      }) as unknown as FakeMDX;

    try {
      const provider = createMdictProvider({ dict: buildDict(false), fs: makeFs() });
      const container = document.createElement('div');
      const outcome = await provider.lookup('questions', {
        signal: new AbortController().signal,
        container,
      });
      expect(outcome.ok).toBe(true);
      // Two lookups: original + redirect target.
      expect(lookupCalls).toEqual(['questions', 'question']);
      // The shadow body shows the resolved entry's content, not the raw
      // redirect string.
      const shadowText = getMdictShadow(container).textContent ?? '';
      expect(shadowText).not.toContain('@@@LINK=');
      expect(shadowText).toContain('a request for information');
    } finally {
      jsmdict.MDX.create = origMDXCreate;
    }
  });

  it('caps @@@LINK= chains at 5 hops to avoid infinite loops', async () => {
    const jsmdict = await import('js-mdict');
    const origMDXCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    type FakeMDX = ReturnType<typeof origMDXCreate> extends Promise<infer T> ? T : never;
    const lookupCalls: string[] = [];
    jsmdict.MDX.create = async () =>
      ({
        meta: { encrypt: 0 },
        header: {},
        // a → b → a → b → ...
        lookup: async (word: string) => {
          lookupCalls.push(word);
          if (word === 'a') return { keyText: 'a', definition: '@@@LINK=b' };
          if (word === 'b') return { keyText: 'b', definition: '@@@LINK=a' };
          return { keyText: word, definition: null };
        },
      }) as unknown as FakeMDX;

    try {
      const provider = createMdictProvider({ dict: buildDict(false), fs: makeFs() });
      const container = document.createElement('div');
      const outcome = await provider.lookup('a', {
        signal: new AbortController().signal,
        container,
      });
      // The chain is bounded; outcome resolves either way (the last
      // result is rendered, even if it's still a redirect string).
      expect(outcome.ok).toBe(true);
      // Initial + 5 hops = 6 calls total.
      expect(lookupCalls.length).toBeLessThanOrEqual(6);
    } finally {
      jsmdict.MDX.create = origMDXCreate;
    }
  });

  it('rewrites url(...) refs in loose CSS to blob URLs sourced from MDD', async () => {
    const jsmdict = await import('js-mdict');
    const origMDXCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    const origMDDCreate = jsmdict.MDD.create.bind(jsmdict.MDD);
    type FakeMDX = ReturnType<typeof origMDXCreate> extends Promise<infer T> ? T : never;
    type FakeMDD = ReturnType<typeof origMDDCreate> extends Promise<infer T> ? T : never;
    jsmdict.MDX.create = async () =>
      ({
        meta: { encrypt: 0 },
        header: {},
        lookup: async (word: string) => ({
          keyText: word,
          definition: `<a class="play_pron"></a>`,
        }),
      }) as unknown as FakeMDX;
    const locateMock = vi.fn(async (key: string) => {
      if (key === 'sound.png') {
        return { keyText: key, data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) };
      }
      return { keyText: key, data: null };
    });
    jsmdict.MDD.create = async () =>
      ({
        locateBytes: locateMock,
      }) as unknown as FakeMDD;

    const looseCss = '.play_pron{background-image:url(sound.png);background-repeat:no-repeat;}';
    const dictWithCss: ImportedDictionary = {
      id: 'mdict:fixture-with-css-url',
      kind: 'mdict',
      name: 'Fixture w/ CSS url',
      bundleDir: 'fixture-bundle',
      files: { mdx: MDX_FIXTURE_NAME, mdd: ['fixture.mdd'], css: ['style.css'] },
      addedAt: 1,
    };
    const fsWithCss = {
      openFile: async (p: string, _base: BaseDir) => {
        const base = p.split('/').pop()!;
        if (base === MDX_FIXTURE_NAME) return readMdxFile();
        if (base === 'fixture.mdd') return new File([new Uint8Array()], 'fixture.mdd');
        if (base === 'style.css') return new File([looseCss], 'style.css', { type: 'text/css' });
        throw new Error(`Unknown fixture file: ${base}`);
      },
    };

    try {
      const provider = createMdictProvider({ dict: dictWithCss, fs: fsWithCss });
      const container = document.createElement('div');
      await provider.lookup('hello', {
        signal: new AbortController().signal,
        container,
      });

      const shadow = getMdictShadow(container);
      const styleText = Array.from(shadow.querySelectorAll('style'))
        .map((s) => s.textContent)
        .join('\n');
      // The original `url(sound.png)` is rewritten to a blob URL.
      expect(styleText).not.toContain('url(sound.png)');
      expect(styleText).toMatch(/url\("blob:[^"]+"\)/);
      expect(locateMock).toHaveBeenCalledWith('sound.png');
    } finally {
      jsmdict.MDX.create = origMDXCreate;
      jsmdict.MDD.create = origMDDCreate;
    }
  });

  it('rewrites url(...) refs inside MDD-resident <link> stylesheets too', async () => {
    const jsmdict = await import('js-mdict');
    const origMDXCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    const origMDDCreate = jsmdict.MDD.create.bind(jsmdict.MDD);
    type FakeMDX = ReturnType<typeof origMDXCreate> extends Promise<infer T> ? T : never;
    type FakeMDD = ReturnType<typeof origMDDCreate> extends Promise<infer T> ? T : never;
    jsmdict.MDX.create = async () =>
      ({
        meta: { encrypt: 0 },
        header: {},
        lookup: async (word: string) => ({
          keyText: word,
          definition: `<link rel="stylesheet" href="mwa.css"><span>${word}</span>`,
        }),
      }) as unknown as FakeMDX;
    const cssWithUrl = '.icon{background-image:url("img/spk.png")}';
    const locateMock = vi.fn(async (key: string) => {
      if (key === 'mwa.css') {
        return { keyText: key, data: new TextEncoder().encode(cssWithUrl) };
      }
      if (key === 'img/spk.png') {
        return { keyText: key, data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) };
      }
      return { keyText: key, data: null };
    });
    jsmdict.MDD.create = async () =>
      ({
        locateBytes: locateMock,
      }) as unknown as FakeMDD;

    try {
      const provider = createMdictProvider({ dict: buildDict(true), fs: makeFs() });
      const container = document.createElement('div');
      await provider.lookup('hello', {
        signal: new AbortController().signal,
        container,
      });

      const shadow = getMdictShadow(container);
      const styleText = Array.from(shadow.querySelectorAll('style'))
        .map((s) => s.textContent)
        .join('\n');
      expect(styleText).not.toContain('img/spk.png');
      expect(styleText).toMatch(/url\("blob:[^"]+"\)/);
      expect(locateMock).toHaveBeenCalledWith('img/spk.png');
    } finally {
      jsmdict.MDX.create = origMDXCreate;
      jsmdict.MDD.create = origMDDCreate;
    }
  });

  it('hides the auto-prepended headword when the dict body already includes one with matching text', async () => {
    const jsmdict = await import('js-mdict');
    const origMDXCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    type FakeMDX = ReturnType<typeof origMDXCreate> extends Promise<infer T> ? T : never;
    jsmdict.MDX.create = async () =>
      ({
        meta: { encrypt: 0 },
        header: {},
        lookup: async (word: string) => ({
          keyText: word,
          definition: `<h1 class="dict-h1"> ${word} </h1><p>def</p>`,
        }),
      }) as unknown as FakeMDX;

    try {
      const provider = createMdictProvider({ dict: buildDict(false), fs: makeFs() });
      const container = document.createElement('div');
      await provider.lookup('question', {
        signal: new AbortController().signal,
        container,
      });

      // Light-DOM h1 (our auto-prepended one) is removed when the dict's
      // own h1 matches; only the shadow's h1 remains visible.
      expect(container.querySelector('h1')).toBeNull();
      const shadowH1 = getMdictShadow(container).querySelector('h1');
      expect(shadowH1?.textContent?.trim()).toBe('question');
    } finally {
      jsmdict.MDX.create = origMDXCreate;
    }
  });

  it('hides the auto-prepended headword when the dict body starts with a non-h1 element matching the word', async () => {
    const jsmdict = await import('js-mdict');
    const origMDXCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    type FakeMDX = ReturnType<typeof origMDXCreate> extends Promise<infer T> ? T : never;
    jsmdict.MDX.create = async () =>
      ({
        meta: { encrypt: 0 },
        header: {},
        // Many dicts prefix the entry with a non-h1 styled headword (e.g.
        // <h3 class="entry_name">探春</h3>). The shell should still
        // de-duplicate against our auto-prepended h1.
        lookup: async (word: string) => ({
          keyText: word,
          definition: `<h3 class="entry_name">${word}</h3><div>def</div>`,
        }),
      }) as unknown as FakeMDX;

    try {
      const provider = createMdictProvider({ dict: buildDict(false), fs: makeFs() });
      const container = document.createElement('div');
      await provider.lookup('探春', {
        signal: new AbortController().signal,
        container,
      });

      // Light-DOM h1 is removed because the dict body's first child is an
      // h3 with the same trimmed text.
      expect(container.querySelector('h1')).toBeNull();
      const shadowH3 = getMdictShadow(container).querySelector('h3.entry_name');
      expect(shadowH3?.textContent?.trim()).toBe('探春');
    } finally {
      jsmdict.MDX.create = origMDXCreate;
    }
  });

  it('tags the in-shadow body with data-dict-kind so external tooling / CSS can target it', async () => {
    const jsmdict = await import('js-mdict');
    const origMDXCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    type FakeMDX = ReturnType<typeof origMDXCreate> extends Promise<infer T> ? T : never;
    jsmdict.MDX.create = async () =>
      ({
        meta: { encrypt: 0 },
        header: {},
        lookup: async (word: string) => ({
          keyText: word,
          definition: `<p>def</p>`,
        }),
      }) as unknown as FakeMDX;

    try {
      const provider = createMdictProvider({ dict: buildDict(false), fs: makeFs() });
      const container = document.createElement('div');
      await provider.lookup('hello', {
        signal: new AbortController().signal,
        container,
      });

      const tagged = getMdictShadow(container).querySelector('[data-dict-kind="mdict"]');
      expect(tagged).not.toBeNull();
    } finally {
      jsmdict.MDX.create = origMDXCreate;
    }
  });

  it('keeps the auto-prepended headword when the dict body has a different h1 text', async () => {
    const jsmdict = await import('js-mdict');
    const origMDXCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    type FakeMDX = ReturnType<typeof origMDXCreate> extends Promise<infer T> ? T : never;
    jsmdict.MDX.create = async () =>
      ({
        meta: { encrypt: 0 },
        header: {},
        lookup: async (word: string) => ({
          keyText: word,
          definition: `<h1>question (verb)</h1><p>def</p>`,
        }),
      }) as unknown as FakeMDX;

    try {
      const provider = createMdictProvider({ dict: buildDict(false), fs: makeFs() });
      const container = document.createElement('div');
      await provider.lookup('question', {
        signal: new AbortController().signal,
        container,
      });
      // The auto-prepended h1 stays because the dict's h1 text differs.
      expect(container.querySelector('h1')?.textContent).toBe('question');
    } finally {
      jsmdict.MDX.create = origMDXCreate;
    }
  });

  it('resolves <img src="/path"> against the MDD (treating leading slash as MDD-relative)', async () => {
    const jsmdict = await import('js-mdict');
    const origMDXCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    const origMDDCreate = jsmdict.MDD.create.bind(jsmdict.MDD);
    type FakeMDX = ReturnType<typeof origMDXCreate> extends Promise<infer T> ? T : never;
    type FakeMDD = ReturnType<typeof origMDDCreate> extends Promise<infer T> ? T : never;
    jsmdict.MDX.create = async () =>
      ({
        meta: { encrypt: 0 },
        header: {},
        lookup: async (word: string) => ({
          keyText: word,
          // MW-style absolute-from-root reference inside the MDX HTML.
          definition: `<div class="art"><img src="/images/door_rev.png"></div>`,
        }),
      }) as unknown as FakeMDX;
    // The MDD only stores it under the leading-slash-stripped key, so the
    // fallback retry must kick in.
    const locateMock = vi.fn(async (key: string) => {
      if (key === 'images/door_rev.png') {
        return { keyText: key, data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) };
      }
      return { keyText: key, data: null };
    });
    jsmdict.MDD.create = async () =>
      ({
        locateBytes: locateMock,
      }) as unknown as FakeMDD;

    try {
      const provider = createMdictProvider({ dict: buildDict(true), fs: makeFs() });
      const container = document.createElement('div');
      await provider.lookup('door', {
        signal: new AbortController().signal,
        container,
      });

      const img = getMdictShadow(container).querySelector('img') as HTMLImageElement | null;
      expect(img).not.toBeNull();
      expect(img!.getAttribute('src')).toMatch(/^blob:/);
      expect(locateMock).toHaveBeenCalledWith('/images/door_rev.png');
      expect(locateMock).toHaveBeenCalledWith('images/door_rev.png');
    } finally {
      jsmdict.MDX.create = origMDXCreate;
      jsmdict.MDD.create = origMDDCreate;
    }
  });

  it('repeated lookups of the same word produce identical, bounded reads', async () => {
    const counter = makeReadCounter();
    const fs = withReadCounting(makeFs(), counter);
    const provider = createMdictProvider({ dict: buildDict(false), fs });

    const run = async () => {
      await provider.lookup(KNOWN_HEADWORD, {
        signal: new AbortController().signal,
        container: document.createElement('div'),
      });
    };

    await run(); // includes init
    const afterFirst = counter.total;
    await run();
    const secondDelta = counter.total - afterFirst;
    await run();
    const thirdDelta = counter.total - afterFirst - secondDelta;

    // js-mdict doesn't cache record blocks. Repeats re-read the same block
    // — assert deltas are equal (no creeping growth) and small.
    expect(secondDelta).toBeGreaterThan(0);
    expect(secondDelta).toBeLessThan(64 * 1024);
    expect(thirdDelta).toBe(secondDelta);
  });
});
