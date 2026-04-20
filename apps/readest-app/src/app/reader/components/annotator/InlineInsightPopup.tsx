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
  INLINE_INSIGHT_SEPARATOR,
} from '@/services/inlineInsight/client';
import type { InlineInsightCallLogger } from '@/services/inlineInsight/client';
import {
  createInlineInsightLogFilename,
  formatInlineInsightLog,
} from '@/services/inlineInsight/logging';

interface InlineInsightPopupProps {
  selection: TextSelection;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
}

interface Insight {
  label: string;
  content: string;
}

function parseSection(text: string): Insight[] {
  const seen = new Set<string>();
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((l) => {
      const m = l.match(/^\[([^\]]+)\]\s+(.+)/);
      if (!m) return [];

      const insight = { label: m[1]!, content: m[2]! };
      const key = `${insight.label}\n${insight.content}`;
      if (seen.has(key)) return [];

      seen.add(key);
      return [insight];
    });
}

const InsightItem: React.FC<{ brief: Insight; detail?: string }> = ({ brief, detail }) => {
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

const InlineInsightPopup: React.FC<InlineInsightPopupProps> = ({
  selection,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { appService } = useEnv();
  const inlineInsightSettings = useMemo(
    () => ({
      ...DEFAULT_INLINE_INSIGHT_SETTINGS,
      ...settings?.inlineInsightSettings,
    }),
    [settings?.inlineInsightSettings],
  );
  const targetLanguage = inlineInsightSettings.targetLanguage.trim() || getLocale();

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [followUpAnswer, setFollowUpAnswer] = useState('');
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpError, setFollowUpError] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const followUpAbortRef = useRef<AbortController | null>(null);
  const contextRef = useRef('');

  const sepIdx = text.indexOf(INLINE_INSIGHT_SEPARATOR);
  const briefRaw = sepIdx >= 0 ? text.slice(0, sepIdx) : text;
  const detailRaw = sepIdx >= 0 ? text.slice(sepIdx + INLINE_INSIGHT_SEPARATOR.length) : '';
  const briefItems = parseSection(briefRaw);
  const detailItems = parseSection(detailRaw);
  const detailMap = Object.fromEntries(detailItems.map((d) => [d.label, d.content]));
  const inlineInsightLogger = useMemo<InlineInsightCallLogger | undefined>(() => {
    if (!appService || !isTauriAppPlatform()) return undefined;

    return async (entry) => {
      const filename = createInlineInsightLogFilename(new Date(entry.timestamp));
      const content = formatInlineInsightLog(entry);
      try {
        await appService.writeFile(`logs/inlineinsight/${filename}`, 'None', content);
      } catch (error) {
        try {
          await appService.writeFile(`inlineinsight/${filename}`, 'Log', content);
        } catch (fallbackError) {
          console.error('Failed to write Inline Insight log', error, fallbackError);
        }
      }
    };
  }, [appService]);

  const run = useCallback(async () => {
    if (!inlineInsightSettings.enabled || !inlineInsightSettings.model) return;

    abortRef.current = new AbortController();
    setLoading(true);
    setError('');
    setText('');

    const context = extractContext(selection, inlineInsightSettings.maxContextChars);
    contextRef.current = context;
    try {
      for await (const delta of streamInlineInsight(
        selection.text,
        context,
        inlineInsightSettings,
        targetLanguage,
        abortRef.current.signal,
        inlineInsightLogger,
      )) {
        setText((prev) => prev + delta);
        setLoading(false);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message || _('Failed to get AI response'));
        setLoading(false);
      }
    }
  }, [selection, inlineInsightSettings, inlineInsightLogger, targetLanguage, _]);

  useEffect(() => {
    run();
    return () => {
      abortRef.current?.abort();
      followUpAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFollowUpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = followUpQuestion.trim();
    if (
      !question ||
      followUpLoading ||
      !inlineInsightSettings.enabled ||
      !inlineInsightSettings.model
    ) {
      return;
    }

    followUpAbortRef.current?.abort();
    followUpAbortRef.current = new AbortController();
    setFollowUpAnswer('');
    setFollowUpError('');
    setFollowUpLoading(true);

    const context =
      contextRef.current || extractContext(selection, inlineInsightSettings.maxContextChars);
    contextRef.current = context;

    try {
      for await (const delta of streamInlineInsightFollowUp(
        question,
        selection.text,
        context,
        text,
        inlineInsightSettings,
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

          {!inlineInsightSettings.enabled ? (
            <p className='text-base-content/60 text-xs'>{_('Enable Inline Insight in Settings')}</p>
          ) : !inlineInsightSettings.model ? (
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
          {!followUpOpen && inlineInsightSettings.enabled && inlineInsightSettings.model && (
            <button
              type='button'
              className='btn btn-circle btn-xs btn-ghost bg-base-100/80 absolute bottom-2 right-2'
              aria-label={_('Ask follow-up')}
              onClick={() => setFollowUpOpen(true)}
            >
              <PiChatCircle className='size-4' />
            </button>
          )}
          {followUpOpen && inlineInsightSettings.enabled && inlineInsightSettings.model && (
            <form
              className='border-base-content/10 flex flex-shrink-0 flex-col gap-1.5 border-t pt-2'
              onSubmit={handleFollowUpSubmit}
            >
              <div className='flex items-center gap-1.5'>
                <input
                  className='input input-bordered input-sm h-8 min-h-0 flex-1 text-xs'
                  value={followUpQuestion}
                  placeholder={_('Ask a follow-up...')}
                  onChange={(event) => setFollowUpQuestion(event.target.value)}
                />
                <button
                  type='submit'
                  className='btn btn-primary btn-sm h-8 min-h-0 px-2'
                  disabled={!followUpQuestion.trim() || followUpLoading}
                >
                  <PiPaperPlaneRight className='size-4' />
                </button>
              </div>
              {(followUpLoading || followUpAnswer || followUpError) && (
                <div className='bg-base-100 border-base-content/10 max-h-20 overflow-y-auto rounded border p-1.5 text-xs leading-relaxed'>
                  {followUpError ? (
                    <p className='text-error'>{followUpError}</p>
                  ) : followUpAnswer ? (
                    <p className='whitespace-pre-wrap'>{followUpAnswer}</p>
                  ) : (
                    <div className='flex items-center gap-2'>
                      <div className='border-primary size-3 animate-spin rounded-full border-2 border-t-transparent' />
                      {_('Thinking...')}
                    </div>
                  )}
                </div>
              )}
            </form>
          )}
        </div>
      </Popup>
    </div>
  );
};

export default InlineInsightPopup;
