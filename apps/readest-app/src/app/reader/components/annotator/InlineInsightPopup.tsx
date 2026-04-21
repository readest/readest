import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PiCaretDown, PiCaretUp, PiChatCircle, PiPaperPlaneRight } from 'react-icons/pi';

import Popup from '@/components/Popup';
import { Position, TextSelection } from '@/utils/sel';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { getLocale } from '@/utils/misc';
import { isTauriAppPlatform } from '@/services/environment';
import { DEFAULT_INLINE_INSIGHT_SETTINGS } from '@/services/inlineInsight/types';
import { extractContext } from '@/services/inlineInsight/contextExtractor';
import {
  streamInlineInsight,
  streamInlineInsightFollowUp,
  isInlineInsightDebugLoggingEnabled,
} from '@/services/inlineInsight/client';
import {
  parseInlineInsightSections,
  type InlineInsightItem,
} from '@/services/inlineInsight/parser';
import type { InlineInsightCallLogger } from '@/services/inlineInsight/client';
import { createInlineInsightTauriLogger } from '@/services/inlineInsight/logging';

interface InlineInsightPopupProps {
  selection: TextSelection;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
}

const InsightItem: React.FC<{ brief: InlineInsightItem; detail?: string }> = ({
  brief,
  detail,
}) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className='border-base-content/10 rounded border p-2'>
      <p className='text-base-content/80 select-text text-xs leading-relaxed'>
        <span className='text-base-content mr-1 font-semibold'>[{brief.label}]</span>
        {expanded && detail ? detail : brief.content}
      </p>
      {detail && (
        <button
          type='button'
          className='text-base-content/50 mt-1 flex items-center gap-0.5 text-[10px] hover:underline'
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <>
              <PiCaretUp className='size-3' /> Less
            </>
          ) : (
            <>
              <PiCaretDown className='size-3' /> More
            </>
          )}
        </button>
      )}
    </div>
  );
};

interface InlineInsightFollowUpPanelProps {
  question: string;
  answer: string;
  loading: boolean;
  error: string;
  onQuestionChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  translate: ReturnType<typeof useTranslation>;
}

const InlineInsightFollowUpPanel: React.FC<InlineInsightFollowUpPanelProps> = ({
  question,
  answer,
  loading,
  error,
  onQuestionChange,
  onSubmit,
  translate,
}) => {
  return (
    <form
      className='border-base-content/10 flex flex-shrink-0 flex-col gap-1.5 border-t pt-2'
      onSubmit={onSubmit}
    >
      <div className='flex items-center gap-1.5'>
        <input
          className='input input-bordered input-sm h-8 min-h-0 flex-1 text-xs'
          value={question}
          placeholder={translate('Ask a follow-up...')}
          onChange={(event) => onQuestionChange(event.target.value)}
        />
        <button
          type='submit'
          className='btn btn-primary btn-sm h-8 min-h-0 px-2'
          disabled={!question.trim() || loading}
        >
          <PiPaperPlaneRight className='size-4' />
        </button>
      </div>
      {(loading || answer || error) && (
        <div className='bg-base-100 border-base-content/10 max-h-20 overflow-y-auto rounded border p-1.5 text-xs leading-relaxed'>
          {error ? (
            <p className='text-error'>{error}</p>
          ) : answer ? (
            <p className='whitespace-pre-wrap'>{answer}</p>
          ) : (
            <div className='flex items-center gap-2'>
              <div className='border-primary size-3 animate-spin rounded-full border-2 border-t-transparent' />
              {translate('Thinking...')}
            </div>
          )}
        </div>
      )}
    </form>
  );
};

const InlineInsightPopup: React.FC<InlineInsightPopupProps> = ({
  selection,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { settings: _settings_store } = useSettingsStore();
  const { appService } = useEnv();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const settings = useMemo(
    () => ({
      ...DEFAULT_INLINE_INSIGHT_SETTINGS,
      ..._settings_store?.inlineInsightSettings,
    }),
    [_settings_store?.inlineInsightSettings],
  );
  const targetLanguage = settings.targetLanguage.trim() || getLocale();

  const [answer, setAnswer] = useState('');
  const { briefItems, detailMap } = parseInlineInsightSections(answer);

  const abortRef = useRef<AbortController | null>(null);
  const contextRef = useRef('');
  const inlineInsightLogger = useMemo<InlineInsightCallLogger | undefined>(() => {
    if (!isInlineInsightDebugLoggingEnabled() || !appService || !isTauriAppPlatform()) {
      return undefined;
    }

    return createInlineInsightTauriLogger(appService);
  }, [appService]);

  const callLLM = useCallback(async () => {
    if (!settings.enabled || !settings.model) return;

    abortRef.current = new AbortController();
    setLoading(true);
    setError('');
    setAnswer('');

    const context = extractContext(selection, settings.maxContextChars);
    contextRef.current = context;

    try {
      for await (const delta of streamInlineInsight(
        selection.text,
        context,
        settings,
        targetLanguage,
        abortRef.current.signal,
        inlineInsightLogger,
      )) {
        setAnswer((prev) => prev + delta);
        setLoading(false);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message || _('Failed to get AI response'));
        setLoading(false);
      }
    }
  }, [selection, settings, inlineInsightLogger, targetLanguage, _]);

  useEffect(() => {
    callLLM();
    return () => {
      abortRef.current?.abort();
      followUpAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const followUpAbortRef = useRef<AbortController | null>(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [followUpAnswer, setFollowUpAnswer] = useState('');
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpError, setFollowUpError] = useState('');

  const handleFollowUpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = followUpQuestion.trim();
    const _invalid = !question || followUpLoading || !settings.enabled || !settings.model;
    if (_invalid) {
      return;
    }

    followUpAbortRef.current?.abort();
    followUpAbortRef.current = new AbortController();
    setFollowUpAnswer('');
    setFollowUpError('');
    setFollowUpLoading(true);

    const context = contextRef.current || extractContext(selection, settings.maxContextChars);
    // Reuse the initial context so follow-up questions stay anchored to the same passage
    // instead of drifting when the DOM selection changes.
    contextRef.current = context;

    try {
      for await (const delta of streamInlineInsightFollowUp(
        question,
        selection.text,
        context,
        answer,
        settings,
        targetLanguage,
        followUpAbortRef.current.signal,
        inlineInsightLogger,
      )) {
        setFollowUpAnswer((prev) => prev + delta);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setFollowUpError((err as Error).message || _('Failed to get AI response'));
      }
    } finally {
      setFollowUpLoading(false);
    }
  };

  const selectedPreview =
    selection.text.length > 60 ? `${selection.text.slice(0, 60)}…` : selection.text;

  return (
    <div>
      <Popup
        width={popupWidth}
        maxHeight={followUpOpen ? popupHeight + 160 : popupHeight}
        position={position}
        trianglePosition={trianglePosition}
        className='select-text'
        onDismiss={onDismiss}
      >
        <div
          className='text-base-content relative flex flex-col gap-2 overflow-hidden p-3'
          style={{
            maxHeight: `${followUpOpen ? popupHeight + 160 : popupHeight}px`,
          }}
        >
          <p className='text-base-content/50 truncate text-[11px] italic'>
            &ldquo;{selectedPreview}&rdquo;
          </p>

          {!settings.enabled ? (
            <p className='text-base-content/60 text-xs'>{_('Enable Inline Insight in Settings')}</p>
          ) : !settings.model ? (
            <p className='text-base-content/60 text-xs'>
              {_('Inline Insight model not configured')}
            </p>
          ) : error ? (
            <p className='text-error text-xs'>{error}</p>
          ) : (
            <div
              className='flex min-h-0 flex-col gap-2 overflow-y-auto pb-6'
              style={{ maxHeight: `${Math.max(120, popupHeight - 44)}px` }}
            >
              {loading && briefItems.length === 0 && (
                <div className='flex items-center gap-2 text-xs'>
                  <div className='border-primary size-4 animate-spin rounded-full border-2 border-t-transparent' />
                  {_('Analyzing...')}
                </div>
              )}
              {briefItems.map((brief, index) => (
                <InsightItem
                  key={`${brief.label}-${index}`}
                  brief={brief}
                  detail={detailMap[brief.label]}
                />
              ))}
            </div>
          )}
          {!followUpOpen && settings.enabled && settings.model && (
            <button
              type='button'
              className='btn btn-circle btn-xs btn-ghost bg-base-100/80 absolute bottom-2 right-2'
              aria-label={_('Ask follow-up')}
              onClick={() => setFollowUpOpen(true)}
            >
              <PiChatCircle className='size-4' />
            </button>
          )}
          {followUpOpen && settings.enabled && settings.model && (
            <InlineInsightFollowUpPanel
              question={followUpQuestion}
              answer={followUpAnswer}
              loading={followUpLoading}
              error={followUpError}
              onQuestionChange={setFollowUpQuestion}
              onSubmit={handleFollowUpSubmit}
              translate={_}
            />
          )}
        </div>
      </Popup>
    </div>
  );
};

export default InlineInsightPopup;
