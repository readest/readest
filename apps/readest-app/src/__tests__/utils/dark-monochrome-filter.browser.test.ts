import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { getDarkMonochromeFilter, mountDarkMonochromeFilter } from '@/utils/imageBackground';
import { getStyles, type ThemeCode } from '@/utils/style';
import {
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_SCREEN_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  DEFAULT_TTS_CONFIG,
  DEFAULT_VIEW_CONFIG,
} from '@/services/constants';
import type { ViewSettings } from '@/types/book';

const baseSettings = {
  ...DEFAULT_BOOK_STYLE,
  ...DEFAULT_BOOK_FONT,
  ...DEFAULT_BOOK_LAYOUT,
  ...DEFAULT_BOOK_LANGUAGE,
  ...DEFAULT_VIEW_CONFIG,
  ...DEFAULT_TTS_CONFIG,
  ...DEFAULT_TRANSLATOR_CONFIG,
  ...DEFAULT_ANNOTATOR_CONFIG,
  ...DEFAULT_SCREEN_CONFIG,
  overrideColor: false,
} as ViewSettings;

const grayDarkTheme = {
  bg: '#444444',
  fg: '#c6c6c6',
  primary: '#88ccee',
  isDarkMode: true,
  palette: {},
} as ThemeCode;

const renderPixels = async (fgColor: string) => {
  const source = document.createElement('canvas');
  source.width = 9;
  source.height = 1;
  const ctx = source.getContext('2d')!;
  const colors = [
    [255, 255, 255, 255], // 0: white -> transparent
    [245, 245, 245, 255], // 1: near-white -> transparent
    [0, 0, 0, 255], // 2: black ink -> fgColor
    [128, 128, 128, 255], // 3: anti-aliased gray
    [255, 0, 0, 255], // 4: chromatic red accent
    [0, 0, 0, 0], // 5: already transparent
    [0, 0, 0, 128], // 6: semi-transparent black ink
    [128, 128, 128, 128], // 7: semi-transparent gray
    [255, 255, 0, 255], // 8: chromatic yellow accent
  ];
  ctx.putImageData(new ImageData(new Uint8ClampedArray(colors.flat()), 9, 1), 0, 0);
  const image = new Image();
  image.src = source.toDataURL();
  await image.decode();

  const output = document.createElement('canvas');
  output.width = 9;
  output.height = 1;
  const result = output.getContext('2d')!;
  mountDarkMonochromeFilter(document, fgColor);
  result.filter = getDarkMonochromeFilter(fgColor);
  result.drawImage(image, 0, 0);
  return [...result.getImageData(0, 0, 9, 1).data];
};

const sampleScreenshotPixel = async (frame: HTMLElement, x: number, y: number) => {
  const shot = await page.screenshot({ element: frame, save: false, base64: true });
  const image = new Image();
  image.src = `data:image/png;base64,${shot}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  const scale = image.width / frame.getBoundingClientRect().width;
  const [r, g, b] = ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
  return [r, g, b];
};

describe('dark monochrome SVG filter (#7981)', () => {
  // Drawn through a canvas filter, which WebKit doesn't apply; the test below
  // checks the same filter where the reader uses it.
  const isWebKit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
  it.skipIf(isWebKit)(
    'turns white transparent, maps black to fg, and keeps transparent pixels clear',
    async () => {
      const pixels = await renderPixels('#c6c6c6');
      expect(pixels[3]).toBe(0); // #ffffff -> transparent
      expect(pixels[7]).toBe(0); // #f5f5f5 -> transparent
      expect(pixels.slice(8, 12)).toEqual([198, 198, 198, 255]); // #000000 -> #c6c6c6
      expect(pixels[15]).toBeGreaterThan(0); // #808080 -> partial alpha
      expect(pixels[15]).toBeLessThan(255);
      expect(pixels[16]).toBeGreaterThan(pixels[17]!); // red accent stays reddish
      expect(pixels[19]).toBe(255); // opaque red keeps full alpha
      expect(pixels.slice(20, 24)).toEqual([0, 0, 0, 0]); // transparent stays transparent
      // semi-transparent black keeps full fg brightness and alpha=128
      expect(Math.abs(pixels[24]! - 198)).toBeLessThanOrEqual(2);
      expect(Math.abs(pixels[25]! - 198)).toBeLessThanOrEqual(2);
      expect(Math.abs(pixels[26]! - 198)).toBeLessThanOrEqual(2);
      expect(pixels[27]).toBe(128);
      // semi-transparent gray stays visible (not dropped to 0)
      expect(pixels[31]).toBeGreaterThan(40);
      // opaque yellow keeps full alpha and yellow hue
      expect(pixels[32]).toBeGreaterThan(pixels[34]!);
      expect(pixels[33]).toBeGreaterThan(pixels[34]!);
      expect(pixels[35]).toBe(255);
    },
  );

  // The reader's section iframe has no background of its own: foliate paints
  // the page color outside it. Screen-blending an inverted image there left a
  // black box on every page that isn't black.
  it('draws gaiji and diagrams on the page color, and follows a theme change', async () => {
    const imgCanvas = document.createElement('canvas');
    imgCanvas.width = 40;
    imgCanvas.height = 40;
    const ctx = imgCanvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 40, 40);
    ctx.fillStyle = '#000000';
    ctx.fillRect(15, 15, 10, 10);
    const dataUrl = imgCanvas.toDataURL();

    const wrapper = document.createElement('div');
    wrapper.style.cssText =
      'background:#444444;color-scheme:dark;padding:0;margin:0;width:100px;height:100px;';
    const frame = document.createElement('iframe');
    frame.style.cssText =
      'border:0;width:100px;height:100px;background:transparent;color-scheme:dark;display:block;';
    const xhtml = `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><p style="margin:0"><img class="gaiji" src="${dataUrl}" style="display:inline-block;width:40px;height:40px;"/><img class="monochrome-diagram" src="${dataUrl}" style="display:inline-block;width:40px;height:40px;"/></p></body></html>`;
    frame.src = URL.createObjectURL(new Blob([xhtml], { type: 'application/xhtml+xml' }));
    wrapper.appendChild(frame);
    document.body.appendChild(wrapper);

    try {
      await new Promise((resolve) => (frame.onload = resolve));
      const doc = frame.contentDocument!;
      const style = doc.createElement('style');
      doc.head.appendChild(style);
      // What the reader does on load and on a theme change: set the styles,
      // then mount the filter they name.
      const applyTheme = async (theme: ThemeCode, settings: Partial<ViewSettings> = {}) => {
        style.textContent = `${getStyles({ ...baseSettings, ...settings }, theme)}
          html, body { margin: 0 !important; padding: 0 !important; background: transparent !important; }`;
        mountDarkMonochromeFilter(doc, theme.fg);
        await new Promise((resolve) => setTimeout(resolve, 150));
      };
      await Promise.all(Array.from(doc.querySelectorAll('img')).map((i) => i.decode()));

      for (const transparentImageBackground of [false, true]) {
        await applyTheme(grayDarkTheme, { transparentImageBackground });
        // the white ground of the gaiji (4,4) and the diagram (44,4) shows the page
        expect(await sampleScreenshotPixel(wrapper, 4, 4)).toEqual([68, 68, 68]);
        expect(await sampleScreenshotPixel(wrapper, 44, 4)).toEqual([68, 68, 68]);
        // their black ink (20,20) and (60,20) takes the text color
        expect(await sampleScreenshotPixel(wrapper, 20, 20)).toEqual([198, 198, 198]);
        expect(await sampleScreenshotPixel(wrapper, 60, 20)).toEqual([198, 198, 198]);
      }

      await applyTheme({ ...grayDarkTheme, fg: '#ffd595' });
      expect(await sampleScreenshotPixel(wrapper, 4, 4)).toEqual([68, 68, 68]);
      expect(await sampleScreenshotPixel(wrapper, 20, 20)).toEqual([255, 213, 149]);
      expect(await sampleScreenshotPixel(wrapper, 60, 20)).toEqual([255, 213, 149]);
    } finally {
      wrapper.remove();
    }
  });
});
