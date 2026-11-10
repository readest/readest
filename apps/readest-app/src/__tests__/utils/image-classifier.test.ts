// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearDiagramClassificationCache,
  evaluatePixelDistribution,
  getDiagramClassificationCache,
  isDistributionInvertible,
  classifyAndTagStandaloneDiagrams,
} from '@/utils/imageClassifier';
import { getStyles, type ThemeCode } from '@/utils/style';
import type { Palette } from '@/styles/themes';
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

const makeViewSettings = (overrides: Partial<ViewSettings> = {}): ViewSettings =>
  ({
    ...DEFAULT_BOOK_STYLE,
    ...DEFAULT_BOOK_FONT,
    ...DEFAULT_BOOK_LAYOUT,
    ...DEFAULT_BOOK_LANGUAGE,
    ...DEFAULT_VIEW_CONFIG,
    ...DEFAULT_TTS_CONFIG,
    ...DEFAULT_TRANSLATOR_CONFIG,
    ...DEFAULT_ANNOTATOR_CONFIG,
    ...DEFAULT_SCREEN_CONFIG,
    ...overrides,
  }) as ViewSettings;

const darkTheme: ThemeCode = {
  bg: '#121212',
  fg: '#e0e0e0',
  primary: '#0066cc',
  isDarkMode: true,
  palette: {} as Palette,
};

const lightTheme: ThemeCode = {
  bg: '#ffffff',
  fg: '#121212',
  primary: '#0066cc',
  isDarkMode: false,
  palette: {} as Palette,
};

describe('imageClassifier', () => {
  beforeEach(() => {
    clearDiagramClassificationCache();
  });

  describe('evaluatePixelDistribution & isDistributionInvertible', () => {
    const TOTAL = 128 * 128; // 16,384

    const createBuffer = (generator: (index: number) => [number, number, number, number]) => {
      const buf = new Uint8ClampedArray(TOTAL * 4);
      for (let i = 0; i < TOTAL; i++) {
        const [r, g, b, a] = generator(i);
        buf[i * 4] = r;
        buf[i * 4 + 1] = g;
        buf[i * 4 + 2] = b;
        buf[i * 4 + 3] = a;
      }
      return buf;
    };

    it('identifies pure monochrome line-art diagrams as invertible', () => {
      // 90% white (255), 7% black lines (0), 3% anti-aliasing gray (128)
      const data = createBuffer((i) => {
        if (i < TOTAL * 0.9) return [255, 255, 255, 255];
        if (i < TOTAL * 0.97) return [0, 0, 0, 255];
        return [128, 128, 128, 255];
      });
      const dist = evaluatePixelDistribution(data);
      expect(dist.chroma).toBe(0);
      expect(dist.whiteRatio).toBeCloseTo(0.9, 2);
      expect(dist.midtoneRatio).toBeCloseTo(0.03, 2);
      expect(isDistributionInvertible(dist)).toBe(true);
    });

    it('identifies high-white text headings with JPEG noise (Tier 2) as invertible', () => {
      // 83% white, 13% midtones (JPEG mosquito noise), 4% black
      const data = createBuffer((i) => {
        if (i < TOTAL * 0.83) return [255, 255, 255, 255];
        if (i < TOTAL * 0.96) return [120, 120, 120, 255]; // midtone
        return [10, 10, 10, 255];
      });
      const dist = evaluatePixelDistribution(data);
      expect(dist.whiteRatio).toBeCloseTo(0.83, 2);
      expect(dist.midtoneRatio).toBeCloseTo(0.13, 2);
      expect(isDistributionInvertible(dist)).toBe(true);
    });

    it('rejects continuous-tone photographs with high midtones', () => {
      // 50% white, 45% midtones, 5% dark
      const data = createBuffer((i) => {
        if (i < TOTAL * 0.5) return [255, 255, 255, 255];
        if (i < TOTAL * 0.95) return [128, 128, 128, 255];
        return [20, 20, 20, 255];
      });
      const dist = evaluatePixelDistribution(data);
      expect(dist.whiteRatio).toBeCloseTo(0.5, 2);
      expect(dist.midtoneRatio).toBeCloseTo(0.45, 2);
      expect(isDistributionInvertible(dist)).toBe(false);
    });

    it('rejects color images due to high chroma', () => {
      // 85% white, 15% red lines
      const data = createBuffer((i) => {
        if (i < TOTAL * 0.85) return [255, 255, 255, 255];
        return [240, 20, 20, 255]; // red
      });
      const dist = evaluatePixelDistribution(data);
      expect(dist.chroma).toBeGreaterThan(10.0);
      expect(isDistributionInvertible(dist)).toBe(false);
    });

    it('rejects already-dark background diagrams from double-inverting', () => {
      // 85% black (0), 10% white lines (255), 5% gray
      const data = createBuffer((i) => {
        if (i < TOTAL * 0.85) return [0, 0, 0, 255];
        if (i < TOTAL * 0.95) return [255, 255, 255, 255];
        return [128, 128, 128, 255];
      });
      const dist = evaluatePixelDistribution(data);
      expect(dist.darkRatio).toBeCloseTo(0.85, 2);
      expect(isDistributionInvertible(dist)).toBe(false);
    });
  });

  describe('classifyAndTagStandaloneDiagrams DOM filtering', () => {
    it('skips processing in light mode', () => {
      document.body.innerHTML = '<div><img src="diag.png" /></div>';
      classifyAndTagStandaloneDiagrams(document, false, false);
      const img = document.querySelector('img')!;
      expect(img.classList.contains('monochrome-diagram')).toBe(false);
    });

    it('skips processing in fixed-layout / manga books', () => {
      document.body.innerHTML = '<div><img src="manga.png" /></div>';
      classifyAndTagStandaloneDiagrams(document, true, true);
      const img = document.querySelector('img')!;
      expect(img.classList.contains('monochrome-diagram')).toBe(false);
    });

    it('skips inline images with text siblings or gaiji classes', () => {
      document.body.innerHTML = `
        <p>Text sibling <img class="has-text-siblings" src="glyph.png" /></p>
        <p><img class="gaiji-wide" src="gaiji.png" /></p>
      `;
      classifyAndTagStandaloneDiagrams(document, true, false);
      const imgs = document.querySelectorAll('img');
      expect(imgs[0]?.classList.contains('monochrome-diagram')).toBe(false);
      expect(imgs[1]?.classList.contains('monochrome-diagram')).toBe(false);
    });

    it('skips cover images', () => {
      document.body.innerHTML = `
        <div><img class="cover" src="cover.jpg" /></div>
        <div epub:type="cover"><img src="cover2.jpg" /></div>
      `;
      classifyAndTagStandaloneDiagrams(document, true, false);
      const imgs = document.querySelectorAll('img');
      expect(imgs[0]?.classList.contains('monochrome-diagram')).toBe(false);
      expect(imgs[1]?.classList.contains('monochrome-diagram')).toBe(false);
    });

    it('uses memory cache for instant resolution', () => {
      const cache = getDiagramClassificationCache();
      cache.set('https://example.com/cached-diag.png', true);
      cache.set('https://example.com/cached-photo.jpg', false);

      document.body.innerHTML = `
        <p><img src="https://example.com/cached-diag.png" /></p>
        <p><img src="https://example.com/cached-photo.jpg" /></p>
      `;

      classifyAndTagStandaloneDiagrams(document, true, false);

      const imgs = document.querySelectorAll('img');
      expect(imgs[0]?.classList.contains('monochrome-diagram')).toBe(true);
      expect(imgs[1]?.classList.contains('monochrome-diagram')).toBe(false);
    });

    it('cleans up event listeners and pending attribute on image error', async () => {
      document.body.innerHTML = `
        <p><img id="pending-img" src="https://example.com/pending-diag.png" /></p>
      `;
      classifyAndTagStandaloneDiagrams(document, true, false);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const img = document.getElementById('pending-img') as HTMLImageElement;
      expect(img.getAttribute('data-diagram-pending')).toBe('true');

      img.dispatchEvent(new Event('error'));
      expect(img.hasAttribute('data-diagram-pending')).toBe(false);
      expect(getDiagramClassificationCache().get('https://example.com/pending-diag.png')).toBe(
        false,
      );
    });
  });

  describe('CSS styling for monochrome diagrams in dark mode', () => {
    it('applies invert and screen blending to img.monochrome-diagram in dark mode', () => {
      const css = getStyles(makeViewSettings(), darkTheme);
      expect(css).toMatch(
        /img\.monochrome-diagram\s*\{[^}]*filter:\s*invert\(1\)\s*hue-rotate\(180deg\);/,
      );
      expect(css).toMatch(/img\.monochrome-diagram\s*\{[^}]*mix-blend-mode:\s*screen;/);
    });

    it('does not apply invert filter to img.monochrome-diagram in light mode', () => {
      const css = getStyles(makeViewSettings(), lightTheme);
      expect(css).not.toMatch(
        /img\.monochrome-diagram\s*\{[^}]*filter:\s*invert\(1\)\s*hue-rotate\(180deg\);/,
      );
    });
  });
});
