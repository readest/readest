import crypto from 'crypto';
import { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { supabase } from '@/utils/supabase';
import { getDailyTranslationPlanData, getUserPlan } from '@/utils/access';

const DEFAULT_DEEPL_FREE_API = 'https://api-free.deepl.com/v2/translate';
const DEFAULT_DEEPL_PRO_API = 'https://api.deepl.com/v2/translate';

const ErrorCodes = {
  UNAUTHORIZED: 'Unauthorized',
  DEEPL_API_ERROR: 'DeepL API Error',
  DAILY_QUOTA_EXCEEDED: 'Daily Quota Exceeded',
  INTERNAL_SERVER_ERROR: 'Internal Server Error',
};

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

interface CloudflareEnv {
  TRANSLATIONS_KV?: KVNamespace;
}

const getUserAndToken = async (authHeader: string | undefined) => {
  if (!authHeader) return {};

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) return {};
  return { user, token };
};

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

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const env = (req.env || {}) as CloudflareEnv;
  const hasKVCache = !!env['TRANSLATIONS_KV'];

  const { user, token } = await getUserAndToken(req.headers['authorization']);
  const { DEEPL_PRO_API, DEEPL_FREE_API } = process.env;
  const deepFreeApiUrl = DEEPL_FREE_API || DEFAULT_DEEPL_FREE_API;
  const deeplProApiUrl = DEEPL_PRO_API || DEFAULT_DEEPL_PRO_API;

  let deeplApiUrl = deepFreeApiUrl;
  let userPlan = 'free';
  if (user && token) {
    userPlan = getUserPlan(token);
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

  try {
    const translations = await Promise.all(
      text.map(async (singleText) => {
        if (!singleText?.trim()) {
          return { text: '' };
        }
        if (useCache && hasKVCache) {
          try {
            const cacheKey = generateCacheKey(singleText, sourceLang, targetLang);
            const cachedTranslation = await env['TRANSLATIONS_KV']!.get(cacheKey);

            if (cachedTranslation) {
              return {
                text: cachedTranslation,
                detected_source_language: sourceLang,
              };
            }
          } catch (cacheError) {
            console.error('Cache retrieval error:', cacheError);
          }
        }

        // if (!user || !token) return res.status(401).json({ error: ErrorCodes.UNAUTHORIZED });

        return await callDeepLAPI(
          user?.id,
          token,
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
    return res.status(200).json({ translations });
  } catch (error) {
    console.error('Error proxying DeepL request:', error);
    if (error instanceof Error && error.message.includes(ErrorCodes.DAILY_QUOTA_EXCEEDED)) {
      return res.status(429).json({ error: ErrorCodes.DAILY_QUOTA_EXCEEDED });
    }
    return res.status(500).json({ error: ErrorCodes.INTERNAL_SERVER_ERROR });
  }
};

async function callDeepLAPI(
  userId: string | undefined,
  token: string | undefined,
  text: string,
  sourceLang: string,
  targetLang: string,
  apiUrl: string,
  authKey: string,
  translationsKV: KVNamespace | undefined,
  useCache: boolean,
) {
  let dailyUsageKey = '';
  if (userId && token) {
    const { quota: dailyQuota } = getDailyTranslationPlanData(token);
    const currentDate = new Date().toISOString().split('T')[0]!;
    dailyUsageKey = `daily_usage:${currentDate}:${userId}`;
    const dailyUsage = (await translationsKV?.get(dailyUsageKey)) || '0';
    if (dailyQuota <= parseInt(dailyUsage) + text.length) {
      throw new Error(ErrorCodes.DAILY_QUOTA_EXCEEDED);
    }
  }

  const isV2Api = apiUrl.endsWith('/v2/translate');

  // TODO: this should be processed in the client, but for now, we need to do it here
  // please remove this when most clients are updated
  const input = text.replaceAll('\n', '').trim();
  const requestBody = {
    text: isV2Api ? [input] : input,
    source_lang: isV2Api ? sourceLang : (LANG_V2_V1_MAP[sourceLang] ?? sourceLang),
    target_lang: isV2Api ? targetLang : (LANG_V2_V1_MAP[targetLang] ?? targetLang),
  };

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

  const data = await response.json();

  let translatedText = '';
  let detectedSourceLanguage = '';

  if (data.translations && data.translations.length > 0) {
    translatedText = data.translations[0].text;
    detectedSourceLanguage = data.translations[0].detected_source_language || '';
  } else if (data.data) {
    translatedText = data.data;
  }

  let newDailyUsage = 0;
  if (dailyUsageKey && translationsKV) {
    try {
      const usage = translatedText.length + text.length;
      const dailyUsage = (await translationsKV.get(dailyUsageKey)) || '0';
      newDailyUsage = parseInt(dailyUsage) + usage;
      await translationsKV.put(dailyUsageKey, newDailyUsage.toString(), {
        expirationTtl: 86400 * 30,
      });
    } catch (cacheError) {
      console.error('Cache storage error:', cacheError);
    }
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
    daily_usage: newDailyUsage,
    detected_source_language: detectedSourceLanguage,
  };
}

export default handler;
