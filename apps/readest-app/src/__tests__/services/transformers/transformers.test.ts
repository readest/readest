import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ViewSettings } from '@/types/book';
import type { TransformContext } from '@/services/transformers/types';

// --- Mocks ---

vi.mock('@/utils/style', () => ({
  transformStylesheet: vi.fn(
    (_css: string, _vw: number, _vh: number, _vertical: boolean) => 'transformed-css',
  ),
}));

vi.mock('@/utils/simplecc', () => ({
  initSimpleCC: vi.fn(),
  runSimpleCC: vi.fn((text: string, _variant: string) => text),
}));

vi.mock('@/utils/lang', () => ({
  detectLanguage: vi.fn(() => 'en'),
  getLanguageInfo: vi.fn(() => ({ direction: 'ltr' })),
  isSameLang: vi.fn(() => true),
  isValidLang: vi.fn(() => true),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: vi.fn(() => ({ settings: { globalViewSettings: {} } })),
  },
}));

vi.mock('foliate-js/epubcfi.js', () => ({
  parse: vi.fn(),
  toRange: vi.fn(),
}));

// --- Helpers ---

function makeCtx(overrides: Partial<TransformContext> = {}): TransformContext {
  return {
    bookKey: 'test-book',
    viewSettings: {} as ViewSettings,
    userLocale: 'en',
    isFixedLayout: false,
    content: '',
    transformers: [],
    ...overrides,
  };
}

// Suppress console noise
const consoleSpy = {
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
};
void consoleSpy;

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// footnoteTransformer
// =============================================================================

describe('footnoteTransformer', () => {
  let footnoteTransformer: typeof import('@/services/transformers/footnote').footnoteTransformer;

  beforeEach(async () => {
    ({ footnoteTransformer } = await import('@/services/transformers/footnote'));
  });

  test('has the correct name', () => {
    expect(footnoteTransformer.name).toBe('footnote');
  });

  test('adds epubtype-footnote class to aside with epub:type="footnote"', async () => {
    const html = '<aside epub:type="footnote" id="fn1">Some note</aside>';
    const result = await footnoteTransformer.transform(makeCtx({ content: html }));
    expect(result).toContain('class="epubtype-footnote"');
    expect(result).toContain('epub:type="footnote"');
    expect(result).toContain('id="fn1"');
  });

  test('adds epubtype-footnote class to aside with epub:type="endnote"', async () => {
    const html = '<aside epub:type="endnote">End note</aside>';
    const result = await footnoteTransformer.transform(makeCtx({ content: html }));
    expect(result).toContain('class="epubtype-footnote"');
    expect(result).toContain('epub:type="endnote"');
  });

  test('adds epubtype-footnote class to aside with epub:type="note"', async () => {
    const html = '<aside epub:type="note">A note</aside>';
    const result = await footnoteTransformer.transform(makeCtx({ content: html }));
    expect(result).toContain('class="epubtype-footnote"');
  });

  test('adds epubtype-footnote class to aside with epub:type="rearnote"', async () => {
    const html = '<aside epub:type="rearnote">Rear note</aside>';
    const result = await footnoteTransformer.transform(makeCtx({ content: html }));
    expect(result).toContain('class="epubtype-footnote"');
    expect(result).toContain('epub:type="rearnote"');
  });

  test('handles multiple aside elements in one document', async () => {
    const html =
      '<aside epub:type="footnote" id="fn1">Note 1</aside>' +
      '<p>Text</p>' +
      '<aside epub:type="endnote" id="en1">Note 2</aside>';
    const result = await footnoteTransformer.transform(makeCtx({ content: html }));
    const matches = result.match(/class="epubtype-footnote"/g);
    expect(matches).toHaveLength(2);
  });

  test('does not modify aside without epub:type', async () => {
    const html = '<aside id="fn1">Normal aside</aside>';
    const result = await footnoteTransformer.transform(makeCtx({ content: html }));
    expect(result).toBe(html);
  });

  test('does not modify aside with non-matching epub:type', async () => {
    const html = '<aside epub:type="annotation">Not a footnote</aside>';
    const result = await footnoteTransformer.transform(makeCtx({ content: html }));
    expect(result).toBe(html);
  });

  test('is case-insensitive for the tag match', async () => {
    const html = '<ASIDE epub:type="footnote" id="fn1">Upper case</ASIDE>';
    const result = await footnoteTransformer.transform(makeCtx({ content: html }));
    expect(result).toContain('class="epubtype-footnote"');
  });

  test('handles single-quoted epub:type values', async () => {
    const html = "<aside epub:type='footnote' id='fn1'>Single quotes</aside>";
    const result = await footnoteTransformer.transform(makeCtx({ content: html }));
    expect(result).toContain('class="epubtype-footnote"');
  });

  test('returns empty string content unchanged', async () => {
    const result = await footnoteTransformer.transform(makeCtx({ content: '' }));
    expect(result).toBe('');
  });

  test('preserves content without aside elements', async () => {
    const html = '<p>Hello <strong>world</strong></p>';
    const result = await footnoteTransformer.transform(makeCtx({ content: html }));
    expect(result).toBe(html);
  });
});

// =============================================================================
// whitespaceTransformer
// =============================================================================

describe('whitespaceTransformer', () => {
  let whitespaceTransformer: typeof import('@/services/transformers/whitespace').whitespaceTransformer;

  beforeEach(async () => {
    ({ whitespaceTransformer } = await import('@/services/transformers/whitespace'));
  });

  test('has the correct name', () => {
    expect(whitespaceTransformer.name).toBe('whitespace');
  });

  describe('when overrideLayout is true', () => {
    const settings = { overrideLayout: true } as ViewSettings;

    test('replaces &nbsp; with a normal space', async () => {
      const html = 'hello&nbsp;world';
      const result = await whitespaceTransformer.transform(
        makeCtx({ content: html, viewSettings: settings }),
      );
      expect(result).toBe('hello world');
    });

    test('replaces multiple &nbsp; entities', async () => {
      const html = 'a&nbsp;b&nbsp;c';
      const result = await whitespaceTransformer.transform(
        makeCtx({ content: html, viewSettings: settings }),
      );
      expect(result).toBe('a b c');
    });

    test('does not replace &amp;nbsp; (escaped ampersand)', async () => {
      const html = 'hello&amp;nbsp;world';
      const result = await whitespaceTransformer.transform(
        makeCtx({ content: html, viewSettings: settings }),
      );
      expect(result).toBe('hello&amp;nbsp;world');
    });

    test('replaces U+00A0 non-breaking space with normal space', async () => {
      const html = 'hello\u00A0world';
      const result = await whitespaceTransformer.transform(
        makeCtx({ content: html, viewSettings: settings }),
      );
      expect(result).toBe('hello world');
    });

    test('collapses multiple consecutive spaces into one', async () => {
      const html = 'hello   world';
      const result = await whitespaceTransformer.transform(
        makeCtx({ content: html, viewSettings: settings }),
      );
      expect(result).toBe('hello world');
    });

    test('handles combined &nbsp; replacement and space collapsing', async () => {
      const html = 'hello&nbsp; &nbsp;world';
      const result = await whitespaceTransformer.transform(
        makeCtx({ content: html, viewSettings: settings }),
      );
      expect(result).toBe('hello world');
    });

    test('handles U+00A0 followed by regular spaces', async () => {
      const html = 'hello\u00A0  world';
      const result = await whitespaceTransformer.transform(
        makeCtx({ content: html, viewSettings: settings }),
      );
      expect(result).toBe('hello world');
    });

    test('preserves single spaces', async () => {
      const html = 'hello world';
      const result = await whitespaceTransformer.transform(
        makeCtx({ content: html, viewSettings: settings }),
      );
      expect(result).toBe('hello world');
    });

    test('returns empty string unchanged', async () => {
      const result = await whitespaceTransformer.transform(
        makeCtx({ content: '', viewSettings: settings }),
      );
      expect(result).toBe('');
    });
  });

  describe('when overrideLayout is false', () => {
    const settings = { overrideLayout: false } as ViewSettings;

    test('returns content unchanged with &nbsp;', async () => {
      const html = 'hello&nbsp;world';
      const result = await whitespaceTransformer.transform(
        makeCtx({ content: html, viewSettings: settings }),
      );
      expect(result).toBe('hello&nbsp;world');
    });

    test('returns content unchanged with U+00A0', async () => {
      const html = 'hello\u00A0world';
      const result = await whitespaceTransformer.transform(
        makeCtx({ content: html, viewSettings: settings }),
      );
      expect(result).toBe('hello\u00A0world');
    });

    test('returns content unchanged with multiple spaces', async () => {
      const html = 'hello   world';
      const result = await whitespaceTransformer.transform(
        makeCtx({ content: html, viewSettings: settings }),
      );
      expect(result).toBe('hello   world');
    });
  });

  describe('when overrideLayout is undefined', () => {
    test('returns content unchanged (falsy)', async () => {
      const html = 'hello&nbsp;world';
      const result = await whitespaceTransformer.transform(makeCtx({ content: html }));
      expect(result).toBe('hello&nbsp;world');
    });
  });
});

// =============================================================================
// punctuationTransformer
// =============================================================================

describe('punctuationTransformer', () => {
  let punctuationTransformer: typeof import('@/services/transformers/punctuation').punctuationTransformer;

  beforeEach(async () => {
    ({ punctuationTransformer } = await import('@/services/transformers/punctuation'));
  });

  test('has the correct name', () => {
    expect(punctuationTransformer.name).toBe('punctuation');
  });

  describe('when replaceQuotationMarks is false', () => {
    test('returns content unchanged', async () => {
      const html = '\u201C\u4F60\u597D\u201D'; // "你好"
      const result = await punctuationTransformer.transform(
        makeCtx({
          content: html,
          viewSettings: { replaceQuotationMarks: false } as ViewSettings,
        }),
      );
      expect(result).toBe(html);
    });
  });

  describe('when replaceQuotationMarks is true, no variant conversion', () => {
    const baseSettings = {
      replaceQuotationMarks: true,
      convertChineseVariant: 'none' as const,
      vertical: false,
    } as ViewSettings;

    test('returns content unchanged when no variant or vertical conversion needed', async () => {
      const html = '\u201C\u4F60\u597D\u201D';
      const result = await punctuationTransformer.transform(
        makeCtx({ content: html, viewSettings: baseSettings }),
      );
      expect(result).toBe(html);
    });
  });

  describe('Chinese variant quotation mark conversion (Hans to Hant)', () => {
    const settings = {
      replaceQuotationMarks: true,
      convertChineseVariant: 's2t' as const,
      vertical: false,
    } as ViewSettings;

    test('converts left double curly quote to left corner bracket', async () => {
      const result = await punctuationTransformer.transform(
        makeCtx({ content: '\u201C', viewSettings: settings }),
      );
      // "\u201C" -> "\u300C" (「)
      expect(result).toBe('\u300C');
    });

    test('converts right double curly quote to right corner bracket', async () => {
      const result = await punctuationTransformer.transform(
        makeCtx({ content: '\u201D', viewSettings: settings }),
      );
      // "\u201D" -> "\u300D" (」)
      expect(result).toBe('\u300D');
    });

    test('converts left single curly quote to left double corner bracket', async () => {
      const result = await punctuationTransformer.transform(
        makeCtx({ content: '\u2018', viewSettings: settings }),
      );
      // "\u2018" -> "\u300E" (『)
      expect(result).toBe('\u300E');
    });

    test('converts right single curly quote to right double corner bracket', async () => {
      const result = await punctuationTransformer.transform(
        makeCtx({ content: '\u2019', viewSettings: settings }),
      );
      // "\u2019" -> "\u300F" (』)
      expect(result).toBe('\u300F');
    });

    test('converts mixed quotation marks in a sentence', async () => {
      const html = '\u201C\u4F60\u597D\u201D\u4ED6\u8BF4\u2018\u518D\u89C1\u2019';
      const result = await punctuationTransformer.transform(
        makeCtx({ content: html, viewSettings: settings }),
      );
      expect(result).toContain('\u300C');
      expect(result).toContain('\u300D');
      expect(result).toContain('\u300E');
      expect(result).toContain('\u300F');
    });
  });

  describe('reverse punctuation transform with variant conversion', () => {
    const settings = {
      replaceQuotationMarks: true,
      convertChineseVariant: 's2t' as const,
      vertical: false,
    } as ViewSettings;

    test('reverses the conversion direction when reversePunctuationTransform is true', async () => {
      // With s2t and reverse=true, the shouldReverse flag flips, so the mapping
      // goes from Hant -> Hans instead of Hans -> Hant
      const result = await punctuationTransformer.transform(
        makeCtx({
          content: '\u300C\u300D',
          viewSettings: settings,
          reversePunctuationTransform: true,
        }),
      );
      // 「」 -> ""
      expect(result).toContain('\u201C');
      expect(result).toContain('\u201D');
    });
  });

  describe('vertical quotation mark conversion', () => {
    const settings = {
      replaceQuotationMarks: true,
      convertChineseVariant: 'none' as const,
      vertical: true,
    } as ViewSettings;

    test('converts left double curly quote to vertical form (Hans default)', async () => {
      const result = await punctuationTransformer.transform(
        makeCtx({ content: '\u201C', viewSettings: settings }),
      );
      // Hans vertical: "\u201C" -> "\uFE43" (﹃)
      expect(result).toBe('\uFE43');
    });

    test('converts right double curly quote to vertical form (Hans default)', async () => {
      const result = await punctuationTransformer.transform(
        makeCtx({ content: '\u201D', viewSettings: settings }),
      );
      // Hans vertical: "\u201D" -> "\uFE44" (﹄)
      expect(result).toBe('\uFE44');
    });

    test('converts left single curly quote to vertical form (Hans default)', async () => {
      const result = await punctuationTransformer.transform(
        makeCtx({ content: '\u2018', viewSettings: settings }),
      );
      // Hans vertical: "\u2018" -> "\uFE41" (﹁)
      expect(result).toBe('\uFE41');
    });

    test('converts right single curly quote to vertical form (Hans default)', async () => {
      const result = await punctuationTransformer.transform(
        makeCtx({ content: '\u2019', viewSettings: settings }),
      );
      // Hans vertical: "\u2019" -> "\uFE42" (﹂)
      expect(result).toBe('\uFE42');
    });

    test('uses Hant vertical map when primaryLanguage is zh-Hant', async () => {
      const result = await punctuationTransformer.transform(
        makeCtx({
          content: '\u201C',
          viewSettings: settings,
          primaryLanguage: 'zh-Hant',
        }),
      );
      // Hant vertical: "\u201C" -> "\uFE41" (﹁) — different from Hans
      expect(result).toBe('\uFE41');
    });

    test('uses Hant vertical map when primaryLanguage is zh-TW', async () => {
      const result = await punctuationTransformer.transform(
        makeCtx({
          content: '\u201C',
          viewSettings: settings,
          primaryLanguage: 'zh-TW',
        }),
      );
      expect(result).toBe('\uFE41');
    });

    test('uses Hant vertical map when userLocale is zh-TW', async () => {
      const result = await punctuationTransformer.transform(
        makeCtx({
          content: '\u201C',
          viewSettings: settings,
          userLocale: 'zh-TW',
        }),
      );
      expect(result).toBe('\uFE41');
    });

    test('uses Hant vertical map when userLocale is zh_TW', async () => {
      const result = await punctuationTransformer.transform(
        makeCtx({
          content: '\u201C',
          viewSettings: settings,
          userLocale: 'zh_TW',
        }),
      );
      expect(result).toBe('\uFE41');
    });

    test('reverses vertical conversion when reversePunctuationTransform is true', async () => {
      const result = await punctuationTransformer.transform(
        makeCtx({
          content: '\uFE43',
          viewSettings: settings,
          reversePunctuationTransform: true,
        }),
      );
      // Hans reverse vertical: "\uFE43" (﹃) -> "\u201C" (")
      expect(result).toBe('\u201C');
    });
  });

  describe('combined variant and vertical conversion', () => {
    const settings = {
      replaceQuotationMarks: true,
      convertChineseVariant: 's2t' as const,
      vertical: true,
    } as ViewSettings;

    test('applies variant conversion first, then vertical conversion', async () => {
      // s2t converts "\u201C" -> "\u300C" (「), then vertical Hans converts "\u300C" -> "\uFE41" (﹁)
      const result = await punctuationTransformer.transform(
        makeCtx({ content: '\u201C', viewSettings: settings }),
      );
      expect(result).toBe('\uFE41');
    });
  });

  test('returns empty string unchanged', async () => {
    const result = await punctuationTransformer.transform(
      makeCtx({
        content: '',
        viewSettings: { replaceQuotationMarks: true, vertical: true } as ViewSettings,
      }),
    );
    expect(result).toBe('');
  });
});

// =============================================================================
// styleTransformer
// =============================================================================

describe('styleTransformer', () => {
  let styleTransformer: typeof import('@/services/transformers/style').styleTransformer;
  let transformStylesheet: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const styleMod = await import('@/utils/style');
    transformStylesheet = styleMod.transformStylesheet as ReturnType<typeof vi.fn>;
    transformStylesheet.mockClear();
    transformStylesheet.mockResolvedValue('transformed-css');
    ({ styleTransformer } = await import('@/services/transformers/style'));
  });

  test('has the correct name', () => {
    expect(styleTransformer.name).toBe('style');
  });

  test('returns content unchanged for fixed layout', async () => {
    const html = '<style>body { color: red; }</style>';
    const result = await styleTransformer.transform(
      makeCtx({ content: html, isFixedLayout: true }),
    );
    expect(result).toBe(html);
    expect(transformStylesheet).not.toHaveBeenCalled();
  });

  test('transforms style blocks for non-fixed layout', async () => {
    const html = '<html><head><style>body { color: red; }</style></head><body></body></html>';
    const result = await styleTransformer.transform(
      makeCtx({ content: html, width: 800, height: 600 }),
    );
    expect(transformStylesheet).toHaveBeenCalledWith('body { color: red; }', 800, 600, undefined);
    expect(result).toContain('<style>transformed-css</style>');
  });

  test('transforms multiple style blocks', async () => {
    transformStylesheet.mockResolvedValueOnce('css-1').mockResolvedValueOnce('css-2');
    const html =
      '<html><head>' +
      '<style>.a { margin: 0; }</style>' +
      '<style>.b { padding: 0; }</style>' +
      '</head><body></body></html>';
    const result = await styleTransformer.transform(
      makeCtx({ content: html, width: 1024, height: 768 }),
    );
    expect(transformStylesheet).toHaveBeenCalledTimes(2);
    expect(result).toContain('<style>css-1</style>');
    expect(result).toContain('<style>css-2</style>');
  });

  test('passes vertical setting to transformStylesheet', async () => {
    const html = '<style>div { writing-mode: vertical-rl; }</style>';
    const settings = { vertical: true } as ViewSettings;
    await styleTransformer.transform(
      makeCtx({ content: html, viewSettings: settings, width: 800, height: 600 }),
    );
    expect(transformStylesheet).toHaveBeenCalledWith(expect.any(String), 800, 600, true);
  });

  test('uses window dimensions when width/height not provided', async () => {
    const html = '<style>p { font-size: 16px; }</style>';
    await styleTransformer.transform(makeCtx({ content: html }));
    expect(transformStylesheet).toHaveBeenCalledWith(
      expect.any(String),
      window.innerWidth,
      window.innerHeight,
      undefined,
    );
  });

  test('returns content unchanged when no style blocks present', async () => {
    const html = '<html><head></head><body><p>Hello</p></body></html>';
    const result = await styleTransformer.transform(makeCtx({ content: html }));
    expect(result).toBe(html);
    expect(transformStylesheet).not.toHaveBeenCalled();
  });

  test('returns empty string unchanged', async () => {
    const result = await styleTransformer.transform(makeCtx({ content: '' }));
    expect(result).toBe('');
    expect(transformStylesheet).not.toHaveBeenCalled();
  });
});

// =============================================================================
// sanitizerTransformer
// =============================================================================

describe('sanitizerTransformer', () => {
  let sanitizerTransformer: typeof import('@/services/transformers/sanitizer').sanitizerTransformer;

  beforeEach(async () => {
    ({ sanitizerTransformer } = await import('@/services/transformers/sanitizer'));
  });

  test('has the correct name', () => {
    expect(sanitizerTransformer.name).toBe('sanitizer');
  });

  test('returns content unchanged when allowScript is true', async () => {
    const html = '<html><body><script>alert("xss")</script><p>Hello</p></body></html>';
    const settings = { allowScript: true } as ViewSettings;
    const result = await sanitizerTransformer.transform(
      makeCtx({ content: html, viewSettings: settings }),
    );
    expect(result).toBe(html);
  });

  test('sanitizes content when allowScript is false', async () => {
    const html = '<html><head></head><body><script>alert("xss")</script><p>Hello</p></body></html>';
    const settings = { allowScript: false } as ViewSettings;
    const result = await sanitizerTransformer.transform(
      makeCtx({ content: html, viewSettings: settings }),
    );
    expect(result).not.toContain('<script>');
    expect(result).toContain('<p>Hello</p>');
  });

  test('sanitizes content when allowScript is undefined (falsy)', async () => {
    const html = '<html><head></head><body><script>alert("xss")</script><p>Safe</p></body></html>';
    const result = await sanitizerTransformer.transform(makeCtx({ content: html }));
    expect(result).not.toContain('<script>');
    expect(result).toContain('Safe');
  });

  test('preserves epub: attributes after sanitization', async () => {
    const html =
      '<html xmlns:epub="http://www.idpf.org/2007/ops"><head></head><body>' +
      '<aside epub:type="footnote">Note</aside></body></html>';
    const settings = { allowScript: false } as ViewSettings;
    const result = await sanitizerTransformer.transform(
      makeCtx({ content: html, viewSettings: settings }),
    );
    expect(result).toContain('epub:type');
  });

  test('preserves &nbsp; entities through sanitization', async () => {
    const html = '<html><head></head><body><p>hello&nbsp;world</p></body></html>';
    const settings = { allowScript: false } as ViewSettings;
    const result = await sanitizerTransformer.transform(
      makeCtx({ content: html, viewSettings: settings }),
    );
    expect(result).toContain('&nbsp;');
  });

  test('output starts with XML declaration and DOCTYPE', async () => {
    const html = '<html><head></head><body><p>test</p></body></html>';
    const settings = { allowScript: false } as ViewSettings;
    const result = await sanitizerTransformer.transform(
      makeCtx({ content: html, viewSettings: settings }),
    );
    expect(result).toMatch(/^<\?xml version="1\.0" encoding="utf-8"\?>/);
    expect(result).toContain('<!DOCTYPE html');
  });
});

// =============================================================================
// languageTransformer
// =============================================================================

describe('languageTransformer', () => {
  let languageTransformer: typeof import('@/services/transformers/language').languageTransformer;
  let isSameLang: ReturnType<typeof vi.fn>;
  let isValidLang: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const langMod = await import('@/utils/lang');
    isSameLang = langMod.isSameLang as ReturnType<typeof vi.fn>;
    isValidLang = langMod.isValidLang as ReturnType<typeof vi.fn>;
    isSameLang.mockClear();
    isValidLang.mockClear();
    ({ languageTransformer } = await import('@/services/transformers/language'));
  });

  test('has the correct name', () => {
    expect(languageTransformer.name).toBe('language');
  });

  test('does not modify html tag when language is valid and matches primary', async () => {
    isValidLang.mockReturnValue(true);
    isSameLang.mockReturnValue(true);
    const html = '<html lang="en" xml:lang="en"><head></head><body>Hello</body></html>';
    const result = await languageTransformer.transform(
      makeCtx({ content: html, primaryLanguage: 'en' }),
    );
    expect(result).toBe(html);
  });

  test('sets language when html tag has no lang attribute and isValidLang returns false', async () => {
    isValidLang.mockReturnValue(false);
    const html = '<html><head></head><body>Hello</body></html>';
    const result = await languageTransformer.transform(
      makeCtx({ content: html, primaryLanguage: 'en' }),
    );
    // When isValidLang(primaryLanguage) is false, detectLanguage is called, returning 'en'
    expect(result).toContain('lang="en"');
    expect(result).toContain('xml:lang="en"');
  });
});

// =============================================================================
// simpleccTransformer
// =============================================================================

describe('simpleccTransformer', () => {
  let simpleccTransformer: typeof import('@/services/transformers/simplecc').simpleccTransformer;

  beforeEach(async () => {
    ({ simpleccTransformer } = await import('@/services/transformers/simplecc'));
  });

  test('has the correct name', () => {
    expect(simpleccTransformer.name).toBe('simplecc');
  });

  test('returns content unchanged when convertChineseVariant is "none"', async () => {
    const html = '<html><body>Hello</body></html>';
    const settings = { convertChineseVariant: 'none' as const } as ViewSettings;
    const result = await simpleccTransformer.transform(
      makeCtx({ content: html, viewSettings: settings }),
    );
    expect(result).toBe(html);
  });

  test('returns content unchanged when convertChineseVariant is undefined', async () => {
    const html = '<html><body>Hello</body></html>';
    const result = await simpleccTransformer.transform(makeCtx({ content: html }));
    expect(result).toBe(html);
  });

  test('calls initSimpleCC and runSimpleCC when variant is set', async () => {
    const { initSimpleCC, runSimpleCC } = await import('@/utils/simplecc');
    const mockInit = initSimpleCC as ReturnType<typeof vi.fn>;
    const mockRun = runSimpleCC as ReturnType<typeof vi.fn>;
    mockInit.mockClear();
    mockRun.mockClear();
    mockRun.mockImplementation((text: string) => text.replace(/Hello/g, 'Converted'));

    const html = '<html><body><p>Hello</p></body></html>';
    const settings = { convertChineseVariant: 's2t' as const } as ViewSettings;
    const result = await simpleccTransformer.transform(
      makeCtx({ content: html, viewSettings: settings }),
    );
    expect(mockInit).toHaveBeenCalled();
    expect(mockRun).toHaveBeenCalled();
    expect(result).toContain('Converted');
  });
});

// =============================================================================
// availableTransformers (index)
// =============================================================================

describe('availableTransformers', () => {
  test('exports all expected transformers', async () => {
    const { availableTransformers } = await import('@/services/transformers/index');
    const names = availableTransformers.map((t) => t.name);
    expect(names).toContain('footnote');
    expect(names).toContain('whitespace');
    expect(names).toContain('punctuation');
    expect(names).toContain('style');
    expect(names).toContain('sanitizer');
    expect(names).toContain('language');
    expect(names).toContain('simplecc');
    expect(names).toContain('proofread');
  });

  test('each transformer has a name and transform function', async () => {
    const { availableTransformers } = await import('@/services/transformers/index');
    for (const transformer of availableTransformers) {
      expect(typeof transformer.name).toBe('string');
      expect(transformer.name.length).toBeGreaterThan(0);
      expect(typeof transformer.transform).toBe('function');
    }
  });
});
