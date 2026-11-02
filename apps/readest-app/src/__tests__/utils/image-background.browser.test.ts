import { describe, expect, it } from 'vitest';
import { WHITE_TRANSPARENCY_FILTER } from '@/utils/imageBackground';
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
});
