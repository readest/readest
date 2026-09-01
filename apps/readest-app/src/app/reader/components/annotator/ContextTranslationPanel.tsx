'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { requestContextTranslation } from '@/services/ai/contextTranslationService';
import { ContextTranslationError } from '@/services/ai/contextTranslationTypes';
import type {
  ContextTranslationDetailLevel,
  ContextTranslationInput,
  ContextTranslationSettings,
} from '@/services/ai/contextTranslationTypes';
import { AITranslationResultView, type AITranslationState } from './AITranslationResultView';

type ContextTranslationPanelProps = {
  selectedText: string;
  settings: ContextTranslationSettings;
  sourceLanguage?: string;
  bookTitle?: string;
  chapterTitle?: string;
  beforeContext?: string;
  afterContext?: string;
  sentence?: string;
  paragraph?: string;
  onOpenSettings: () => void;
};

let lastContextTranslationDetailLevel: ContextTranslationDetailLevel = 'normal';

const isConfigured = (settings: ContextTranslationSettings) =>
  settings.enabled &&
  !!settings.baseUrl.trim() &&
  !!settings.apiKey.trim() &&
  !!settings.modelId.trim();

const toMessage = (error: unknown): { message: string; retryable: boolean } => {
  if (error instanceof ContextTranslationError) {
    return { message: error.message, retryable: error.retryable };
  }
  return {
    message: error instanceof Error ? error.message : 'Context translation failed.',
    retryable: true,
  };
};

export const ContextTranslationPanel = ({
  selectedText,
  settings,
  sourceLanguage,
  bookTitle,
  chapterTitle,
  beforeContext = '',
  afterContext = '',
  sentence,
  paragraph,
  onOpenSettings,
}: ContextTranslationPanelProps) => {
  const _ = useTranslation();
  const [detailLevel, setDetailLevel] = useState<ContextTranslationDetailLevel>(
    lastContextTranslationDetailLevel,
  );
  const [state, setState] = useState<AITranslationState>({ status: 'idle' });

  const input = useMemo<ContextTranslationInput>(
    () => ({
      selectedText,
      beforeContext,
      afterContext,
      sentence,
      paragraph,
      sourceLanguage,
      targetLanguage: settings.targetLanguage,
      bookTitle,
      chapterTitle,
      detailLevel,
    }),
    [
      selectedText,
      beforeContext,
      afterContext,
      sentence,
      paragraph,
      sourceLanguage,
      settings.targetLanguage,
      bookTitle,
      chapterTitle,
      detailLevel,
    ],
  );

  const load = useCallback(
    async (forceRefresh = false) => {
      if (!isConfigured(settings)) {
        setState({
          status: 'error',
          message: _('AI translation is not configured.'),
          retryable: false,
        });
        return;
      }
      setState({ status: 'loading', detailLevel });
      try {
        const result = await requestContextTranslation(input, settings, { forceRefresh });
        setState({ status: 'success', result });
      } catch (error) {
        setState({ status: 'error', ...toMessage(error) });
      }
    },
    [_, detailLevel, input, settings],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <div className='space-y-3 px-4 pb-4'>
      <div className='flex justify-end'>
        <label className='label cursor-pointer gap-2 py-0 text-xs text-base-content/70'>
          <span>{_('Detailed')}</span>
          <input
            type='checkbox'
            className='toggle toggle-xs'
            checked={detailLevel === 'detailed'}
            onChange={(event) => {
              const next = event.target.checked ? 'detailed' : 'normal';
              lastContextTranslationDetailLevel = next;
              setDetailLevel(next);
            }}
          />
        </label>
      </div>
      <AITranslationResultView
        state={state}
        targetLanguage={settings.targetLanguage}
        onRetry={() => void load(true)}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
};
