import { detectLanguage, isValidLang } from '@/utils/lang';
import type { Transformer } from './types';

export const languageTransformer: Transformer = {
  name: 'language',

  transform: async (ctx) => {
    let result = ctx.content;
    const attrsMatch = result.match(/<html\b([^>]*)>/i);
    if (attrsMatch) {
      let attrs = attrsMatch[1] || '';
      const langRegex = / lang="([^"]*)"/i;
      const xmlLangRegex = / xml:lang="([^"]*)"/i;
      const xmlLangMatch = attrs.match(xmlLangRegex);
      const langMatch = attrs.match(langRegex);
      if (!isValidLang(langMatch?.[1] || xmlLangMatch?.[1])) {
        const mainContent = result.replace(/<[^>]+>/g, ' ');
        const lang = detectLanguage(mainContent);
        const newLangAttr = ` lang="${lang}"`;
        const newXmlLangAttr = ` xml:lang="${lang}"`;
        attrs = langMatch ? attrs.replace(langRegex, newLangAttr) : attrs + newLangAttr;
        attrs = xmlLangMatch ? attrs.replace(xmlLangRegex, newXmlLangAttr) : attrs + newXmlLangAttr;
        result = result.replace(attrsMatch[0], `<html${attrs}>`);
      }
    }
    return result;
  },
};
