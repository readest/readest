import { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { supabase } from '@/utils/supabase';
import { getUserPlan } from '@/utils/access';

const DEEPL_FREE_API = 'https://api-free.deepl.com/v2/translate';
const DEEPL_PRO_API = 'https://api.deepl.com/v2/translate';

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

const getDeepLAPIKey = (keys: string | undefined) => {
  const keyArray = keys?.split(',') ?? [];
  return keyArray.length ? keyArray[Math.floor(Math.random() * keyArray.length)] : '';
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const { user, token } = await getUserAndToken(req.headers['authorization']);
  let deeplApiUrl = DEEPL_FREE_API;
  if (user && token) {
    const userPlan = await getUserPlan(token);
    if (userPlan !== 'free') deeplApiUrl = DEEPL_PRO_API;
  }
  const deeplAuthKey =
    deeplApiUrl === DEEPL_PRO_API
      ? getDeepLAPIKey(process.env['DEEPL_PRO_API_KEYS'])
      : getDeepLAPIKey(process.env['DEEPL_FREE_API_KEYS']);

  await runMiddleware(req, res, corsAllMethods);

  try {
    const response = await fetch(deeplApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${deeplAuthKey}`,
        'Content-Type': 'application/json',
      },
      body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
    });
    res.status(response.status);
    res.json(await response.json());
  } catch (error) {
    console.error('Error proxying DeepL request:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export default handler;
