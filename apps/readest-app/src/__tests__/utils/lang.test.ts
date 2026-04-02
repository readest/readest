import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  isCJKStr,
  isCJKLang,
  normalizeToFullLang,
  normalizeToShortLang,
  normalizedLangCode,
  isSameLang,
  isValidLang,
  code6392to6391,
  code6393to6391,
  getLanguageName,
  inferLangFromScript,
  getLanguageInfo,
} from '@/utils/lang';

describe('isCJKStr', () => {
  it('should return true for strings containing Chinese characters', () => {
    expect(isCJKStr('你好')).toBe(true);
    expect(isCJKStr('中文测试')).toBe(true);
    expect(isCJKStr('Hello 世界')).toBe(true);
  });

  it('should return true for strings containing Japanese Hiragana', () => {
    expect(isCJKStr('こんにちは')).toBe(true);
    expect(isCJKStr('Hello ひらがな')).toBe(true);
  });

  it('should return true for strings containing Japanese Katakana', () => {
    expect(isCJKStr('カタカナ')).toBe(true);
    expect(isCJKStr('Test カタカナ text')).toBe(true);
  });

  it('should return true for strings containing Korean Hangul', () => {
    expect(isCJKStr('한국어')).toBe(true);
    expect(isCJKStr('Hello 안녕')).toBe(true);
  });

  it('should return false for pure Latin text', () => {
    expect(isCJKStr('Hello World')).toBe(false);
    expect(isCJKStr('English text only')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isCJKStr('')).toBe(false);
  });

  it('should return false for numbers and punctuation only', () => {
    expect(isCJKStr('12345')).toBe(false);
    expect(isCJKStr('!@#$%')).toBe(false);
  });

  it('should return false for other non-CJK scripts', () => {
    expect(isCJKStr('مرحبا')).toBe(false); // Arabic
    expect(isCJKStr('Привет')).toBe(false); // Cyrillic
    expect(isCJKStr('สวัสดี')).toBe(false); // Thai
  });
});

describe('isCJKLang', () => {
  it('should return true for ISO 639-1 CJK language codes', () => {
    expect(isCJKLang('zh')).toBe(true);
    expect(isCJKLang('ja')).toBe(true);
    expect(isCJKLang('ko')).toBe(true);
  });

  it('should return true for ISO 639-2 CJK language codes', () => {
    expect(isCJKLang('zho')).toBe(true);
    expect(isCJKLang('jpn')).toBe(true);
    expect(isCJKLang('kor')).toBe(true);
  });

  it('should return true for language codes with region subtags', () => {
    expect(isCJKLang('zh-CN')).toBe(true);
    expect(isCJKLang('zh-TW')).toBe(true);
    expect(isCJKLang('ja-JP')).toBe(true);
    expect(isCJKLang('ko-KR')).toBe(true);
  });

  it('should return false for non-CJK languages', () => {
    expect(isCJKLang('en')).toBe(false);
    expect(isCJKLang('fr')).toBe(false);
    expect(isCJKLang('de')).toBe(false);
    expect(isCJKLang('es')).toBe(false);
  });

  it('should return false for null, undefined, and empty string', () => {
    expect(isCJKLang(null)).toBe(false);
    expect(isCJKLang(undefined)).toBe(false);
    expect(isCJKLang('')).toBe(false);
  });
});

describe('normalizeToFullLang', () => {
  it('should normalize Chinese variants to zh-Hans or zh-Hant', () => {
    expect(normalizeToFullLang('zh')).toBe('zh-Hans');
    expect(normalizeToFullLang('zh-CN')).toBe('zh-Hans');
    expect(normalizeToFullLang('zh-TW')).toBe('zh-Hant');
    expect(normalizeToFullLang('zh-HK')).toBe('zh-Hant');
  });

  it('should maximize language codes with regions', () => {
    expect(normalizeToFullLang('en')).toBe('en-US');
    expect(normalizeToFullLang('fr')).toBe('fr-FR');
    expect(normalizeToFullLang('de')).toBe('de-DE');
    expect(normalizeToFullLang('ja')).toBe('ja-JP');
  });

  it('should handle language codes that are already full', () => {
    expect(normalizeToFullLang('en-US')).toBe('en-US');
    expect(normalizeToFullLang('en-GB')).toBe('en-GB');
  });

  it('should be case-insensitive', () => {
    expect(normalizeToFullLang('ZH')).toBe('zh-Hans');
    expect(normalizeToFullLang('ZH-CN')).toBe('zh-Hans');
    expect(normalizeToFullLang('EN')).toBe('en-US');
  });

  it('should fall back to ZH_SCRIPTS_MAPPING for recognized Chinese codes on Intl failure', () => {
    expect(normalizeToFullLang('zh-hans')).toBe('zh-Hans');
    expect(normalizeToFullLang('zh-hant')).toBe('zh-Hant');
  });

  it('should return input as-is for unrecognized codes', () => {
    expect(normalizeToFullLang('xyz-unknown')).toBe('xyz-unknown');
  });
});

describe('normalizeToShortLang', () => {
  it('should map known Chinese region codes to zh-Hans or zh-Hant', () => {
    expect(normalizeToShortLang('zh-CN')).toBe('zh-Hans');
    expect(normalizeToShortLang('zh-TW')).toBe('zh-Hant');
    expect(normalizeToShortLang('zh-HK')).toBe('zh-Hant');
    expect(normalizeToShortLang('zh-MO')).toBe('zh-Hant');
  });

  it('should map bare zh to zh-Hans', () => {
    expect(normalizeToShortLang('zh')).toBe('zh-Hans');
  });

  it('should map zh-Hans and zh-Hant correctly', () => {
    expect(normalizeToShortLang('zh-Hans')).toBe('zh-Hans');
    expect(normalizeToShortLang('zh-Hant')).toBe('zh-Hant');
  });

  it('should default unknown zh variants to zh-Hans', () => {
    expect(normalizeToShortLang('zh-SG')).toBe('zh-Hans');
  });

  it('should extract the base language for non-Chinese codes', () => {
    expect(normalizeToShortLang('en-US')).toBe('en');
    expect(normalizeToShortLang('fr-FR')).toBe('fr');
    expect(normalizeToShortLang('ja-JP')).toBe('ja');
    expect(normalizeToShortLang('ko-KR')).toBe('ko');
  });

  it('should return the base language for codes without region', () => {
    expect(normalizeToShortLang('en')).toBe('en');
    expect(normalizeToShortLang('fr')).toBe('fr');
    expect(normalizeToShortLang('de')).toBe('de');
  });

  it('should be case-insensitive', () => {
    expect(normalizeToShortLang('ZH-CN')).toBe('zh-Hans');
    expect(normalizeToShortLang('EN-US')).toBe('en');
  });
});

describe('normalizedLangCode', () => {
  it('should extract and lowercase the base language code', () => {
    expect(normalizedLangCode('en-US')).toBe('en');
    expect(normalizedLangCode('zh-CN')).toBe('zh');
    expect(normalizedLangCode('fr-FR')).toBe('fr');
    expect(normalizedLangCode('ja-JP')).toBe('ja');
  });

  it('should handle codes without region subtags', () => {
    expect(normalizedLangCode('en')).toBe('en');
    expect(normalizedLangCode('zh')).toBe('zh');
  });

  it('should lowercase the output', () => {
    expect(normalizedLangCode('EN-US')).toBe('en');
    expect(normalizedLangCode('ZH')).toBe('zh');
    expect(normalizedLangCode('FR')).toBe('fr');
  });

  it('should return empty string for null and undefined', () => {
    expect(normalizedLangCode(null)).toBe('');
    expect(normalizedLangCode(undefined)).toBe('');
  });

  it('should return empty string for empty string', () => {
    expect(normalizedLangCode('')).toBe('');
  });
});

describe('isSameLang', () => {
  it('should return true for same base language with different regions', () => {
    expect(isSameLang('en-US', 'en-GB')).toBe(true);
    expect(isSameLang('zh-CN', 'zh-TW')).toBe(true);
    expect(isSameLang('fr-FR', 'fr-CA')).toBe(true);
  });

  it('should return true for identical language codes', () => {
    expect(isSameLang('en', 'en')).toBe(true);
    expect(isSameLang('zh', 'zh')).toBe(true);
  });

  it('should be case-insensitive', () => {
    expect(isSameLang('EN', 'en')).toBe(true);
    expect(isSameLang('en-US', 'EN-GB')).toBe(true);
  });

  it('should return false for different languages', () => {
    expect(isSameLang('en', 'fr')).toBe(false);
    expect(isSameLang('zh-CN', 'ja-JP')).toBe(false);
  });

  it('should return false when either argument is null, undefined, or empty', () => {
    expect(isSameLang(null, 'en')).toBe(false);
    expect(isSameLang('en', null)).toBe(false);
    expect(isSameLang(undefined, 'en')).toBe(false);
    expect(isSameLang('en', undefined)).toBe(false);
    expect(isSameLang('', 'en')).toBe(false);
    expect(isSameLang('en', '')).toBe(false);
    expect(isSameLang(null, null)).toBe(false);
    expect(isSameLang(undefined, undefined)).toBe(false);
  });
});

describe('isValidLang', () => {
  it('should return true for valid ISO 639-1 codes', () => {
    expect(isValidLang('en')).toBe(true);
    expect(isValidLang('fr')).toBe(true);
    expect(isValidLang('de')).toBe(true);
    expect(isValidLang('zh')).toBe(true);
    expect(isValidLang('ja')).toBe(true);
    expect(isValidLang('ko')).toBe(true);
    expect(isValidLang('es')).toBe(true);
  });

  it('should return true for valid codes with region subtags', () => {
    expect(isValidLang('en-US')).toBe(true);
    expect(isValidLang('zh-CN')).toBe(true);
    expect(isValidLang('fr-FR')).toBe(true);
  });

  it('should return true for valid ISO 639-2 three-letter codes', () => {
    expect(isValidLang('eng')).toBe(true);
    expect(isValidLang('fre')).toBe(true);
    expect(isValidLang('ger')).toBe(true);
    expect(isValidLang('chi')).toBe(true);
  });

  it('should return false for special/undefined language codes', () => {
    expect(isValidLang('und')).toBe(false); // undetermined
    expect(isValidLang('mul')).toBe(false); // multiple
    expect(isValidLang('mis')).toBe(false); // miscellaneous
    expect(isValidLang('zxx')).toBe(false); // no linguistic content
  });

  it('should return false for undefined, empty, and falsy values', () => {
    expect(isValidLang(undefined)).toBe(false);
    expect(isValidLang('')).toBe(false);
  });

  it('should return false for completely bogus codes', () => {
    expect(isValidLang('xyz')).toBe(false);
    expect(isValidLang('qqq')).toBe(false);
    expect(isValidLang('zzzz')).toBe(false);
  });
});

describe('code6392to6391', () => {
  it('should convert ISO 639-2B codes to ISO 639-1', () => {
    expect(code6392to6391('eng')).toBe('en');
    expect(code6392to6391('fre')).toBe('fr');
    expect(code6392to6391('ger')).toBe('de');
    expect(code6392to6391('chi')).toBe('zh');
    expect(code6392to6391('jpn')).toBe('ja');
    expect(code6392to6391('kor')).toBe('ko');
    expect(code6392to6391('spa')).toBe('es');
    expect(code6392to6391('por')).toBe('pt');
    expect(code6392to6391('ita')).toBe('it');
    expect(code6392to6391('rus')).toBe('ru');
  });

  it('should return empty string for unknown codes', () => {
    expect(code6392to6391('xyz')).toBe('');
    expect(code6392to6391('qqq')).toBe('');
    expect(code6392to6391('')).toBe('');
  });

  it('should return empty string for ISO 639-1 codes (not 639-2B)', () => {
    expect(code6392to6391('en')).toBe('');
    expect(code6392to6391('fr')).toBe('');
  });
});

describe('code6393to6391', () => {
  it('should convert common individual language codes via macro mapping', () => {
    expect(code6393to6391('cmn')).toBe('zh'); // Mandarin -> Chinese
    expect(code6393to6391('arb')).toBe('ar'); // Standard Arabic -> Arabic
  });

  it('should convert ISO 639-3 codes that match directly', () => {
    expect(code6393to6391('eng')).toBe('en');
    expect(code6393to6391('fra')).toBe('fr');
    expect(code6393to6391('deu')).toBe('de');
    expect(code6393to6391('spa')).toBe('es');
    expect(code6393to6391('jpn')).toBe('ja');
    expect(code6393to6391('kor')).toBe('ko');
  });

  it('should return empty string for unknown codes', () => {
    expect(code6393to6391('xyz')).toBe('');
    expect(code6393to6391('qqq')).toBe('');
    expect(code6393to6391('')).toBe('');
  });

  it('should handle other macro-mapped individual codes', () => {
    expect(code6393to6391('arz')).toBe('ar'); // Egyptian Arabic -> Arabic
    expect(code6393to6391('nob')).toBe('no'); // Norwegian Bokmal -> Norwegian
    expect(code6393to6391('nno')).toBe('no'); // Norwegian Nynorsk -> Norwegian
    expect(code6393to6391('pes')).toBe('fa'); // Iranian Persian -> Persian
  });
});

describe('getLanguageName', () => {
  it('should return language names for valid ISO 639-1 codes', () => {
    expect(getLanguageName('en')).toBe('English');
    expect(getLanguageName('fr')).toBe('French');
    expect(getLanguageName('de')).toBe('German');
    expect(getLanguageName('es')).toBe('Spanish; Castilian');
    expect(getLanguageName('zh')).toBe('Chinese');
    expect(getLanguageName('ja')).toBe('Japanese');
    expect(getLanguageName('ko')).toBe('Korean');
  });

  it('should return language names for codes with region subtags', () => {
    expect(getLanguageName('en-US')).toBe('English');
    expect(getLanguageName('zh-CN')).toBe('Chinese');
    expect(getLanguageName('fr-FR')).toBe('French');
  });

  it('should return language names for valid ISO 639-2B codes', () => {
    expect(getLanguageName('eng')).toBe('English');
    expect(getLanguageName('fre')).toBe('French');
    expect(getLanguageName('ger')).toBe('German');
  });

  it('should return the normalized code itself for unknown languages', () => {
    expect(getLanguageName('xyz')).toBe('xyz');
    expect(getLanguageName('qqq')).toBe('qqq');
  });

  it('should be case-insensitive', () => {
    expect(getLanguageName('EN')).toBe('English');
    expect(getLanguageName('FR')).toBe('French');
  });
});

describe('inferLangFromScript', () => {
  it('should detect Korean from Hangul characters when lang is empty', () => {
    expect(inferLangFromScript('안녕하세요', '')).toBe('ko');
  });

  it('should detect Korean from Hangul characters when lang is en', () => {
    expect(inferLangFromScript('한국어 텍스트', 'en')).toBe('ko');
  });

  it('should detect Japanese from Hiragana characters when lang is empty', () => {
    expect(inferLangFromScript('こんにちは', '')).toBe('ja');
  });

  it('should detect Japanese from Katakana characters when lang is en', () => {
    expect(inferLangFromScript('カタカナ', 'en')).toBe('ja');
  });

  it('should detect Chinese from Han characters when lang is empty', () => {
    expect(inferLangFromScript('你好世界', '')).toBe('zh');
  });

  it('should detect Chinese from Han characters when lang is en', () => {
    expect(inferLangFromScript('中文', 'en')).toBe('zh');
  });

  it('should prioritize Hangul over Han when both are present', () => {
    // Hangul check comes before Han, so Korean should win
    expect(inferLangFromScript('한자漢字', '')).toBe('ko');
  });

  it('should prioritize Hiragana/Katakana over Han', () => {
    // Japanese check comes before Han
    expect(inferLangFromScript('日本語のひらがな', '')).toBe('ja');
  });

  it('should return the provided lang when it is not empty or en', () => {
    expect(inferLangFromScript('你好', 'fr')).toBe('fr');
    expect(inferLangFromScript('한국어', 'de')).toBe('de');
    expect(inferLangFromScript('こんにちは', 'zh')).toBe('zh');
  });

  it('should return the lang when text has no CJK characters', () => {
    expect(inferLangFromScript('Hello World', '')).toBe('');
    expect(inferLangFromScript('Hello World', 'en')).toBe('en');
    expect(inferLangFromScript('Bonjour', 'en')).toBe('en');
  });
});

describe('getLanguageInfo', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return language info for valid language codes', () => {
    const info = getLanguageInfo('en');
    expect(info.canonical).toBe('en');
    expect(info.locale).toBeDefined();
    expect(info.isCJK).toBe(false);
    expect(info.direction).toBe('ltr');
  });

  it('should identify CJK languages', () => {
    const zhInfo = getLanguageInfo('zh');
    expect(zhInfo.isCJK).toBe(true);

    const jaInfo = getLanguageInfo('ja');
    expect(jaInfo.isCJK).toBe(true);
  });

  it('should detect RTL direction for Arabic', () => {
    const arInfo = getLanguageInfo('ar');
    expect(arInfo.direction).toBe('rtl');
  });

  it('should detect RTL direction for Hebrew', () => {
    const heInfo = getLanguageInfo('he');
    expect(heInfo.direction).toBe('rtl');
  });

  it('should detect LTR direction for English', () => {
    const enInfo = getLanguageInfo('en');
    expect(enInfo.direction).toBe('ltr');
  });

  it('should return empty object for empty string', () => {
    const info = getLanguageInfo('');
    expect(info).toEqual({});
  });

  it('should return empty object for invalid language codes', () => {
    const info = getLanguageInfo('not-a-valid-locale!!!');
    expect(info).toEqual({});
  });

  it('should canonicalize language codes', () => {
    const info = getLanguageInfo('en-US');
    expect(info.canonical).toBe('en-US');
  });

  it('should handle language codes with script subtags', () => {
    const info = getLanguageInfo('zh-Hans');
    expect(info.isCJK).toBe(true);
    expect(info.direction).toBe('ltr');
  });
});
