import { describe, it, expect, afterEach } from 'vitest';
import type { ViewSettings } from '@/types/book';
import { getStyles, applyLinkHitArea } from '@/utils/style';
import {
  applyScrollableStyle,
  findScrollableBox,
  SCROLL_WRAPPER_CLASS,
  SCROLL_WRAPPER_FIT_CLASS,
} from '@/utils/scrollable';
import {
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_TTS_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_SCREEN_CONFIG,
} from '@/services/constants';

const viewSettings = {
  ...DEFAULT_BOOK_FONT,
  ...DEFAULT_BOOK_LAYOUT,
  ...DEFAULT_BOOK_STYLE,
  ...DEFAULT_BOOK_LANGUAGE,
  ...DEFAULT_VIEW_CONFIG,
  ...DEFAULT_TTS_CONFIG,
  ...DEFAULT_TRANSLATOR_CONFIG,
  ...DEFAULT_ANNOTATOR_CONFIG,
  ...DEFAULT_SCREEN_CONFIG,
} as ViewSettings;

// #6857's sample: a full-width table whose last cell is a right-aligned link
// with no right padding, so the link ends flush with the table's edge.
const BOOK_CSS = `
  table { width: 100%; }
  td { padding: 5px; }
  td:last-child { padding-right: 0; }
  .right { text-align: right; }
`;
const BODY = `
  <table><tbody><tr>
    <td>Glowlight Tetra</td>
    <td class="right"><a href="https://duckduckgo.com/?q=Hemigrammus+erythrozonus">duckduckgo.com</a></td>
  </tr></tbody></table>
`;

const poll = async (fn: () => boolean, timeout = 2000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 30));
  }
  return fn();
};

let iframe: HTMLIFrameElement | null = null;

const loadSection = async (extraCss = '') => {
  iframe = document.createElement('iframe');
  iframe.style.cssText = 'width: 500px; height: 600px; border: 0';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(
    `<!doctype html><html><head><style>${BOOK_CSS}${extraCss}</style>` +
      `<style>${getStyles(viewSettings)}</style></head><body>${BODY}</body></html>`,
  );
  doc.close();
  applyLinkHitArea(doc);
  applyScrollableStyle(doc);
  const wrapper = doc.querySelector<HTMLElement>(`.${SCROLL_WRAPPER_CLASS}`)!;
  await poll(() => wrapper.classList.contains(SCROLL_WRAPPER_FIT_CLASS));
  return { doc, wrapper };
};

afterEach(() => {
  iframe?.remove();
  iframe = null;
});

describe('table fit with enlarged link hit areas (#6857)', () => {
  it('does not make a table that fits its column scroll because of a link at its edge', async () => {
    const { doc, wrapper } = await loadSection();
    const table = wrapper.querySelector('table')!;
    expect(table.getBoundingClientRect().width).toBeLessThanOrEqual(wrapper.clientWidth);
    expect(doc.documentElement.classList.contains('link-hit-area')).toBe(true);

    expect(wrapper.classList.contains(SCROLL_WRAPPER_FIT_CLASS), 'table marked fit').toBe(true);
    expect(doc.defaultView!.getComputedStyle(wrapper).overflowX).toBe('visible');
  });

  it('still scrolls a table a few pixels wider than its column', async () => {
    const { wrapper } = await loadSection('table { min-width: calc(100% + 8px); }');
    expect(wrapper.querySelector('table')!.offsetWidth).toBeGreaterThan(wrapper.clientWidth + 4);

    expect(wrapper.classList.contains(SCROLL_WRAPPER_FIT_CLASS), 'table marked fit').toBe(false);
  });

  it('leaves a wheel or swipe over the fitting table to the page', async () => {
    const { doc } = await loadSection();
    expect(findScrollableBox(doc.querySelector('a'))).toBeNull();
  });
});
