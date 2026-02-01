import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Fzf, byLengthAsc } from 'fzf';
import { PiGraph } from 'react-icons/pi';

import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { eventDispatcher } from '@/utils/event';
import { DEFAULT_BOOK_SEARCH_CONFIG } from '@/services/constants';
import {
  getRecapIfNeeded,
  getXRaySnapshot,
  rebuildXRayToPage,
  updateXRayForProgress,
} from '@/services/ai/xrayService';
import { isBookIndexed } from '@/services/ai/ragService';
import type { XRayEntity, XRayEvidence, XRaySnapshot } from '@/services/ai/types';
import type { BookSearchConfig } from '@/types/book';
import XRayGraph from './XRayGraph';

interface XRayViewProps {
  bookKey: string;
}

type XRayTab = 'entities' | 'timeline' | 'relationships' | 'themes' | 'recap';

type EntityMentionSource = 'fact' | 'relationship' | 'event';

interface EntityMention {
  evidence: XRayEvidence;
  context: string;
  source: EntityMentionSource;
}

interface EntityMentionStats {
  mentions: EntityMention[];
  lockedCount: number;
  lastSeenPage: number;
  onPage: boolean;
  inChapter: boolean;
}

interface EntityView {
  entity: XRayEntity;
  oneLiner: string;
  mentionCount: number;
  lastSeenPage: number;
  mentions: EntityMention[];
  topMentions: EntityMention[];
  allMentions: EntityMention[];
  relevanceScore: number;
  isRelevantNow: boolean;
  isLocked: boolean;
  onPage: boolean;
  inChapter: boolean;
  category: 'people' | 'terms' | 'places' | 'images';
  related: Array<{ id: string; label: string; type: string; evidence?: XRayEvidence }>;
  searchText: string;
}

const XRayView: React.FC<XRayViewProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getBookData, getConfig } = useBookDataStore();
  const { getProgress, getView } = useReaderStore();

  const progress = getProgress(bookKey);
  const bookData = getBookData(bookKey);
  const bookHash = bookKey.split('-')[0] || '';
  const bookTitle = bookData?.book?.title || 'Unknown';
  const currentPage = progress?.pageinfo?.current ?? 0;
  const aiSettings = settings?.aiSettings;

  const [activeTab, setActiveTab] = useState<XRayTab>('entities');
  const [snapshot, setSnapshot] = useState<XRaySnapshot | null>(null);
  const [recap, setRecap] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [isIndexed, setIsIndexed] = useState<boolean | null>(null);
  const [entitySearch, setEntitySearch] = useState('');
  const [entitySort, setEntitySort] = useState<'relevance' | 'alphabetical'>('relevance');
  const [entityCategory, setEntityCategory] = useState<
    'all' | 'people' | 'terms' | 'places' | 'images'
  >('all');
  const [entityScope, setEntityScope] = useState<'page' | 'chapter' | 'book'>('page');
  const [relationshipFilter, setRelationshipFilter] = useState('all');
  const [relationshipView, setRelationshipView] = useState<'list' | 'graph'>('list');
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'major'>('all');
  const [jumpingEvidenceKey, setJumpingEvidenceKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedGraphEntity, setSelectedGraphEntity] = useState<XRayEntity | null>(null);

  const tabs = useMemo(
    () => [
      { id: 'entities', label: _('Entities') },
      { id: 'timeline', label: _('Timeline') },
      { id: 'relationships', label: _('Relationships') },
      { id: 'themes', label: _('Themes') },
      { id: 'recap', label: _('Recap') },
    ],
    [_],
  );

  const checkIndexed = useCallback(async () => {
    if (!bookHash) {
      setIsIndexed(false);
      return;
    }
    const indexed = await isBookIndexed(bookHash);
    setIsIndexed(indexed);
  }, [bookHash]);

  const loadSnapshot = useCallback(async () => {
    if (!bookHash) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await getXRaySnapshot(bookHash, currentPage);
      setSnapshot(data);
    } catch (err) {
      console.error('Failed to load X-Ray snapshot:', err);
      setErrorMessage(_('Failed to load X-Ray data'));
    } finally {
      setIsLoading(false);
    }
  }, [bookHash, currentPage, _]);

  const handleUpdate = useCallback(async () => {
    if (!aiSettings?.enabled || !bookHash) return;

    const indexed = await isBookIndexed(bookHash);
    if (!indexed) {
      setErrorMessage(_('Book must be indexed first. Open AI Assistant to index.'));
      return;
    }

    setIsUpdating(true);
    setErrorMessage(null);

    try {
      await updateXRayForProgress({
        bookHash,
        currentPage,
        settings: aiSettings,
        bookTitle,
        appService,
        force: true,
      });
      await loadSnapshot();
    } catch (err) {
      const message = err instanceof Error ? err.message : _('X-Ray update failed.');
      setErrorMessage(message);
    } finally {
      setIsUpdating(false);
    }
  }, [aiSettings, bookHash, currentPage, bookTitle, appService, loadSnapshot, _]);

  const handleRebuild = useCallback(async () => {
    if (!aiSettings?.enabled || !bookHash) return;

    const indexed = await isBookIndexed(bookHash);
    if (!indexed) {
      setErrorMessage(_('Book must be indexed first. Open AI Assistant to index.'));
      return;
    }

    setIsRebuilding(true);
    setErrorMessage(null);

    try {
      await rebuildXRayToPage({
        bookHash,
        currentPage,
        settings: aiSettings,
        bookTitle,
        appService,
      });
      await loadSnapshot();
    } catch (err) {
      const message = err instanceof Error ? err.message : _('X-Ray rebuild failed.');
      setErrorMessage(message);
    } finally {
      setIsRebuilding(false);
    }
  }, [aiSettings, bookHash, currentPage, bookTitle, appService, loadSnapshot, _]);

  const handleEvidenceJump = useCallback(
    async (evidence: XRayEvidence) => {
      if (!bookKey) return;
      const view = getView(bookKey);
      if (!view) return;
      const config = getConfig(bookKey);
      const searchConfig = (config?.searchConfig || DEFAULT_BOOK_SEARCH_CONFIG) as BookSearchConfig;
      const query = evidence.quote.length > 180 ? evidence.quote.slice(0, 180) : evidence.quote;
      const evidenceKey = `${evidence.chunkId}:${evidence.page}`;
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
      }
    },
    [bookKey, getView, getConfig],
  );

  const loadRecap = useCallback(async () => {
    if (!bookHash || !aiSettings?.enabled) return;
    const text = await getRecapIfNeeded({
      bookHash,
      bookTitle,
      maxPageIncluded: currentPage,
      settings: aiSettings,
      appService,
    });
    setRecap(text);
  }, [bookHash, bookTitle, currentPage, aiSettings, appService]);

  const entities = useMemo(() => snapshot?.entities || [], [snapshot?.entities]);
  const relationships = useMemo(() => snapshot?.relationships || [], [snapshot?.relationships]);
  const events = useMemo(() => snapshot?.events || [], [snapshot?.events]);
  const themes = useMemo(() => entities.filter((entity) => entity.type === 'theme'), [entities]);
  const filteredRelationships = useMemo(
    () =>
      relationshipFilter === 'all'
        ? relationships
        : relationships.filter(
            (rel) => rel.sourceId === relationshipFilter || rel.targetId === relationshipFilter,
          ),
    [relationshipFilter, relationships],
  );
  const filteredEvents = useMemo(
    () => (timelineFilter === 'major' ? events.filter((event) => event.importance >= 7) : events),
    [timelineFilter, events],
  );

  const currentSectionIndex = progress?.section?.current ?? null;

  const entityById = useMemo(() => {
    return new Map(snapshot?.entities.map((entity) => [entity.id, entity]) || []);
  }, [snapshot?.entities]);

  const parseSectionIndex = useCallback((chunkId: string): number | null => {
    const match = chunkId.match(/-(\d+)-\d+(?:-unit)?$/);
    if (!match) return null;
    const parsed = Number.parseInt(match[1]!, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }, []);

  const truncateText = useCallback((value: string, limit = 140) => {
    if (value.length <= limit) return value;
    return `${value.slice(0, limit).trim()}…`;
  }, []);

  const relatedByEntity = useMemo(() => {
    const map = new Map<
      string,
      Array<{ id: string; label: string; type: string; evidence?: XRayEvidence }>
    >();
    for (const rel of relationships) {
      const source = entityById.get(rel.sourceId);
      const target = entityById.get(rel.targetId);
      if (!source || !target) continue;
      const sourceList = map.get(source.id) ?? [];
      sourceList.push({
        id: target.id,
        label: target.canonicalName,
        type: rel.type,
        evidence: rel.evidence[0],
      });
      map.set(source.id, sourceList);

      const targetList = map.get(target.id) ?? [];
      targetList.push({
        id: source.id,
        label: source.canonicalName,
        type: rel.type,
        evidence: rel.evidence[0],
      });
      map.set(target.id, targetList);
    }
    return map;
  }, [relationships, entityById]);

  const mentionStats = useMemo(() => {
    const stats = new Map<string, EntityMentionStats>();
    const seenKeys = new Map<string, Set<string>>();

    const getEntry = (entityId: string): EntityMentionStats => {
      const existing = stats.get(entityId);
      if (existing) return existing;
      const entry: EntityMentionStats = {
        mentions: [],
        lockedCount: 0,
        lastSeenPage: -1,
        onPage: false,
        inChapter: false,
      };
      stats.set(entityId, entry);
      seenKeys.set(entityId, new Set());
      return entry;
    };

    const addMention = (
      entityId: string,
      evidence: XRayEvidence,
      context: string,
      source: EntityMentionSource,
    ) => {
      if (!entityId) return;
      const entry = getEntry(entityId);
      if (evidence.page > currentPage) {
        entry.lockedCount += 1;
        return;
      }
      const key = `${evidence.chunkId}:${evidence.page}:${evidence.quote}`;
      const keys = seenKeys.get(entityId)!;
      if (keys.has(key)) return;
      keys.add(key);
      entry.mentions.push({ evidence, context, source });
      entry.lastSeenPage = Math.max(entry.lastSeenPage, evidence.page);
      if (evidence.page === currentPage) entry.onPage = true;
      const sectionIndex = parseSectionIndex(evidence.chunkId);
      if (
        sectionIndex !== null &&
        currentSectionIndex !== null &&
        sectionIndex === currentSectionIndex
      )
        entry.inChapter = true;
    };

    for (const entity of entities) {
      for (const fact of entity.facts) {
        for (const evidence of fact.evidence) {
          addMention(entity.id, evidence, fact.value, 'fact');
        }
      }
    }

    for (const rel of relationships) {
      const source = entityById.get(rel.sourceId);
      const target = entityById.get(rel.targetId);
      const sourceLabel = source?.canonicalName || rel.sourceId;
      const targetLabel = target?.canonicalName || rel.targetId;
      const context = `${sourceLabel} ${rel.type} ${targetLabel}`;
      for (const evidence of rel.evidence) {
        addMention(rel.sourceId, evidence, context, 'relationship');
        addMention(rel.targetId, evidence, context, 'relationship');
      }
    }

    for (const event of events) {
      for (const evidence of event.evidence) {
        for (const entityId of event.involvedEntityIds) {
          addMention(entityId, evidence, `Event: ${event.summary}`, 'event');
        }
      }
    }

    return stats;
  }, [
    entities,
    relationships,
    events,
    entityById,
    currentPage,
    currentSectionIndex,
    parseSectionIndex,
  ]);

  const entityViews = useMemo(() => {
    return entities.map((entity) => {
      const stats = mentionStats.get(entity.id) ?? {
        mentions: [],
        lockedCount: 0,
        lastSeenPage: entity.lastSeenPage,
        onPage: false,
        inChapter: false,
      };
      const mentionsSorted = [...stats.mentions].sort((a, b) => b.evidence.page - a.evidence.page);
      const topMentions = [...stats.mentions].sort((a, b) => {
        const distA = Math.abs(a.evidence.page - currentPage);
        const distB = Math.abs(b.evidence.page - currentPage);
        if (distA !== distB) return distA - distB;
        return b.evidence.page - a.evidence.page;
      });
      const mentionCount = stats.mentions.length;
      const lastSeenPage = stats.lastSeenPage >= 0 ? stats.lastSeenPage : entity.lastSeenPage;
      const relevanceScore =
        mentionCount * 10 + (stats.onPage ? 50 : 0) + (stats.inChapter ? 20 : 0) + lastSeenPage;
      const oneLiner = truncateText(
        entity.description || entity.facts[0]?.value || _('No details available yet'),
      );
      const related = relatedByEntity.get(entity.id) ?? [];
      const searchText = [
        entity.canonicalName,
        entity.description,
        ...entity.aliases,
        ...entity.facts.map((fact) => `${fact.key} ${fact.value}`),
        ...related.map((rel) => `${rel.label} ${rel.type}`),
        ...stats.mentions.map((mention) => mention.context),
      ]
        .filter(Boolean)
        .join(' ');

      const category: EntityView['category'] = (() => {
        switch (entity.type) {
          case 'character':
            return 'people';
          case 'location':
            return 'places';
          case 'term':
          case 'concept':
          case 'theme':
          case 'artifact':
          case 'event':
          case 'organization':
          default:
            return 'terms';
        }
      })();

      return {
        entity,
        oneLiner,
        mentionCount,
        lastSeenPage,
        mentions: mentionsSorted,
        topMentions: topMentions.slice(0, 3),
        allMentions: mentionsSorted,
        relevanceScore,
        isRelevantNow: stats.onPage || stats.inChapter,
        isLocked: stats.lockedCount > 0,
        onPage: stats.onPage,
        inChapter: stats.inChapter,
        related,
        searchText,
        category,
      };
    });
  }, [entities, mentionStats, relatedByEntity, currentPage, _, truncateText]);

  const categoryCounts = useMemo(() => {
    const counts = {
      all: entityViews.length,
      people: 0,
      terms: 0,
      places: 0,
      images: 0,
    };
    for (const view of entityViews) {
      counts[view.category as 'people' | 'terms' | 'places'] += 1;
    }
    return counts;
  }, [entityViews]);

  const entitySearchIds = useMemo(() => {
    const query = entitySearch.trim();
    if (!query) return null;
    const fzf = new Fzf(entityViews, {
      selector: (item) => item.searchText,
      tiebreakers: [byLengthAsc],
      casing: 'smart-case',
      normalize: true,
      limit: 200,
    });
    const results = fzf.find(query);
    return new Set(results.map((result) => result.item.entity.id));
  }, [entitySearch, entityViews]);

  const sortEntityViews = useCallback(
    (list: EntityView[]) => {
      return list.slice().sort((a, b) => {
        if (entitySort === 'alphabetical') {
          return a.entity.canonicalName.localeCompare(b.entity.canonicalName);
        }
        if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
        return b.lastSeenPage - a.lastSeenPage;
      });
    },
    [entitySort],
  );

  const matchesCategory = useCallback(
    (view: EntityView) => {
      if (entityCategory === 'all') return true;
      if (entityCategory === 'images') return false;
      return view.category === entityCategory;
    },
    [entityCategory],
  );

  const matchesScope = useCallback(
    (view: EntityView) => {
      if (entityScope === 'page') return view.onPage;
      if (entityScope === 'chapter') return view.inChapter;
      return true;
    },
    [entityScope],
  );

  const applyFilters = useCallback(
    (list: EntityView[]) => {
      const filtered = list.filter(matchesCategory);
      return entitySearchIds
        ? filtered.filter((entity) => entitySearchIds.has(entity.entity.id))
        : filtered;
    },
    [entitySearchIds, matchesCategory],
  );

  const currentEntities = useMemo(() => {
    return sortEntityViews(applyFilters(entityViews.filter(matchesScope)));
  }, [entityViews, matchesScope, applyFilters, sortEntityViews]);

  const bookEntities = useMemo(() => {
    if (entityScope === 'book') return [];
    return sortEntityViews(applyFilters(entityViews.filter((entity) => !matchesScope(entity))));
  }, [entityScope, entityViews, matchesScope, applyFilters, sortEntityViews]);

  const notableClips = useMemo(() => {
    return events
      .filter((event) => event.importance >= 7)
      .map((event) => ({
        id: event.id,
        page: event.page,
        summary: event.summary,
        evidence: event.evidence[0],
      }))
      .filter((event) => event.evidence && event.page <= currentPage)
      .slice(0, 5);
  }, [events, currentPage]);

  const currentSectionLabel = useMemo(() => {
    if (entityScope === 'chapter') return _('In this chapter');
    if (entityScope === 'book') return _('In the book');
    return _('Current page');
  }, [entityScope, _]);

  const showSecondarySection = entityScope !== 'book';

  const formatQuote = (quote: string, limit = 140): string => {
    if (quote.length <= limit) return quote;
    return `${quote.slice(0, limit).trim()}…`;
  };

  const renderMention = (mention: EntityMention, index: number) => {
    const evidenceKey = `${mention.evidence.chunkId}:${mention.evidence.page}:${index}`;
    const evidenceId = `${mention.evidence.chunkId}:${mention.evidence.page}`;
    return (
      <div key={evidenceKey} className='mt-1'>
        <div className='flex items-start justify-between gap-2'>
          <div className='text-base-content/70 text-[11px]'>
            {mention.context && (
              <span className='text-base-content/80 font-medium'>{mention.context}. </span>
            )}
            &ldquo;{formatQuote(mention.evidence.quote)}&rdquo;
          </div>
          <button
            type='button'
            className='text-base-content/50 text-[11px] hover:underline disabled:opacity-60'
            onClick={() => handleEvidenceJump(mention.evidence)}
            disabled={jumpingEvidenceKey === evidenceId}
          >
            {_('Go to')} {_('p.')}
            {mention.evidence.page + 1}
          </button>
        </div>
      </div>
    );
  };

  const renderEntityCard = (item: EntityView) => {
    const previewMention = item.topMentions[0];
    return (
      <div key={item.entity.id} className='border-base-300/60 rounded-md border p-3'>
        <div className='flex items-start justify-between gap-2'>
          <div>
            <div className='text-sm font-semibold'>{item.entity.canonicalName}</div>
            <p className='text-base-content/70 mt-1 text-xs'>{item.oneLiner}</p>
          </div>
          <div className='text-base-content/60 text-xs uppercase'>{item.entity.type}</div>
        </div>

        <div className='mt-2 flex flex-wrap gap-1 text-[11px]'>
          <span className='badge badge-xs'>
            {_('Mentions')}: {item.mentionCount}
          </span>
          <span className='badge badge-xs'>
            {_('Last seen')}: {_('p.')}
            {item.lastSeenPage + 1}
          </span>
          {item.onPage && <span className='badge badge-xs'>{_('On this page')}</span>}
          {!item.onPage && item.inChapter && (
            <span className='badge badge-xs'>{_('In this chapter')}</span>
          )}
        </div>

        {previewMention ? (
          <div className='mt-2'>
            <div className='flex items-start justify-between gap-2'>
              <div className='text-base-content/70 text-[11px]'>
                &ldquo;{formatQuote(previewMention.evidence.quote)}&rdquo;
              </div>
              <button
                type='button'
                className='text-base-content/50 text-[11px] hover:underline disabled:opacity-60'
                onClick={() => handleEvidenceJump(previewMention.evidence)}
                disabled={
                  jumpingEvidenceKey ===
                  `${previewMention.evidence.chunkId}:${previewMention.evidence.page}`
                }
              >
                {_('Go to')} {_('p.')}
                {previewMention.evidence.page + 1}
              </button>
            </div>
          </div>
        ) : (
          <p className='text-base-content/50 mt-2 text-[11px]'>{_('No mentions yet')}</p>
        )}

        {item.isLocked && (
          <div className='text-base-content/50 mt-2 text-[11px]'>{_('Locked until later')}</div>
        )}

        <details className='mt-2'>
          <summary className='text-base-content/60 cursor-pointer text-[11px]'>
            {_('Show more')}
          </summary>

          <div className='mt-2'>
            <div className='text-base-content/60 text-[11px] uppercase'>{_('Mentions')}</div>
            {item.topMentions.length === 0 ? (
              <p className='text-base-content/50 text-[11px]'>{_('No mentions yet')}</p>
            ) : (
              item.topMentions.map(renderMention)
            )}
          </div>

          {item.allMentions.length > item.topMentions.length && (
            <details className='mt-2'>
              <summary className='text-base-content/60 cursor-pointer text-[11px]'>
                {_('All mentions')} ({item.allMentions.length})
              </summary>
              <div className='mt-2'>{item.allMentions.map(renderMention)}</div>
            </details>
          )}

          <details className='mt-2'>
            <summary className='text-base-content/60 cursor-pointer text-[11px]'>
              {_('Advanced')}
            </summary>
            <div className='mt-2 space-y-1'>
              {item.related.length === 0 ? (
                <p className='text-base-content/50 text-[11px]'>{_('No relationships yet')}</p>
              ) : (
                item.related.slice(0, 5).map((rel, index) => (
                  <div
                    key={`${rel.id}:${index}`}
                    className='flex items-center justify-between gap-2'
                  >
                    <div className='text-base-content/70 text-[11px]'>
                      {rel.label} · {rel.type}
                    </div>
                    {rel.evidence && (
                      <button
                        type='button'
                        className='text-base-content/50 text-[11px] hover:underline'
                        onClick={() => handleEvidenceJump(rel.evidence!)}
                      >
                        {_('Go to')}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </details>
        </details>
      </div>
    );
  };

  useEffect(() => {
    loadSnapshot();
    loadRecap();
    checkIndexed();
  }, [loadSnapshot, loadRecap, checkIndexed]);

  useEffect(() => {
    if (relationshipFilter === 'all') return;
    if (!entities.some((entity) => entity.id === relationshipFilter)) {
      setRelationshipFilter('all');
    }
  }, [entities, relationshipFilter]);

  useEffect(() => {
    const handler = (event: CustomEvent) => {
      if (event.detail?.bookHash !== bookHash) return;
      loadSnapshot();
    };
    eventDispatcher.on('xray-updated', handler);
    return () => {
      eventDispatcher.off('xray-updated', handler);
    };
  }, [bookHash, loadSnapshot]);

  if (!aiSettings?.enabled) {
    return (
      <div className='flex h-full items-center justify-center p-4 text-center text-sm'>
        {_('Enable AI in Settings')}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <div className='border-primary size-5 animate-spin rounded-full border-2 border-t-transparent' />
      </div>
    );
  }

  return (
    <div className='flex h-full flex-col'>
      <div className='border-base-300/50 flex items-center justify-between gap-2 border-b px-3 py-2 text-xs'>
        <div>
          <span className='text-base-content/70'>{_('As of page')}</span>{' '}
          <span className='text-base-content font-medium'>{currentPage + 1}</span>
        </div>
        <div className='flex items-center gap-2'>
          <button
            className='btn btn-ghost btn-xs'
            onClick={handleUpdate}
            disabled={isUpdating || isRebuilding}
          >
            {isUpdating ? _('Loading...') : _('Update X-Ray')}
          </button>
          <button
            className='btn btn-ghost btn-xs'
            onClick={handleRebuild}
            disabled={isUpdating || isRebuilding}
          >
            {isRebuilding ? _('Loading...') : _('Rebuild X-Ray')}
          </button>
        </div>
      </div>

      {/* Indexing warning */}
      {isIndexed === false && (
        <div className='bg-warning/10 border-warning/30 m-3 rounded-md border px-3 py-2 text-xs'>
          <div className='text-warning flex items-start gap-2'>
            <svg
              className='mt-0.5 h-4 w-4 flex-shrink-0'
              fill='none'
              viewBox='0 0 24 24'
              stroke='currentColor'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
              />
            </svg>
            <div>
              <p className='font-medium'>{_('Book not indexed')}</p>
              <p className='text-warning/80 mt-1'>
                {_(
                  'Open the AI Assistant panel and click "Index Book" to enable X-Ray extraction.',
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error message */}
      {errorMessage && (
        <div className='bg-error/10 border-error/30 m-3 rounded-md border px-3 py-2 text-xs'>
          <div className='text-error flex items-start gap-2'>
            <svg
              className='mt-0.5 h-4 w-4 flex-shrink-0'
              fill='none'
              viewBox='0 0 24 24'
              stroke='currentColor'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M6 18L18 6M6 6l12 12'
              />
            </svg>
            <div>
              <p className='font-medium'>{_('Error')}</p>
              <p className='text-error/80 mt-1'>{errorMessage}</p>
            </div>
          </div>
        </div>
      )}

      <div className='flex flex-wrap gap-2 px-3 py-2'>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={clsx(
              'btn btn-xs rounded-full border-none',
              activeTab === tab.id ? 'bg-base-300 text-base-content' : 'bg-base-200/70',
            )}
            onClick={() => setActiveTab(tab.id as XRayTab)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className='flex-1 space-y-3 overflow-y-auto px-3 pb-6'>
        {activeTab === 'entities' && (
          <div className='space-y-3'>
            <div className='flex flex-wrap items-center gap-2 text-xs'>
              <input
                className='input input-bordered input-xs h-7 w-full max-w-xs'
                value={entitySearch}
                onChange={(event) => setEntitySearch(event.target.value)}
                placeholder={_('Search entities')}
              />
            </div>

            <div className='flex flex-wrap items-center gap-2 text-xs'>
              <div className='bg-base-200 flex items-center gap-1 rounded-lg p-1'>
                {(
                  [
                    { id: 'all', label: _('All'), count: categoryCounts.all },
                    { id: 'people', label: _('People'), count: categoryCounts.people },
                    { id: 'terms', label: _('Terms'), count: categoryCounts.terms },
                    { id: 'places', label: _('Places'), count: categoryCounts.places },
                    { id: 'images', label: _('Images'), count: categoryCounts.images },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    className={clsx(
                      'btn btn-xs rounded-md border-none px-2',
                      entityCategory === item.id
                        ? 'bg-base-100 text-base-content shadow-sm'
                        : 'text-base-content/60 hover:bg-base-100/50 bg-transparent',
                      item.id === 'images' && 'btn-disabled',
                    )}
                    onClick={() => setEntityCategory(item.id)}
                    disabled={item.id === 'images'}
                  >
                    {item.label}
                    {item.id !== 'images' && (
                      <span className='text-base-content/50 ml-1 text-[10px]'>{item.count}</span>
                    )}
                  </button>
                ))}
              </div>

              <div className='bg-base-200 flex items-center gap-1 rounded-lg p-1'>
                {(
                  [
                    { id: 'page', label: _('Page') },
                    { id: 'chapter', label: _('Chapter') },
                    { id: 'book', label: _('Book') },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    className={clsx(
                      'btn btn-xs rounded-md border-none px-2',
                      entityScope === item.id
                        ? 'bg-base-100 text-base-content shadow-sm'
                        : 'text-base-content/60 hover:bg-base-100/50 bg-transparent',
                    )}
                    onClick={() => setEntityScope(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className='bg-base-200 ml-auto flex items-center gap-1 rounded-lg p-1'>
                <button
                  className={clsx(
                    'btn btn-xs rounded-md border-none px-2',
                    entitySort === 'relevance'
                      ? 'bg-base-100 text-base-content shadow-sm'
                      : 'text-base-content/60 hover:bg-base-100/50 bg-transparent',
                  )}
                  onClick={() => setEntitySort('relevance')}
                >
                  {_('Relevance')}
                </button>
                <button
                  className={clsx(
                    'btn btn-xs rounded-md border-none px-2',
                    entitySort === 'alphabetical'
                      ? 'bg-base-100 text-base-content shadow-sm'
                      : 'text-base-content/60 hover:bg-base-100/50 bg-transparent',
                  )}
                  onClick={() => setEntitySort('alphabetical')}
                >
                  {_('A-Z')}
                </button>
              </div>
            </div>

            {entitySearch.trim() && (
              <p className='text-base-content/50 text-[11px]'>
                {_('Matches')}: {entitySearchIds ? entitySearchIds.size : 0}
              </p>
            )}

            {entityViews.length === 0 ? (
              <p className='text-base-content/60 text-sm'>{_('No entities yet')}</p>
            ) : (
              <div className='space-y-4'>
                <div>
                  <div className='text-xs font-semibold'>{currentSectionLabel}</div>
                  <div className='mt-2 space-y-3'>
                    {currentEntities.length === 0 ? (
                      <p className='text-base-content/60 text-sm'>{_('None found')}</p>
                    ) : (
                      currentEntities.map(renderEntityCard)
                    )}
                  </div>
                </div>

                {showSecondarySection && (
                  <div>
                    <div className='text-xs font-semibold'>{_('In the book')}</div>
                    <div className='mt-2 space-y-3'>
                      {bookEntities.length === 0 ? (
                        <p className='text-base-content/60 text-sm'>{_('No other entities yet')}</p>
                      ) : (
                        bookEntities.map(renderEntityCard)
                      )}
                    </div>
                  </div>
                )}

                {notableClips.length > 0 && (
                  <div>
                    <div className='text-xs font-semibold'>{_('Notable clips')}</div>
                    <div className='mt-2 space-y-3'>
                      {notableClips.map((clip) => (
                        <div key={clip.id} className='border-base-300/60 rounded-md border p-3'>
                          <div className='text-base-content/60 text-xs'>
                            {_('Page')} {clip.page + 1}
                          </div>
                          <p className='text-sm'>{clip.summary}</p>
                          {clip.evidence && (
                            <p className='text-base-content/70 mt-1 text-xs'>
                              &ldquo;{formatQuote(clip.evidence.quote)}&rdquo;
                            </p>
                          )}
                          <p className='text-base-content/70 mt-1 text-xs'>
                            {_('Why it matters')}: {clip.summary}
                          </p>
                          {clip.evidence && (
                            <button
                              type='button'
                              className='text-base-content/50 mt-2 text-left text-[11px] hover:underline'
                              onClick={() => handleEvidenceJump(clip.evidence!)}
                            >
                              {_('Go to location')}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className='space-y-3'>
            <div className='flex items-center gap-2 text-xs'>
              <span className='text-base-content/60'>{_('Filter by importance')}</span>
              <select
                className='select select-bordered select-xs h-7'
                value={timelineFilter}
                onChange={(event) => setTimelineFilter(event.target.value as 'all' | 'major')}
              >
                <option value='all'>{_('All events')}</option>
                <option value='major'>{_('Major events')}</option>
              </select>
            </div>
            {filteredEvents.length === 0 ? (
              <p className='text-base-content/60 text-sm'>{_('No events yet')}</p>
            ) : (
              filteredEvents
                .slice()
                .sort((a, b) => a.page - b.page)
                .map((event) => (
                  <div key={event.id} className='border-base-300/60 rounded-md border p-3'>
                    <div className='text-base-content/60 text-xs'>
                      {_('Page')} {event.page + 1}
                    </div>
                    <p className='text-sm'>{event.summary}</p>
                    {event.evidence[0] && (
                      <button
                        type='button'
                        className='text-base-content/50 mt-1 text-left text-[11px] hover:underline disabled:opacity-60'
                        onClick={() => handleEvidenceJump(event.evidence[0]!)}
                        disabled={
                          jumpingEvidenceKey ===
                          `${event.evidence[0]!.chunkId}:${event.evidence[0]!.page}`
                        }
                        title={_('Jump to quote')}
                      >
                        &ldquo;{event.evidence[0].quote}&rdquo;
                      </button>
                    )}
                  </div>
                ))
            )}
          </div>
        )}

        {activeTab === 'relationships' && (
          <div className='space-y-3'>
            <div className='flex items-center gap-2 text-xs'>
              <span className='text-base-content/60'>{_('Filter by entity')}</span>
              <select
                className='select select-bordered select-xs h-7'
                value={relationshipFilter}
                onChange={(event) => setRelationshipFilter(event.target.value)}
              >
                <option value='all'>{_('All entities')}</option>
                {entities
                  .slice()
                  .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))
                  .map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.canonicalName}
                    </option>
                  ))}
              </select>
              <div className='bg-base-200 ml-auto flex items-center gap-1 rounded-lg p-1'>
                <button
                  className={clsx(
                    'btn btn-xs rounded-md border-none px-2',
                    relationshipView === 'list'
                      ? 'bg-base-100 text-base-content shadow-sm'
                      : 'text-base-content/60 hover:bg-base-100/50 bg-transparent',
                  )}
                  onClick={() => setRelationshipView('list')}
                  title={_('List view')}
                >
                  <svg className='size-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M4 6h16M4 12h16M4 18h16'
                    />
                  </svg>
                </button>
                <button
                  className={clsx(
                    'btn btn-xs rounded-md border-none px-2',
                    relationshipView === 'graph'
                      ? 'bg-base-100 text-base-content shadow-sm'
                      : 'text-base-content/60 hover:bg-base-100/50 bg-transparent',
                  )}
                  onClick={() => setRelationshipView('graph')}
                  title={_('Graph view')}
                >
                  <PiGraph className='size-4' />
                </button>
              </div>
            </div>
            {relationshipView === 'graph' ? (
              <div className='space-y-3'>
                <div className='border-base-300 h-[300px] rounded-md border'>
                  <XRayGraph
                    entities={entities}
                    relationships={filteredRelationships}
                    events={events}
                    onNodeClick={(entity) => setSelectedGraphEntity(entity)}
                  />
                </div>
                {selectedGraphEntity ? (
                  <div className='border-base-300/60 rounded-md border p-3'>
                    <div className='flex items-start justify-between gap-2'>
                      <div>
                        <div className='text-sm font-semibold'>
                          {selectedGraphEntity.canonicalName}
                        </div>
                        <span className='text-base-content/50 text-[10px] uppercase'>
                          {selectedGraphEntity.type}
                        </span>
                      </div>
                      <button
                        type='button'
                        className='text-base-content/50 text-[11px] hover:underline'
                        onClick={() => setSelectedGraphEntity(null)}
                      >
                        {_('Close')}
                      </button>
                    </div>
                    <p className='text-base-content/80 mt-2 text-xs leading-relaxed'>
                      {selectedGraphEntity.description || _('No description available')}
                    </p>
                    {(() => {
                      const related = relationships.filter(
                        (rel) =>
                          rel.sourceId === selectedGraphEntity.id ||
                          rel.targetId === selectedGraphEntity.id,
                      );
                      if (related.length === 0) return null;
                      return (
                        <div className='mt-3'>
                          <div className='text-base-content/60 text-[11px] uppercase'>
                            {_('Connections')}
                          </div>
                          <div className='mt-1 space-y-1'>
                            {related.slice(0, 5).map((rel, index) => {
                              const isSource = rel.sourceId === selectedGraphEntity.id;
                              const otherId = isSource ? rel.targetId : rel.sourceId;
                              const other = entityById.get(otherId);
                              return (
                                <div
                                  key={`${rel.id}:${index}`}
                                  className='text-base-content/70 text-xs'
                                >
                                  {isSource ? _('→') : _('←')} {other?.canonicalName || otherId}
                                  <span className='text-base-content/50 ml-1'>· {rel.type}</span>
                                  {rel.inferred && (
                                    <span className='text-base-content/40 ml-1 text-[10px]'>
                                      ({_('inferred')})
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                            {related.length > 5 && (
                              <div className='text-base-content/50 text-xs'>
                                +{related.length - 5} more
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    {selectedGraphEntity.facts.length > 0 && (
                      <div className='mt-3'>
                        <div className='text-base-content/60 text-[11px] uppercase'>
                          {_('Facts')}
                        </div>
                        <div className='mt-1 space-y-1'>
                          {selectedGraphEntity.facts.slice(0, 3).map((fact, index) => (
                            <div key={index} className='text-base-content/70 text-xs'>
                              <span className='font-medium'>{fact.key}:</span> {fact.value}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className='text-base-content/50 text-center text-xs'>
                    {_('Click a node to see details')}
                  </p>
                )}
              </div>
            ) : filteredRelationships.length === 0 ? (
              <p className='text-base-content/60 text-sm'>{_('No relationships yet')}</p>
            ) : (
              filteredRelationships.map((rel) => {
                const source = entityById.get(rel.sourceId);
                const target = entityById.get(rel.targetId);
                return (
                  <div key={rel.id} className='border-base-300/60 rounded-md border p-3'>
                    <div className='text-sm font-semibold'>
                      {source?.canonicalName || rel.sourceId}
                      {' -> '}
                      {target?.canonicalName || rel.targetId}
                    </div>
                    <p className='text-base-content/70 mt-1 text-xs'>
                      {rel.description}
                      {rel.inferred && (
                        <span className='text-base-content/50 ml-2 text-[10px] uppercase'>
                          {_('Inferred')}
                        </span>
                      )}
                    </p>
                    {rel.evidence[0] && (
                      <button
                        type='button'
                        className='text-base-content/50 mt-2 text-left text-[11px] hover:underline disabled:opacity-60'
                        onClick={() => handleEvidenceJump(rel.evidence[0]!)}
                        disabled={
                          jumpingEvidenceKey ===
                          `${rel.evidence[0]!.chunkId}:${rel.evidence[0]!.page}`
                        }
                        title={_('Jump to quote')}
                      >
                        &ldquo;{rel.evidence[0].quote}&rdquo; (p.{rel.evidence[0].page + 1})
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'themes' && (
          <div className='space-y-3'>
            {themes.length === 0 ? (
              <p className='text-base-content/60 text-sm'>{_('No themes yet')}</p>
            ) : (
              themes.map((theme) => (
                <div key={theme.id} className='border-base-300/60 rounded-md border p-3'>
                  <div className='text-sm font-semibold'>{theme.canonicalName}</div>
                  <p className='text-base-content/70 mt-1 text-xs'>
                    {theme.description || _('No details available yet')}
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'recap' && (
          <div className='space-y-3'>
            {recap ? (
              <p className='text-base-content/80 text-sm leading-relaxed'>{recap}</p>
            ) : (
              <p className='text-base-content/60 text-sm'>{_('No recap available')}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default XRayView;
