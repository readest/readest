import { stubTranslation as _ } from '@/utils/misc';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { normalizeToShortLang } from '@/utils/lang';
import { TranslationProvider } from '../types';

/**
 * Based on https://translate.toil.cc/v2/docs API specification
 */
async function translateSingleTextForService(
  text: string,
  lang: string,
  service: string,
): Promise<string[]> {
  const fetchImpl = isTauriAppPlatform() ? tauriFetch : window.fetch;
  const url = 'https://translate.toil.cc/v2/translate/';

  const request = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      lang: lang,
      service: service,
      text: text,
    })
  };

  const response = await fetchImpl(url, request);

  if (!response.ok) {
    const response_json = JSON.stringify(await response.json());
    throw new Error(`${service} failed with status ${response.status}\n${text.length}\n${JSON.stringify(request)}\n${response_json}`);
  }

  const data = await response.json();
  if (
    data &&
    Array.isArray(data.translations)
  ) {
    return data.translations;
  } else {
    // fallback: return original texts if translation failed
    return [text];
  }
};

export const yandexProvider: TranslationProvider = {
  name: 'yandex',
  label: _('Yandex Translate'),
  authRequired: false,
  translate: async (texts: string[], sourceLang: string, targetLang: string): Promise<string[]> => {
    if (!texts.length) return [];

    /**
      Possible options:
      - yandexcloud: often returns 500: {"error":"The text couldn't be translated, because Forbidden"}
      - yandexgpt: often better than others
      - yandextranslate
      - yandexbrowser
    */
    const service = "yandexgpt";

    // Yandex does not accept "auto" language
    const source_lang = sourceLang == "AUTO" ? "en" : normalizeToShortLang(sourceLang).toLowerCase();
    const target_lang = normalizeToShortLang(targetLang).toLowerCase();
    const lang = `${source_lang}-${target_lang}`;

    const responses = await Promise.all(texts.map(async text => {
      return await translateSingleTextForService(text, lang, service)
    }));

    const translatedTexts = responses.flat();
    return translatedTexts;
  }
};
