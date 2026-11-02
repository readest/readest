import { afterEach, beforeAll, expect, test } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';
import type { ViewSettings } from '@/types/book';
import {
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_VIEW_CONFIG,
} from '@/services/constants';
import { getFootnoteStyles, getStyles, getThemeCode } from '@/utils/style';
import '@/styles/globals.css';

let paginator: Renderer | undefined;
let source: string;

beforeAll(async () => {
  await import('foliate-js/paginator.js');
});

afterEach(() => {
  paginator?.destroy();
  paginator?.remove();
  URL.revokeObjectURL(source);
  document.documentElement.removeAttribute('data-theme');
});

for (const theme of ['default-light', 'default-dark']) {
  test.each([
    false,
    true,
  ])(`${theme} extracts the footnote body surface with override %s`, async (overrideColor) => {
    document.documentElement.dataset['theme'] = theme;
    const settings = {
      ...DEFAULT_BOOK_FONT,
      ...DEFAULT_BOOK_LANGUAGE,
      ...DEFAULT_BOOK_LAYOUT,
      ...DEFAULT_BOOK_STYLE,
      ...DEFAULT_VIEW_CONFIG,
      backgroundTextureId: 'paper',
      isEink: true,
      overrideColor,
    } as ViewSettings;
    const html = `<html xmlns="http://www.w3.org/1999/xhtml"><head><style>body { background: black; color: white; }</style></head><body class="pbg"><p>Footnote with an authored body background.</p></body></html>`;
    source = URL.createObjectURL(new Blob([html], { type: 'application/xhtml+xml' }));
    paginator = document.createElement('foliate-paginator') as Renderer;
    paginator.style.cssText = 'position:absolute;width:360px;height:220px;left:0;top:0;';
    paginator.setAttribute('flow', 'scrolled');
    paginator.setAttribute('no-preload', '');
    for (const side of ['top', 'right', 'bottom', 'left'])
      paginator.setAttribute(`margin-${side}`, '0px');
    document.body.appendChild(paginator);
    paginator.open({ sections: [{ load: () => source, size: html.length }] } as unknown as BookDoc);
    const themeCode = { ...getThemeCode(), isDarkMode: theme === 'default-dark' };
    paginator.setStyles?.(`${getStyles(settings, themeCode, [], true)}\n${getFootnoteStyles()}`);
    await paginator.goTo({ index: 0 });
    const doc = paginator.getContents()[0]!.doc;
    const surface = doc.defaultView!.frameElement!.parentElement!;
    // The real renderer removes the body's fill after extracting it, so only
    // checking the body would miss a texture-obscuring view surface.
    expect(doc.defaultView!.getComputedStyle(surface).backgroundColor).toBe(
      overrideColor ? 'rgba(0, 0, 0, 0)' : 'rgb(0, 0, 0)',
    );
    if (!overrideColor)
      expect(doc.defaultView!.getComputedStyle(doc.body).color).toBe('rgb(255, 255, 255)');
  });
}
