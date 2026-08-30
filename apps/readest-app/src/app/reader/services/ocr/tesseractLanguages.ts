interface TesseractLanguageOptions {
  mangaFallback?: boolean;
}

const JAPANESE_LANGUAGES = ['jpn', 'jpn_vert', 'eng'] as const;
const KOREAN_LANGUAGES = ['kor', 'kor_vert', 'eng'] as const;
const SIMPLIFIED_CHINESE_LANGUAGES = ['chi_sim', 'chi_sim_vert', 'eng'] as const;
const TRADITIONAL_CHINESE_LANGUAGES = ['chi_tra', 'chi_tra_vert', 'eng'] as const;
const UNDEFINED_LANGUAGES = new Set(['', 'mis', 'mul', 'und', 'zxx']);

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
  return ['eng'];
};
