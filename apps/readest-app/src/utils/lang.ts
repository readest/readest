import { franc } from 'franc-min';
import { iso6392 } from 'iso-639-2';
import { iso6393To1 } from 'iso-639-3';

export const isCJKStr = (str: string) => {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(str ?? '');
};

export const isCJKLang = (lang: string | null | undefined): boolean => {
  if (!lang) return false;
  const normalizedLang = normalizedLangCode(lang);
  return ['zh', 'ja', 'ko', 'zho', 'jpn', 'kor'].includes(normalizedLang);
};

export const normalizeToFullLang = (langCode: string): string => {
  const mapping: Record<string, string> = {
    en: 'en-US',
    fr: 'fr-FR',
    de: 'de-DE',
    es: 'es-ES',
    it: 'it-IT',
    ja: 'ja-JP',
    ko: 'ko-KR',
    pt: 'pt-PT',
    ar: 'ar-SA',
    nl: 'nl-NL',
    pl: 'pl-PL',
    tr: 'tr-TR',
    id: 'id-ID',
    ru: 'ru-RU',
    uk: 'uk-UA',
    th: 'th-TH',
    no: 'no-NO',
    sv: 'sv-SE',
    fi: 'fi-FI',
    da: 'da-DK',
    cs: 'cs-CZ',
    hu: 'hu-HU',
    ro: 'ro-RO',
    bg: 'bg-BG',
    hr: 'hr-HR',
    lt: 'lt-LT',
    sl: 'sl-SI',
    sk: 'sk-SK',
    bo: 'bo-CN',
    zh: 'zh-Hans',
    'zh-cn': 'zh-Hans',
    'zh-tw': 'zh-Hant',
    'zh-mo': 'zh-Hant',
    'zh-hans': 'zh-Hans',
    'zh-hant': 'zh-Hant',
  };

  return mapping[langCode.toLowerCase()] || langCode;
};

export const normalizeToShortLang = (langCode: string): string => {
  const lang = langCode.toLowerCase();
  const mapping: Record<string, string> = {
    'zh-cn': 'zh-Hans',
    'zh-tw': 'zh-Hant',
    'zh-hk': 'zh-Hant',
    'zh-mo': 'zh-Hant',
    'zh-hans': 'zh-Hans',
    'zh-hant': 'zh-Hant',
  };

  if (lang.startsWith('zh')) {
    return mapping[lang] || 'zh-Hans';
  }
  return lang.split('-')[0]!;
};

export const normalizedLangCode = (lang: string | null | undefined): string => {
  if (!lang) return '';
  return lang.split('-')[0]!.toLowerCase();
};

export const isSameLang = (lang1?: string | null, lang2?: string | null): boolean => {
  if (!lang1 || !lang2) return false;
  const normalizedLang1 = normalizedLangCode(lang1);
  const normalizedLang2 = normalizedLangCode(lang2);
  return normalizedLang1 === normalizedLang2;
};

export const isValidLang = (lang?: string) => {
  if (!lang) return false;
  if (typeof lang !== 'string') return false;
  const code = normalizedLangCode(lang);
  return iso6392.some((l) => l.iso6391 === code || l.iso6392B === code);
};

export const code6392to6391 = (code: string): string => {
  const lang = iso6392.find((l) => l.iso6392B === code);
  return lang?.iso6391 || '';
};

const commonIndivToMacro: Record<string, string> = {
  cmn: 'zho',
  arb: 'ara',
  arz: 'ara',
  ind: 'msa',
  zsm: 'msa',
  nob: 'nor',
  nno: 'nor',
  pes: 'fas',
  quy: 'que',
};

export const code6393to6391 = (code: string): string => {
  const macro = commonIndivToMacro[code] || code;
  return iso6393To1[macro] || '';
};

export const getLanguageName = (code: string): string => {
  const lang = normalizedLangCode(code);
  const language = iso6392.find((l) => l.iso6391 === lang || l.iso6392B === lang);
  return language ? language.name : lang;
};

export const inferLangFromScript = (text: string, lang: string): string => {
  if (!lang || lang === 'en') {
    if (/[\p{Script=Hangul}]/u.test(text)) {
      return 'ko';
    } else if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) {
      return 'ja';
    } else if (/[\p{Script=Han}]/u.test(text)) {
      return 'zh';
    }
  }
  return lang;
};

export const detectLanguage = (content: string): string => {
  try {
    const iso6393Lang = franc(content.substring(0, 1000));
    const iso6391Lang = code6393to6391(iso6393Lang) || 'en';
    return iso6391Lang;
  } catch {
    console.warn('Language detection failed, defaulting to en.');
    return 'en';
  }
};
