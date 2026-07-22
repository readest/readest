import { describe, test, expect, afterEach } from 'vitest';
import type { FoliateView } from '@/types/view';
import { handleA11yNavigation } from '@/utils/a11y';

// The exact paragraph-layout selector emitted by getParagraphLayoutStyles() in
// src/utils/style.ts. Its <div> clause only matches paragraph-like divs whose
// descendants are all inline formatting tags — so nesting any other element
// (e.g. the next-section skip link) inside such a paragraph drops the match.
// This needs the real :has() engine, so it runs as a browser test.
const PARAGRAPH_SELECTOR = 'p, blockquote, dd, div:not(:has(*:not(b, a, em, i, strong, u, span)))';

const NEXT_SECTION_ID = 'readest-skip-link-next-section';

const makeOptions = () => ({
  skipToLastPosCallback: () => {},
  skipToLastPosLabel: 'last',
  skipToNextSectionCallback: () => {},
  skipToNextSectionLabel: 'next',
});

const iframes: HTMLIFrameElement[] = [];

// Render an isolated, laid-out document in an iframe (mirrors how foliate
// renders each EPUB section) so getComputedStyle and :has() use the real engine.
const renderSection = (bodyHtml: string) => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  iframes.push(iframe);
  const doc = iframe.contentDocument!;
  const style = doc.createElement('style');
  style.textContent =
    `body { font-size: 16px; }` + `${PARAGRAPH_SELECTOR} { line-height: 3 !important; }`;
  doc.head.appendChild(style);
  doc.body.innerHTML = bodyHtml;
  return { doc, win: iframe.contentWindow! };
};

describe('handleA11yNavigation paragraph-layout interaction', () => {
  afterEach(() => {
    while (iframes.length) iframes.pop()!.remove();
  });

  test('keeps the last <div> paragraph styled by the paragraph-layout rule', () => {
    const { doc, win } = renderSection(
      `<div class="para">First paragraph.</div>` +
        `<div class="para">Last paragraph <span>with an inline span</span>.</div>`,
    );
    const lastPara = doc.body.lastElementChild as HTMLElement;
    // 3 × 16px — the overridden line spacing, applied before any injection.
    expect(win.getComputedStyle(lastPara).lineHeight).toBe('48px');

    handleA11yNavigation({} as FoliateView, doc, makeOptions());

    // The skip link is still injected at the section end (accessibility intact)...
    const skipLink = doc.getElementById(NEXT_SECTION_ID);
    expect(skipLink).not.toBeNull();
    expect(lastPara.contains(skipLink)).toBe(true);
    // ...and the last paragraph still receives the overridden line spacing
    // instead of reverting to the book default (the bug: #last-paragraph).
    expect(win.getComputedStyle(lastPara).lineHeight).toBe('48px');
  });
});
