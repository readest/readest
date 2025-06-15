export const isCJKStr = (str: string) => {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(str ?? '');
};

export const isCJKLang = (lang: string | null | undefined): boolean => {
  if (!lang) return false;
  const normalizedLang = lang.split('-')[0]!.toLowerCase();
  return ['zh', 'ja', 'ko'].includes(normalizedLang);
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
