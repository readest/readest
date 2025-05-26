import { getAPIBaseUrl } from '@/services/environment';
import { stubTranslation as _ } from '@/utils/misc';
import { TranslationProvider } from '../types';

const DEEPL_API_ENDPOINT = getAPIBaseUrl() + '/deepl/translate';

export const deeplProvider: TranslationProvider = {
  name: 'deepl',
  label: _('DeepL'),
  translate: async (
    text: string[],
    sourceLang: string,
    targetLang: string,
    token?: string | null,
    useCache: boolean = false,
  ): Promise<string[]> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const body = JSON.stringify({
      text: text,
      source_lang: sourceLang.toUpperCase(),
      target_lang: targetLang.toUpperCase(),
      use_cache: useCache,
    });

    const response = await fetch(DEEPL_API_ENDPOINT, { method: 'POST', headers, body });

    if (!response.ok) {
      throw new Error(`Translation failed with status ${response.status}`);
    }

    const data = await response.json();
    if (!data || !data.translations) {
      throw new Error('Invalid response from translation service');
    }

    return text.map((line, i) => {
      if (!line?.trim().length) {
        return line;
      }
      return data.translations?.[i]?.text || line;
    });
  },
};
