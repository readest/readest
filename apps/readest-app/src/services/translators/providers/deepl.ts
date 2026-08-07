import { getAPIBaseUrl } from '@/services/environment';
import { stubTranslation as _ } from '@/utils/misc';
import { ErrorCodes, TranslationProvider } from '../types';
import { UserPlan } from '@/types/quota';
import { getSubscriptionPlan, getTranslationQuota } from '@/utils/access';
import { normalizeToShortLang } from '@/utils/lang';
import { saveDailyUsage } from '../utils';

const DEEPL_API_ENDPOINT = getAPIBaseUrl() + '/deepl/translate';

export const deeplProvider: TranslationProvider = {
  name: 'deepl',
  label: _('DeepL'),
  authRequired: true,
  // No `preservesMarkup`: round-tripping inline markup through this endpoint
  // corrupts it, silently and inconsistently. Measured against the live API —
  // `<b>` and `<i>` alone survive, but `<em>` is dropped outright, and when a
  // sentence carries both bold and italic the bold content is moved outside
  // its own tag, leaving an empty `<b></b>` so nothing renders bold. Losing
  // the formatting while keeping the text (the plain-text path) is better than
  // emitting markup that lies about it.
  // DeepL proper supports `tag_handling=html`, but that would have to be set
  // by the /deepl/translate service, which lives outside this repo; passing the
  // field from here is ignored.
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

    const normalizedSourceLang = normalizeToShortLang(sourceLang).toUpperCase();
    const body = JSON.stringify({
      text: text,
      ...(normalizedSourceLang !== 'AUTO' ? { source_lang: normalizedSourceLang } : {}),
      target_lang: normalizeToShortLang(targetLang).toUpperCase(),
      use_cache: useCache,
    });

    const quota = getTranslationQuota(userPlan);
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
