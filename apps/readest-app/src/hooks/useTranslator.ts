import { useState, useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  ErrorCodes,
  getTranslator,
  getTranslators,
  isTranslatorAvailable,
  TranslatorName,
} from '@/services/translators';
import { getFromCache, storeInCache, UseTranslatorOptions } from '@/services/translators';
import { polish, preprocess } from '@/services/translators';
import { eventDispatcher } from '@/utils/event';
import { getLocale } from '@/utils/misc';
import { useEnv } from '@/context/EnvContext';
import {
  ensureCustomTranslatorsLoaded,
  useCustomTranslatorStore,
} from '@/store/customTranslatorStore';
import { isCustomTranslatorName } from '@/services/translators/custom';
import { isCustomTranslatorAllowed } from '@/utils/access';
import { useTranslation } from './useTranslation';

export function useTranslator({
  provider = 'deepl',
  sourceLang = 'AUTO',
  targetLang = 'EN',
  enablePolishing = true,
  enablePreprocessing = true,
  promptId,
  bookTitle,
  bookAuthor,
}: UseTranslatorOptions = {}) {
  const _ = useTranslation();
  const { token } = useAuth();
  const { envConfig } = useEnv();
  const [loading, setLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(provider);
  const [translator, setTransltor] = useState(() => getTranslator(provider));
  const customTranslators = useCustomTranslatorStore((s) => s.translators);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const translators = useMemo(() => getTranslators(), [customTranslators]);

  useEffect(() => {
    ensureCustomTranslatorsLoaded(envConfig);
  }, [envConfig]);

  useEffect(() => {
    setLoading(false);
  }, [provider, sourceLang, targetLang]);

  useEffect(() => {
    const hasPremium = isCustomTranslatorAllowed(token);
    const availableTranslators = translators.filter((t) =>
      isTranslatorAvailable(t, !!token, hasPremium),
    );
    const selectedTranslator =
      availableTranslators.find((t) => t.name === provider) || availableTranslators[0]!;
    const selectedProviderName = selectedTranslator.name as TranslatorName;
    setTransltor(selectedTranslator);
    setSelectedProvider(selectedProviderName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, translators, token]);

  const translate = useCallback(
    async (
      input: string[],
      options?: { source?: string; target?: string; useCache?: boolean },
    ): Promise<string[]> => {
      const sourceLanguage = options?.source || sourceLang;
      const targetLanguage = options?.target || targetLang || getLocale();
      const useCache = options?.useCache ?? false;
      const context = { promptId, bookTitle, bookAuthor };
      const activeTranslator = translators.find((t) => t.name === selectedProvider);
      const cacheProvider =
        activeTranslator?.getCacheKey?.(sourceLanguage, targetLanguage, context) ??
        selectedProvider;
      const textsToTranslate = enablePreprocessing ? preprocess(input) : input;

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
            cacheProvider,
          );
          if (cachedTranslation) return;

          textsNeedingTranslation.push(text);
          indicesNeedingTranslation.push(index);
        }),
      );

      if (textsNeedingTranslation.length === 0) {
        const results = await Promise.all(
          textsToTranslate.map((text) =>
            getFromCache(text, sourceLanguage, targetLanguage, cacheProvider).then(
              (cached) => cached || text,
            ),
          ),
        );

        return enablePolishing ? polish(results, targetLanguage) : results;
      }

      setLoading(true);

      try {
        if (!activeTranslator) {
          throw new Error(`No translator found for provider: ${selectedProvider}`);
        }
        const translatedTexts = await activeTranslator.translate(
          textsNeedingTranslation,
          sourceLanguage,
          targetLanguage,
          token,
          useCache,
          undefined,
          context,
        );

        await Promise.all(
          textsNeedingTranslation.map(async (text, index) => {
            return storeInCache(
              text,
              translatedTexts[index] || '',
              sourceLanguage,
              targetLanguage,
              cacheProvider,
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
                cacheProvider,
              );

              if (cachedTranslation) {
                results[index] = cachedTranslation;
              }
            }
          }),
        );

        setLoading(false);
        return enablePolishing ? polish(results, targetLanguage) : results;
      } catch (err) {
        if (err instanceof Error && err.message.includes(ErrorCodes.DAILY_QUOTA_EXCEEDED)) {
          eventDispatcher.dispatch('toast', {
            timeout: 5000,
            message: _(
              'Daily translation quota reached. Upgrade your plan to continue using AI translations.',
            ),
            type: 'error',
          });
          setSelectedProvider('azure');
        }
        if (
          err instanceof Error &&
          err.message === ErrorCodes.UNAUTHORIZED &&
          isCustomTranslatorName(selectedProvider)
        ) {
          eventDispatcher.dispatch('toast', {
            timeout: 5000,
            message: _('Check the API key for {{name}}', { name: activeTranslator?.label }),
            type: 'error',
          });
        }
        setLoading(false);
        throw err instanceof Error ? err : new Error(String(err));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedProvider, sourceLang, targetLang, translators, token, promptId, bookTitle, bookAuthor],
  );

  return {
    translate,
    translator,
    translators,
    loading,
  };
}
