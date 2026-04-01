import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/utils/misc', () => ({ isCJKEnv: vi.fn(() => false) }));
vi.mock('@/utils/path', () => ({
  getFilename: vi.fn((path: string) => path.split('/').pop() || path),
}));
vi.mock('@/utils/md5', () => ({
  md5Fingerprint: vi.fn((name: string) => `md5_${name}`),
}));

import { isCJKEnv } from '@/utils/misc';
import {
  getFontName,
  getFontId,
  getFontFormat,
  getMimeType,
  getCSSFormatString,
  createFontFamily,
  createFontCSS,
  createCustomFont,
  mountAdditionalFonts,
  mountCustomFont,
  type FontFormat,
  type CustomFont,
} from '@/styles/fonts';

describe('getFontName', () => {
  it('should strip .ttf extension', () => {
    expect(getFontName('/fonts/Roboto.ttf')).toBe('Roboto');
  });

  it('should strip .otf extension', () => {
    expect(getFontName('/fonts/Roboto.otf')).toBe('Roboto');
  });

  it('should strip .woff extension', () => {
    expect(getFontName('/fonts/Roboto.woff')).toBe('Roboto');
  });

  it('should strip .woff2 extension', () => {
    expect(getFontName('/fonts/Roboto.woff2')).toBe('Roboto');
  });

  it('should be case-insensitive for extensions', () => {
    expect(getFontName('/fonts/Roboto.TTF')).toBe('Roboto');
    expect(getFontName('/fonts/Roboto.OTF')).toBe('Roboto');
    expect(getFontName('/fonts/Roboto.WOFF2')).toBe('Roboto');
  });

  it('should preserve name with dots that are not font extensions', () => {
    expect(getFontName('/fonts/My.Custom.Font.ttf')).toBe('My.Custom.Font');
  });

  it('should return filename as-is when no font extension matches', () => {
    expect(getFontName('/fonts/Roboto.txt')).toBe('Roboto.txt');
  });

  it('should handle path with no directory separators', () => {
    expect(getFontName('Roboto.ttf')).toBe('Roboto');
  });

  it('should handle deeply nested paths', () => {
    expect(getFontName('/a/b/c/d/Font.woff2')).toBe('Font');
  });
});

describe('getFontId', () => {
  it('should return md5 fingerprint of the name', () => {
    expect(getFontId('Roboto')).toBe('md5_Roboto');
  });

  it('should return different ids for different names', () => {
    expect(getFontId('Roboto')).not.toBe(getFontId('Arial'));
  });
});

describe('getFontFormat', () => {
  it('should return ttf for .ttf files', () => {
    expect(getFontFormat('font.ttf')).toBe('ttf');
  });

  it('should return otf for .otf files', () => {
    expect(getFontFormat('font.otf')).toBe('otf');
  });

  it('should return woff for .woff files', () => {
    expect(getFontFormat('font.woff')).toBe('woff');
  });

  it('should return woff2 for .woff2 files', () => {
    expect(getFontFormat('font.woff2')).toBe('woff2');
  });

  it('should be case-insensitive', () => {
    expect(getFontFormat('font.TTF')).toBe('ttf');
    expect(getFontFormat('font.OTF')).toBe('otf');
    expect(getFontFormat('font.WOFF')).toBe('woff');
    expect(getFontFormat('font.WOFF2')).toBe('woff2');
  });

  it('should default to ttf for unknown extensions', () => {
    expect(getFontFormat('font.abc')).toBe('ttf');
  });

  it('should default to ttf for paths without extension', () => {
    expect(getFontFormat('font')).toBe('ttf');
  });

  it('should handle full paths', () => {
    expect(getFontFormat('/home/user/fonts/Roboto.woff2')).toBe('woff2');
  });
});

describe('getMimeType', () => {
  it('should return font/ttf for ttf', () => {
    expect(getMimeType('ttf')).toBe('font/ttf');
  });

  it('should return font/otf for otf', () => {
    expect(getMimeType('otf')).toBe('font/otf');
  });

  it('should return font/woff for woff', () => {
    expect(getMimeType('woff')).toBe('font/woff');
  });

  it('should return font/woff2 for woff2', () => {
    expect(getMimeType('woff2')).toBe('font/woff2');
  });

  it('should return correct types for all known formats', () => {
    const formats: FontFormat[] = ['ttf', 'otf', 'woff', 'woff2'];
    for (const format of formats) {
      expect(getMimeType(format)).toMatch(/^font\//);
    }
  });
});

describe('getCSSFormatString', () => {
  it('should return truetype for ttf', () => {
    expect(getCSSFormatString('ttf')).toBe('truetype');
  });

  it('should return opentype for otf', () => {
    expect(getCSSFormatString('otf')).toBe('opentype');
  });

  it('should return woff for woff', () => {
    expect(getCSSFormatString('woff')).toBe('woff');
  });

  it('should return woff2 for woff2', () => {
    expect(getCSSFormatString('woff2')).toBe('woff2');
  });
});

describe('createFontFamily', () => {
  it('should trim leading and trailing whitespace', () => {
    expect(createFontFamily('  Roboto  ')).toBe('Roboto');
  });

  it('should collapse multiple internal spaces', () => {
    expect(createFontFamily('Open   Sans')).toBe('Open Sans');
  });

  it('should collapse tabs and mixed whitespace', () => {
    expect(createFontFamily('Open\t\tSans')).toBe('Open Sans');
  });

  it('should return single-word names unchanged', () => {
    expect(createFontFamily('Roboto')).toBe('Roboto');
  });

  it('should handle empty string', () => {
    expect(createFontFamily('')).toBe('');
  });

  it('should handle whitespace-only string', () => {
    expect(createFontFamily('   ')).toBe('');
  });
});

describe('createFontCSS', () => {
  const baseFont: CustomFont = {
    id: 'test-id',
    name: 'TestFont',
    path: '/fonts/TestFont.ttf',
    blobUrl: 'blob:http://localhost/abc123',
  };

  it('should generate valid @font-face CSS', () => {
    const css = createFontCSS(baseFont);
    expect(css).toContain('@font-face');
    expect(css).toContain('font-family: "TestFont"');
    expect(css).toContain('format("truetype")');
    expect(css).toContain('blob:http://localhost/abc123');
    expect(css).toContain('font-display: swap');
  });

  it('should use family field over name when present', () => {
    const font: CustomFont = { ...baseFont, family: 'Custom Family' };
    const css = createFontCSS(font);
    expect(css).toContain('font-family: "Custom Family"');
  });

  it('should include font-style and font-weight for non-variable fonts', () => {
    const font: CustomFont = { ...baseFont, style: 'italic', weight: 700 };
    const css = createFontCSS(font);
    expect(css).toContain('font-style: italic');
    expect(css).toContain('font-weight: 700');
  });

  it('should default to normal style and 400 weight', () => {
    const css = createFontCSS(baseFont);
    expect(css).toContain('font-style: normal');
    expect(css).toContain('font-weight: 400');
  });

  it('should omit font-style and font-weight for variable fonts', () => {
    const font: CustomFont = {
      ...baseFont,
      variable: true,
      style: 'italic',
      weight: 700,
    };
    const css = createFontCSS(font);
    expect(css).not.toContain('font-style:');
    expect(css).not.toContain('font-weight:');
  });

  it('should throw when blobUrl is missing', () => {
    const font: CustomFont = { ...baseFont, blobUrl: undefined };
    expect(() => createFontCSS(font)).toThrow('Blob URL not available for font: TestFont');
  });

  it('should use correct format string for otf files', () => {
    const font: CustomFont = { ...baseFont, path: '/fonts/TestFont.otf' };
    const css = createFontCSS(font);
    expect(css).toContain('format("opentype")');
  });

  it('should use correct format string for woff files', () => {
    const font: CustomFont = { ...baseFont, path: '/fonts/TestFont.woff' };
    const css = createFontCSS(font);
    expect(css).toContain('format("woff")');
  });

  it('should use correct format string for woff2 files', () => {
    const font: CustomFont = { ...baseFont, path: '/fonts/TestFont.woff2' };
    const css = createFontCSS(font);
    expect(css).toContain('format("woff2")');
  });

  it('should normalize family name with extra spaces', () => {
    const font: CustomFont = { ...baseFont, family: '  Open   Sans  ' };
    const css = createFontCSS(font);
    expect(css).toContain('font-family: "Open Sans"');
  });
});

describe('createCustomFont', () => {
  it('should create font with default name from path', () => {
    const font = createCustomFont('/fonts/Roboto.ttf');
    expect(font.name).toBe('Roboto');
    expect(font.path).toBe('/fonts/Roboto.ttf');
    expect(font.id).toBe('md5_Roboto');
  });

  it('should use custom name when provided', () => {
    const font = createCustomFont('/fonts/Roboto.ttf', { name: 'My Font' });
    expect(font.name).toBe('My Font');
    expect(font.id).toBe('md5_My Font');
  });

  it('should include optional fields from options', () => {
    const font = createCustomFont('/fonts/Roboto.ttf', {
      family: 'Roboto Family',
      style: 'italic',
      weight: 700,
      variable: true,
    });
    expect(font.family).toBe('Roboto Family');
    expect(font.style).toBe('italic');
    expect(font.weight).toBe(700);
    expect(font.variable).toBe(true);
  });

  it('should leave optional fields undefined when not provided', () => {
    const font = createCustomFont('/fonts/Roboto.ttf');
    expect(font.family).toBeUndefined();
    expect(font.style).toBeUndefined();
    expect(font.weight).toBeUndefined();
    expect(font.variable).toBeUndefined();
  });

  it('should handle woff2 path', () => {
    const font = createCustomFont('/fonts/OpenSans.woff2');
    expect(font.name).toBe('OpenSans');
    expect(font.path).toBe('/fonts/OpenSans.woff2');
  });
});

describe('mountAdditionalFonts', () => {
  beforeEach(() => {
    // Reset document head between tests
    document.head.innerHTML = '';
    vi.mocked(isCJKEnv).mockReturnValue(false);
  });

  it('should mount basic Google Fonts link tags', async () => {
    await mountAdditionalFonts(document);

    const links = document.head.querySelectorAll('link[rel="stylesheet"]');
    expect(links.length).toBeGreaterThanOrEqual(1);

    // Verify at least one link points to Google Fonts
    const hrefs = Array.from(links).map((l) => l.getAttribute('href') || '');
    expect(hrefs.some((h) => h.includes('fonts.googleapis.com'))).toBe(true);
  });

  it('should set crossOrigin on link tags', async () => {
    await mountAdditionalFonts(document);

    const links = document.head.querySelectorAll('link');
    for (const link of Array.from(links)) {
      expect(link.crossOrigin).toBe('anonymous');
    }
  });

  it('should not mount CJK fonts when isCJK is false', async () => {
    await mountAdditionalFonts(document, false);

    const styles = document.head.querySelectorAll('style');
    expect(styles.length).toBe(0);

    const links = document.head.querySelectorAll('link');
    const hrefs = Array.from(links).map((l) => l.getAttribute('href') || '');
    expect(hrefs.some((h) => h.includes('jsdelivr.net'))).toBe(false);
  });

  it('should mount CJK fonts when isCJK is true', async () => {
    await mountAdditionalFonts(document, true);

    // Should have a style element with @font-face rules
    const styles = document.head.querySelectorAll('style');
    expect(styles.length).toBeGreaterThanOrEqual(1);

    const styleContent = styles[0]!.textContent || '';
    expect(styleContent).toContain('@font-face');
    expect(styleContent).toContain('FangSong');
    expect(styleContent).toContain('Kaiti');
    expect(styleContent).toContain('Heiti');
    expect(styleContent).toContain('XiHeiti');

    // Should have CJK-specific link tags
    const links = document.head.querySelectorAll('link');
    const hrefs = Array.from(links).map((l) => l.getAttribute('href') || '');
    expect(hrefs.some((h) => h.includes('jsdelivr.net'))).toBe(true);
  });

  it('should mount CJK fonts when isCJKEnv returns true', async () => {
    vi.mocked(isCJKEnv).mockReturnValue(true);

    await mountAdditionalFonts(document);

    const styles = document.head.querySelectorAll('style');
    expect(styles.length).toBeGreaterThanOrEqual(1);

    const styleContent = styles[0]!.textContent || '';
    expect(styleContent).toContain('@font-face');
  });

  it('should mount CJK fonts when either isCJK param or isCJKEnv is true', async () => {
    vi.mocked(isCJKEnv).mockReturnValue(false);
    await mountAdditionalFonts(document, true);

    const styles = document.head.querySelectorAll('style');
    expect(styles.length).toBeGreaterThanOrEqual(1);
  });
});

describe('mountCustomFont', () => {
  const baseFont: CustomFont = {
    id: 'test-font-id',
    name: 'TestFont',
    path: '/fonts/TestFont.ttf',
    blobUrl: 'blob:http://localhost/abc123',
  };

  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('should create a style element with the correct id', () => {
    mountCustomFont(document, baseFont);

    const style = document.getElementById('custom-font-test-font-id');
    expect(style).not.toBeNull();
    expect(style!.tagName).toBe('STYLE');
  });

  it('should set textContent to the generated CSS', () => {
    mountCustomFont(document, baseFont);

    const style = document.getElementById('custom-font-test-font-id');
    expect(style!.textContent).toContain('@font-face');
    expect(style!.textContent).toContain('font-family: "TestFont"');
    expect(style!.textContent).toContain('blob:http://localhost/abc123');
  });

  it('should append the style element to document head', () => {
    mountCustomFont(document, baseFont);

    expect(document.head.children.length).toBe(1);
    expect(document.head.children[0]!.id).toBe('custom-font-test-font-id');
  });

  it('should update existing style element instead of creating a duplicate', () => {
    mountCustomFont(document, baseFont);
    expect(document.head.querySelectorAll('style').length).toBe(1);

    const updatedFont: CustomFont = {
      ...baseFont,
      blobUrl: 'blob:http://localhost/updated',
    };
    mountCustomFont(document, updatedFont);

    // Still only one style element
    expect(document.head.querySelectorAll('style').length).toBe(1);

    const style = document.getElementById('custom-font-test-font-id');
    expect(style!.textContent).toContain('blob:http://localhost/updated');
  });

  it('should handle multiple different fonts', () => {
    const font2: CustomFont = {
      id: 'other-font-id',
      name: 'OtherFont',
      path: '/fonts/OtherFont.otf',
      blobUrl: 'blob:http://localhost/other',
    };

    mountCustomFont(document, baseFont);
    mountCustomFont(document, font2);

    expect(document.head.querySelectorAll('style').length).toBe(2);
    expect(document.getElementById('custom-font-test-font-id')).not.toBeNull();
    expect(document.getElementById('custom-font-other-font-id')).not.toBeNull();
  });

  it('should throw when font has no blobUrl', () => {
    const fontNoBlobUrl: CustomFont = { ...baseFont, blobUrl: undefined };
    expect(() => mountCustomFont(document, fontNoBlobUrl)).toThrow(
      'Blob URL not available for font: TestFont',
    );
  });
});
