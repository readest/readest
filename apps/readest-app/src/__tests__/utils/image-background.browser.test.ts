import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { WHITE_TRANSPARENCY_FILTER, mountWhiteTransparencyFilter } from '@/utils/imageBackground';
import { applyFixedlayoutStyles, getStyles, type ThemeCode } from '@/utils/style';
import {
  DEFAULT_BOOK_STYLE,
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_TTS_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_SCREEN_CONFIG,
} from '@/services/constants';
import type { ViewSettings } from '@/types/book';

const settings = {
  ...DEFAULT_BOOK_STYLE,
  ...DEFAULT_BOOK_FONT,
  ...DEFAULT_BOOK_LAYOUT,
  ...DEFAULT_BOOK_LANGUAGE,
  ...DEFAULT_VIEW_CONFIG,
  ...DEFAULT_TTS_CONFIG,
  ...DEFAULT_TRANSLATOR_CONFIG,
  ...DEFAULT_ANNOTATOR_CONFIG,
  ...DEFAULT_SCREEN_CONFIG,
  transparentImageBackground: true,
} as ViewSettings;
const theme = {
  bg: '#eee0c0',
  fg: '#202020',
  primary: '#3366cc',
  isDarkMode: false,
  palette: {},
} as ThemeCode;

// Exercise the browser's SVG filter pipeline, including the threshold, color
// preservation, existing alpha, and ordering with dark-mode inversion.
const renderPixels = async (invert = false) => {
  const source = document.createElement('canvas');
  source.width = 8;
  source.height = 1;
  const ctx = source.getContext('2d')!;
  const colors = [
    [255, 255, 255, 255],
    [245, 245, 245, 255],
    [244, 244, 244, 255],
    [255, 244, 255, 255],
    [255, 0, 0, 255],
    [0, 0, 0, 255],
    [0, 0, 255, 128],
    [255, 255, 255, 0],
  ];
  ctx.putImageData(new ImageData(new Uint8ClampedArray(colors.flat()), 8, 1), 0, 0);
  const image = new Image();
  image.src = source.toDataURL();
  await image.decode();
  const output = document.createElement('canvas');
  output.width = 8;
  output.height = 1;
  const result = output.getContext('2d')!;
  mountWhiteTransparencyFilter(document);
  result.filter = `${WHITE_TRANSPARENCY_FILTER}${invert ? ' invert(100%)' : ''}`;
  result.drawImage(image, 0, 0);
  return [...result.getImageData(0, 0, 8, 1).data];
};

describe('white transparency rendered pixels (#7045)', () => {
  it.each([
    false,
    true,
  ])('matches images despite inline-image blend rules (fixed layout: %s)', async (fixed) => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.body.innerHTML =
      '<p width="100" height="100"><img class="has-text-siblings"/><svg><image/></svg></p>';
    if (fixed) {
      applyFixedlayoutStyles(doc, settings, theme, 'EPUB');
    } else {
      const style = doc.createElement('style');
      style.textContent = getStyles(settings, theme);
      doc.head.appendChild(style);
    }
    try {
      for (const image of doc.querySelectorAll('img, image')) {
        const computed = frame.contentWindow!.getComputedStyle(image);
        expect(computed.filter).toContain('readest-white-transparent');
        expect(computed.mixBlendMode).toBe('normal');
      }
    } finally {
      frame.remove();
    }
  });
  it.each([
    false,
    true,
  ])('restores the original image styles when turned off (fixed: %s)', (fixed) => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.body.innerHTML = '<p><img/></p><svg><image/></svg>';
    const style = doc.createElement('style');
    doc.head.appendChild(style);
    try {
      for (const isDarkMode of [false, true]) {
        for (const overrideColor of [false, true]) {
          for (const invertImgColorInDark of [false, true]) {
            const current = { ...settings, overrideColor, invertImgColorInDark };
            const currentTheme = { ...theme, isDarkMode };
            const apply = (transparentImageBackground: boolean) => {
              const next = { ...current, transparentImageBackground };
              if (fixed) applyFixedlayoutStyles(doc, next, currentTheme, 'EPUB');
              else style.textContent = getStyles(next, currentTheme);
            };
            const read = () =>
              Array.from(doc.querySelectorAll('img, image'), (image) => {
                const computed = frame.contentWindow!.getComputedStyle(image);
                return [computed.filter, computed.mixBlendMode, computed.backgroundColor];
              });
            apply(false);
            const original = read();
            apply(true);
            expect(read()[0]![0]).toContain('readest-white-transparent');
            apply(false);
            expect(read()).toEqual(original);
            expect(read()[0]![0]).not.toContain('readest-white-transparent');
          }
        }
      }
    } finally {
      frame.remove();
    }
  });

  it('removes only near-white pixels and preserves color and alpha', async () => {
    expect(await renderPixels()).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 244, 244, 244, 255, 255, 244, 255, 255, 255, 0, 0, 255, 0, 0, 0, 255,
      0, 0, 255, 128, 0, 0, 0, 0,
    ]);
  });

  it('removes the original white before inversion', async () => {
    const pixels = await renderPixels(true);
    expect(pixels.slice(0, 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(pixels.slice(16, 24)).toEqual([0, 255, 255, 255, 255, 255, 255, 255]);
  });

  // Sections render in an iframe, where WebKit (iOS, iPadOS, macOS) drew a
  // filter held in a data: URL as no filter at all (#7391).
  it('paints a white image as transparent inside a section iframe', async () => {
    const white = document.createElement('canvas');
    white.width = white.height = 40;
    const ctx = white.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 40, 40);
    const xhtml = `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><img src="${white.toDataURL()}"/></body></html>`;
    const frame = document.createElement('iframe');
    frame.style.cssText = 'border:0;width:40px;height:40px';
    frame.src = URL.createObjectURL(new Blob([xhtml], { type: 'application/xhtml+xml' }));
    document.body.appendChild(frame);
    try {
      await new Promise((resolve) => (frame.onload = resolve));
      const doc = frame.contentDocument!;
      const style = doc.createElement('style');
      style.textContent = `${getStyles(settings, theme)}
        html, body { margin: 0 !important; padding: 0 !important; background: rgb(0, 128, 0) !important; }
        img { display: block; }`;
      doc.head.appendChild(style);
      // as the reader's load handler does, after the styles are in place
      mountWhiteTransparencyFilter(doc);
      await doc.querySelector('img')!.decode();
      await new Promise((resolve) => setTimeout(resolve, 200));
      const shot = await page.screenshot({ element: frame, save: false, base64: true });
      const image = new Image();
      image.src = `data:image/png;base64,${shot}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const read = canvas.getContext('2d')!;
      read.drawImage(image, 0, 0);
      const [r, g, b] = read.getImageData(10, 10, 1, 1).data;
      // the page's green, not the image's white
      expect([r, g, b]).toEqual([0, 128, 0]);
    } finally {
      frame.remove();
    }
  });
});
