import { afterEach, describe, expect, test } from 'vitest';
import type { ViewSettings } from '@/types/book';
import { applyLinkHitArea, getStyles, LINK_TOUCH_HOLD_CLASS } from '@/utils/style';
import {
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_BOOK_STYLE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_TTS_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_SCREEN_CONFIG,
} from '@/services/constants';

const settings = {
  ...DEFAULT_BOOK_FONT,
  ...DEFAULT_BOOK_LAYOUT,
  ...DEFAULT_BOOK_LANGUAGE,
  ...DEFAULT_BOOK_STYLE,
  ...DEFAULT_VIEW_CONFIG,
  ...DEFAULT_TTS_CONFIG,
  ...DEFAULT_TRANSLATOR_CONFIG,
  ...DEFAULT_ANNOTATOR_CONFIG,
  ...DEFAULT_SCREEN_CONFIG,
} as ViewSettings;

let iframe: HTMLIFrameElement | undefined;
afterEach(() => iframe?.remove());

const pixel =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>',
  );

describe('Android linked-image touch hold', () => {
  test.each([
    { name: 'default', layout: {} },
    { name: 'Use Book Layout', layout: { useBookLayout: true } },
    { name: 'Override Book Layout', layout: { overrideLayout: true } },
  ])('keeps image hit targets and text selection under $name', async ({ layout }) => {
    iframe = document.createElement('iframe');
    iframe.style.cssText = 'width: 500px; height: 600px; border: 0';
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    doc.head.innerHTML = `<style>${getStyles({ ...settings, ...layout })}</style>`;
    doc.body.innerHTML = `
      <a href="#figure" style="display:block; width:100px; height:100px">
        <img id="figure" src="${pixel}" width="100" height="100"/>
      </a>
      <a href="#svg" style="display:block; width:100px; height:100px">
        <svg width="100" height="100"><image id="svg" href="${pixel}" width="100" height="100"/></svg>
      </a>
      <a href="#note" id="text">Text link</a>
      <a href="#glyph"><img id="glyph" src="${pixel}" zy-enlarge-src="none" style="pointer-events:none"/></a>
      <a href="#svg-glyph"><svg zy-enlarge-src="none" width="100" height="100"><image id="svg-glyph" href="${pixel}" width="100" height="100"/></svg></a>
    `;
    await doc.querySelector('img')!.decode();
    applyLinkHitArea(doc);
    const pointerEvents = (id: string) =>
      doc.defaultView!.getComputedStyle(doc.getElementById(id)!).pointerEvents;
    doc.documentElement.classList.add(LINK_TOUCH_HOLD_CLASS);
    for (const id of ['figure', 'svg']) {
      const image = doc.getElementById(id)!;
      const rect = image.getBoundingClientRect();
      expect(doc.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2), id).toBe(
        image,
      );
    }
    expect(pointerEvents('text')).toBe('none');
    expect(pointerEvents('glyph')).toBe('none');
    expect(pointerEvents('svg-glyph')).toBe('none');
    doc.documentElement.classList.remove(LINK_TOUCH_HOLD_CLASS);
    expect(pointerEvents('text')).toBe('auto');
  });
});
