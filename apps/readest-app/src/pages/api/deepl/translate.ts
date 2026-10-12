import crypto from 'crypto';
import { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import {
  getDailyTranslationPlanData,
  getSubscriptionPlan,
  validateUserAndToken,
} from '@/utils/access';
import { ErrorCodes } from '@/services/translators';
import { UsageStatsManager } from '@/utils/usage';

const DEFAULT_DEEPL_FREE_API = 'https://api-free.deepl.com/v2/translate';
const DEFAULT_DEEPL_PRO_API = 'https://api.deepl.com/v2/translate';

// Hard per-request caps, independent of the per-user daily quota. They bound
// the work a single request can trigger (one upstream fetch per item, run in
// parallel) so one caller cannot fan out thousands of concurrent DeepL calls
// or buffer megabytes of text in a 128MB Worker. The largest daily quota (pro)
// is 500 KiB, so a 50K-char request ceiling never gets in the way of a
// legitimate batch while still blocking the 500×9000 abuse case.
const MAX_TRANSLATION_ITEMS = 100;
const MAX_TRANSLATION_TOTAL_CHARS = 50_000;

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

interface CloudflareEnv {
  TRANSLATIONS_KV?: KVNamespace;
}

const LANG_V2_V1_MAP: Record<string, string> = {
  'ZH-HANS': 'ZH',
  'ZH-HANT': 'ZH-TW',
};

const getDeepLAPIKey = (keys: string | undefined) => {
  const keyArray = keys?.split(',') ?? [];
  return keyArray.length ? keyArray[Math.floor(Math.random() * keyArray.length)]! : '';
};

const generateCacheKey = (text: string, sourceLang: string, targetLang: string): string => {
  const inputString = `${sourceLang}:${targetLang}:${text}`;
  const hash = crypto.createHash('sha1').update(inputString).digest('hex');
  return `tr:${hash}`;
};

const checkDailyUsage = async (userId: string, token: string, chars: number) => {
  const { quota: dailyQuota } = getDailyTranslationPlanData(token);
  const dailyUsage = await UsageStatsManager.getCurrentUsage(userId, 'translation_chars', 'daily');

  if (dailyQuota <= dailyUsage + chars) {
    throw new Error(ErrorCodes.DAILY_QUOTA_EXCEEDED);
  }
  return dailyUsage;
};

const updateDailyUsage = async (
  userId: string | undefined,
  token: string | undefined,
  incrementUsage: number,
) => {
  if (!userId || !token) return 0;

  try {
    const userPlan = getSubscriptionPlan(token);
    const newUsage = await UsageStatsManager.trackUsage(
      userId,
      'translation_chars',
      incrementUsage,
      {
        plan_type: userPlan,
        source: 'deepl_api',
      },
    );

    return newUsage;
  } catch (cacheError) {
    console.error('Update daily usage error:', cacheError);
  }

  return 0;
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let env: Partial<CloudflareEnv> = {};
  try {
    env = (getCloudflareContext().env || {}) as CloudflareEnv;
  } catch {
    console.warn('Cloudflare context is not available. Skipping KV cache.');
  }
  const hasKVCache = !!env['TRANSLATIONS_KV'];

  const { user, token } = await validateUserAndToken(req.headers['authorization']);
  const { DEEPL_PRO_API, DEEPL_FREE_API } = process.env;
  const deepFreeApiUrl = DEEPL_FREE_API || DEFAULT_DEEPL_FREE_API;
  const deeplProApiUrl = DEEPL_PRO_API || DEFAULT_DEEPL_PRO_API;

  let deeplApiUrl = deepFreeApiUrl;
  let userPlan = 'free';
  if (user && token) {
    userPlan = getSubscriptionPlan(token);
    if (userPlan === 'pro') deeplApiUrl = deeplProApiUrl;
  }
  const deeplAuthKey =
    deeplApiUrl === deeplProApiUrl
      ? getDeepLAPIKey(process.env['DEEPL_PRO_API_KEYS'])
      : getDeepLAPIKey(process.env['DEEPL_FREE_API_KEYS']);

  const {
    text,
    source_lang: sourceLang = 'AUTO',
    target_lang: targetLang = 'EN',
    use_cache: useCache = false,
  }: { text: string[]; source_lang: string; target_lang: string; use_cache: boolean } = req.body;

  // Authenticate up front. The only auth check used to live inside the
  // per-item `Promise.all` callback below, which let an unauthenticated caller
  // read cached translations before the check, and — worse — still ran the
  // success `res.status(200)` after the in-callback `res.status(401)`, sending
  // two responses for one request. Validating `text` as a string array here
  // also stops a non-array body from throwing inside `.map` and surfacing as an
  // opaque 500.
  if (!user || !token) {
    return res.status(401).json({ error: ErrorCodes.UNAUTHORIZED });
  }
  if (!Array.isArray(text) || text.some((t) => typeof t !== 'string')) {
    return res.status(400).json({ error: 'Invalid text' });
  }

  // Bound the request before doing any work. Without this a single request can
  // carry hundreds of items of thousands of chars each.
  const totalChars = text.reduce((sum, t) => sum + t.length, 0);
  if (text.length > MAX_TRANSLATION_ITEMS || totalChars > MAX_TRANSLATION_TOTAL_CHARS) {
    return res.status(413).json({ error: 'Translation request too large' });
  }

  try {
    // Reserve the whole request against the daily quota *once*, up front. The
    // old per-item check ran inside the `Promise.all` map where every item read
    // the same pre-increment usage snapshot, so N items each under the quota
    // would all pass and translate N× the quota in a single request. Checking
    // the summed character count here closes that bypass; usage is incremented
    // after a successful translation via `updateDailyUsage` below.
    await checkDailyUsage(user.id, token, totalChars);

    const translations = await Promise.all(
      text.map(async (singleText) => {
        if (!singleText?.trim()) {
          return { text: '', daily_usage: 0 };
        }
        if (useCache && hasKVCache) {
          try {
            const cacheKey = generateCacheKey(singleText, sourceLang, targetLang);
            const cachedTranslation = await env['TRANSLATIONS_KV']!.get(cacheKey);

            if (cachedTranslation) {
              return {
                text: cachedTranslation,
                daily_usage: 0,
                detected_source_language: sourceLang,
              };
            }
          } catch (cacheError) {
            console.error('Cache retrieval error:', cacheError);
          }
        }

        return await callDeepLAPI(
          singleText,
          sourceLang,
          targetLang,
          deeplApiUrl,
          deeplAuthKey,
          env['TRANSLATIONS_KV'],
          useCache,
        );
      }),
    );
    const originalCharsCount = text.reduce((a, b) => a + b.length, 0);
    const translatedCharsCount = translations.reduce((a, b) => a + (b?.text.length || 0), 0);
    const newDailyUsage = await updateDailyUsage(
      user?.id,
      token,
      originalCharsCount + translatedCharsCount,
    );
    translations.forEach((translation) => {
      if (translation && translation.text) {
        translation.daily_usage = newDailyUsage;
      }
    });
    return res.status(200).json({ translations });
  } catch (error) {
    if (error instanceof Error && error.message.includes(ErrorCodes.DAILY_QUOTA_EXCEEDED)) {
      return res.status(429).json({ error: ErrorCodes.DAILY_QUOTA_EXCEEDED });
    } else {
      console.error('Error proxying DeepL request:', error);
    }
    return res.status(500).json({ error: ErrorCodes.INTERNAL_SERVER_ERROR });
  }
};

async function callDeepLAPI(
  text: string,
  sourceLang: string,
  targetLang: string,
  apiUrl: string,
  authKey: string,
  translationsKV: KVNamespace | undefined,
  useCache: boolean,
) {
  const isV2Api = apiUrl.endsWith('/v2/translate');

  // TODO: this should be processed in the client, but for now, we need to do it here
  // please remove this when most clients are updated
  const input = text.replaceAll('\n', '').trim();

  const requestBody: {
    text: string | string[];
    target_lang: string;
    source_lang?: string;
  } = {
    text: isV2Api ? [input] : input,
    source_lang: isV2Api ? sourceLang : (LANG_V2_V1_MAP[sourceLang] ?? sourceLang),
    target_lang: isV2Api ? targetLang : (LANG_V2_V1_MAP[targetLang] ?? targetLang),
  };

  if (isV2Api && requestBody.source_lang?.toUpperCase() === 'AUTO') {
    delete requestBody.source_lang;
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${authKey}`,
      'x-fingerprint': process.env['DEEPL_X_FINGERPRINT'] || '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepL API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    translations?: { text: string; detected_source_language?: string }[];
    data?: string;
  };

  let translatedText = '';
  let detectedSourceLanguage = '';

  if (data.translations && data.translations.length > 0) {
    translatedText = data.translations[0]!.text;
    detectedSourceLanguage = data.translations[0]!.detected_source_language || '';
  } else if (data.data) {
    translatedText = data.data;
  }

  if (useCache && translationsKV && translatedText) {
    try {
      const cacheKey = generateCacheKey(text, sourceLang, targetLang);
      await translationsKV.put(cacheKey, translatedText, { expirationTtl: 86400 * 90 });
    } catch (cacheError) {
      console.error('Cache storage error:', cacheError);
    }
  }

  return {
    text: translatedText,
    daily_usage: 0,
    detected_source_language: detectedSourceLanguage,
  };
}

export default handler;
