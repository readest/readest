import { afterEach, describe, expect, it } from 'vitest';
import { makePDF } from 'foliate-js/pdf.js';
import { Overlayer } from 'foliate-js/overlayer.js';

// readest/readest#7853: highlights on adjacent lines of a PDF overlapped on
// Linux but not on Android. A PDF text layer is a transparent span per run of
// text, as tall as the PDF's glyphs (`line-height: 1`), set in whatever font
// the system gives pdf.js's generic family. A text rect is as tall as that
// font's ascent plus descent: about 1.1 em with Android's Roboto or Liberation
// Sans, but 1.45 em with Noto Sans CJK SC, which a Chinese-locale Linux without
// Liberation or Arial gives Chromium for Arial and Times New Roman. That is
// more than a tightly set book's line spacing.
//
// The fixture sets 12pt text on 14pt lines (1.17 em), upright on page 1 and
// turned by `/Rotate 90` on page 2. TallSans stands in for Noto Sans CJK on any
// machine: Inter with Noto Sans CJK's ascent and descent.

type PDFBook = {
  sections: {
    load: () => Promise<{
      src: string;
      onZoom: (options: { doc: Document; scale: number; pageColors: undefined }) => Promise<void>;
    }>;
  }[];
  destroy: () => void;
};

type PDFJS = { TextLayer: { fontFamilyMap: Map<string, string> } };
type Box = { x: number; y: number; width: number; height: number };

const TALL_FONT = 'TallSans';
const TALL_METRICS = { ascentOverride: '116%', descentOverride: '29%' };
const GENERIC_FAMILIES = ['sans-serif', 'serif', 'monospace'];

let iframe: HTMLIFrameElement | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  iframe?.remove();
  iframe = null;
  container?.remove();
  container = null;
});

const addTallFont = async (win: Window & typeof globalThis) => {
  const response = await fetch(
    new URL('../../../public/fonts/InterVariable.woff2', import.meta.url),
  );
  const face = new win.FontFace(TALL_FONT, await response.arrayBuffer(), TALL_METRICS);
  win.document.fonts.add(face);
  await face.load();
};

const strips = (overlayer: Overlayer): Box[] =>
  Array.from((overlayer.element as SVGSVGElement).querySelectorAll(':scope > g > *')).map((el) =>
    (el as SVGGraphicsElement).getBBox(),
  );

// How far two boxes overlap across both axes; 0 when they don't touch.
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

describe('PDF highlights stay within their line (#7853)', () => {
  it.each([
    ['an upright page', 0],
    ['a rotated page', 1],
  ])('keeps the strips of adjacent lines apart on %s when the system font is tall', async (_, index) => {
    await addTallFont(window);
    const response = await fetch(
      new URL('../fixtures/data/repro-7853-tight-leading.pdf', import.meta.url),
    );
    const file = new File([await response.arrayBuffer()], 'repro-7853-tight-leading.pdf', {
      type: 'application/pdf',
    });
    const book = (await makePDF(file)) as unknown as PDFBook;
    const { fontFamilyMap } = (globalThis as unknown as { pdfjsLib: PDFJS }).pdfjsLib.TextLayer;
    const saved = new Map(fontFamilyMap);
    try {
      // The system answers pdf.js's generic family with a tall font.
      for (const family of GENERIC_FAMILIES) fontFamilyMap.set(family, TALL_FONT);
      const page = await book.sections[index]!.load();
      iframe = document.createElement('iframe');
      iframe.style.cssText = 'width:792px;height:792px;border:0';
      const loaded = new Promise((resolve) =>
        iframe!.addEventListener('load', resolve, { once: true }),
      );
      iframe.src = page.src;
      document.body.append(iframe);
      await loaded;
      await addTallFont(iframe.contentWindow as Window & typeof globalThis);
      const doc = iframe.contentDocument!;
      await page.onZoom({ doc, scale: 1, pageColors: undefined });

      const spans = [...doc.querySelectorAll<HTMLElement>('.textLayer span')];
      expect(getComputedStyle(spans[0]!).fontFamily).toBe(TALL_FONT);
      const line = (start: string) => spans.find((span) => span.textContent?.startsWith(start))!;
      // "precept is self-evident today when the tempo" over "of change is
      // increasing exponentially", as in the report.
      const first = line('seeks new answers');
      const last = line('of change is');
      const range = doc.createRange();
      range.setStart(first.firstChild!, 0);
      range.setEnd(last.firstChild!, last.firstChild!.textContent!.length);

      const overlayer = new Overlayer(doc);
      doc.body.append(overlayer.element);
      overlayer.add('highlight', range, Overlayer.highlight);

      const lines = strips(overlayer);
      expect(lines).toHaveLength(2);
      expect(overlap(lines[0]!, lines[1]!), 'area where the two lines overlap').toBeCloseTo(0, 1);
      // Across the line, each strip is the span's own box: the glyphs' size in
      // the PDF.
      const box = first.getBoundingClientRect();
      const across = (b: Box) => Math.min(b.width, b.height);
      for (const strip of lines) expect(across(strip)).toBeCloseTo(across(box), 0);
    } finally {
      fontFamilyMap.clear();
      for (const [family, value] of saved) fontFamilyMap.set(family, value);
      book.destroy?.();
    }
  });

  // Only a text layer pdf.js rendered is clipped. A book's own markup keeps
  // the text's height, even a `textLayer` class with a box shorter than its
  // text.
  it.each([
    ['a paragraph', '<p><span>One line of book text.</span></p>'],
    [
      "a book's own .textLayer",
      '<div class="textLayer"><span style="display:inline-block;height:10px">One line of book text.</span></div>',
    ],
  ])('leaves text in %s at its font height', async (_, html) => {
    await addTallFont(window);
    container = document.createElement('div');
    container.style.cssText = `position:absolute;left:0;top:100px;width:600px;font:20px/1 ${TALL_FONT}`;
    container.innerHTML = html;
    document.body.append(container);
    const overlayer = new Overlayer(document);
    container.append(overlayer.element);
    const range = document.createRange();
    range.selectNodeContents(container.querySelector('span')!.firstChild!);
    overlayer.add('highlight', range, Overlayer.highlight);

    const [strip] = strips(overlayer);
    expect(strip!.height).toBeCloseTo(29, 0);
  });
});
