import { afterEach, describe, expect, it } from 'vitest';
import { makePDF, setupPanningEvents } from 'foliate-js/pdf.js';
import { rangeFromAnchorToPoint } from '@/utils/sel';
import {
  getCaretPositionInText,
  toDocPoint,
  toWindowPoint,
} from '@/app/reader/utils/crossDocSelection';
import { getPdfCaretPosition } from '@/utils/pdfText';

type PDFBook = {
  sections: {
    load: () => Promise<{
      src: string;
      onZoom: (options: { doc: Document; scale: number; pageColors: undefined }) => Promise<void>;
    }>;
  }[];
  destroy: () => void;
};

let iframe: HTMLIFrameElement;
afterEach(() => iframe?.remove());
const mount = async (scale = 0.6) => {
  iframe = document.createElement('iframe');
  iframe.style.cssText = `width:600px;height:800px;border:0;transform:scale(${scale});transform-origin:0 0`;
  const loaded = new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));
  iframe.srcdoc = `<!doctype html><body style="margin:0"><style>
    .textLayer {position:relative;width:600px;height:800px;font:24px sans-serif}
    .textLayer span {position:absolute;white-space:pre;z-index:1}
    .endOfContent {position:absolute;inset:100% 0 0;z-index:0;user-select:none}
    .selecting .endOfContent {top:0}
    </style><div class="textLayer"><span style="left:40px;top:60px">Alpha first line</span><span style="left:40px;top:120px">Beta second line</span><span style="left:40px;top:180px">Gamma third line</span><span style="left:40px;top:240px">Delta last line</span><div class="endOfContent"></div></div>`;
  document.body.append(iframe);
  await loaded;
  const doc = iframe.contentDocument!;
  setupPanningEvents(doc);
  const text = doc.querySelector('span')!.firstChild!;
  const initial = doc.createRange();
  initial.selectNodeContents(text);
  doc.getSelection()!.addRange(initial);
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { doc, text };
};

describe('PDF app handles hit test text-layer gaps', () => {
  it('extends to the nearby second line instead of the old gap-cover position', async () => {
    const { doc, text } = await mount();
    const range = rangeFromAnchorToPoint(doc, text, 0, 210, 151);
    expect(range?.toString()).toContain('Beta');
    expect(range?.toString()).not.toContain('Gamma');
  });

  it('resolves a gap to a text node near the pointer for cross-page handles', async () => {
    const { doc } = await mount();
    const caret = getCaretPositionInText(doc, 210, 151);
    expect(caret?.node.nodeType).toBe(Node.TEXT_NODE);
    expect(caret?.node.textContent).toBe('Beta second line');
  });
  it.each([
    0.4, 0.6, 1, 1.5,
  ])('keeps both drag directions stable at iframe scale %s', async (scale) => {
    const { doc, text } = await mount(scale);
    for (const y of [125, 151, 175, 205, 151, 125]) {
      const windowPoint = toWindowPoint(doc, { x: 210, y })!;
      const local = toDocPoint(doc, windowPoint)!;
      const range = rangeFromAnchorToPoint(doc, text, 0, local.x, local.y)!;
      expect(range.toString()).toContain('Beta');
      expect(range.toString().includes('Gamma')).toBe(y >= 175);
      const selection = doc.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });

  it('can move the start through a gap while the far endpoint stays anchored', async () => {
    const { doc } = await mount();
    const end = doc.querySelectorAll('span')[3]!.firstChild!;
    const range = rangeFromAnchorToPoint(doc, end, end.textContent!.length, 90, 151)!;
    expect(range.startContainer.textContent).toBe('Beta second line');
    expect(range.endContainer).toBe(end);
    expect(range.endOffset).toBe(end.textContent!.length);
  });

  it('returns a caret in the closest RTL run and leaves EPUB lookup alone', async () => {
    const { doc } = await mount();
    const span = doc.querySelectorAll('span')[1]! as HTMLElement;
    span.dir = 'rtl';
    span.textContent = 'שלום עולם';
    const rect = span.getBoundingClientRect();
    const caret = getPdfCaretPosition(doc, rect.right + 2, rect.bottom + 3)!;
    expect(caret.node).toBe(span.firstChild);
    expect(caret.offset).toBe(0);
    doc.querySelector('.textLayer')!.classList.remove('textLayer');
    expect(getPdfCaretPosition(doc, 210, 151)).toBeNull();
  });
});

it('keeps a handle in the adjacent line of a rendered two-column PDF', async () => {
  const response = await fetch(new URL('../fixtures/data/sample-paper.pdf', import.meta.url));
  const file = new File([await response.arrayBuffer()], 'sample-paper.pdf', {
    type: 'application/pdf',
  });
  const book = (await makePDF(file)) as unknown as PDFBook;
  try {
    const page = await book.sections[0]!.load();
    iframe = document.createElement('iframe');
    iframe.style.cssText =
      'width:612px;height:792px;border:0;transform:scale(.6);transform-origin:0 0';
    const loaded = new Promise((resolve) =>
      iframe.addEventListener('load', resolve, { once: true }),
    );
    iframe.src = page.src;
    document.body.append(iframe);
    await loaded;
    const doc = iframe.contentDocument!;
    await page.onZoom({ doc, scale: 1, pageColors: undefined });
    const spans = [...doc.querySelectorAll('.textLayer span')].filter((span) =>
      span.textContent?.trim(),
    );
    const anchor = spans[4]!.firstChild!;
    const target = spans[5]!;
    const initial = doc.createRange();
    initial.selectNodeContents(anchor);
    doc.getSelection()!.addRange(initial);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const rect = target.getBoundingClientRect();
    const range = rangeFromAnchorToPoint(
      doc,
      anchor,
      0,
      rect.left + rect.width / 2,
      rect.bottom + 1,
    )!;
    expect(range.endContainer).toBe(target.firstChild);
    expect(range.toString()).not.toContain('INTRODUCTION');
  } finally {
    book.destroy?.();
  }
});
