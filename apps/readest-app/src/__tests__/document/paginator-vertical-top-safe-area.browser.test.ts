/**
 * FoliateViewer sets a vertical book's margin-top to gridInsets.top / 1.5 +
 * the margin, because the paginator pads vertical text by 1.5x its margin
 * (#7389). This pins that multiplier in a real layout: if it changes, the
 * text slides back under the Dynamic Island. The margin FoliateViewer
 * computes is tested in foliate-viewer-open-margins.test.tsx.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Renderer } from '@/types/view';

let paginator: Renderer;
const urls: string[] = [];

const container = () => paginator.shadowRoot!.getElementById('container')!;
const currentDoc = () =>
  paginator.getContents().find((c) => c.index === paginator.primaryIndex)!.doc;

const openVertical = async (scrolled: boolean) => {
  paginator = document.createElement('foliate-paginator') as Renderer;
  Object.assign(paginator.style, {
    width: '393px',
    height: '852px',
    position: 'absolute',
    top: '0',
    left: '0',
  });
  paginator.setAttribute('margin-top', `${59 / 1.5 + 16}px`);
  paginator.setAttribute('margin-right', '16px');
  paginator.setAttribute('margin-bottom', `${34 / 1.5 + 16}px`);
  paginator.setAttribute('margin-left', '16px');
  paginator.setAttribute('max-column-count', '1');
  paginator.setAttribute('max-inline-size', '720px');
  paginator.setAttribute('max-block-size', '1440px');
  if (scrolled) {
    paginator.setAttribute('flow', 'scrolled');
    paginator.setAttribute('scroll-direction', 'horizontal');
  }
  document.body.append(paginator);

  const lines = Array.from(
    { length: 40 },
    (_, i) =>
      `<p>${i === 0 ? '<span id="first-glyph">一</span>' : ''}縦書きの本文テスト行で上部のセーフエリアと干渉しないことを確認します。</p>`,
  ).join('');
  const html = `<!doctype html><html dir="rtl"><head><style>html{writing-mode:vertical-rl}html,body{margin:0;padding:0;font-size:18px;line-height:1.7}p{margin:0}</style></head><body>${lines}</body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  urls.push(url);

  paginator.open({
    dir: 'rtl',
    sections: [{ id: 'ch-0', linear: 'yes', size: html.length, load: async () => url }],
  } as unknown as Parameters<Renderer['open']>[0]);
  await paginator.goTo({ index: 0, anchor: 0 });
  await expect.poll(() => currentDoc()?.getElementById('first-glyph')).not.toBeNull();
  await expect.poll(() => container().style.opacity).not.toBe('0');
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
};

const getTextColumnBounds = () => {
  const doc = currentDoc();
  const frame = paginator.shadowRoot!.querySelector('iframe')!;
  const frameRect = frame.getBoundingClientRect();
  const glyphRect = doc.getElementById('first-glyph')!.getBoundingClientRect();
  const bodyRect = doc.body.getBoundingClientRect();
  return {
    top: frameRect.top + glyphRect.top,
    bottom: frameRect.top + bodyRect.bottom,
  };
};

beforeAll(async () => {
  await import('foliate-js/paginator.js');
});

afterEach(() => {
  paginator?.destroy();
  paginator?.remove();
  urls.splice(0).forEach(URL.revokeObjectURL);
});

describe('vertical writing mode top and bottom safe-area insets (#7389)', () => {
  it('clears the 59px Dynamic Island and 34px bottom safe area plus 1.5x margins in vertical paginated mode', async () => {
    await openVertical(false);
    const { top } = getTextColumnBounds();
    expect(top).toBeGreaterThanOrEqual(82);
  });

  it('clears the 59px Dynamic Island and 34px bottom safe area plus 1.5x margins in vertical scrolled mode', async () => {
    await openVertical(true);
    const { top, bottom } = getTextColumnBounds();
    expect(top).toBeGreaterThanOrEqual(82);
    expect(bottom).toBeLessThanOrEqual(852 - 57);
  });
});
