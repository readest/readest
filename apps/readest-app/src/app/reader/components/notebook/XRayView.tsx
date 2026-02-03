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
  getXRaySnapshot,
  rebuildXRayToPage,
  updateXRayForProgress,
} from '@/services/ai/xrayService';
import { isBookIndexed } from '@/services/ai/ragService';
import type { XRayEntity, XRayEntityType, XRayEvidence, XRaySnapshot } from '@/services/ai/types';
import type { BookSearchConfig } from '@/types/book';
import XRayGraph from './XRayGraph';

interface XRayViewProps {
  bookKey: string;
}

type XRayTab = 'entities' | 'timeline' | 'relationships';

type EntityMentionSource = 'fact' | 'relationship' | 'event';

const ENTITY_TYPE_WHITELIST: XRayEntityType[] = [
  'character',
  'location',
  'organization',
  'artifact',
  'term',
  'event',
  'concept',
];

const isLivingEntity = (entity?: XRayEntity | null): boolean => entity?.type === 'character';

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
  category: 'people' | 'places' | 'organizations' | 'artifacts' | 'concepts' | 'events';
  related: Array<{ id: string; label: string; type: string; evidence?: XRayEvidence }>;
  searchText: string;
  isInferred: boolean;
}

const XRayView: React.FC<XRayViewProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getBookData, getConfig } = useBookDataStore();
  const progress = useReaderStore((state) => state.getProgress(bookKey));
  const getView = useReaderStore((state) => state.getView);
  const bookData = getBookData(bookKey);
  const bookHash = bookKey.split('-')[0] || '';
  const bookTitle = bookData?.book?.title || 'Unknown';
  const currentPage = progress?.pageinfo?.current ?? 0;
  const aiSettings = settings?.aiSettings;
  const providerUnsupported = aiSettings?.enabled && aiSettings.provider !== 'ai-gateway';

  const [activeTab, setActiveTab] = useState<XRayTab>('entities');
  const [snapshot, setSnapshot] = useState<XRaySnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [isIndexed, setIsIndexed] = useState<boolean | null>(null);
  const [entitySearch, setEntitySearch] = useState('');
  const [entitySort, setEntitySort] = useState<'relevance' | 'alphabetical'>('relevance');
  const [entityCategory, setEntityCategory] = useState<
    'all' | 'people' | 'places' | 'organizations' | 'artifacts' | 'concepts' | 'events'
  >('all');
  const [entityScope, setEntityScope] = useState<'page' | 'chapter' | 'book'>('page');
  const [relationshipFilter, setRelationshipFilter] = useState('all');
  const [relationshipView, setRelationshipView] = useState<'list' | 'graph'>('list');
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'major'>('all');
  const [jumpingEvidenceKey, setJumpingEvidenceKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedGraphEntity, setSelectedGraphEntity] = useState<XRayEntity | null>(null);

  const lastUpdatedLabel = useMemo(() => {
    if (!snapshot?.lastUpdated) return '';
    return new Date(snapshot.lastUpdated).toLocaleString();
  }, [snapshot?.lastUpdated]);

  const asOfTooltip = useMemo(() => {
    const pageLabel = `${_('As Of Page')} ${currentPage + 1}`;
    if (!lastUpdatedLabel) return pageLabel;
    return `${pageLabel} | ${_('Updated')} ${lastUpdatedLabel}`;
  }, [_, currentPage, lastUpdatedLabel]);

  const pendingLabel = useMemo(() => {
    const from = snapshot?.state?.pendingFromPage;
    const to = snapshot?.state?.pendingToPage;
    if (typeof to !== 'number') return '';
    const start = typeof from === 'number' ? from + 1 : to + 1;
    return start === to + 1 ? `${start}` : `${start}-${to + 1}`;
  }, [snapshot?.state?.pendingFromPage, snapshot?.state?.pendingToPage]);

  const stateErrorMessage = useMemo(() => {
    const error = snapshot?.state?.lastError;
    if (!error) return '';
    switch (error) {
      case 'not_indexed':
        return _('Book must be indexed first. Open AI Assistant to index.');
      case 'missing_api_key':
        return _('AI Gateway API key required.');
      case 'provider_not_supported':
        return _('X-Ray extraction currently requires AI Gateway.');
      case 'extraction_failed':
        return _('X-Ray extraction failed.');
      default:
        return error;
    }
  }, [snapshot?.state?.lastError, _]);

  const tabs = useMemo(
    () => [
      { id: 'entities', label: _('Entities') },
      { id: 'timeline', label: _('Timeline') },
      { id: 'relationships', label: _('Relationships') },
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

    if (aiSettings.provider !== 'ai-gateway') {
      setErrorMessage(_('X-Ray extraction currently requires AI Gateway.'));
      return;
    }

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
        bookMetadata: bookData?.book?.metadata,
      });
      await loadSnapshot();
    } catch (err) {
      const message = err instanceof Error ? err.message : _('X-Ray update failed.');
      setErrorMessage(message);
    } finally {
      setIsUpdating(false);
    }
  }, [aiSettings, bookHash, currentPage, bookTitle, appService, bookData, loadSnapshot, _]);

  const handleRebuild = useCallback(async () => {
    if (!aiSettings?.enabled || !bookHash) return;

    if (aiSettings.provider !== 'ai-gateway') {
      setErrorMessage(_('X-Ray extraction currently requires AI Gateway.'));
      return;
    }

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
        bookMetadata: bookData?.book?.metadata,
      });
      await loadSnapshot();
    } catch (err) {
      const message = err instanceof Error ? err.message : _('X-Ray rebuild failed.');
      setErrorMessage(message);
    } finally {
      setIsRebuilding(false);
    }
  }, [aiSettings, bookHash, currentPage, bookTitle, appService, bookData, loadSnapshot, _]);

  const handleEvidenceJump = useCallback(
    async (evidence: XRayEvidence) => {
      if (!bookKey) return;
      if (evidence.inferred || evidence.chunkId === 'inferred') return;
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

  const entities = useMemo(
    () =>
      (snapshot?.entities || []).filter((entity) => ENTITY_TYPE_WHITELIST.includes(entity.type)),
    [snapshot?.entities],
  );
  const relationships = useMemo(() => snapshot?.relationships || [], [snapshot?.relationships]);
  const events = useMemo(() => snapshot?.events || [], [snapshot?.events]);
  const relationshipEntities = useMemo(
    () => entities.filter((entity) => isLivingEntity(entity)),
    [entities],
  );
  const livingEntityIds = useMemo(
    () => new Set(relationshipEntities.map((entity) => entity.id)),
    [relationshipEntities],
  );
  const livingRelationships = useMemo(
    () =>
      relationships.filter(
        (rel) => livingEntityIds.has(rel.sourceId) && livingEntityIds.has(rel.targetId),
      ),
    [relationships, livingEntityIds],
  );
  const filteredRelationships = useMemo(
    () =>
      relationshipFilter === 'all'
        ? livingRelationships
        : livingRelationships.filter(
            (rel) => rel.sourceId === relationshipFilter || rel.targetId === relationshipFilter,
          ),
    [relationshipFilter, livingRelationships],
  );
  const filteredEvents = useMemo(
    () => (timelineFilter === 'major' ? events.filter((event) => event.importance >= 7) : events),
    [timelineFilter, events],
  );

  const currentSectionIndex = progress?.section?.current ?? null;

  const entityById = useMemo(() => {
    return new Map(entities.map((entity) => [entity.id, entity]));
  }, [entities]);

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
    for (const rel of livingRelationships) {
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
  }, [livingRelationships, entityById]);

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
      const isInferred = entity.facts.some((fact) => fact.inferred);
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
          case 'organization':
            return 'organizations';
          case 'artifact':
            return 'artifacts';
          case 'event':
            return 'events';
          case 'term':
          case 'concept':
          default:
            return 'concepts';
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
        isInferred,
      };
    });
  }, [entities, mentionStats, relatedByEntity, currentPage, _, truncateText]);

  const categoryCounts = useMemo(() => {
    const counts = {
      all: entityViews.length,
      people: 0,
      places: 0,
      organizations: 0,
      artifacts: 0,
      concepts: 0,
      events: 0,
    };
    for (const view of entityViews) {
      counts[view.category] += 1;
    }
    return counts;
  }, [entityViews]);

  const scopeAvailability = useMemo(
    () => ({
      page: entityViews.some((view) => view.onPage),
      chapter: entityViews.some((view) => view.inChapter),
    }),
    [entityViews],
  );

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

  const formatQuote = (quote: string, limit = 140): string => {
    if (quote.length <= limit) return quote;
    return `${quote.slice(0, limit).trim()}…`;
  };

  const getEntityTypeLabel = useCallback(
    (type: XRayEntity['type']) => {
      switch (type) {
        case 'character':
          return _('Character');
        case 'location':
          return _('Location');
        case 'organization':
          return _('Organization');
        case 'artifact':
          return _('Artifact');
        case 'event':
          return _('Event');
        case 'concept':
          return _('Concept');
        case 'term':
        default:
          return _('Term');
      }
    },
    [_],
  );

  const pillBase =
    'inline-flex h-6 items-center justify-center rounded-full px-2.5 text-[10px] font-semibold leading-[1] tracking-wide border';

  const pillVariants = {
    mention:
      'bg-base-200/70 text-base-content/70 border-base-300/40 dark:bg-base-300/30 dark:text-base-content/70 dark:border-base-300/40',
    lastSeen:
      'bg-base-200/70 text-base-content/70 border-base-300/40 dark:bg-base-300/30 dark:text-base-content/70 dark:border-base-300/40',
    onPage:
      'bg-base-200/70 text-base-content/70 border-base-300/40 dark:bg-base-300/30 dark:text-base-content/70 dark:border-base-300/40',
    inChapter:
      'bg-base-200/70 text-base-content/70 border-base-300/40 dark:bg-base-300/30 dark:text-base-content/70 dark:border-base-300/40',
    neutral:
      'bg-base-200/70 text-base-content/70 border-base-300/40 dark:bg-base-300/30 dark:text-base-content/70 dark:border-base-300/40',
    success:
      'bg-base-200/70 text-base-content/70 border-base-300/40 dark:bg-base-300/30 dark:text-base-content/70 dark:border-base-300/40',
    danger:
      'bg-base-200/70 text-base-content/70 border-base-300/40 dark:bg-base-300/30 dark:text-base-content/70 dark:border-base-300/40',
    warning:
      'bg-base-200/70 text-base-content/70 border-base-300/40 dark:bg-base-300/30 dark:text-base-content/70 dark:border-base-300/40',
  };

  const getPillClass = (variant: keyof typeof pillVariants) =>
    clsx(pillBase, pillVariants[variant] || pillVariants.neutral);

  const renderPill = (variant: keyof typeof pillVariants, content: React.ReactNode) => (
    <span className={getPillClass(variant)}>
      <span className='relative top-[0.5px]'>{content}</span>
    </span>
  );

  const renderMention = (mention: EntityMention, index: number) => {
    const evidenceKey = `${mention.evidence.chunkId}:${mention.evidence.page}:${index}`;
    const evidenceId = `${mention.evidence.chunkId}:${mention.evidence.page}`;
    const canJump = !mention.evidence.inferred && mention.evidence.chunkId !== 'inferred';
    return (
      <div key={evidenceKey} className='mt-1'>
        <button
          type='button'
          className='hover:bg-base-200/40 flex w-full items-start justify-between gap-2 rounded-md px-1 py-1 text-left transition-colors'
          onClick={() => handleEvidenceJump(mention.evidence)}
          disabled={!canJump || jumpingEvidenceKey === evidenceId}
        >
          <div className='text-base-content/70 text-[11px]'>
            {mention.context && (
              <span className='text-base-content/80 font-medium'>{mention.context}. </span>
            )}
            &ldquo;{formatQuote(mention.evidence.quote)}&rdquo;
          </div>
          <span className='text-base-content/50 text-[11px]'>
            {_('p.')}
            {mention.evidence.page + 1}
            {mention.evidence.inferred && (
              <span className='text-base-content/40 ml-1 text-[10px]'>{_('Inferred')}</span>
            )}
          </span>
        </button>
      </div>
    );
  };

  const renderEntityCard = (item: EntityView) => {
    const previewMention = item.topMentions[0];
    const previewJumpable =
      previewMention &&
      !previewMention.evidence.inferred &&
      previewMention.evidence.chunkId !== 'inferred';
    return (
      <div key={item.entity.id} className='border-base-300/60 rounded-md border p-3'>
        <div className='flex items-start justify-between gap-2'>
          <div>
            <div className='text-sm font-semibold'>{item.entity.canonicalName}</div>
            <p className='text-base-content/70 mt-1 text-xs'>{item.oneLiner}</p>
          </div>
          <div className='text-base-content/60 text-xs'>{getEntityTypeLabel(item.entity.type)}</div>
        </div>

        <div className='mt-3 flex flex-wrap gap-2 text-[10px]'>
          {renderPill('mention', `${_('Mentions')}: ${item.mentionCount}`)}
          {renderPill('lastSeen', `${_('Last Seen')}: ${_('p.')}${item.lastSeenPage + 1}`)}
          {item.isInferred && renderPill('warning', _('Inferred'))}
        </div>

        {previewMention ? (
          <button
            type='button'
            className='hover:bg-base-200/40 mt-2 w-full rounded-md px-1 py-1 text-left text-[11px] transition-colors'
            onClick={() => handleEvidenceJump(previewMention.evidence)}
            disabled={
              !previewJumpable ||
              jumpingEvidenceKey ===
                `${previewMention.evidence.chunkId}:${previewMention.evidence.page}`
            }
          >
            <span className='text-base-content/70'>
              &ldquo;{formatQuote(previewMention.evidence.quote)}&rdquo;
            </span>
            <span className='text-base-content/50 ml-2'>
              {_('p.')}
              {previewMention.evidence.page + 1}
            </span>
          </button>
        ) : (
          <p className='text-base-content/50 mt-2 text-[11px]'>{_('No mentions yet')}</p>
        )}

        {item.isLocked && (
          <div className='text-base-content/50 mt-2 text-[11px]'>{_('Locked until later')}</div>
        )}

        <details className='mt-2'>
          <summary className='text-base-content/60 cursor-pointer text-[11px]'>
            {_('Show More')}
          </summary>

          <div className='mt-2'>
            <div className='text-base-content/60 text-[11px]'>{_('Mentions')}</div>
            {item.topMentions.length === 0 ? (
              <p className='text-base-content/50 text-[11px]'>{_('No mentions yet')}</p>
            ) : (
              item.topMentions.map(renderMention)
            )}
          </div>

          {item.allMentions.length > item.topMentions.length && (
            <details className='mt-2'>
              <summary className='text-base-content/60 cursor-pointer text-[11px]'>
                {_('All Mentions')} ({item.allMentions.length})
              </summary>
              <div className='mt-2'>{item.allMentions.map(renderMention)}</div>
            </details>
          )}
        </details>
      </div>
    );
  };

  useEffect(() => {
    loadSnapshot();
    checkIndexed();
  }, [loadSnapshot, checkIndexed]);

  useEffect(() => {
    loadSnapshot();
  }, [currentPage, loadSnapshot]);

  useEffect(() => {
    if (relationshipFilter === 'all') return;
    if (!relationshipEntities.some((entity) => entity.id === relationshipFilter)) {
      setRelationshipFilter('all');
    }
  }, [relationshipEntities, relationshipFilter]);

  useEffect(() => {
    if (entityCategory === 'all') return;
    if (categoryCounts[entityCategory] === 0) {
      setEntityCategory('all');
    }
  }, [categoryCounts, entityCategory]);

  useEffect(() => {
    if (entityScope === 'page' && !scopeAvailability.page) {
      setEntityScope('book');
    }
    if (entityScope === 'chapter' && !scopeAvailability.chapter) {
      setEntityScope('book');
    }
  }, [entityScope, scopeAvailability]);

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
      <div className='px-3'>
        <div className='flex items-center justify-between gap-2'>
          <div className='dropdown dropdown-start'>
            <div
              tabIndex={0}
              role='button'
              className='content font-size-base inline-flex items-center gap-1'
            >
              {_('X-Ray')}
              <svg
                className='text-base-content/60 size-3'
                viewBox='0 0 20 20'
                fill='currentColor'
                aria-hidden='true'
              >
                <path
                  fillRule='evenodd'
                  d='M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.293l3.71-4.06a.75.75 0 1 1 1.1 1.02l-4.25 4.65a.75.75 0 0 1-1.1 0l-4.25-4.65a.75.75 0 0 1 .02-1.06Z'
                  clipRule='evenodd'
                />
              </svg>
            </div>
            <ul className='dropdown-content menu menu-sm border-base-300/60 xray-scrollbar rounded-box bg-base-100 z-10 mt-1 w-44 border p-1 shadow'>
              <li>
                <button
                  type='button'
                  onClick={handleUpdate}
                  disabled={isUpdating || isRebuilding || providerUnsupported}
                  title={_('Incremental update to current page')}
                >
                  {isUpdating ? _('Loading...') : _('Update X-Ray')}
                </button>
              </li>
              <li>
                <button
                  type='button'
                  onClick={handleRebuild}
                  disabled={isUpdating || isRebuilding || providerUnsupported}
                  title={_('Reprocess from scratch to current page')}
                >
                  {isRebuilding ? _('Loading...') : _('Rebuild X-Ray')}
                </button>
              </li>
            </ul>
          </div>
          <div className='lg:tooltip lg:tooltip-bottom' title={asOfTooltip}>
            <div className='text-base-content/70 flex items-center gap-1 whitespace-nowrap text-xs'>
              <span>{_('As Of Page')}</span>
              <span className='text-base-content font-medium'>{currentPage + 1}</span>
              {pendingLabel && (
                <span className='text-base-content/50 ml-1 text-[11px]'>
                  {_('Pending')}: {_('p.')}
                  {pendingLabel}
                </span>
              )}
            </div>
          </div>
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

      {providerUnsupported && (
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
              <p className='font-medium'>{_('AI Gateway required')}</p>
              <p className='text-warning/80 mt-1'>
                {_('X-Ray extraction currently requires AI Gateway. Switch provider in Settings.')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error message */}
      {(errorMessage || stateErrorMessage) && (
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
              <p className='text-error/80 mt-1'>{errorMessage || stateErrorMessage}</p>
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
      <div className='xray-scrollbar flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 pb-6'>
        {activeTab === 'entities' && (
          <div className='space-y-3'>
            <div className='flex flex-wrap items-center gap-2 text-xs'>
              <input
                className='input input-bordered input-xs h-7 w-full max-w-xs'
                value={entitySearch}
                onChange={(event) => setEntitySearch(event.target.value)}
                placeholder={_('Search Entities')}
              />
            </div>

            <div className='flex flex-wrap items-center gap-2 text-xs'>
              <div className='bg-base-200 flex w-full min-w-0 max-w-full flex-wrap items-center gap-1 rounded-lg p-1'>
                {(
                  [
                    { id: 'all', label: _('All'), count: categoryCounts.all },
                    { id: 'people', label: _('People'), count: categoryCounts.people },
                    { id: 'places', label: _('Places'), count: categoryCounts.places },
                    {
                      id: 'organizations',
                      label: _('Organizations'),
                      count: categoryCounts.organizations,
                    },
                    { id: 'artifacts', label: _('Artifacts'), count: categoryCounts.artifacts },
                    { id: 'concepts', label: _('Concepts'), count: categoryCounts.concepts },
                    { id: 'events', label: _('Events'), count: categoryCounts.events },
                  ] as const
                )
                  .filter((item) => item.id === 'all' || item.count > 0)
                  .map((item) => (
                    <button
                      key={item.id}
                      className={clsx(
                        'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium leading-none',
                        entityCategory === item.id
                          ? 'bg-base-100 text-base-content shadow-sm'
                          : 'text-base-content/70 hover:bg-base-100/50 bg-transparent',
                      )}
                      onClick={() => setEntityCategory(item.id)}
                    >
                      <span className='leading-none'>{item.label}</span>
                      <span className='text-base-content/70 bg-base-100/70 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] leading-none'>
                        <span className='relative top-[0.5px]'>{item.count}</span>
                      </span>
                    </button>
                  ))}
              </div>

              <div className='bg-base-200 flex items-center gap-1 rounded-lg p-1'>
                {(
                  [
                    { id: 'page', label: _('Page'), tooltip: _('Only entities on this page') },
                    {
                      id: 'chapter',
                      label: _('Chapter'),
                      tooltip: _('Only entities in this chapter'),
                    },
                    { id: 'book', label: _('Book'), tooltip: _('All entities in the book') },
                  ] as const
                ).map((item) => {
                  const isDisabled =
                    item.id === 'page'
                      ? !scopeAvailability.page
                      : item.id === 'chapter'
                        ? !scopeAvailability.chapter
                        : false;
                  return (
                    <div
                      key={item.id}
                      className='lg:tooltip lg:tooltip-bottom'
                      title={item.tooltip}
                    >
                      <button
                        className={clsx(
                          'btn btn-xs rounded-md border-none px-2',
                          entityScope === item.id && !isDisabled
                            ? 'bg-base-100 text-base-content shadow-sm'
                            : 'text-base-content/60 hover:bg-base-100/50 bg-transparent',
                          isDisabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
                        )}
                        onClick={() => setEntityScope(item.id)}
                        disabled={isDisabled}
                      >
                        {item.label}
                      </button>
                    </div>
                  );
                })}
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
                <div className='space-y-3'>
                  {currentEntities.length === 0 ? (
                    <p className='text-base-content/60 text-sm'>{_('None found')}</p>
                  ) : (
                    currentEntities.map(renderEntityCard)
                  )}
                </div>

                {notableClips.length > 0 && (
                  <div>
                    <div className='text-xs font-semibold'>{_('Notable Clips')}</div>
                    <div className='mt-2 space-y-3'>
                      {notableClips.map((clip) => (
                        <div key={clip.id} className='border-base-300/60 rounded-md border p-3'>
                          <div className='text-base-content/60 text-xs'>
                            {_('Page')} {clip.page + 1}
                          </div>
                          <p className='text-sm'>{clip.summary}</p>
                          {clip.evidence && (
                            <button
                              type='button'
                              className='text-base-content/70 hover:bg-base-200/40 mt-1 w-full rounded-md px-1 py-1 text-left text-xs transition-colors'
                              onClick={() => handleEvidenceJump(clip.evidence!)}
                              disabled={
                                clip.evidence.inferred ||
                                clip.evidence.chunkId === 'inferred' ||
                                jumpingEvidenceKey ===
                                  `${clip.evidence.chunkId}:${clip.evidence.page}`
                              }
                            >
                              &ldquo;{formatQuote(clip.evidence.quote)}&rdquo;
                            </button>
                          )}
                          <p className='text-base-content/70 mt-1 text-xs'>
                            {_('Why it matters')}: {clip.summary}
                          </p>
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
            <div className='flex w-full flex-wrap items-center gap-2 text-xs'>
              <span className='text-base-content/60 whitespace-nowrap'>
                {_('Filter by Importance')}
              </span>
              <select
                className='select select-bordered select-xs h-7 w-full min-w-0 sm:w-auto'
                value={timelineFilter}
                onChange={(event) => setTimelineFilter(event.target.value as 'all' | 'major')}
              >
                <option value='all'>{_('All Events')}</option>
                <option value='major'>{_('Major Events')}</option>
              </select>
            </div>
            {filteredEvents.length === 0 ? (
              <p className='text-base-content/60 text-sm'>{_('No events yet')}</p>
            ) : (
              <div className='relative'>
                <div className='bg-base-content/25 absolute bottom-0 left-2 top-0 z-0 w-px -translate-x-1/2' />
                <div className='space-y-4'>
                  {filteredEvents
                    .slice()
                    .sort((a, b) => a.page - b.page)
                    .map((event) => {
                      const isMajor = event.importance >= 7;
                      const primaryEvidence = event.evidence[0];
                      return (
                        <div key={event.id} className='relative flex gap-3'>
                          <div className='relative flex w-4 flex-none items-start justify-center'>
                            <span
                              className={clsx(
                                'z-10 inline-flex rounded-full border',
                                isMajor
                                  ? 'bg-base-content border-base-content ring-base-content/30 size-3 ring-1'
                                  : 'bg-base-content border-base-content/80 size-2',
                              )}
                            />
                          </div>
                          <div
                            className={clsx(
                              'border-base-300/60 bg-base-100/50 min-w-0 flex-1 rounded-md border p-3',
                              isMajor && 'border-base-content/20',
                            )}
                          >
                            <div className='text-base-content/60 text-xs'>
                              {_('Page')} {event.page + 1}
                            </div>
                            <p className='text-sm'>{event.summary}</p>
                            {primaryEvidence && (
                              <button
                                type='button'
                                className='text-base-content/50 mt-1 text-left text-[11px] hover:underline disabled:opacity-60'
                                onClick={() => handleEvidenceJump(primaryEvidence)}
                                disabled={
                                  primaryEvidence.inferred ||
                                  primaryEvidence.chunkId === 'inferred' ||
                                  jumpingEvidenceKey ===
                                    `${primaryEvidence.chunkId}:${primaryEvidence.page}`
                                }
                                title={_('Jump to quote')}
                              >
                                &ldquo;{primaryEvidence.quote}&rdquo;
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'relationships' && (
          <div className='space-y-3'>
            <div className='flex w-full flex-wrap items-center gap-2 text-xs'>
              <span className='text-base-content/60 whitespace-nowrap'>
                {_('Filter by Entity')}
              </span>
              <select
                className='select select-bordered select-xs h-7 w-full min-w-0 focus:outline-none focus:outline-offset-0 focus:ring-0 focus:ring-offset-0 sm:w-auto'
                value={relationshipFilter}
                onChange={(event) => setRelationshipFilter(event.target.value)}
              >
                <option value='all'>{_('All Entities')}</option>
                {relationshipEntities
                  .slice()
                  .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))
                  .map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.canonicalName}
                    </option>
                  ))}
              </select>
              <div className='bg-base-200 ml-0 flex w-full items-center justify-start gap-1 rounded-lg p-1 sm:ml-auto sm:w-auto sm:justify-end'>
                <button
                  className={clsx(
                    'btn btn-xs rounded-md border-none px-2',
                    relationshipView === 'list'
                      ? 'bg-base-100 text-base-content shadow-sm'
                      : 'text-base-content/60 hover:bg-base-100/50 bg-transparent',
                  )}
                  onClick={() => setRelationshipView('list')}
                  title={_('List View')}
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
                  title={_('Graph View')}
                >
                  <PiGraph className='size-4' />
                </button>
              </div>
            </div>
            {relationshipView === 'graph' ? (
              <div className='space-y-3'>
                <div className='border-base-300 h-[300px] w-full min-w-0 overflow-hidden rounded-md border'>
                  <XRayGraph
                    entities={relationshipEntities}
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
                        <span className='text-base-content/50 text-[10px]'>
                          {getEntityTypeLabel(selectedGraphEntity.type)}
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
                          <div className='text-base-content/60 text-[11px]'>{_('Connections')}</div>
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
                                      ({_('Inferred')})
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
                        <div className='text-base-content/60 text-[11px]'>{_('Facts')}</div>
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
                        <span className='text-base-content/50 ml-2 text-[10px]'>
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
                          rel.evidence[0]!.inferred ||
                          rel.evidence[0]!.chunkId === 'inferred' ||
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
      </div>
    </div>
  );
};

export default XRayView;
