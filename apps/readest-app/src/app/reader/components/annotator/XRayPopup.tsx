import React, { useCallback, useEffect, useState } from 'react';

import Popup from '@/components/Popup';
import { Position } from '@/utils/sel';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { DEFAULT_BOOK_SEARCH_CONFIG } from '@/services/constants';
import { lookupTerm } from '@/services/ai/xrayService';
import type { XRayLookupResult } from '@/services/ai/types';
import { eventDispatcher } from '@/utils/event';
import type { BookSearchConfig } from '@/types/book';

interface XRayPopupProps {
  term: string;
  bookKey: string;
  language?: string;
  maxPageIncluded: number;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
}

const XRayPopup: React.FC<XRayPopupProps> = ({
  term,
  bookKey,
  language,
  maxPageIncluded,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { getConfig } = useBookDataStore();
  const { getView } = useReaderStore();
  const aiSettings = settings?.aiSettings;
  const [result, setResult] = useState<XRayLookupResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [jumpingEvidenceKey, setJumpingEvidenceKey] = useState<string | null>(null);

  const summaryText = result?.summary?.trim()
    ? result.summary
    : result?.source === 'entity'
      ? _('No details available yet')
      : result?.source === 'none'
        ? _('No references found yet')
        : '';

  const handleEvidenceJump = useCallback(
    async (quote: string, chunkId: string, page: number) => {
      const view = getView(bookKey);
      if (!view) return;
      const config = getConfig(bookKey);
      const searchConfig = (config?.searchConfig || DEFAULT_BOOK_SEARCH_CONFIG) as BookSearchConfig;
      const query = quote.length > 180 ? quote.slice(0, 180) : quote;
      const evidenceKey = `${chunkId}:${page}`;
      setJumpingEvidenceKey(evidenceKey);

      try {
        const generator = await view.search({
          ...searchConfig,
          scope: 'book',
          query,
          matchCase: false,
          matchWholeWords: false,
        });
        for await (const result of generator) {
          if (typeof result === 'string') continue;
          if ('progress' in result && typeof result.progress === 'number') continue;
          const match = 'subitems' in result ? result.subitems[0] : result;
          if (match?.cfi) {
            view.goTo(match.cfi);
            break;
          }
        }
      } finally {
        view.clearSearch();
        setJumpingEvidenceKey(null);
        onDismiss?.();
      }
    },
    [bookKey, getView, getConfig, onDismiss],
  );

  useEffect(() => {
    if (!term || !aiSettings?.enabled) {
      setResult(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    setResult(null);
    const bookHash = bookKey.split('-')[0] || '';
    if (!bookHash) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    lookupTerm({
      bookHash,
      term,
      maxPageIncluded,
      settings: aiSettings,
      language,
    })
      .then((data) => {
        if (!cancelled) setResult(data);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message || _('Failed to load X-Ray'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [term, bookKey, maxPageIncluded, aiSettings, language, _]);

  const handleSearch = () => {
    eventDispatcher.dispatch('search-term', { term, bookKey });
    onDismiss?.();
  };

  return (
    <div>
      <Popup
        width={popupWidth}
        height={popupHeight}
        position={position}
        trianglePosition={trianglePosition}
        className='select-text'
        onDismiss={onDismiss}
      >
        <div className='text-base-content flex h-full flex-col gap-2 p-3'>
          <div className='flex items-center justify-between gap-2'>
            <div className='text-sm font-semibold'>{term}</div>
            <button className='btn btn-ghost btn-xs' onClick={handleSearch}>
              {_('Search')}
            </button>
          </div>
          {!aiSettings?.enabled ? (
            <p className='text-base-content/60 text-xs'>{_('Enable AI in Settings')}</p>
          ) : loading ? (
            <div className='flex items-center gap-2 text-xs'>
              <div className='border-primary size-4 animate-spin rounded-full border-2 border-t-transparent' />
              {_('Loading X-Ray...')}
            </div>
          ) : error ? (
            <p className='text-error text-xs'>{error}</p>
          ) : result ? (
            <>
              {summaryText && <p className='text-base-content/80 text-xs'>{summaryText}</p>}
              {result.evidence.length > 0 && (
                <div className='text-base-content/60 space-y-1 text-[11px]'>
                  {result.evidence.slice(0, 3).map((evidence, index) => (
                    <button
                      key={`${evidence.chunkId}-${index}`}
                      type='button'
                      className='text-left hover:underline disabled:opacity-60'
                      onClick={() =>
                        handleEvidenceJump(evidence.quote, evidence.chunkId, evidence.page)
                      }
                      disabled={jumpingEvidenceKey === `${evidence.chunkId}:${evidence.page}`}
                      title={_('Jump to quote')}
                    >
                      &ldquo;{evidence.quote}&rdquo; (p.{evidence.page + 1})
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className='text-base-content/60 text-xs'>{_('No X-Ray data yet')}</p>
          )}
        </div>
      </Popup>
    </div>
  );
};

export default XRayPopup;
