import path from 'node:path';
import {
  adbShell,
  hasAdb,
  isPackageInstalled,
  listDeviceSerials,
  longPress,
  pushFile,
  tap,
} from './adb';
import { CdpPage, forwardWebViewDevtools, listPages } from './cdp';

export const APP_PKG = 'com.bilingify.readest';
const CDP_PORT = Number(process.env['READEST_CDP_PORT'] ?? 9333);
const REMOTE_FIXTURE_DIR = '/sdcard/Download';

export interface AndroidEnv {
  serial: string;
}

// The lane soft-skips unless adb, a device, and an installed Readest app are
// all present, so it is safe to run `pnpm test:android` anywhere.
export const detectAndroidEnv = async (): Promise<AndroidEnv | null> => {
  if (!(await hasAdb())) return null;
  const serials = await listDeviceSerials();
  if (serials.length === 0) return null;
  if (!(await isPackageInstalled(APP_PKG))) return null;
  return { serial: process.env['ANDROID_SERIAL'] ?? serials[0]! };
};

export const waitFor = async <T>(
  probe: () => Promise<T | null | undefined | false>,
  { timeoutMs = 15_000, intervalMs = 250, label = 'condition' } = {},
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
      last = value;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timed out waiting for ${label} (last: ${String(last)})`);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Open a fixture EPUB in the reader via a VIEW intent (the "Open with" flow,
 * which opens the book transiently without touching the user's library) and
 * return a CDP session attached to the reader page.
 */
export const openFixtureBook = async (fixtureFile: string): Promise<CdpPage> => {
  const remote = `${REMOTE_FIXTURE_DIR}/${path.basename(fixtureFile)}`;
  await pushFile(fixtureFile, remote);

  // Register the file with MediaStore so a content:// URI exists — receivers
  // get a read grant with the intent, so this works without the app holding
  // any storage permission (fresh emulator installs).
  await adbShell(
    `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${remote}`,
  );
  let uri = `file://${remote}`;
  try {
    // Match by basename: MediaStore stores the canonical
    // /storage/emulated/0/... path, not the /sdcard symlink we pushed to.
    const basename = path.basename(remote);
    const row = await waitFor(
      async () => {
        const out = await adbShell(
          `content query --uri content://media/external/file --projection _id --where "_data LIKE '%/${basename}'"`,
        );
        const m = out.match(/_id=(\d+)/);
        return m ? m[1] : null;
      },
      { timeoutMs: 5_000, label: 'MediaStore row' },
    );
    uri = `content://media/external/file/${row}`;
  } catch {
    // fall back to the file:// URI (works when the app has storage access)
  }

  await adbShell(
    `am start -a android.intent.action.VIEW -d "${uri}" -t application/epub+zip ` +
      `--grant-read-uri-permission ${APP_PKG}`,
  );

  const target = await waitFor(
    async () => {
      await forwardWebViewDevtools(APP_PKG, CDP_PORT);
      const pages = await listPages(CDP_PORT);
      return pages.find((p) => p.type === 'page' && p.url.includes('/reader'));
    },
    { timeoutMs: 30_000, intervalMs: 500, label: 'reader page' },
  );
  const page = await CdpPage.connect(CDP_PORT, target.id);

  // Wait until the book is rendered with real text content.
  await waitFor(
    () =>
      page.evaluate<boolean>(`
        const view = document.querySelector('foliate-view');
        if (!view || !view.renderer) return false;
        const contents = view.renderer.getContents();
        return contents.some((c) => c.doc && (c.doc.body?.textContent ?? '').trim().length > 200);
      `),
    { timeoutMs: 30_000, intervalMs: 500, label: 'book content rendered' },
  );
  return page;
};

export interface WordTarget {
  /** Device pixels — pass straight to adb input. */
  deviceX: number;
  deviceY: number;
  cssX: number;
  cssY: number;
  onScreen: boolean;
}

export interface WordRef {
  word: string;
  /** Character index within the paragraph's first text node. */
  index: number;
}

export interface SelectionTargets {
  /** Identifies the paragraph: leading characters of its first text node. */
  prefix: string;
  /** Spine section the paragraph lives in. */
  sectionIndex: number;
  firstWord: WordRef;
  midWord: WordRef;
  /** A word at least two lines below the first one (drag destination). */
  dragWord: WordRef;
  /** Pagination position (frame x) where the paragraph is on screen. */
  frameX: number;
}

/**
 * Force hyphenation in every rendered section document. The bug under test
 * needs generated hyphens, and the app's hyphenation setting may be off on
 * the test device — the injected style makes the lane independent of it.
 */
export const ensureHyphenation = (page: CdpPage) =>
  page.evaluate<number>(`
    const view = document.querySelector('foliate-view');
    let injected = 0;
    for (const c of view.renderer.getContents()) {
      if (!c.doc || c.doc.getElementById('e2e-hyphens')) continue;
      const style = c.doc.createElement('style');
      style.id = 'e2e-hyphens';
      style.textContent =
        'p { -webkit-hyphens: auto !important; hyphens: auto !important; ' +
        'text-align: justify !important; }';
      (c.doc.head ?? c.doc.documentElement).appendChild(style);
      injected++;
    }
    if (injected) await new Promise((r) => setTimeout(r, 400));
    return injected;
  `);

/**
 * Navigate to the chapter whose TOC label matches `labelPattern` (case
 * insensitive). Returns false when the TOC has no such entry.
 */
export const gotoChapter = async (page: CdpPage, labelPattern: string): Promise<boolean> => {
  const ok = await page.evaluate<boolean>(`
    const view = document.querySelector('foliate-view');
    const flat = [];
    const walk = (items) => {
      for (const item of items ?? []) {
        flat.push(item);
        walk(item.subitems);
      }
    };
    walk(view.book.toc);
    const re = new RegExp(${JSON.stringify(labelPattern)}, 'i');
    const match = flat.find((item) => re.test(item.label ?? ''));
    if (!match) return false;
    await view.goTo(match.href);
    return true;
  `);
  if (ok) {
    // Let the section render and settle.
    await new Promise((r) => setTimeout(r, 1000));
  }
  return ok;
};

/**
 * Find a paragraph suitable for the hyphen-selection cases on the CURRENT
 * page: it must render at least one generated hyphen (auto-hyphenation) and
 * start on screen. Returns null when this page has none — callers page
 * forward and retry, which makes the lane fixture-agnostic (any English book
 * works, e.g. sample-alice.epub).
 */
const findTargetsOnCurrentPage = (page: CdpPage) =>
  page.evaluate<SelectionTargets | null>(`
    const view = document.querySelector('foliate-view');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const WORD_RE = () => /[A-Za-z][A-Za-z'\\u2019-]*/g;
    for (const c of view.renderer.getContents()) {
      if (!c.doc) continue;
      const win = c.doc.defaultView;
      const fe = win.frameElement.getBoundingClientRect();
      for (const p of c.doc.querySelectorAll('p')) {
        const tw = c.doc.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        let node = null;
        let t;
        while ((t = tw.nextNode())) {
          if (t.data.trim().length > 40) {
            node = t;
            break;
          }
        }
        if (!node) continue;

        // Generated auto-hyphens show up as an extra sub-glyph-width rect
        // appended to a line of a single text node.
        const em = parseFloat(win.getComputedStyle(p).fontSize) || 16;
        let hasHyphen = false;
        const hw = c.doc.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        const probe = c.doc.createRange();
        let h;
        while (!hasHyphen && (h = hw.nextNode())) {
          if (!h.data.trim()) continue;
          probe.selectNodeContents(h);
          const rects = [...probe.getClientRects()];
          for (let i = 1; i < rects.length; i++) {
            const a = rects[i - 1];
            const b = rects[i];
            const sameLine = Math.abs(a.top - b.top) < Math.max(a.height, b.height) / 2;
            const adjacent = Math.abs(b.left - (a.left + a.width)) <= 2;
            if (sameLine && adjacent && b.width > 0 && b.width <= em * 0.6) {
              hasHyphen = true;
              break;
            }
          }
        }
        if (!hasHyphen) continue;

        const data = node.data;
        const re = WORD_RE();
        const first = re.exec(data);
        if (!first) continue;

        // The selection must start at the paragraph's first character —
        // bail if any non-whitespace content precedes the word.
        const before = c.doc.createRange();
        before.selectNodeContents(p);
        before.setEnd(node, first.index);
        if (before.toString().trim().length > 0) continue;

        const rectOf = (index, length) => {
          const r = c.doc.createRange();
          r.setStart(node, index);
          r.setEnd(node, index + length);
          return r.getBoundingClientRect();
        };
        const firstRect = rectOf(first.index, first[0].length);
        const fx = fe.left + firstRect.left + firstRect.width / 2;
        const fy = fe.top + firstRect.top + firstRect.height / 2;
        if (fx < 0 || fx > vw || fy < 0 || fy > vh) continue;

        const second = re.exec(data);
        const third = second ? re.exec(data) : null;
        const mid = third ?? second;
        if (!mid) continue;

        // Drag destination: a word at least two line-heights below the
        // first word, still on screen.
        const lineH = firstRect.height || em * 1.5;
        let drag = null;
        const dre = WORD_RE();
        let m;
        while ((m = dre.exec(data))) {
          const r = rectOf(m.index, m[0].length);
          const cx = fe.left + r.left + r.width / 2;
          const cy = fe.top + r.top + r.height / 2;
          if (r.top >= firstRect.top + 2 * lineH && cx >= 0 && cx <= vw && cy >= 0 && cy <= vh) {
            drag = { word: m[0], index: m.index };
            break;
          }
        }
        if (!drag) continue;

        return {
          prefix: data.trim().slice(0, 24),
          sectionIndex: c.index ?? 0,
          firstWord: { word: first[0], index: first.index },
          midWord: { word: mid[0], index: mid.index },
          dragWord: drag,
          frameX: fe.left,
        };
      }
    }
    return null;
  `);

const turnPage = (page: CdpPage, dir: 'next' | 'prev') =>
  page.evaluate<boolean>(`
    const view = document.querySelector('foliate-view');
    await view.renderer.${dir}();
    await new Promise((r) => setTimeout(r, 200));
    return true;
  `);

/** Page forward from the current position until selection targets are found. */
export const findSelectionTargets = async (page: CdpPage): Promise<SelectionTargets> => {
  for (let i = 0; i < 40; i++) {
    // Re-ensure on every step: paging forward can render new sections.
    await ensureHyphenation(page);
    const targets = await findTargetsOnCurrentPage(page);
    if (targets) return targets;
    await turnPage(page, 'next');
  }
  throw new Error('no hyphenated on-screen paragraph found in the fixture book');
};

/** Locate a word (by its exact character index in the paragraph's first text node). */
export const locateWord = (page: CdpPage, prefix: string, ref: WordRef) =>
  page.evaluate<WordTarget | null>(`
    const view = document.querySelector('foliate-view');
    for (const c of view.renderer.getContents()) {
      if (!c.doc) continue;
      const walker = c.doc.createTreeWalker(c.doc.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.data.trim().startsWith(${JSON.stringify(prefix)})) continue;
        if (node.data.slice(${JSON.stringify(ref.index)}, ${ref.index + ref.word.length}) !==
            ${JSON.stringify(ref.word)}) continue;
        const range = c.doc.createRange();
        range.setStart(node, ${ref.index});
        range.setEnd(node, ${ref.index + ref.word.length});
        const rect = range.getBoundingClientRect();
        const frame = c.doc.defaultView.frameElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const cssX = frame.left + rect.left + rect.width / 2;
        const cssY = frame.top + rect.top + rect.height / 2;
        return {
          deviceX: Math.round(cssX * dpr),
          deviceY: Math.round(cssY * dpr),
          cssX,
          cssY,
          onScreen: cssX >= 0 && cssX <= window.innerWidth && cssY >= 0 && cssY <= window.innerHeight,
        };
      }
    }
    return null;
  `);

export interface SelectionState {
  exists: boolean;
  collapsed: boolean;
  text: string;
  startOffset: number;
  startText: string;
}

export const getSelectionState = (page: CdpPage) =>
  page.evaluate<SelectionState>(`
    const view = document.querySelector('foliate-view');
    for (const c of view.renderer.getContents()) {
      const sel = c.doc?.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        return {
          exists: true,
          collapsed: sel.isCollapsed,
          text: sel.toString(),
          startOffset: range.startOffset,
          startText: (range.startContainer.data ?? '').slice(0, 40),
        };
      }
    }
    return { exists: false, collapsed: true, text: '', startOffset: -1, startText: '' };
  `);

/** The app's own selection drag handles (SelectionRangeEditor) in the top document. */
export const getCustomHandles = (page: CdpPage) =>
  page.evaluate<{ x: number; y: number }[]>(`
    return [...document.querySelectorAll('div.cursor-grab')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
  `);

export interface ReaderMetrics {
  dpr: number;
  viewWidth: number;
  viewHeight: number;
  frameX: number;
  marginRight: number;
  marginBottom: number;
}

export const getReaderMetrics = (page: CdpPage, sectionIndex?: number) =>
  page.evaluate<ReaderMetrics>(`
    const view = document.querySelector('foliate-view');
    const renderer = view.renderer;
    const contents = renderer.getContents();
    const content =
      contents.find((c) => c.doc && c.index === ${sectionIndex ?? -1}) ??
      contents.find((c) => c.doc);
    return {
      dpr: window.devicePixelRatio || 1,
      viewWidth: window.innerWidth,
      viewHeight: window.innerHeight,
      frameX: content.doc.defaultView.frameElement.getBoundingClientRect().x,
      marginRight: parseFloat(renderer.getAttribute('margin-right')) || 0,
      marginBottom: parseFloat(renderer.getAttribute('margin-bottom')) || 0,
    };
  `);

/** Navigate (next/prev) until the rendered section's frame x matches. */
export const gotoFrameX = (page: CdpPage, frameX: number, sectionIndex?: number) =>
  page.evaluate<number>(`
    const view = document.querySelector('foliate-view');
    const contents = view.renderer.getContents();
    const content =
      contents.find((c) => c.doc && c.index === ${sectionIndex ?? -1}) ??
      contents.find((c) => c.doc);
    const fx = () => content.doc.defaultView.frameElement.getBoundingClientRect().x;
    for (let i = 0; i < 60; i++) {
      const x = fx();
      if (Math.abs(x - ${frameX}) < 2) break;
      if (x < ${frameX}) await view.renderer.prev();
      else await view.renderer.next();
      await new Promise((r) => setTimeout(r, 150));
    }
    return fx();
  `);

export const clearDomSelection = (page: CdpPage) =>
  page.evaluate<string>(`
    const view = document.querySelector('foliate-view');
    for (const c of view.renderer.getContents()) {
      c.doc?.getSelection()?.removeAllRanges();
    }
    window.getSelection()?.removeAllRanges();
    return 'cleared';
  `);

/** Long-press a word and wait until it is selected. */
export const longPressWord = async (
  page: CdpPage,
  prefix: string,
  ref: WordRef,
): Promise<WordTarget> => {
  const target = await waitFor(() => locateWord(page, prefix, ref), {
    label: `word "${ref.word}"`,
  });
  if (!target.onScreen) throw new Error(`word "${ref.word}" is off-screen`);
  await longPress(target.deviceX, target.deviceY);
  await waitFor(
    async () => {
      const sel = await getSelectionState(page);
      return sel.exists && !sel.collapsed && sel.text.includes(ref.word) ? sel : null;
    },
    { label: `selection of "${ref.word}"` },
  );
  return target;
};

/** Tap an empty-ish text spot away from the popup to dismiss the selection. */
export const dismissSelection = async (page: CdpPage): Promise<void> => {
  const { dpr, viewWidth, viewHeight } = await getReaderMetrics(page);
  await tap(viewWidth * 0.5 * dpr, viewHeight * 0.78 * dpr);
  await waitFor(
    async () => {
      const handles = await getCustomHandles(page);
      const sel = await getSelectionState(page);
      return handles.length === 0 && (!sel.exists || sel.collapsed);
    },
    { label: 'selection dismissed' },
  );
  await clearDomSelection(page);
  await sleep(300);
};
