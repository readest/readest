import { stubTranslation as _ } from '@/utils/misc';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { TranslationProvider } from '../types';
import { normalizeToFullLang } from '@/utils/lang';

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

const getAuthToken = async (): Promise<string> => {
  const now = Date.now();

  if (tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.token;
  }

  try {
    const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
    const tokenResponse = await fetch('https://edge.microsoft.com/translate/auth', {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!tokenResponse.ok) {
      throw new Error(`Failed to get auth token: ${tokenResponse.status}`);
    }

    const token = await tokenResponse.text();
    const expiresAt = now + 8 * 60 * 1000;

    tokenCache = {
      token,
      expiresAt,
    };

    return token;
  } catch (error) {
    console.error('Error getting Microsoft translation auth token:', error);
    throw error;
  }
};

export const azureProvider: TranslationProvider = {
  name: 'azure',
  label: _('Azure Translator'),
  translate: async (text: string[], sourceLang: string, targetLang: string): Promise<string[]> => {
    if (!text.length) return [];

    const results: string[] = [];
    const msSourceLang = sourceLang ? normalizeToFullLang(sourceLang) : '';
    const msTargetLang = normalizeToFullLang(targetLang);

    const translationPromises = text.map(async (line, index) => {
      if (!line?.trim().length) {
        results[index] = line;
        return;
      }

      const url = 'https://api-edge.cognitive.microsofttranslator.com/translate';
      const params = new URLSearchParams({
        to: msTargetLang,
        'api-version': '3.0',
      });
      if (msSourceLang && msSourceLang.toLowerCase() !== 'auto') {
        params.append('from', msSourceLang);
      }

      const token = await getAuthToken();
      const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
      const response = await fetch(`${url}?${params.toString()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify([{ Text: line }]),
      });

      if (!response.ok) {
        throw new Error(`Translation failed with status ${response.status}`);
      }

      const data = await response.json();

      if (Array.isArray(data) && data.length > 0 && data[0].translations) {
        results[index] = data[0].translations[0].text || line;
      } else {
        results[index] = line;
      }
    });

    await Promise.all(translationPromises);

    return results;
  },
};
