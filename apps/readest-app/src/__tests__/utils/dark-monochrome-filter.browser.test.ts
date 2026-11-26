import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { DARK_MONOCHROME_FILTER, mountDarkMonochromeFilter } from '@/utils/imageBackground';
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
  source.width = 7;
  source.height = 1;
  const ctx = source.getContext('2d')!;
  const colors = [
    [255, 255, 255, 255], // white -> transparent
    [245, 245, 245, 255], // near-white -> transparent
    [0, 0, 0, 255], // black ink -> fgColor
    [128, 128, 128, 255], // anti-aliased gray
    [255, 0, 0, 255], // chromatic red accent
    [0, 0, 0, 0], // already transparent
    [0, 0, 0, 128], // semi-transparent black ink
  ];
  ctx.putImageData(new ImageData(new Uint8ClampedArray(colors.flat()), 7, 1), 0, 0);
  const image = new Image();
  image.src = source.toDataURL();
  await image.decode();

  const output = document.createElement('canvas');
  output.width = 7;
  output.height = 1;
  const result = output.getContext('2d')!;
  mountDarkMonochromeFilter(document, fgColor);
  result.filter = DARK_MONOCHROME_FILTER;
  result.drawImage(image, 0, 0);
  return [...result.getImageData(0, 0, 7, 1).data];
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
  it('turns white transparent, maps black to fg, and keeps transparent pixels clear', async () => {
    const pixels = await renderPixels('#c6c6c6');
    expect(pixels[3]).toBe(0); // #ffffff -> transparent
    expect(pixels[7]).toBe(0); // #f5f5f5 -> transparent
    expect(pixels.slice(8, 12)).toEqual([198, 198, 198, 255]); // #000000 -> #c6c6c6
    expect(pixels[15]).toBeGreaterThan(0); // #808080 -> partial alpha
    expect(pixels[15]).toBeLessThan(255);
    expect(pixels[16]).toBeGreaterThan(pixels[17]!); // red accent stays reddish
    expect(pixels.slice(20, 24)).toEqual([0, 0, 0, 0]); // transparent stays transparent
    expect(pixels[27]).toBe(128); // semi-transparent black keeps alpha
  });

  it('blends white-background gaiji and monochrome-diagram over Gray Dark iframe without black boxes', async () => {
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
      style.textContent = `${getStyles({ ...baseSettings, transparentImageBackground: true }, grayDarkTheme)}
        html, body { margin: 0 !important; padding: 0 !important; background: transparent !important; }`;
      doc.head.appendChild(style);
      mountDarkMonochromeFilter(doc, grayDarkTheme.fg);
      await Promise.all(Array.from(doc.querySelectorAll('img')).map((i) => i.decode()));
      await new Promise((resolve) => setTimeout(resolve, 150));

      // White background of gaiji (x=4, y=4) and diagram (x=44, y=4) must show Gray Dark #444444 (68,68,68)
      expect(await sampleScreenshotPixel(wrapper, 4, 4)).toEqual([68, 68, 68]);
      expect(await sampleScreenshotPixel(wrapper, 44, 4)).toEqual([68, 68, 68]);
      // Black ink center of gaiji (x=20, y=20) and diagram (x=60, y=20) must show #c6c6c6 (198,198,198)
      expect(await sampleScreenshotPixel(wrapper, 20, 20)).toEqual([198, 198, 198]);
      expect(await sampleScreenshotPixel(wrapper, 60, 20)).toEqual([198, 198, 198]);

      // Switching fgColor to Sepia Dark (#ffd595) updates ink color without black box
      mountDarkMonochromeFilter(doc, '#ffd595');
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await sampleScreenshotPixel(wrapper, 4, 4)).toEqual([68, 68, 68]);
      expect(await sampleScreenshotPixel(wrapper, 20, 20)).toEqual([255, 213, 149]);
    } finally {
      wrapper.remove();
    }
  });
});
