import { getAPIBaseUrl } from '@/services/environment';
import { stubTranslation as _ } from '@/utils/misc';
import { ErrorCodes, TranslationProvider } from '../types';
import { UserPlan } from '@/types/quota';
import { getSubscriptionPlan } from '@/utils/access';
import { normalizeToShortLang } from '@/utils/lang';
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
      userPlan = getSubscriptionPlan(token);
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (authRequired && !token) {
      throw new Error('Authentication token is required for DeepL translation');
    }

    const body = JSON.stringify({
      text: text,
      source_lang: normalizeToShortLang(sourceLang).toUpperCase(),
      target_lang: normalizeToShortLang(targetLang).toUpperCase(),
      use_cache: useCache,
    });

    const quota = DEFAULT_DAILY_TRANSLATION_QUOTA[userPlan];
    try {
      const response = await fetch(DEEPL_API_ENDPOINT, { method: 'POST', headers, body });

      if (!response.ok) {
        const data = await response.json();
        if (data && data.error && data.error === ErrorCodes.DAILY_QUOTA_EXCEEDED) {
          saveDailyUsage(quota);
          deeplProvider.quotaExceeded = true;
          throw new Error(ErrorCodes.DAILY_QUOTA_EXCEEDED);
        }
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
      throw error;
    }
  },
};
