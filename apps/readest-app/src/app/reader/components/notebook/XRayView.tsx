'use client';

import clsx from 'clsx';
import React, { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import {
  LuBookOpen,
  LuChevronDown,
  LuClock3,
  LuGitFork,
  LuQuote,
  LuRefreshCw,
  LuSearch,
  LuShieldCheck,
} from 'react-icons/lu';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import type { AISettings } from '@/services/ai/types';
import type { XRaySourceStatus } from '@/services/ai/xray/source/ReedyXRaySource';
import type {
  XRayClaimStatus,
  XRayEntity,
  XRayEntityType,
  XRayEvidenceLocator,
  XRaySnapshot,
} from '@/services/ai/xray/types';
import { useBookDataStore } from '@/store/bookDataStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { formatTitle, getContributorNames } from '@/utils/book';
import { eventDispatcher } from '@/utils/event';

interface XRayViewProps {
  bookKey: string;
}

type ExplorerTab = 'entities' | 'timeline' | 'relationships' | 'claims';

const XRayView: React.FC<XRayViewProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const bookHash = bookKey.split('-')[0] ?? '';
  const bookDoc = useBookDataStore((state) => state.booksData[bookHash]?.bookDoc ?? null);
  const progress = useBookProgress(bookKey);
  const getView = useReaderStore((state) => state.getView);
  const aiSettings = useSettingsStore((state) => state.settings.aiSettings);
  const [activeTab, setActiveTab] = useState<ExplorerTab>('entities');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const [status, setStatus] = useState<XRaySourceStatus | null>(null);
  const [loadedSnapshot, setSnapshot] = useState<XRaySnapshot | null>(null);
  const [snapshotCfi, setSnapshotCfi] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const currentCfi = progress?.location ?? '';

  const load = useCallback(
    async (showLoading = true): Promise<void> => {
      if (
        !appService ||
        appService.appPlatform !== 'tauri' ||
        !aiSettings?.enabled ||
        !aiSettings.reedy?.enabled ||
        !hasCredentials(aiSettings) ||
        !bookHash ||
        !currentCfi
      ) {
        setIsLoading(false);
        return;
      }
      const id = ++requestId.current;
      if (showLoading) {
        setIsLoading(true);
        setStatus(null);
        setSnapshot(null);
        setSnapshotCfi(null);
      }
      setError(null);
      try {
        const { getXRayService } = await import('@/services/ai/xray/XRayService');
        const service = await getXRayService(appService, aiSettings);
        const nextStatus = await service.getStatus(bookHash);
        const nextSnapshot =
          nextStatus.kind === 'ready' ? await service.getSnapshot(bookHash, currentCfi) : null;
        if (id !== requestId.current) return;
        setStatus(nextStatus);
        setSnapshot(nextSnapshot);
        setSnapshotCfi(nextSnapshot ? currentCfi : null);
      } catch {
        if (id !== requestId.current) return;
        setError(_('Failed to load X-Ray'));
      } finally {
        if (id === requestId.current) setIsLoading(false);
      }
    },
    [_, aiSettings, appService, bookHash, currentCfi],
  );

  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  useEffect(() => {
    const handleUpdate = (event: CustomEvent) => {
      if (event.detail?.bookHash === bookHash) void load(false);
    };
    eventDispatcher.on('xray-updated', handleUpdate);
    return () => eventDispatcher.off('xray-updated', handleUpdate);
  }, [bookHash, load]);

  useEffect(() => {
    if (status?.kind !== 'indexing') return;
    const timer = setTimeout(() => void load(false), 1_500);
    return () => clearTimeout(timer);
  }, [load, status?.kind]);

  const update = async (): Promise<void> => {
    if (!appService || !bookDoc || !currentCfi || !aiSettings?.reedy?.enabled) return;
    setIsUpdating(true);
    setError(null);
    try {
      const { getXRayService } = await import('@/services/ai/xray/XRayService');
      const service = await getXRayService(appService, aiSettings);
      const result = await service.updateForProgress({
        bookHash,
        currentCfi,
        metadata: {
          title: formatTitle(bookDoc.metadata.title),
          description: bookDoc.metadata.description,
          subject: getContributorNames(bookDoc.metadata.subject),
        },
      });
      if (result.kind === 'updated') {
        void eventDispatcher.dispatch('xray-updated', {
          bookHash,
          maxPositionIndex: result.maxPositionIndex,
        });
      } else if (result.kind === 'unavailable') {
        await load(false);
      }
    } catch {
      setError(_('X-Ray update failed.'));
    } finally {
      setIsUpdating(false);
    }
  };

  const navigateToEvidence = (evidence: XRayEvidenceLocator): void => {
    if (evidence.inferred || !evidence.startCfi) return;
    getView(bookKey)?.goTo(evidence.startCfi);
  };
  const snapshot = snapshotCfi === currentCfi ? loadedSnapshot : null;

  if (appService?.appPlatform !== 'tauri') {
    return null;
  }
  if (!aiSettings?.enabled) {
    return <CenteredMessage>{_('Enable AI in Settings to use X-Ray')}</CenteredMessage>;
  }
  if (!aiSettings.reedy?.enabled) return null;
  if (!hasCredentials(aiSettings)) {
    return (
      <CenteredMessage>{_('Configure the selected AI provider to use X-Ray')}</CenteredMessage>
    );
  }
  if (!currentCfi) {
    return <CenteredMessage>{_('Open a readable page to use X-Ray')}</CenteredMessage>;
  }
  if (isLoading) {
    return (
      <div className='flex h-full items-center justify-center' aria-label={_('Loading X-Ray')}>
        <span className='loading loading-spinner loading-sm eink:hidden' />
        <span className='hidden text-sm eink:inline'>{_('Loading X-Ray')}</span>
      </div>
    );
  }
  if (error && !snapshot) {
    return (
      <CenteredMessage>
        <span role='alert'>{error}</span>
      </CenteredMessage>
    );
  }

  if (status?.kind !== 'ready' || !snapshot) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-4 px-6 text-center'>
        <div className='border-base-300 bg-base-100/50 eink-bordered flex size-11 items-center justify-center rounded-full border'>
          <LuBookOpen className='size-5' aria-hidden='true' />
        </div>
        <div>
          <p className='text-sm font-semibold'>{statusTitle(status, _)}</p>
          <p className='text-base-content/60 mt-1 text-xs leading-relaxed'>
            {statusDescription(status, _)}
          </p>
        </div>
      </div>
    );
  }

  const filteredEntities = snapshot.entities.filter((entity) => {
    if (!deferredQuery) return true;
    return [
      entity.name,
      entity.description,
      ...entity.aliases,
      ...entity.facts.flatMap((fact) => [fact.key, fact.value]),
    ]
      .join(' ')
      .toLocaleLowerCase()
      .includes(deferredQuery);
  });
  const tabs: Array<{ id: ExplorerTab; label: string; count: number }> = [
    { id: 'entities', label: _('Entities'), count: snapshot.entities.length },
    { id: 'timeline', label: _('Timeline'), count: snapshot.events.length },
    { id: 'relationships', label: _('Links'), count: snapshot.relationships.length },
    { id: 'claims', label: _('Claims'), count: snapshot.claims.length },
  ];
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex]!.id;
    setActiveTab(nextTab);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      .item(nextIndex)
      .focus();
  };

  return (
    <section className='flex min-h-0 flex-1 flex-col' aria-label={_('X-Ray')}>
      <header className='border-base-300/60 border-b px-3 pb-3 eink:border-base-content'>
        <div className='flex items-center justify-between gap-3'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <LuShieldCheck className='text-base-content/60 size-4' aria-hidden='true' />
              <h2 className='truncate text-sm font-semibold'>{_('Spoiler-safe X-Ray')}</h2>
            </div>
            <p className='text-base-content/55 mt-1 text-[11px] tabular-nums'>
              {_('Read through position {{position}}', { position: snapshot.maxPositionIndex + 1 })}
            </p>
          </div>
          <button
            type='button'
            className='btn btn-ghost btn-sm eink-bordered size-9 min-h-9 p-0'
            onClick={update}
            disabled={isUpdating}
            aria-label={_('Update X-Ray')}
            title={_('Update X-Ray')}
          >
            {isUpdating ? (
              <>
                <span className='loading loading-spinner loading-xs eink:hidden' />
                <LuRefreshCw className='hidden size-4 eink:block' aria-hidden='true' />
              </>
            ) : (
              <LuRefreshCw className='size-4' aria-hidden='true' />
            )}
          </button>
        </div>
        {error ? (
          <p className='text-error mt-2 text-xs' role='alert'>
            {error}
          </p>
        ) : null}
      </header>

      <div
        className='border-base-300/50 flex gap-1 overflow-x-auto border-b px-3 py-2 eink:border-base-content'
        role='tablist'
        aria-label={_('X-Ray sections')}
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type='button'
            role='tab'
            id={`xray-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`xray-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={clsx(
              'min-h-8 shrink-0 rounded-md px-2 py-1 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15',
              activeTab === tab.id
                ? 'bg-base-300 text-base-content'
                : 'text-base-content/60 hover:bg-base-300/50',
            )}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {tab.label}{' '}
            <span className='tabular-nums opacity-60 eink:opacity-100'>{tab.count}</span>
          </button>
        ))}
      </div>

      <div
        id={`xray-panel-${activeTab}`}
        role='tabpanel'
        aria-labelledby={`xray-tab-${activeTab}`}
        className='min-h-0 flex-1 overflow-y-auto px-3 py-3'
      >
        {activeTab === 'entities' ? (
          <div className='space-y-3'>
            <label className='input input-sm input-bordered eink-bordered flex h-9 items-center gap-2'>
              <LuSearch className='text-base-content/45 size-4' aria-hidden='true' />
              <span className='sr-only'>{_('Search entities')}</span>
              <input
                type='search'
                className='grow'
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={_('Search entities')}
              />
            </label>
            {filteredEntities.length ? (
              filteredEntities.map((entity) => (
                <EntityCard
                  key={`${entity.type}:${entity.name}`}
                  entity={entity}
                  onNavigate={navigateToEvidence}
                  translate={_}
                />
              ))
            ) : (
              <EmptyResult icon={LuBookOpen} label={_('No matching entities')} />
            )}
          </div>
        ) : null}

        {activeTab === 'timeline' ? (
          snapshot.events.length ? (
            <ol className='relative ms-2 border-s border-base-300/80 ps-4'>
              {snapshot.events.map((event) => (
                <li
                  key={`${event.summary}:${event.evidence[0]?.unitId ?? ''}`}
                  className='pb-5 last:pb-0'
                >
                  <span className='bg-base-content absolute -ms-[1.18rem] mt-1.5 size-2 rounded-full' />
                  <p className='text-sm leading-relaxed'>{event.summary}</p>
                  <p className='text-base-content/50 mt-1 text-[11px]'>
                    {_('Importance {{importance}} of 10', { importance: event.importance })}
                  </p>
                  <EvidenceList
                    evidence={event.evidence}
                    onNavigate={navigateToEvidence}
                    translate={_}
                  />
                </li>
              ))}
            </ol>
          ) : (
            <EmptyResult icon={LuClock3} label={_('No timeline events yet')} />
          )
        ) : null}

        {activeTab === 'relationships' ? (
          snapshot.relationships.length ? (
            <div className='space-y-2'>
              {snapshot.relationships.map((relationship) => (
                <article
                  key={`${relationship.source}:${relationship.target}:${relationship.type}`}
                  className='border-base-300/70 bg-base-100/35 eink-bordered rounded-lg border p-3'
                >
                  <div className='flex flex-wrap items-center gap-1.5 text-sm font-semibold'>
                    <span>{relationship.source}</span>
                    <span
                      className='text-base-content/35 inline-block rtl:rotate-180'
                      aria-hidden='true'
                    >
                      →
                    </span>
                    <span>{relationship.target}</span>
                  </div>
                  <p className='text-base-content/50 mt-1 text-[10px] font-semibold uppercase tracking-wide'>
                    {relationship.type}
                  </p>
                  {relationship.description ? (
                    <p className='text-base-content/75 mt-2 text-xs leading-relaxed'>
                      {relationship.description}
                    </p>
                  ) : null}
                  <EvidenceList
                    evidence={relationship.evidence}
                    onNavigate={navigateToEvidence}
                    translate={_}
                  />
                </article>
              ))}
            </div>
          ) : (
            <EmptyResult icon={LuGitFork} label={_('No relationships yet')} />
          )
        ) : null}

        {activeTab === 'claims' ? (
          snapshot.claims.length ? (
            <div className='space-y-2'>
              {snapshot.claims.map((claim) => (
                <article
                  key={`${claim.type}:${claim.description}`}
                  className='border-base-300/70 bg-base-100/35 eink-bordered rounded-lg border p-3'
                >
                  <div className='flex items-center justify-between gap-2'>
                    <p className='text-[10px] font-semibold uppercase tracking-wide'>
                      {claim.type}
                    </p>
                    {claim.status ? (
                      <span className='text-base-content/50 text-[10px] uppercase'>
                        {claimStatusLabel(claim.status, _)}
                      </span>
                    ) : null}
                  </div>
                  <p className='mt-2 text-sm leading-relaxed'>{claim.description}</p>
                  <EvidenceList
                    evidence={claim.evidence}
                    onNavigate={navigateToEvidence}
                    translate={_}
                  />
                </article>
              ))}
            </div>
          ) : (
            <EmptyResult icon={LuQuote} label={_('No claims yet')} />
          )
        ) : null}
      </div>
    </section>
  );
};

const EntityCard = ({
  entity,
  onNavigate,
  translate: _,
}: {
  entity: XRayEntity;
  onNavigate: (evidence: XRayEvidenceLocator) => void;
  translate: ReturnType<typeof useTranslation>;
}) => (
  <details className='group border-base-300/70 bg-base-100/35 eink-bordered rounded-lg border'>
    <summary className='cursor-pointer list-none rounded-lg px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15 [&::-webkit-details-marker]:hidden'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='text-sm font-semibold'>{entity.name}</span>
            <span className='text-base-content/45 text-[10px] font-semibold uppercase tracking-wide'>
              {entityTypeLabel(entity.type, _)}
            </span>
          </div>
          <p className='text-base-content/70 mt-1 text-xs leading-relaxed'>
            {entity.description || _('No details available yet')}
          </p>
        </div>
        <LuChevronDown
          className='text-base-content/40 mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-180'
          aria-hidden='true'
        />
      </div>
    </summary>
    <div className='border-base-300/60 border-t px-3 py-3 eink:border-base-content'>
      {entity.aliases.length ? (
        <p className='text-base-content/60 text-[11px]'>
          {_('Also known as')}: {entity.aliases.join(', ')}
        </p>
      ) : null}
      {entity.facts.length ? (
        <dl className='mt-3 space-y-2'>
          {entity.facts.map((fact) => (
            <div key={`${fact.key}:${fact.value}`}>
              <dt className='text-base-content/45 text-[10px] font-semibold uppercase tracking-wide'>
                {fact.key}
              </dt>
              <dd className='mt-0.5 text-xs leading-relaxed'>{fact.value}</dd>
              <EvidenceList evidence={fact.evidence} onNavigate={onNavigate} translate={_} />
            </div>
          ))}
        </dl>
      ) : null}
      <EvidenceList evidence={entity.evidence} onNavigate={onNavigate} translate={_} />
    </div>
  </details>
);

const EvidenceList = ({
  evidence,
  onNavigate,
  translate: _,
}: {
  evidence: readonly XRayEvidenceLocator[];
  onNavigate: (item: XRayEvidenceLocator) => void;
  translate: ReturnType<typeof useTranslation>;
}) => {
  if (!evidence.length) return null;
  return (
    <div className='mt-3 space-y-1.5'>
      {evidence.slice(-3).map((item) => {
        const label =
          item.displayPage === undefined
            ? _('Position {{position}}', { position: item.positionIndex + 1 })
            : _('Page {{page}}', { page: item.displayPage });
        return item.inferred ? (
          <div
            key={`${item.unitId}:${item.exactQuote}`}
            className='text-base-content/55 text-[11px]'
          >
            &ldquo;{item.exactQuote}&rdquo; · {label} · {_('Inferred')}
          </div>
        ) : (
          <button
            key={`${item.unitId}:${item.exactQuote}`}
            type='button'
            className='hover:bg-base-200/60 block min-h-8 w-full rounded-md px-1.5 py-1 text-start text-[11px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15'
            onClick={() => onNavigate(item)}
            title={_('Jump to quote')}
          >
            <span className='text-base-content/75'>&ldquo;{item.exactQuote}&rdquo;</span>{' '}
            <span className='text-base-content/45'>· {label}</span>
          </button>
        );
      })}
    </div>
  );
};

const EmptyResult = ({ icon: Icon, label }: { icon: React.ElementType; label: string }) => (
  <div className='text-base-content/50 flex min-h-40 flex-col items-center justify-center gap-2 text-center'>
    <Icon className='size-5' aria-hidden='true' />
    <p className='text-xs'>{label}</p>
  </div>
);

const CenteredMessage = ({ children }: { children: React.ReactNode }) => (
  <div className='text-base-content/60 flex h-full items-center justify-center px-6 text-center text-sm leading-relaxed'>
    {children}
  </div>
);

const statusTitle = (
  status: XRaySourceStatus | null,
  _: ReturnType<typeof useTranslation>,
): string => {
  if (!status || status.kind === 'not_indexed') return _('Book not indexed');
  if (status.kind === 'indexing') return _('The book index is still being prepared');
  if (status.kind === 'empty_index') return _('No readable text was found');
  if (status.kind === 'stale_index') return _('The book index needs an update');
  if (status.kind === 'failed') return _('The book index could not be prepared');
  return _('X-Ray');
};

const statusDescription = (
  status: XRaySourceStatus | null,
  _: ReturnType<typeof useTranslation>,
): string => {
  if (!status || status.kind === 'not_indexed')
    return _('Book must be indexed first. Open AI Assistant to index.');
  if (status?.kind === 'indexing') return _('X-Ray will become available after indexing finishes.');
  if (status?.kind === 'empty_index')
    return _('This book may contain only images or unsupported text.');
  if (status?.kind === 'stale_index')
    return _('Rebuild with the currently selected embedding model.');
  if (status?.kind === 'failed') return _('Try preparing the book index again in AI Assistant.');
  return _('X-Ray uses only what you have read.');
};

const entityTypeLabel = (type: XRayEntityType, _: ReturnType<typeof useTranslation>): string => {
  const labels: Record<XRayEntityType, string> = {
    character: _('Character'),
    location: _('Location'),
    organization: _('Organization'),
    artifact: _('Artifact'),
    term: _('Term'),
    event: _('Event'),
    concept: _('Concept'),
  };
  return labels[type];
};

const claimStatusLabel = (
  status: XRayClaimStatus,
  _: ReturnType<typeof useTranslation>,
): string => {
  const labels: Record<XRayClaimStatus, string> = {
    true: _('True'),
    false: _('False'),
    suspected: _('Suspected'),
  };
  return labels[status];
};

const hasCredentials = (settings: AISettings): boolean => {
  if (settings.provider === 'ai-gateway') return !!settings.aiGatewayApiKey;
  if (settings.provider === 'openrouter') return !!settings.openrouterApiKey;
  return true;
};

export default XRayView;
