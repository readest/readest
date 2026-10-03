interface TesseractLanguageOptions {
  mangaFallback?: boolean;
}

const JAPANESE_LANGUAGES = ['jpn', 'jpn_vert'] as const;
const KOREAN_LANGUAGES = ['kor', 'kor_vert', 'eng'] as const;
const SIMPLIFIED_CHINESE_LANGUAGES = ['chi_sim', 'chi_sim_vert', 'eng'] as const;
const TRADITIONAL_CHINESE_LANGUAGES = ['chi_tra', 'chi_tra_vert', 'eng'] as const;
const UNDEFINED_LANGUAGES = new Set(['', 'mis', 'mul', 'und', 'zxx']);

export const OCR_LANGUAGE_CODES = [
  'en',
  'fr',
  'de',
  'nl',
  'it',
  'ja',
  'ko',
  'es',
  'pt',
  'ru',
  'he',
  'ar',
  'fa',
  'el',
  'uk',
  'pl',
  'sl',
  'tr',
  'hi',
  'id',
  'vi',
  'th',
  'ms',
  'bo',
  'bn',
  'ta',
  'si',
  'zh-CN',
  'zh-TW',
  'ro',
  'hu',
  'uz',
  'ka',
] as const;

const TESSERACT_LANGUAGE_BY_BASE: Readonly<Record<string, string>> = {
  ar: 'ara',
  ara: 'ara',
  ben: 'ben',
  bn: 'ben',
  bo: 'bod',
  bod: 'bod',
  de: 'deu',
  deu: 'deu',
  dut: 'nld',
  el: 'ell',
  ell: 'ell',
  en: 'eng',
  eng: 'eng',
  es: 'spa',
  fa: 'fas',
  fas: 'fas',
  fra: 'fra',
  fre: 'fra',
  fr: 'fra',
  geo: 'kat',
  ger: 'deu',
  gre: 'ell',
  he: 'heb',
  heb: 'heb',
  hi: 'hin',
  hin: 'hin',
  hu: 'hun',
  hun: 'hun',
  id: 'ind',
  ind: 'ind',
  it: 'ita',
  ita: 'ita',
  ka: 'kat',
  kat: 'kat',
  may: 'msa',
  ms: 'msa',
  msa: 'msa',
  nl: 'nld',
  nld: 'nld',
  per: 'fas',
  pl: 'pol',
  pol: 'pol',
  por: 'por',
  pt: 'por',
  ro: 'ron',
  ron: 'ron',
  ru: 'rus',
  rum: 'ron',
  rus: 'rus',
  si: 'sin',
  sin: 'sin',
  sl: 'slv',
  slv: 'slv',
  spa: 'spa',
  ta: 'tam',
  tam: 'tam',
  tha: 'tha',
  th: 'tha',
  tib: 'bod',
  tr: 'tur',
  tur: 'tur',
  uk: 'ukr',
  ukr: 'ukr',
  uz: 'uzb',
  uzb: 'uzb',
  vi: 'vie',
  vie: 'vie',
};

export const getTesseractLanguages = (
  language: string | readonly string[] | undefined,
  { mangaFallback = false }: TesseractLanguageOptions = {},
): readonly string[] => {
  const firstLanguage = (Array.isArray(language) ? language[0] : language) ?? '';
  const normalized = firstLanguage.trim().replaceAll('_', '-').toLowerCase();
  const base = normalized.split('-')[0]!;

  if (UNDEFINED_LANGUAGES.has(base)) return mangaFallback ? JAPANESE_LANGUAGES : ['eng'];
  if (base === 'ja' || base === 'jpn') return JAPANESE_LANGUAGES;
  if (base === 'ko' || base === 'kor') return KOREAN_LANGUAGES;
  if (['zh', 'zho', 'chi'].includes(base)) {
    return /(?:hant|hk|mo|tw)/.test(normalized)
      ? TRADITIONAL_CHINESE_LANGUAGES
      : SIMPLIFIED_CHINESE_LANGUAGES;
  }
  const model = TESSERACT_LANGUAGE_BY_BASE[base];
  return model ? [model] : ['eng'];
};

export const getOcrTextLanguage = (
  language: string | readonly string[] | undefined,
  { mangaFallback = false }: TesseractLanguageOptions = {},
): string | undefined => {
  const firstLanguage = (Array.isArray(language) ? language[0] : language) ?? '';
  const normalized = firstLanguage.trim().replaceAll('_', '-');
  const base = normalized.toLowerCase().split('-')[0]!;
  if (UNDEFINED_LANGUAGES.has(base)) return mangaFallback ? 'ja' : undefined;
  if (base === 'jpn') return 'ja';
  if (base === 'kor') return 'ko';
  if (['chi', 'zho'].includes(base))
    return /(?:hant|hk|mo|tra|tw)/iu.test(normalized) ? 'zh-TW' : 'zh-CN';
  return normalized;
};
