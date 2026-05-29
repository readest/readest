import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { PiCaretDown, PiCaretUp, PiChatCircle, PiPaperPlaneRight } from 'react-icons/pi';

import Popup from '@/components/Popup';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { Position, TextSelection } from '@/utils/sel';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { getLocale } from '@/utils/misc';
import { getIndexFromCfi } from '@/utils/cfi';
import { createRejectFilter } from '@/utils/node';
import { DEFAULT_INLINE_INSIGHT_SETTINGS } from '@/services/inlineInsight/types';
import { extractContext } from '@/services/inlineInsight/contextExtractor';
import { streamInlineInsight, streamInlineInsightFollowUp } from '@/services/inlineInsight/client';
import {
  parseInlineInsightSections,
  type InlineInsightItem,
} from '@/services/inlineInsight/parser';
import type { BookSearchConfig, BookSearchMatch, BookSearchResult } from '@/types/book';

interface InlineInsightPopupProps {
  bookKey: string;
  selection: TextSelection;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  initialAnswer?: string;
  initialContext?: string;
  onAnswerReady?: (answer: string, context: string) => void;
  onDismiss?: () => void;
}

const InsightItem: React.FC<{
  brief: InlineInsightItem;
  detail?: string;
  actionSlot?: React.ReactNode;
}> = ({ brief, detail, actionSlot }) => {
  const [expanded, setExpanded] = useState(false);
  const [stableDetail, setStableDetail] = useState(detail ?? '');
  const canToggleDetail = Boolean(stableDetail);
  const hasActions = Boolean(canToggleDetail || actionSlot);

  useEffect(() => {
    // Detail text arrives incrementally while streaming. Keep the longest parsed version so
    // temporary parser gaps do not collapse an expanded item back to its brief text.
    if (detail && detail.length >= stableDetail.length) {
      setStableDetail(detail);
    }
  }, [detail, stableDetail.length]);

  return (
    <div className='rounded p-1'>
      <p className='text-base-content/80 select-text text-xs leading-relaxed'>
        <span className='text-base-content mr-1 font-semibold'>[{brief.label}]</span>
        {expanded && canToggleDetail ? stableDetail : brief.content}
      </p>
      {hasActions && (
        <div className='mt-1 flex items-center justify-between gap-2'>
          <div className='min-w-0'>
            {canToggleDetail && (
              <button
                type='button'
                className='text-base-content/50 flex items-center gap-0.5 text-[10px] hover:underline'
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
          {actionSlot}
        </div>
      )}
    </div>
  );
};

const hasMarkdownFeatures = (text: string) => {
  return (
    /(^|\n)\s{0,3}#{1,6}\s+\S/.test(text) ||
    /(^|\n)\s{0,3}([-*+]|\d+\.)\s+\S/.test(text) ||
    /(^|\n)\s{0,3}>\s+\S/.test(text) ||
    /```[\s\S]*```/.test(text) ||
    /`[^`\n]+`/.test(text) ||
    /\*\*[^*\n]+\*\*/.test(text) ||
    /__[^_\n]+__/.test(text) ||
    /\[[^\]\n]+\]\([^)]+\)/.test(text) ||
    /(^|\n)\|.+\|/.test(text)
  );
};

const FollowUpAnswer: React.FC<{ answer: string }> = ({ answer }) => {
  const shouldRenderMarkdown = hasMarkdownFeatures(answer);
  const html = useMemo(() => {
    if (!shouldRenderMarkdown) return '';
    return DOMPurify.sanitize(marked.parse(answer) as string);
  }, [answer, shouldRenderMarkdown]);

  if (shouldRenderMarkdown) {
    return (
      <div
        className='prose prose-xs text-base-content [&_*]:!text-base-content [&_a]:!text-primary [&_code]:bg-base-300 max-w-none select-text text-xs leading-relaxed [&_code]:rounded [&_code]:px-1'
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return <p className='whitespace-pre-wrap'>{answer}</p>;
};

interface InlineInsightFollowUpPanelProps {
  turns: FollowUpTurn[];
  question: string;
  loading: boolean;
  onQuestionChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  translate: ReturnType<typeof useTranslation>;
}

interface FollowUpTurn {
  question: string;
  answer: string;
  error: string;
  loading: boolean;
}

interface SearchContextHit {
  cfi: string;
  index: number | null;
  excerpt: string;
  query: string;
}

const MAX_SEARCH_CONTEXT_HITS = 6;
const MAX_SEARCH_HITS_PER_QUERY = 20;
const MAX_SECTION_SWEEP_STEPS = 120;

const collapseWs = (text: string): string => text.replace(/\s+/g, ' ').trim();

const formatExcerpt = (match: BookSearchMatch): string => {
  const pre = collapseWs(match.excerpt.pre || '');
  const mid = collapseWs(match.excerpt.match || '');
  const post = collapseWs(match.excerpt.post || '');
  return `${pre}${pre ? ' ' : ''}[${mid}]${post ? ` ${post}` : ''}`.trim();
};

const isCjkText = (text: string): boolean => /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
const CJK_SEARCH_CHAR_LIMIT = 10;
const EN_SEARCH_WORD_LIMIT = 4;

const shouldSearchBySelectionLength = (text: string): boolean => {
  const raw = collapseWs(text);
  if (!raw) return false;

  if (isCjkText(raw)) {
    const cjkChars = (raw.match(/[\u3040-\u30ff\u3400-\u9fff]/g) || []).length;
    return cjkChars <= CJK_SEARCH_CHAR_LIMIT;
  }

  const words = raw
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  return words.length <= EN_SEARCH_WORD_LIMIT;
};

const extractMatchesFromResult = (result: BookSearchResult): BookSearchMatch[] => {
  return Array.isArray(result.subitems) ? result.subitems : [];
};

function* iterateBackwardSections(centerIndex: number | null): Generator<number | undefined> {
  if (centerIndex === null || centerIndex < 0) {
    yield undefined;
    return;
  }
  for (let step = 0; step <= MAX_SECTION_SWEEP_STEPS; step += 1) {
    const index = centerIndex - step;
    if (index < 0) break;
    yield index;
  }
}

const InlineInsightFollowUpPanel: React.FC<InlineInsightFollowUpPanelProps> = ({
  turns,
  question,
  loading,
  onQuestionChange,
  onSubmit,
  translate,
}) => {
  return (
    <form
      className='border-base-content/10 bg-base-200/50 flex flex-shrink-0 flex-col gap-2 rounded-lg border p-2'
      onSubmit={onSubmit}
    >
      <div className='flex items-center justify-between gap-2'>
        <div className='text-base-content/70 flex items-center gap-1 text-[11px] font-medium'>
          <PiChatCircle className='size-3.5' />
          {translate('Follow-up')}
        </div>
        {loading && (
          <span className='text-base-content/50 text-[10px]'>{translate('Thinking...')}</span>
        )}
      </div>
      {turns.length > 0 && (
        <div className='border-base-content/10 bg-base-300/55 max-h-36 overflow-y-auto rounded-md border px-2 py-1.5 text-xs leading-relaxed shadow-inner'>
          <div className='space-y-2'>
            {turns.map((turn, index) => (
              <div key={`${turn.question}-${index}`} className='space-y-1'>
                <p className='text-base-content/80'>
                  <span className='font-semibold'>Q:</span> {turn.question}
                </p>
                <div className='text-base-content'>
                  {turn.error ? (
                    <p className='text-error'>{turn.error}</p>
                  ) : turn.answer ? (
                    <FollowUpAnswer answer={turn.answer} />
                  ) : turn.loading ? (
                    <div className='flex items-center gap-2'>
                      <div className='border-primary size-3 animate-spin rounded-full border-2 border-t-transparent' />
                      {translate('Thinking...')}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className='flex items-center gap-1.5'>
        <input
          className='input input-bordered input-sm bg-base-100/60 focus:bg-base-100 h-8 min-h-0 flex-1 text-xs'
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
    </form>
  );
};

const InlineInsightPopup: React.FC<InlineInsightPopupProps> = ({
  bookKey,
  selection,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  initialAnswer = '',
  initialContext = '',
  onAnswerReady,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { settings: _settings_store } = useSettingsStore();
  const { getView } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const [loading, setLoading] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState('');

  const settings = useMemo(
    () => ({
      ...DEFAULT_INLINE_INSIGHT_SETTINGS,
      ..._settings_store?.inlineInsightSettings,
    }),
    [_settings_store?.inlineInsightSettings],
  );
  const targetLanguage = settings.targetLanguage.trim() || getLocale();

  const [answer, setAnswer] = useState(initialAnswer);
  const { briefItems, detailMap } = parseInlineInsightSections(answer);

  const abortRef = useRef<AbortController | null>(null);
  const contextRef = useRef(initialContext);

  const collectKeywordSearchContext = useCallback(async (): Promise<string> => {
    const view = getView(bookKey);
    if (!view?.search) return '';

    const bookData = getBookData(bookKey);
    const primaryLang = bookData?.book?.primaryLanguage || 'en';
    const acceptNode = createRejectFilter({
      tags: primaryLang.startsWith('ja') ? ['rt'] : [],
    });

    const searchConfig: BookSearchConfig = {
      scope: 'section',
      matchCase: false,
      matchWholeWords: false,
      matchDiacritics: false,
    };

    const targetIndex = selection.index ?? (selection.cfi ? getIndexFromCfi(selection.cfi) : null);
    if (!shouldSearchBySelectionLength(selection.text)) {
      return '';
    }
    const timeoutMs = Math.max(100, settings.searchTimeoutMs || 1000);
    const startMs = Date.now();
    const fullSelectionQuery = collapseWs(selection.text).slice(0, 120);
    const queries = fullSelectionQuery ? [fullSelectionQuery] : [];
    const byCfi = new Map<string, SearchContextHit>();

    for (const query of queries) {
      let collected = 0;
      for (const sectionIndex of iterateBackwardSections(targetIndex)) {
        if (Date.now() - startMs >= timeoutMs) break;
        let generator: AsyncGenerator<BookSearchResult | string, void, void>;
        try {
          generator = await view.search({
            ...searchConfig,
            index: sectionIndex,
            query,
            acceptNode,
          });
        } catch {
          // Out-of-range section index or transient view error. Keep sweeping.
          continue;
        }

        for await (const result of generator) {
          if (Date.now() - startMs >= timeoutMs) break;
          if (typeof result === 'string') {
            if (result === 'done') break;
            continue;
          }
          if ('progress' in result && result.progress) continue;

          const matches: BookSearchMatch[] =
            'subitems' in result ? extractMatchesFromResult(result as BookSearchResult) : [result];
          for (const match of matches) {
            const cfi = match.cfi;
            if (!cfi || byCfi.has(cfi)) continue;

            byCfi.set(cfi, {
              cfi,
              index: getIndexFromCfi(cfi),
              excerpt: formatExcerpt(match),
              query,
            });
            collected += 1;
            if (collected >= MAX_SEARCH_HITS_PER_QUERY) break;
          }
          if (collected >= MAX_SEARCH_HITS_PER_QUERY) break;
        }
        if (collected >= MAX_SEARCH_HITS_PER_QUERY) break;
      }
    }

    if (byCfi.size === 0) return '';

    const hits = [...byCfi.values()]
      .sort((a, b) => {
        if (targetIndex === null) return 0;
        const da = a.index === null ? Number.MAX_SAFE_INTEGER : Math.abs(a.index - targetIndex);
        const db = b.index === null ? Number.MAX_SAFE_INTEGER : Math.abs(b.index - targetIndex);
        if (da !== db) return da - db;
        return a.excerpt.length - b.excerpt.length;
      })
      .slice(0, MAX_SEARCH_CONTEXT_HITS);

    const lines = hits.map((hit, i) => {
      const proximity =
        targetIndex === null || hit.index === null
          ? ''
          : ` (distance ${Math.abs(hit.index - targetIndex)})`;
      return `${i + 1}. [${hit.query}]${proximity}: ${hit.excerpt}`;
    });

    return `\n\nRelated Passages (keyword search, nearest first):\n${lines.join('\n')}`;
  }, [
    bookKey,
    getBookData,
    getView,
    selection.cfi,
    selection.index,
    selection.text,
    settings.searchTimeoutMs,
  ]);

  const callLLM = useCallback(async () => {
    if (!settings.enabled || !settings.model) return;
    if (initialAnswer) return;

    abortRef.current = new AbortController();
    setLoading(true);
    setThinking(false);
    setError('');
    setAnswer('');

    const localContext = extractContext(selection, settings.maxContextChars);
    const keywordContext = await collectKeywordSearchContext();
    const context = `${localContext}${keywordContext}`;
    contextRef.current = context;

    let responseText = '';
    try {
      for await (const chunk of streamInlineInsight(
        selection.text,
        context,
        settings,
        targetLanguage,
        abortRef.current.signal,
      )) {
        if (chunk.type === 'reasoning') {
          setThinking(true);
          continue;
        }
        responseText += chunk.text;
        setAnswer(responseText);
        setLoading(false);
      }
      if (responseText.trim()) {
        onAnswerReady?.(responseText, context);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message || _('Failed to get AI response'));
      }
    } finally {
      setLoading(false);
    }
  }, [
    selection,
    settings,
    targetLanguage,
    _,
    initialAnswer,
    onAnswerReady,
    collectKeywordSearchContext,
  ]);

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
  const [followUpTurns, setFollowUpTurns] = useState<FollowUpTurn[]>([]);
  const [followUpLoading, setFollowUpLoading] = useState(false);

  const handleFollowUpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = followUpQuestion.trim();
    const _invalid = !question || followUpLoading || !settings.enabled || !settings.model;
    if (_invalid) {
      return;
    }

    followUpAbortRef.current?.abort();
    followUpAbortRef.current = new AbortController();
    setFollowUpLoading(true);
    setFollowUpQuestion('');

    const turnIndex = followUpTurns.length;
    const historyBefore = followUpTurns;
    setFollowUpTurns((prev) => [...prev, { question, answer: '', error: '', loading: true }]);

    const context = contextRef.current || extractContext(selection, settings.maxContextChars);
    // Reuse the initial context so follow-up questions stay anchored to the same passage
    // instead of drifting when the DOM selection changes.
    contextRef.current = context;
    const previousAnswer = [
      answer.trim(),
      ...historyBefore
        .filter((turn) => turn.question.trim() && (turn.answer.trim() || turn.error.trim()))
        .map((turn) =>
          turn.error.trim()
            ? `Q: ${turn.question}\nA: [Error] ${turn.error}`
            : `Q: ${turn.question}\nA: ${turn.answer}`,
        ),
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      for await (const chunk of streamInlineInsightFollowUp(
        question,
        selection.text,
        context,
        previousAnswer,
        settings,
        targetLanguage,
        followUpAbortRef.current.signal,
      )) {
        if (chunk.type === 'content') {
          setFollowUpTurns((prev) =>
            prev.map((turn, index) =>
              index === turnIndex ? { ...turn, answer: turn.answer + chunk.text } : turn,
            ),
          );
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const message = (err as Error).message || _('Failed to get AI response');
        setFollowUpTurns((prev) =>
          prev.map((turn, index) =>
            index === turnIndex ? { ...turn, error: message, loading: false } : turn,
          ),
        );
      }
    } finally {
      setFollowUpTurns((prev) =>
        prev.map((turn, index) => (index === turnIndex ? { ...turn, loading: false } : turn)),
      );
      setFollowUpLoading(false);
    }
  };

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
          className='text-base-content relative flex flex-col gap-2 overflow-hidden p-2.5'
          style={{
            maxHeight: `${followUpOpen ? popupHeight + 160 : popupHeight}px`,
          }}
        >
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
              className='flex min-h-0 flex-col gap-1.5 overflow-y-auto'
              style={{ maxHeight: `${Math.max(120, popupHeight - (followUpOpen ? 60 : 20))}px` }}
            >
              {loading && briefItems.length === 0 && (
                <div className='flex items-center gap-2 text-xs'>
                  <div className='border-primary size-4 animate-spin rounded-full border-2 border-t-transparent' />
                  {thinking ? _('Thinking...') : _('Analyzing...')}
                </div>
              )}
              {briefItems.map((brief, index) => (
                <InsightItem
                  key={`${brief.label}-${index}`}
                  brief={brief}
                  detail={detailMap[brief.label]}
                  actionSlot={
                    !followUpOpen &&
                    settings.enabled &&
                    settings.model &&
                    index === briefItems.length - 1 && (
                      <button
                        type='button'
                        className='text-base-content/50 flex shrink-0 items-center gap-1 text-[10px] hover:underline'
                        aria-label={_('Ask follow-up')}
                        onClick={() => setFollowUpOpen(true)}
                      >
                        <PiChatCircle className='size-3.5' />
                        {_('Follow-up')}
                      </button>
                    )
                  }
                />
              ))}
              {!loading && briefItems.length === 0 && (
                <button
                  type='button'
                  className='text-base-content/50 flex items-center justify-end gap-1 text-[10px] hover:underline'
                  aria-label={_('Ask follow-up')}
                  onClick={() => setFollowUpOpen(true)}
                >
                  <PiChatCircle className='size-3.5' />
                  {_('Follow-up')}
                </button>
              )}
            </div>
          )}
          {followUpOpen && settings.enabled && settings.model && (
            <InlineInsightFollowUpPanel
              turns={followUpTurns}
              question={followUpQuestion}
              loading={followUpLoading}
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
