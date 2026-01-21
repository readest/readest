import { detectLanguage, getLanguageInfo, isSameLang, isValidLang } from '@/utils/lang';
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
      if (!isValidLang(docLang) || !isSameLang(docLang, primaryLanguage)) {
        const mainContent = result.replace(/<[^>]+>/g, ' ');
        const lang =
          isValidLang(primaryLanguage) && primaryLanguage !== 'en'
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
        isValidLang(primaryLanguage) && primaryLanguage !== 'en'
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
