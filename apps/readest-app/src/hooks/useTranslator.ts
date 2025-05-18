import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  deeplProvider,
  getFromCache,
  storeInCache,
  UseTranslatorOptions,
} from '@/services/translators';

export function useTranslator({
  provider = deeplProvider,
  sourceLang = 'AUTO',
  targetLang = 'EN',
}: UseTranslatorOptions = {}) {
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(false);
  }, [provider.name, sourceLang, targetLang]);

  const translate = useCallback(
    async (
      input: string[],
      options?: { source?: string; target?: string; useCache?: boolean },
    ): Promise<string[]> => {
      const sourceLanguage = options?.source || sourceLang;
      const targetLanguage = options?.target || targetLang;
      const useCache = options?.useCache ?? false;
      const textsToTranslate = input;

      if (textsToTranslate.length === 0 || textsToTranslate.every((t) => !t?.trim())) {
        return textsToTranslate;
      }

      const textsNeedingTranslation: string[] = [];
      const indicesNeedingTranslation: number[] = [];

      await Promise.all(
        textsToTranslate.map(async (text, index) => {
          if (!text?.trim()) return;

          const cachedTranslation = await getFromCache(
            text,
            sourceLanguage,
            targetLanguage,
            provider.name,
          );
          if (cachedTranslation) return;

          textsNeedingTranslation.push(text);
          indicesNeedingTranslation.push(index);
        }),
      );

      if (textsNeedingTranslation.length === 0) {
        const results = await Promise.all(
          textsToTranslate.map((text) =>
            getFromCache(text, sourceLanguage, targetLanguage, provider.name).then(
              (cached) => cached || text,
            ),
          ),
        );

        return results;
      }

      setLoading(true);

      try {
        const translatedTexts = await provider.translate(
          textsNeedingTranslation,
          sourceLanguage,
          targetLanguage,
          token,
          useCache,
        );

        await Promise.all(
          textsNeedingTranslation.map(async (text, index) => {
            return storeInCache(
              text,
              translatedTexts[index] || '',
              sourceLanguage,
              targetLanguage,
              provider.name,
            );
          }),
        );

        const results = [...textsToTranslate];
        indicesNeedingTranslation.forEach((originalIndex, translationIndex) => {
          results[originalIndex] = translatedTexts[translationIndex] || '';
        });

        await Promise.all(
          results.map(async (_, index) => {
            if (!indicesNeedingTranslation.includes(index)) {
              const originalText = textsToTranslate[index];
              if (!originalText?.trim()) return;

              const cachedTranslation = await getFromCache(
                originalText,
                sourceLanguage,
                targetLanguage,
                provider.name,
              );

              if (cachedTranslation) {
                results[index] = cachedTranslation;
              }
            }
          }),
        );

        setLoading(false);
        return results;
      } catch (err) {
        console.error('Translation error:', err);
        setLoading(false);
        throw err instanceof Error ? err : new Error(String(err));
      }
    },
    [provider, sourceLang, targetLang, token],
  );

  return {
    translate,
    loading,
  };
}
