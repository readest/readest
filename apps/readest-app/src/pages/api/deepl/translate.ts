import { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { supabase } from '@/utils/supabase';

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

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const { user, token } = await getUserAndToken(req.headers['authorization']);
  const deeplApiUrl = user && token ? DEEPL_PRO_API : DEEPL_FREE_API;
  const deeplAuthKey =
    user && token ? process.env['DEEPL_PRO_API_KEY'] : process.env['DEEPL_FREE_API_KEY'];

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
