// Regression test for the iOS <= 16 WebContent crash on book open.
//
// WebKit before Safari 17 (branch 7615 and earlier) resolves the
// `document.fonts.ready` promise synchronously while purging still-loading
// `@font-face`s during a style resolver rebuild (CSSFontFaceSet::purge ->
// FontFaceSet::completedLoading -> DeferredPromise::callFunction). Script
// execution is disallowed at that point, so the release assert kills the
// WebContent process. The deferring guard only landed in WebKit 616
// (Safari/iOS 17), the same release that shipped URL.canParse.
//
// The JS-visible promise is created lazily on first access of `.ready`, so
// on affected engines fontsReady() must never touch it and must fall back
// to polling `fonts.status`.
import { describe, expect, it } from 'vitest';

import { fontsReady } from 'foliate-js/paginator.js';

const IOS16_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IOS17_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const OLD_CHROME_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36';

interface FakeDocOptions {
  userAgent: string;
  hasCanParse: boolean;
  status?: 'loading' | 'loaded';
}

const makeFakeDoc = ({ userAgent, hasCanParse, status = 'loading' }: FakeDocOptions) => {
  let readyAccessed = false;
  const readyPromise = Promise.resolve();
  const fonts = {
    status,
    get ready() {
      readyAccessed = true;
      return readyPromise;
    },
  };
  const win = {
    navigator: { userAgent },
    URL: hasCanParse ? { canParse: () => true } : {},
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  };
  const doc = { fonts, defaultView: win };
  return {
    doc,
    readyPromise,
    wasReadyAccessed: () => readyAccessed,
    finishLoading: () => {
      fonts.status = 'loaded';
    },
  };
};

describe('fontsReady', () => {
  it('never accesses fonts.ready on WebKit without URL.canParse (iOS <= 16)', async () => {
    const fake = makeFakeDoc({ userAgent: IOS16_UA, hasCanParse: false });
    const promise = fontsReady(fake.doc);
    expect(fake.wasReadyAccessed()).toBe(false);

    let resolved = false;
    promise.then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(resolved).toBe(false);

    fake.finishLoading();
    await promise;
    expect(fake.wasReadyAccessed()).toBe(false);
  });

  it('resolves without touching fonts.ready when fonts are already loaded on iOS <= 16', async () => {
    const fake = makeFakeDoc({ userAgent: IOS16_UA, hasCanParse: false, status: 'loaded' });
    await fontsReady(fake.doc);
    expect(fake.wasReadyAccessed()).toBe(false);
  });

  it('returns fonts.ready on WebKit with URL.canParse (iOS >= 17)', () => {
    const fake = makeFakeDoc({ userAgent: IOS17_UA, hasCanParse: true });
    expect(fontsReady(fake.doc)).toBe(fake.readyPromise);
    expect(fake.wasReadyAccessed()).toBe(true);
  });

  it('returns fonts.ready on non-WebKit engines even without URL.canParse', () => {
    // Old Chrome/Firefox lack URL.canParse but do not have the WebKit bug;
    // they must keep the exact `fonts.ready` semantics.
    const fake = makeFakeDoc({ userAgent: OLD_CHROME_UA, hasCanParse: false });
    expect(fontsReady(fake.doc)).toBe(fake.readyPromise);
    expect(fake.wasReadyAccessed()).toBe(true);
  });

  it('resolves when the document has no fonts API', async () => {
    await expect(fontsReady({} as never)).resolves.toBeUndefined();
    await expect(fontsReady(null as never)).resolves.toBeUndefined();
  });

  it('resolves without touching fonts.ready on a detached document', async () => {
    const fake = makeFakeDoc({ userAgent: IOS16_UA, hasCanParse: false });
    const detached = { fonts: fake.doc.fonts, defaultView: null };
    await expect(fontsReady(detached as never)).resolves.toBeUndefined();
    expect(fake.wasReadyAccessed()).toBe(false);
  });
});
