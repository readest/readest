export const isCJKStr = (str: string) => {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(str ?? '');
};

export const langToDefaultLocale = (langCode: string): string => {
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
    'zh-hans': 'zh-Hans',
    'zh-hant': 'zh-Hant',
  };

  return mapping[langCode] || langCode;
};

export const localeToLang = (locale: string): string => {
  const mapping: Record<string, string> = {
    'zh-CN': 'zh-Hans',
    'zh-TW': 'zh-Hant',
    'zh-HK': 'zh-Hant',
  };

  if (locale.startsWith('zh')) {
    return mapping[locale] || 'zh-Hans';
  }
  return mapping[locale] || locale.split('-')[0]!.toLowerCase();
};
