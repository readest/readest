import {
  detectLanguage,
  getLanguageInfo,
  isCJKLang,
  isCJKStr,
  isSameLang,
  isValidLang,
  normalizedLangCode,
} from '@/utils/lang';
import type { Transformer } from './types';

const TEXT_SAMPLE_LENGTH = 1000; // what `detectLanguage` reads

// The leading text of `html` with tags stripped, without stripping a section that can run
// to megabytes. Cutting right after a `>` keeps every tag whole, so the result is exactly
// the start of the fully stripped text.
const getTextSample = (html: string): string => {
  for (let size = 4 * TEXT_SAMPLE_LENGTH; ; size *= 2) {
    const end = size >= html.length ? html.length : html.lastIndexOf('>', size) + 1;
    const text = html.slice(0, end).replace(/<[^>]+>/g, ' ');
    if (text.length >= TEXT_SAMPLE_LENGTH || end === html.length) {
      return text.slice(0, TEXT_SAMPLE_LENGTH);
    }
  }
};

export const languageTransformer: Transformer = {
  name: 'language',

  transform: async (ctx) => {
    const primaryLanguage = ctx.primaryLanguage;
    // `en` is the placeholder; books imported before the primary language was normalized
    // may still carry it as `en-US` or `eng`.
    const hasPrimary =
      isValidLang(primaryLanguage) && !['en', 'eng'].includes(normalizedLangCode(primaryLanguage));
    let result = ctx.content;
    const attrsMatch = result.match(/<html\b([^>]*)>/i);
    if (attrsMatch) {
      let attrs = attrsMatch[1] || '';
      const langRegex = / lang="([^"]*)"/i;
      const xmlLangRegex = / xml:lang="([^"]*)"/i;
      const xmlLangMatch = attrs.match(xmlLangRegex);
      const langMatch = attrs.match(langRegex);
      const docLang = langMatch?.[1] || xmlLangMatch?.[1];
      const text = getTextSample(result);
      // Conversion tools routinely stamp a placeholder `en` on both `dc:language` and the
      // root tag, so they agree here even when the section's text is CJK.
      const detectedLang =
        !hasPrimary && !isCJKLang(docLang) && isCJKStr(text) ? detectLanguage(text) : '';
      if (
        !isValidLang(docLang) ||
        !isSameLang(docLang, primaryLanguage) ||
        isCJKLang(detectedLang)
      ) {
        const lang = hasPrimary ? primaryLanguage : detectedLang || detectLanguage(text);
        const languageInfo = getLanguageInfo(lang || '');
        const newLangAttr = ` lang="${lang}"`;
        const newXmlLangAttr = ` xml:lang="${lang}"`;
        const dirAttr = languageInfo?.direction === 'rtl' ? ' dir="rtl"' : '';
        attrs = langMatch ? attrs.replace(langRegex, newLangAttr) : attrs + newLangAttr + dirAttr;
        attrs = xmlLangMatch
          ? attrs.replace(xmlLangRegex, newXmlLangAttr)
          : attrs + newXmlLangAttr + dirAttr;
        result = result.replace(attrsMatch[0], `<html${attrs}>`);
      }
    } else {
      const lang = hasPrimary ? primaryLanguage : detectLanguage(getTextSample(result));
      const languageInfo = getLanguageInfo(lang || '');
      const dirAttr = languageInfo?.direction === 'rtl' ? ' dir="rtl"' : '';
      const newAttrs = ` lang="${lang}" xml:lang="${lang}" ${dirAttr}`;
      result = result.replace(/<html>/i, `<html${newAttrs}>`);
    }
    return result;
  },
};
