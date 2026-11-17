import { afterEach, describe, expect, it } from 'vitest';
import { applyOrientationMedia } from '@/utils/style';

// A book's `@media (orientation: ...)` must follow the reading area, not the
// section iframe, and must re-resolve when the reading area turns (#7449).
// Run in a real engine: happy-dom neither re-cascades on a mediaText write nor
// evaluates media queries.

let frame: HTMLIFrameElement | null = null;

// The iframe is a wide strip, the way the paginator sizes a section, so its own
// orientation is always landscape and can't decide the result.
const loadSection = (css: string, body: string) => {
  frame = document.createElement('iframe');
  Object.assign(frame.style, { width: '1600px', height: '400px' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.documentElement.innerHTML = `<head><style>${css}</style></head><body>${body}</body>`;
  return doc;
};

const display = (doc: Document, selector = '.paracol') =>
  getComputedStyle(doc.querySelector(selector)!).display;

afterEach(() => {
  frame?.remove();
  frame = null;
});

describe('applyOrientationMedia', () => {
  const BILINGUAL = `
    @media (orientation: landscape) { .paracol { display: flex; } }
    @media (orientation: portrait) { .paracol { display: block; } }`;

  it('follows the reading area and re-resolves when it turns', () => {
    const doc = loadSection(BILINGUAL, '<div class="paracol"><p>a</p><p>b</p></div>');
    applyOrientationMedia(doc, false);
    expect(display(doc)).toBe('block');
    applyOrientationMedia(doc, true);
    expect(display(doc)).toBe('flex');
    applyOrientationMedia(doc, false);
    expect(display(doc)).toBe('block');
  });

  it('keeps the cascade the book wrote: a later plain rule still wins', () => {
    const doc = loadSection(
      `${BILINGUAL} .paracol { display: grid; }`,
      '<div class="paracol"><p>a</p></div>',
    );
    applyOrientationMedia(doc, true);
    expect(display(doc)).toBe('grid');
  });

  it('keeps comma lists, negation and nested rules', () => {
    const doc = loadSection(
      `@media print, (orientation: landscape) { .a { display: flex; } }
       @media not all and (orientation: portrait) { .b { display: flex; } }
       @supports (display: grid) { @media (orientation: portrait) { .c { display: grid; } } }
       @media (orientation: portrait) { :root { --w: 1; } html .d { display: flex; } }`,
      '<p class="a"></p><p class="b"></p><p class="c"></p><p class="d"></p>',
    );
    applyOrientationMedia(doc, true);
    expect([display(doc, '.a'), display(doc, '.b'), display(doc, '.c')]).toEqual([
      'flex',
      'flex',
      'block',
    ]);
    applyOrientationMedia(doc, false);
    expect([display(doc, '.a'), display(doc, '.b'), display(doc, '.c')]).toEqual([
      'block',
      'block',
      'grid',
    ]);
    expect(getComputedStyle(doc.documentElement).getPropertyValue('--w').trim()).toBe('1');
    expect(display(doc, '.d')).toBe('flex');
  });
});
