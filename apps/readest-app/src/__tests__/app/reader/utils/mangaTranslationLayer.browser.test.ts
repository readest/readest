import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TranslatedMangaPage } from '@/app/reader/services/manga/mangaTranslationEngine';
import { mountMangaTranslationLayer } from '@/app/reader/utils/mangaTranslationLayer';

describe('mangaTranslationLayer browser layout', () => {
  let iframe: HTMLIFrameElement;

  beforeEach(() => {
    iframe = document.createElement('iframe');
    Object.assign(iframe.style, {
      border: '0',
      height: '600px',
      position: 'absolute',
      width: '400px',
    });
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    const style = doc.createElement('style');
    style.textContent = `
      html, body { height: 600px; margin: 0; width: 400px; }
      body { position: relative; }
    `;
    doc.head.append(style);
  });

  afterEach(() => iframe.remove());

  it('keeps unreadable English hidden without intercepting gestures', async () => {
    const doc = iframe.contentDocument!;
    const win = iframe.contentWindow!;
    const page: TranslatedMangaPage = {
      pageIndex: 0,
      width: 400,
      height: 600,
      regions: [
        {
          id: 'small-bubble',
          sourceText: '長い文章',
          translatedText:
            'This translated sentence must remain fully inside its speech bubble. '.repeat(12),
          textBox: { xMin: 175, yMin: 215, xMax: 225, yMax: 245 },
          bubbleBox: { xMin: 160, yMin: 200, xMax: 240, yMax: 260 },
          maskBoxes: [{ xMin: 175, yMin: 215, xMax: 225, yMax: 245 }],
          backgroundColor: 'rgb(255 255 255)',
        },
      ],
    };

    const layer = mountMangaTranslationLayer(doc, page)!;
    await doc.fonts.ready;
    await new Promise<void>((resolve) => {
      win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve()));
    });

    const bubble = layer.querySelector<HTMLElement>('[data-readest-manga-region-id]')!;
    const text = bubble.querySelector<HTMLElement>('[data-readest-manga-text]')!;
    const bubbleRect = bubble.getBoundingClientRect();
    const mask = layer.querySelector<HTMLElement>('[data-readest-manga-mask]')!;

    expect(bubbleRect.width).toBeGreaterThan(0);
    expect(bubbleRect.height).toBeGreaterThan(0);
    expect(bubble.style.visibility).toBe('hidden');
    expect(mask.style.visibility).toBe('hidden');
    expect(text.style.fontSize).toBe('6px');
    expect(text.style.transform).toBe('none');
    expect(bubble.style.overflow).toBe('hidden');
    expect(win.getComputedStyle(layer).pointerEvents).toBe('none');
    expect(win.getComputedStyle(bubble).pointerEvents).toBe('none');
    for (const element of [layer, ...layer.querySelectorAll<HTMLElement>('*')]) {
      expect(win.getComputedStyle(element).pointerEvents).toBe('none');
    }
    expect(win.getComputedStyle(bubble).userSelect).toBe('none');
    expect(layer.getAttribute('aria-hidden')).toBe('true');
  });
});
