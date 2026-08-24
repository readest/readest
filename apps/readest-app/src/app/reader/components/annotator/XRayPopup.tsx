'use client';

import React, { useEffect, useState } from 'react';

import Popup from '@/components/Popup';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import type { XRayLookupResult } from '@/services/ai/xray/types';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { Position } from '@/utils/sel';

interface XRayPopupProps {
  term: string;
  bookKey: string;
  currentCfi: string;
  language: string;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
}

const XRayPopup: React.FC<XRayPopupProps> = ({
  term,
  bookKey,
  currentCfi,
  language,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const aiSettings = useSettingsStore((state) => state.settings.aiSettings);
  const getView = useReaderStore((state) => state.getView);
  const [result, setResult] = useState<XRayLookupResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const bookHash = bookKey.split('-')[0] ?? '';

    setResult(null);
    setError('');
    if (!appService || appService.appPlatform !== 'tauri' || !aiSettings?.enabled) {
      setLoading(false);
      return;
    }
    if (!bookHash || !currentCfi || !term.trim()) {
      setLoading(false);
      setError(_('Current reading position is unavailable.'));
      return;
    }

    setLoading(true);
    void import('@/services/ai/xray/XRayService')
      .then(({ getXRayService }) => getXRayService(appService, aiSettings))
      .then((service) => service.lookup(bookHash, currentCfi, term, language))
      .then((lookup) => {
        if (!cancelled) setResult(lookup);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : _('Could not load X-Ray.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [_, aiSettings, appService, bookKey, currentCfi, language, term]);

  const goToEvidence = (startCfi: string | null) => {
    if (!startCfi) return;
    getView(bookKey)?.goTo(startCfi);
    onDismiss?.();
  };

  return (
    <Popup
      width={popupWidth}
      height={popupHeight}
      position={position}
      trianglePosition={trianglePosition}
      className='select-text'
      onDismiss={onDismiss}
    >
      <div className='flex h-full flex-col overflow-hidden rounded-lg'>
        <header className='border-base-content/10 flex items-start justify-between gap-3 border-b px-4 py-3'>
          <div className='min-w-0'>
            <p className='text-base-content/55 text-[10px] font-semibold uppercase tracking-[0.16em]'>
              {_('X-Ray')}
            </p>
            <h2 className='truncate text-sm font-semibold'>{term}</h2>
          </div>
          <span className='eink-bordered border-base-content/15 shrink-0 rounded-full border px-2 py-1 text-[10px]'>
            {_('Through current location')}
          </span>
        </header>

        <div className='min-h-0 flex-1 overflow-y-auto px-4 py-3' aria-live='polite'>
          {loading ? (
            <div className='text-base-content/60 flex h-full items-center justify-center gap-2 text-xs'>
              <span className='loading loading-spinner loading-sm' />
              {_('Looking up selection...')}
            </div>
          ) : error ? (
            <div className='space-y-1.5 text-sm'>
              <p className='font-medium'>{_('Could not load X-Ray.')}</p>
              <p className='text-base-content/60 break-words text-xs'>{error}</p>
            </div>
          ) : !result || result.source === 'none' ? (
            <p className='text-base-content/60 text-sm'>
              {_('No X-Ray match found up to your current location.')}
            </p>
          ) : (
            <div className='space-y-4'>
              <div className='space-y-2'>
                <span className='bg-base-200 eink-bordered inline-flex rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide'>
                  {result.entity?.type ?? _('Book context')}
                </span>
                <p className='text-sm leading-relaxed'>{result.summary}</p>
              </div>

              {result.evidence.length > 0 && (
                <section className='space-y-2' aria-label={_('Evidence')}>
                  <h3 className='text-base-content/55 text-[10px] font-semibold uppercase tracking-[0.14em]'>
                    {_('Evidence')}
                  </h3>
                  {result.evidence.slice(0, 3).map((evidence) => (
                    <button
                      key={`${evidence.unitId}:${evidence.positionIndex}:${evidence.exactQuote}`}
                      type='button'
                      className='eink-bordered border-base-content/15 bg-base-200/45 hover:bg-base-200 w-full rounded-lg border p-2.5 text-left disabled:cursor-default'
                      aria-label={_('Go to quote')}
                      disabled={evidence.inferred || !evidence.startCfi}
                      onClick={() => goToEvidence(evidence.startCfi)}
                    >
                      <span className='line-clamp-3 text-xs leading-relaxed'>
                        &ldquo;{evidence.exactQuote}&rdquo;
                      </span>
                      <span className='text-base-content/50 mt-1.5 block text-[10px]'>
                        {evidence.displayPage === undefined
                          ? _('Position {{position}}', {
                              position: evidence.positionIndex + 1,
                            })
                          : _('Page {{page}}', { page: evidence.displayPage })}
                      </span>
                    </button>
                  ))}
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </Popup>
  );
};

export default XRayPopup;
