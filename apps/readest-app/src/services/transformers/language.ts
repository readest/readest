import {
  detectLanguage,
  getLanguageInfo,
  isCJKLang,
  isCJKStr,
  isSameLang,
  isValidLang,
} from '@/utils/lang';
import type { Transformer } from './types';

export const languageTransformer: Transformer = {
  name: 'language',

  transform: async (ctx) => {
    const primaryLanguage = ctx.primaryLanguage;
    let result = ctx.content;
    const attrsMatch = result.match(/<html\b([^>]*)>/i);
    if (attrsMatch) {
      let attrs = attrsMatch[1] || '';
      const langRegex = / lang="([^"]*)"/i;
      const xmlLangRegex = / xml:lang="([^"]*)"/i;
      const xmlLangMatch = attrs.match(xmlLangRegex);
      const langMatch = attrs.match(langRegex);
      const docLang = langMatch?.[1] || xmlLangMatch?.[1];
      const mainContent = result.replace(/<[^>]+>/g, ' ');
      // Conversion tools routinely stamp a placeholder `en` on both `dc:language` and
      // the root tag. Those two then confirm each other here, and the section's own
      // text never gets read — even though a placeholder `primaryLanguage` already
      // sends us to `detectLanguage` below. A CJK-dominant section under a non-CJK
      // declaration is the same placeholder, so it should not be taken at its word.
      const contentIsCJK =
        !isCJKLang(docLang) && isCJKStr(mainContent) && isCJKLang(detectLanguage(mainContent));
      if (!isValidLang(docLang) || !isSameLang(docLang, primaryLanguage) || contentIsCJK) {
        // The placeholder is `en` whatever region it carries, and the comparison above
        // already treats it that way; testing the literal here would let `en-US` through
        // as a real language.
        const lang =
          isValidLang(primaryLanguage) && !isSameLang(primaryLanguage, 'en')
            ? primaryLanguage
            : detectLanguage(mainContent);
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
      const lang =
        isValidLang(primaryLanguage) && !isSameLang(primaryLanguage, 'en')
          ? primaryLanguage
          : detectLanguage(result.replace(/<[^>]+>/g, ' '));
      const languageInfo = getLanguageInfo(lang || '');
      const dirAttr = languageInfo?.direction === 'rtl' ? ' dir="rtl"' : '';
      const newAttrs = ` lang="${lang}" xml:lang="${lang}" ${dirAttr}`;
      result = result.replace(/<html>/i, `<html${newAttrs}>`);
    }
    return result;
  },
};
