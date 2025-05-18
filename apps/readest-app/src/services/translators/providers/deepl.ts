import { getAPIBaseUrl } from '@/services/environment';
import { TranslationProvider } from '../types';

const DEEPL_API_ENDPOINT = getAPIBaseUrl() + '/deepl/translate';

export const deeplProvider: TranslationProvider = {
  name: 'deepl',
  translate: async (
    text: string[],
    sourceLang: string,
    targetLang: string,
    token?: string | null,
    useCache: boolean = false,
  ): Promise<string[]> => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(DEEPL_API_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          text: text,
          source_lang: sourceLang,
          target_lang: targetLang,
          use_cache: useCache,
        }),
      });

      if (!response.ok) {
        throw new Error(`Translation failed with status ${response.status}`);
      }

      const data = await response.json();

      const result = [...text];
      let translationIndex = 0;

      for (let i = 0; i < text.length; i++) {
        if (text[i]!.trim().length > 0) {
          result[i] = data.translations?.[translationIndex]?.text || text[i];
          translationIndex++;
        }
      }

      return result;
    } catch (error) {
      console.error('Translation error:', error);
      return text;
    }
  },
};
