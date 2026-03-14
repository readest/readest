import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  formatRelationshipLabel,
  getXRayEntitySummaries,
  getXRaySnapshot,
  isHumanEntity,
  rebuildXRayToPage,
  updateXRayForProgress,
} from '@/services/ai/xrayService';
import { isBookIndexed } from '@/services/ai/ragService';
import type {
  XRayEntity,
  XRayEntityType,
  XRayEvidence,
  XRayRelationship,
  XRaySnapshot,
} from '@/services/ai/types';
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

const isLivingEntity = (entity?: XRayEntity | null): boolean => isHumanEntity(entity);

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

interface RelationshipPair {
  key: string;
  leftId: string;
  rightId: string;
  leftName: string;
  rightName: string;
  relationships: XRayRelationship[];
  evidence: XRayEvidence[];
  lastSeenPage: number;
}

const uniqueStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output;
};

const ensureSentence = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/[.!?]$/.test(trimmed)) return trimmed;
  return `${trimmed}.`;
};

const buildRelationshipPairs = (
  relationships: XRayRelationship[],
  entityById: Map<string, XRayEntity>,
): RelationshipPair[] => {
  const map = new Map<string, RelationshipPair>();
  for (const rel of relationships) {
    const source = entityById.get(rel.sourceId);
    const target = entityById.get(rel.targetId);
    if (!source || !target) continue;
    const [left, right] = source.id < target.id ? [source, target] : [target, source];
    const key = `${left.id}|${right.id}`;
    const entry = map.get(key) || {
      key,
      leftId: left.id,
      rightId: right.id,
      leftName: left.canonicalName,
      rightName: right.canonicalName,
      relationships: [] as XRayRelationship[],
      evidence: [] as XRayEvidence[],
      lastSeenPage: -1,
    };
    entry.relationships.push(rel);
    entry.evidence.push(...(rel.evidence || []));
    entry.lastSeenPage = Math.max(entry.lastSeenPage, rel.lastSeenPage ?? -1);
    map.set(key, entry);
  }
  return Array.from(map.values());
};

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
  const [entitySummaries, setEntitySummaries] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [isXRayProcessing, setIsXRayProcessing] = useState(false);
  const [isIndexed, setIsIndexed] = useState<boolean | null>(null);
  const [entitySearch, setEntitySearch] = useState('');
  const [entitySort, setEntitySort] = useState<'relevance' | 'alphabetical'>('relevance');
  const [entityCategory, setEntityCategory] = useState<
    'all' | 'people' | 'places' | 'organizations' | 'artifacts' | 'concepts' | 'events'
  >('all');
  const [entityScope, setEntityScope] = useState<'page' | 'chapter' | 'book'>('page');
  const [relationshipFilter, setRelationshipFilter] = useState('all');
  const [relationshipView, setRelationshipView] = useState<'list' | 'graph'>('list');
  const [jumpingEvidenceKey, setJumpingEvidenceKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedGraphEntity, setSelectedGraphEntity] = useState<XRayEntity | null>(null);
  const hasLoadedRef = useRef(false);
  const loadInFlightRef = useRef(false);
  const pendingLoadRef = useRef<{ silent: boolean } | null>(null);
  const snapshotRef = useRef<XRaySnapshot | null>(null);
  const currentPageRef = useRef(currentPage);

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

  const notIndexed = useMemo(
    () => isIndexed === false || snapshot?.state?.lastError === 'not_indexed',
    [isIndexed, snapshot?.state?.lastError],
  );

  const stateErrorMessage = useMemo(() => {
    const error = snapshot?.state?.lastError;
    if (!error || error === 'not_indexed') return '';
    switch (error) {
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
    if (!aiSettings?.enabled || providerUnsupported) {
      setIsIndexed(null);
      return;
    }
    const indexed = await isBookIndexed(bookHash);
    setIsIndexed(indexed);
  }, [bookHash, aiSettings?.enabled, providerUnsupported]);

  const loadSummaries = useCallback(
    async (data?: XRaySnapshot | null) => {
      if (!aiSettings?.enabled || !bookHash) return;
      const snapshotData = data ?? snapshotRef.current;
      if (!snapshotData) return;
      try {
        const run = async () => {
          const summaries = await getXRayEntitySummaries({
            bookHash,
            maxPageIncluded: currentPageRef.current,
            settings: aiSettings,
            entities: snapshotData.entities,
            relationships: snapshotData.relationships,
            events: snapshotData.events,
            claims: snapshotData.claims,
          });
          setEntitySummaries(summaries);
        };

        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
          await new Promise<void>((resolve) => {
            window.requestIdleCallback(
              () => {
                void run().finally(resolve);
              },
              { timeout: 1500 },
            );
          });
          return;
        }

        await run();
      } catch (err) {
        console.warn('Failed to load X-Ray summaries:', err);
      }
    },
    [aiSettings, bookHash],
  );

  const loadSnapshot = useCallback(
    async (options?: { silent?: boolean; page?: number }) => {
      const silent = options?.silent ?? false;
      const targetPage = options?.page ?? currentPageRef.current;
      if (!bookHash) {
        hasLoadedRef.current = false;
        setIsLoading(false);
        return;
      }
      if (loadInFlightRef.current) {
        const pending = pendingLoadRef.current;
        pendingLoadRef.current = { silent: pending ? pending.silent && silent : silent };
        return;
      }
      loadInFlightRef.current = true;
      const shouldShowLoading = !silent && !hasLoadedRef.current;
      if (shouldShowLoading) setIsLoading(true);
      setErrorMessage(null);
      try {
        const data = await getXRaySnapshot(bookHash, targetPage);
        snapshotRef.current = data;
        setSnapshot(data);
        void loadSummaries(data);
      } catch (err) {
        console.error('Failed to load X-Ray snapshot:', err);
        setErrorMessage(_('Failed to load X-Ray data'));
      } finally {
        hasLoadedRef.current = true;
        if (shouldShowLoading) setIsLoading(false);
        loadInFlightRef.current = false;
        const pending = pendingLoadRef.current;
        if (pending) {
          pendingLoadRef.current = null;
          void loadSnapshot(pending);
        }
      }
    },
    [bookHash, loadSummaries, _],
  );

  const handleUpdate = useCallback(async () => {
    if (!aiSettings?.enabled || !bookHash) return;

    if (aiSettings.provider !== 'ai-gateway') {
      setErrorMessage(_('X-Ray extraction currently requires AI Gateway.'));
      return;
    }

    const indexed = await isBookIndexed(bookHash);
    if (!indexed) {
      setIsIndexed(false);
      setErrorMessage(null);
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
      await loadSnapshot({ silent: true });
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
      setIsIndexed(false);
      setErrorMessage(null);
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
      await loadSnapshot({ silent: true });
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
  const events = useMemo<XRaySnapshot['events']>(() => snapshot?.events || [], [snapshot?.events]);
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

  const getEntitySummaryText = useCallback(
    (entity: XRayEntity) =>
      entitySummaries[entity.id] ||
      entity.description ||
      entity.facts[0]?.value ||
      _('No details available yet'),
    [entitySummaries, _],
  );

  const formatEventPageRange = useCallback(
    (event: XRaySnapshot['events'][number]) => {
      const pages = event.evidence.map((item) => item.page).filter((page) => Number.isFinite(page));
      if (pages.length === 0) return `${_('Page')} ${event.page + 1}`;
      const minPage = Math.min(...pages);
      const maxPage = Math.max(...pages);
      if (minPage === maxPage) return `${_('Page')} ${minPage + 1}`;
      return `${_('Page')} ${minPage + 1}-${maxPage + 1}`;
    },
    [_],
  );

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

  const relationshipPairsAll = useMemo(
    () => buildRelationshipPairs(livingRelationships, entityById),
    [livingRelationships, entityById],
  );

  const relationshipPairs = useMemo(
    () =>
      buildRelationshipPairs(filteredRelationships, entityById).sort(
        (a, b) => b.lastSeenPage - a.lastSeenPage,
      ),
    [filteredRelationships, entityById],
  );

  const buildPairSummary = useCallback((pair: RelationshipPair): string => {
    const descriptions = uniqueStrings(
      pair.relationships.map((rel) => rel.description || '').filter(Boolean),
    );
    const typeLabels = uniqueStrings(
      pair.relationships.map((rel) => formatRelationshipLabel(rel.type)),
    );
    const leftToken = pair.leftName.toLowerCase();
    const rightToken = pair.rightName.toLowerCase();
    const namedDescriptions = descriptions.filter((text) => {
      const lower = text.toLowerCase();
      return lower.includes(leftToken) && lower.includes(rightToken);
    });
    if (namedDescriptions.length > 0) {
      return namedDescriptions
        .slice(0, 2)
        .map((value) => ensureSentence(value))
        .filter(Boolean)
        .join(' ');
    }
    const lead = (() => {
      if (typeLabels.length === 1) {
        return ensureSentence(`${pair.leftName} is ${typeLabels[0]} ${pair.rightName}`);
      }
      if (typeLabels.length > 1) {
        return ensureSentence(
          `Relationship between ${pair.leftName} and ${pair.rightName} includes ${typeLabels.join(', ')}`,
        );
      }
      return ensureSentence(`Relationship between ${pair.leftName} and ${pair.rightName} is noted`);
    })();
    const tail = descriptions.length > 0 ? ensureSentence(descriptions[0]!) : '';
    return [lead, tail].filter(Boolean).join(' ');
  }, []);

  const buildEntityRelationshipSummary = useCallback(
    (pairs: RelationshipPair[]): string => {
      if (pairs.length === 0) return _('No relationships yet');
      const ranked = pairs.slice().sort((a, b) => {
        if (b.relationships.length !== a.relationships.length) {
          return b.relationships.length - a.relationships.length;
        }
        return b.lastSeenPage - a.lastSeenPage;
      });
      const sentences = ranked
        .slice(0, 3)
        .map((pair) => buildPairSummary(pair))
        .filter(Boolean);
      return sentences.join(' ');
    },
    [buildPairSummary, _],
  );

  const relationshipSummaryByEntity = useMemo(() => {
    const pairMap = new Map<string, RelationshipPair[]>();
    for (const pair of relationshipPairsAll) {
      const leftList = pairMap.get(pair.leftId) ?? [];
      leftList.push(pair);
      pairMap.set(pair.leftId, leftList);
      const rightList = pairMap.get(pair.rightId) ?? [];
      rightList.push(pair);
      pairMap.set(pair.rightId, rightList);
    }
    const summaryMap = new Map<string, string>();
    for (const entity of relationshipEntities) {
      const pairs = pairMap.get(entity.id) ?? [];
      summaryMap.set(entity.id, buildEntityRelationshipSummary(pairs));
    }
    return summaryMap;
  }, [relationshipEntities, relationshipPairsAll, buildEntityRelationshipSummary]);

  const getRelationshipSummaryText = useCallback(
    (entity?: XRayEntity | null) => {
      if (!entity) return _('No relationships yet');
      return relationshipSummaryByEntity.get(entity.id) || _('No relationships yet');
    },
    [relationshipSummaryByEntity, _],
  );

  const relationshipFilterEntity = useMemo(
    () => relationshipEntities.find((entity) => entity.id === relationshipFilter) || null,
    [relationshipEntities, relationshipFilter],
  );

  const pickPairEvidence = useCallback((pair: RelationshipPair): XRayEvidence | null => {
    if (pair.evidence.length === 0) return null;
    const ordered = pair.evidence.slice().sort((a, b) => b.page - a.page);
    return (
      ordered.find((item) => !item.inferred && item.chunkId !== 'inferred') || ordered[0] || null
    );
  }, []);

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
      const mentionCount = stats.mentions.length;
      const lastSeenPage = stats.lastSeenPage >= 0 ? stats.lastSeenPage : entity.lastSeenPage;
      const relevanceScore =
        mentionCount * 10 + (stats.onPage ? 50 : 0) + (stats.inChapter ? 20 : 0) + lastSeenPage;
      const oneLiner = getEntitySummaryText(entity);
      const related = relatedByEntity.get(entity.id) ?? [];
      const isInferred = entity.facts.some((fact) => fact.inferred);
      const searchText = [
        entity.canonicalName,
        getEntitySummaryText(entity),
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
  }, [entities, mentionStats, relatedByEntity, currentPage, getEntitySummaryText]);

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
    'inline-flex h-5 items-center justify-center rounded-full px-2 text-[10px] font-semibold leading-[1] tracking-wide border';

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
    return (
      <div key={item.entity.id} className='border-base-300/60 rounded-md border p-3'>
        <div className='flex items-start justify-between gap-2'>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <div className='text-sm font-semibold'>{item.entity.canonicalName}</div>
              <div className='flex flex-wrap items-center gap-1.5 text-[10px]'>
                {renderPill('mention', `${_('Mentions')}: ${item.mentionCount}`)}
                {renderPill('lastSeen', `${_('Last Seen')}: ${_('p.')}${item.lastSeenPage + 1}`)}
                {item.isInferred && renderPill('warning', _('Inferred'))}
              </div>
            </div>
          </div>
          <div className='text-base-content/60 shrink-0 text-xs'>
            {getEntityTypeLabel(item.entity.type)}
          </div>
        </div>
        <p className='text-base-content/70 mt-1 text-xs'>{item.oneLiner}</p>

        <details className='mt-2'>
          <summary className='text-base-content/60 cursor-pointer text-[11px]'>
            {_('Quotes')} ({item.mentionCount})
          </summary>
          <div className='mt-2'>
            {item.mentions.length === 0 ? (
              <p className='text-base-content/50 text-[11px]'>{_('No quotes yet')}</p>
            ) : (
              item.mentions.map(renderMention)
            )}
          </div>
        </details>

        {item.isLocked && (
          <div className='text-base-content/50 mt-2 text-[11px]'>{_('Locked until later')}</div>
        )}
      </div>
    );
  };

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    checkIndexed();
  }, [checkIndexed]);

  useEffect(() => {
    currentPageRef.current = currentPage;
    if (!hasLoadedRef.current) return;
    loadSnapshot({ silent: true, page: currentPage });
  }, [currentPage, loadSnapshot]);

  useEffect(() => {
    hasLoadedRef.current = false;
    pendingLoadRef.current = null;
    loadInFlightRef.current = false;
    snapshotRef.current = null;
    setSnapshot(null);
    setEntitySummaries({});
    setIsLoading(Boolean(bookHash));
  }, [bookHash]);

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
      const nextMaxPage = event.detail?.maxPageIncluded;
      const currentMaxPage = snapshotRef.current?.state?.lastAnalyzedPage;
      if (
        typeof nextMaxPage === 'number' &&
        typeof currentMaxPage === 'number' &&
        nextMaxPage <= currentMaxPage
      )
        return;
      loadSnapshot({ silent: true });
    };
    eventDispatcher.on('xray-updated', handler);
    return () => {
      eventDispatcher.off('xray-updated', handler);
    };
  }, [bookHash, loadSnapshot]);

  useEffect(() => {
    const handler = (event: CustomEvent) => {
      if (event.detail?.bookHash !== bookHash) return;
      void loadSummaries(snapshotRef.current);
    };
    eventDispatcher.on('xray-summaries-updated', handler);
    return () => {
      eventDispatcher.off('xray-summaries-updated', handler);
    };
  }, [bookHash, loadSummaries]);

  useEffect(() => {
    const handler = (event: CustomEvent) => {
      if (event.detail?.bookHash !== bookHash) return;
      if (event.detail?.status === 'start') {
        setIsXRayProcessing(true);
        return;
      }
      if (event.detail?.status === 'end') {
        setIsXRayProcessing(false);
      }
    };
    eventDispatcher.on('xray-processing', handler);
    return () => {
      eventDispatcher.off('xray-processing', handler);
    };
  }, [bookHash]);

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

  const showProcessing = isXRayProcessing || isUpdating || isRebuilding;

  return (
    <div className='relative flex h-full flex-col'>
      {showProcessing && (
        <div className='absolute inset-0 z-20 flex items-center justify-center'>
          <div className='bg-base-100/40 absolute inset-0 backdrop-blur-sm' />
          <div className='border-base-300/60 bg-base-100/80 text-base-content relative z-10 flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide shadow-sm'>
            <span className='border-primary size-3 animate-spin rounded-full border-2 border-t-transparent' />
            {_('xray-ing')}
          </div>
        </div>
      )}
      <div className='px-3'>
        <div className='flex items-center justify-between gap-2'>
          <div className='dropdown dropdown-start'>
            <button
              type='button'
              tabIndex={0}
              className='btn btn-ghost btn-sm h-7 min-h-7 gap-1 px-2 normal-case'
              onClick={(event) => event.currentTarget.focus()}
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
            </button>
            <ul className='dropdown-content bgcolor-base-200 no-triangle xray-scrollbar menu menu-sm rounded-box absolute z-[1] mt-2 w-44 p-1 shadow'>
              <li>
                <button
                  type='button'
                  onClick={handleUpdate}
                  disabled={isUpdating || isRebuilding || providerUnsupported || notIndexed}
                  title={_('Incremental update to current page')}
                >
                  {isUpdating ? _('Loading...') : _('Update X-Ray')}
                </button>
              </li>
              <li>
                <button
                  type='button'
                  onClick={handleRebuild}
                  disabled={isUpdating || isRebuilding || providerUnsupported || notIndexed}
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
      {notIndexed && (
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
                {_('Book must be indexed first. Open AI Assistant to index.')}
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
                className='input input-bordered input-xs focus:border-base-300 h-7 w-full max-w-xs pt-0.5 shadow-none focus:shadow-none focus:outline-none focus:ring-0 focus:ring-offset-0'
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
              </div>
            )}
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className='space-y-3'>
            {events.length === 0 ? (
              <p className='text-base-content/60 text-sm'>{_('No events yet')}</p>
            ) : (
              <div className='relative'>
                <div className='bg-base-content/25 absolute bottom-0 left-2 top-0 z-0 w-px -translate-x-1/2' />
                <div className='space-y-4'>
                  {events
                    .slice()
                    .sort((a, b) => a.page - b.page)
                    .map((event) => {
                      const pageLabel = formatEventPageRange(event);
                      return (
                        <div key={event.id} className='relative flex gap-3'>
                          <div className='relative flex w-4 flex-none items-start justify-center'>
                            <span className='bg-base-content border-base-content ring-base-content/30 z-10 inline-flex size-2 rounded-full border ring-1' />
                          </div>
                          <div className='border-base-300/60 bg-base-100/50 min-w-0 flex-1 rounded-md border p-3'>
                            <div className='text-base-content/60 text-xs'>{pageLabel}</div>
                            <p className='text-sm'>{event.summary}</p>
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
                    events={[]}
                    onNodeClick={(entity) => setSelectedGraphEntity(entity)}
                    selectedEntityId={selectedGraphEntity?.id}
                  />
                </div>
                {selectedGraphEntity ? (
                  <div className='border-base-300/60 rounded-md border p-3'>
                    <div className='flex items-start justify-between gap-2'>
                      <div>
                        <div className='text-sm font-semibold'>
                          {selectedGraphEntity.canonicalName}
                        </div>
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
                      {getRelationshipSummaryText(selectedGraphEntity)}
                    </p>
                  </div>
                ) : (
                  <p className='text-base-content/50 text-center text-xs'>
                    {_('Click a node to see details')}
                  </p>
                )}
              </div>
            ) : relationshipPairs.length === 0 ? (
              <p className='text-base-content/60 text-sm'>{_('No relationships yet')}</p>
            ) : (
              <div className='space-y-3'>
                {relationshipFilter !== 'all' && relationshipFilterEntity && (
                  <div className='border-base-300/60 rounded-md border p-3'>
                    <div className='text-sm font-semibold'>
                      {relationshipFilterEntity.canonicalName}
                    </div>
                    <p className='text-base-content/80 mt-2 text-xs leading-relaxed'>
                      {getRelationshipSummaryText(relationshipFilterEntity)}
                    </p>
                  </div>
                )}
                {relationshipPairs.map((pair) => {
                  const typeLabels = uniqueStrings(
                    pair.relationships.map((rel) => formatRelationshipLabel(rel.type)),
                  );
                  const description = buildPairSummary(pair);
                  const evidence = pickPairEvidence(pair);
                  const isInferred = pair.relationships.every((rel) => rel.inferred);
                  return (
                    <div
                      key={pair.key}
                      className='border-base-300/60 hover:border-base-300 rounded-md border p-3 transition-colors'
                    >
                      <div className='flex flex-wrap items-center gap-2 text-xs'>
                        <span className='bg-base-200/70 text-base-content/80 rounded-full px-2 py-1 font-medium'>
                          {pair.leftName}
                        </span>
                        <span className='text-base-content/40'>↔</span>
                        <span className='bg-base-200/70 text-base-content/80 rounded-full px-2 py-1 font-medium'>
                          {pair.rightName}
                        </span>
                        <div className='ml-auto flex flex-wrap gap-1'>
                          {typeLabels.map((label) => (
                            <span
                              key={`${pair.key}-${label}`}
                              className='text-base-content/60 bg-base-200/70 rounded-full px-2 py-1 text-[10px]'
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>
                      <p className='text-base-content/70 mt-2 text-xs'>
                        {description}
                        {isInferred && (
                          <span className='text-base-content/50 ml-2 text-[10px]'>
                            {_('Inferred')}
                          </span>
                        )}
                      </p>
                      {evidence && (
                        <button
                          type='button'
                          className='text-base-content/50 mt-2 text-left text-[11px] hover:underline disabled:opacity-60'
                          onClick={() => handleEvidenceJump(evidence)}
                          disabled={
                            evidence.inferred ||
                            evidence.chunkId === 'inferred' ||
                            jumpingEvidenceKey === `${evidence.chunkId}:${evidence.page}`
                          }
                          title={_('Jump to quote')}
                        >
                          &ldquo;{formatQuote(evidence.quote, 120)}&rdquo; (p.
                          {evidence.page + 1})
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default XRayView;
