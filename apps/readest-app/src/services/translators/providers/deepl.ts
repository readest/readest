import { getAPIBaseUrl } from '@/services/environment';
import { stubTranslation as _ } from '@/utils/misc';
import { ErrorCodes, TranslationProvider } from '../types';
import { UserPlan } from '@/types/user';
import { getUserPlan } from '@/utils/access';
import { DEFAULT_DAILY_TRANSLATION_QUOTA } from '@/services/constants';
import { saveDailyUsage } from '../utils';

const DEEPL_API_ENDPOINT = getAPIBaseUrl() + '/deepl/translate';

export const deeplProvider: TranslationProvider = {
  name: 'deepl',
  label: _('DeepL'),
  authRequired: true,
  quotaExceeded: false,
  translate: async (
    text: string[],
    sourceLang: string,
    targetLang: string,
    token?: string | null,
    useCache: boolean = false,
  ): Promise<string[]> => {
    const authRequired = deeplProvider.authRequired;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    let userPlan: UserPlan = 'free';
    if (token) {
      userPlan = getUserPlan(token);
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (authRequired && !token) {
      throw new Error('Authentication token is required for DeepL translation');
    }

    const body = JSON.stringify({
      text: text,
      source_lang: sourceLang.toUpperCase(),
      target_lang: targetLang.toUpperCase(),
      use_cache: useCache,
    });

    const quota = DEFAULT_DAILY_TRANSLATION_QUOTA[userPlan];
    try {
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
        const translation = data.translations?.[i];
        if (translation?.daily_usage) {
          saveDailyUsage(translation.daily_usage);
          deeplProvider.quotaExceeded = data.daily_usage >= quota;
        }
        return translation?.text || line;
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes(ErrorCodes.DAILY_QUOTA_EXCEEDED)) {
        saveDailyUsage(quota);
        deeplProvider.quotaExceeded = true;
      }
      throw error;
    }
  },
};
