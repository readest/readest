'use client';

import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { IoClose, IoRefresh } from 'react-icons/io5';

import ModalPortal from '@/components/ModalPortal';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { loadSubscriptionState, saveSubscriptionState } from '@/services/opds';
import type { FailedEntry, OPDSSubscriptionState } from '@/services/opds/types';
import { eventDispatcher } from '@/utils/event';

interface Props {
  catalogId: string;
  catalogName: string;
  onClose: () => void;
}

export function FailedDownloadsDialog({ catalogId, catalogName, onClose }: Props) {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [state, setState] = useState<OPDSSubscriptionState | null>(null);

  useEffect(() => {
    if (!appService) return;
    let cancelled = false;
    const refresh = async () => {
      const next = await loadSubscriptionState(appService, catalogId);
      if (!cancelled) setState(next);
    };
    refresh();
    const handler = () => {
      refresh();
    };
    eventDispatcher.on('opds-sync-complete', handler);
    return () => {
      cancelled = true;
      eventDispatcher.off('opds-sync-complete', handler);
    };
  }, [appService, catalogId]);

  if (!appService || !state) return null;

  const persist = async (next: OPDSSubscriptionState) => {
    setState(next);
    await saveSubscriptionState(appService, next);
  };

  const retryEntry = async (entry: FailedEntry) => {
    await persist({
      ...state,
      failedEntries: state.failedEntries.map((fe) =>
        fe.entryId === entry.entryId ? { ...fe, lastAttemptAt: 0 } : fe,
      ),
    });
    eventDispatcher.dispatch('check-opds-subscriptions');
  };

  const skipEntry = async (entry: FailedEntry) => {
    await persist({
      ...state,
      failedEntries: state.failedEntries.filter((fe) => fe.entryId !== entry.entryId),
      knownEntryIds: state.knownEntryIds.includes(entry.entryId)
        ? state.knownEntryIds
        : [...state.knownEntryIds, entry.entryId],
    });
  };

  const retryAll = async () => {
    await persist({
      ...state,
      failedEntries: state.failedEntries.map((fe) => ({ ...fe, lastAttemptAt: 0 })),
    });
    eventDispatcher.dispatch('check-opds-subscriptions');
  };

  const skipAll = async () => {
    const skipped = state.failedEntries.map((fe) => fe.entryId);
    const knownSet = new Set(state.knownEntryIds);
    for (const id of skipped) knownSet.add(id);
    await persist({
      ...state,
      failedEntries: [],
      knownEntryIds: Array.from(knownSet),
    });
  };

  const failed = state.failedEntries;

  return (
    <ModalPortal>
      <dialog className='modal modal-open'>
        <div className='modal-box max-w-lg'>
          <div className='mb-4 flex items-start justify-between gap-4'>
            <div className='min-w-0'>
              <h3 className='font-bold'>{_('Failed downloads')}</h3>
              <p className='text-base-content/60 truncate text-xs'>{catalogName}</p>
            </div>
            <button
              type='button'
              onClick={onClose}
              className='btn btn-ghost btn-sm btn-circle'
              aria-label={_('Close')}
            >
              <IoClose className='h-4 w-4' />
            </button>
          </div>

          {failed.length === 0 ? (
            <p className='text-base-content/60 py-8 text-center text-sm'>
              {_('No failed downloads')}
            </p>
          ) : (
            <ul className='max-h-96 space-y-2 overflow-y-auto'>
              {failed.map((entry) => (
                <li
                  key={entry.entryId}
                  className='border-base-300 flex items-start justify-between gap-3 rounded border p-3'
                >
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-sm font-medium'>{entry.title}</p>
                    <p className='text-base-content/60 truncate text-xs'>{entry.href}</p>
                    <p className='text-base-content/50 mt-1 text-xs'>
                      {_('Attempts: {{count}}', { count: entry.attempts })}
                      {' · '}
                      {dayjs(entry.lastAttemptAt).fromNow()}
                    </p>
                  </div>
                  <div className='flex flex-shrink-0 flex-col gap-1'>
                    <button
                      type='button'
                      onClick={() => retryEntry(entry)}
                      className='btn btn-xs btn-primary'
                    >
                      <IoRefresh className='h-3 w-3' />
                      {_('Retry')}
                    </button>
                    <button type='button' onClick={() => skipEntry(entry)} className='btn btn-xs'>
                      {_('Skip')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {failed.length > 0 && (
            <div className='modal-action'>
              <button type='button' onClick={skipAll} className='btn btn-sm'>
                {_('Skip all')}
              </button>
              <button type='button' onClick={retryAll} className='btn btn-sm btn-primary'>
                {_('Retry all')}
              </button>
            </div>
          )}
        </div>
      </dialog>
    </ModalPortal>
  );
}
