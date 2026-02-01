import { generateText, Output, streamText } from 'ai';
import type { ModelMessage } from 'ai';
import { nanoid } from 'nanoid';

import { aiStore } from './storage/aiStore';
import { getAIProvider } from './providers';
import { hybridSearch, isBookIndexed } from './ragService';
import { aiLogger } from './logger';
import { buildXRayExtractionPrompt, buildXRayRecapPrompt, buildXRaySystemPrompt } from './prompts';
import { extractTermContext } from './xray/lexrank';
import { appendXRayLog } from './xray/logWriter';
import { filterEvidence, xrayExtractionSchema } from './xray/validators';
import { PossessiveParser } from './xray/possessiveParser';
import { CoreferenceResolver } from './xray/coreferenceResolver';
import { XRayGraphInference } from './xray/graphInference';
import { XRayGraphBuilder } from './xray/graphBuilder';
import { eventDispatcher } from '@/utils/event';
import type { AppService } from '@/types/system';
import type {
  AISettings,
  ScoredChunk,
  XRayAliasEntry,
  XRayClaim,
  XRayEntity,
  XRayEntityType,
  XRayEvidence,
  XRayExtractionV1,
  XRayLookupResult,
  XRayRelationship,
  XRaySnapshot,
  XRayState,
  XRayTextUnit,
  XRayTimelineEvent,
} from './types';

const XRAY_VERSION = 1;
const XRAY_MIN_PAGE_DELTA = 3;
const XRAY_MAX_BATCH_PAGES = 10;
const XRAY_MAX_TEXT_UNITS = 18;
const XRAY_LOOKUP_TOPK = 6;
const XRAY_RECAP_INACTIVITY_MS = 28 * 60 * 60 * 1000;

const processingBooks = new Set<string>();

const normalizeName = (value: string): string => {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
};

const isNoisyEntityName = (name: string, type: XRayEntityType): boolean => {
  if (!name) return true;
  if (name.includes('_')) return true;
  const normalized = normalizeName(name);
  if (!normalized) return true;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (type === 'character') {
    const first = tokens[0] ?? '';
    if (tokens.length === 1 && first.length <= 2) return true;
    if (['i', 'me', 'my', 'mine', 'we', 'our', 'you', 'your', 'he', 'she', 'they'].includes(first))
      return true;
    if (
      [
        'must',
        'wonder',
        'admit',
        'trace',
        'do',
        'shall',
        'had',
        'never',
        'contented',
        'present',
        'said',
        'says',
        'the',
        'a',
        'an',
        'and',
      ].includes(first)
    )
      return true;
    if (name.toLowerCase().startsWith('i ')) return true;
  }
  return false;
};

const uniqueStrings = (items: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = normalizeName(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
};

const buildTextUnits = (chunks: ScoredChunk[], bookHash: string): XRayTextUnit[] => {
  return chunks.map((chunk) => ({
    id: `${chunk.id}-unit`,
    bookHash,
    chunkId: chunk.id,
    page: chunk.pageNumber,
    text: chunk.text,
  }));
};

const buildTextUnitsFromChunks = (chunks: ScoredChunk[] | XRayTextUnit[], bookHash: string) => {
  if (chunks.length === 0) return [] as XRayTextUnit[];
  const first = chunks[0];
  if (first && 'text' in first && 'chunkId' in first) return chunks as XRayTextUnit[];
  return buildTextUnits(chunks as ScoredChunk[], bookHash);
};

const buildTermVariants = (term: string): string[] => {
  const raw = term.trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const normalized = lower.replace(/[\s]+/g, ' ');
  const variants = new Set<string>([raw, lower, normalized]);
  if (!normalized.endsWith('s')) variants.add(`${normalized}s`);
  if (!normalized.endsWith("'s")) variants.add(`${normalized}'s`);
  if (!normalized.endsWith('s')) variants.add(`${normalized}s'`);
  return Array.from(variants);
};

const summarizeEntity = (entity: XRayEntity): string => {
  if (entity.description) return entity.description;
  const fact = entity.facts[0];
  if (fact) return `${fact.key}: ${fact.value}`;
  return '';
};

const buildAliasEntries = (bookHash: string, entity: XRayEntity): XRayAliasEntry[] => {
  const entries: XRayAliasEntry[] = [];
  const aliases = uniqueStrings([entity.canonicalName, ...entity.aliases]);
  const now = Date.now();
  for (const alias of aliases) {
    const normalized = normalizeName(alias);
    entries.push({
      key: `${bookHash}:${normalized}`,
      bookHash,
      alias,
      normalized,
      entityIds: [entity.id],
      lastUpdated: now,
    });
  }
  return entries;
};

const mergeAliasEntries = (
  existing: XRayAliasEntry[],
  incoming: XRayAliasEntry[],
): XRayAliasEntry[] => {
  const map = new Map(existing.map((entry) => [entry.key, entry]));
  for (const entry of incoming) {
    const current = map.get(entry.key);
    if (!current) {
      map.set(entry.key, entry);
      continue;
    }
    const ids = new Set([...current.entityIds, ...entry.entityIds]);
    map.set(entry.key, { ...current, entityIds: Array.from(ids), lastUpdated: entry.lastUpdated });
  }
  return Array.from(map.values());
};

const resolveEntityId = (
  name: string,
  entityByName: Map<string, XRayEntity>,
  aliasMap: Map<string, XRayEntity[]>,
): XRayEntity | null => {
  const normalized = normalizeName(name);
  const direct = entityByName.get(normalized);
  if (direct) return direct;
  const aliasMatches = aliasMap.get(normalized);
  if (!aliasMatches || aliasMatches.length === 0) return null;
  return [...aliasMatches].sort((a, b) => b.lastSeenPage - a.lastSeenPage)[0] || null;
};

const XRAY_MODEL = 'openai/gpt-5-nano';

const streamViaApiRoute = async (
  messages: ModelMessage[],
  systemPrompt: string,
  settings: AISettings,
): Promise<string> => {
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      system: systemPrompt,
      apiKey: settings.aiGatewayApiKey,
      model: XRAY_MODEL,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Extraction failed: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
};

const fetchStructuredXRay = async (
  prompt: string,
  systemPrompt: string,
  settings: AISettings,
): Promise<XRayExtractionV1> => {
  const response = await fetch('/api/ai/xray', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      system: systemPrompt,
      apiKey: settings.aiGatewayApiKey,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Extraction failed: ${response.status}`);
  }

  return (await response.json()) as XRayExtractionV1;
};

const generateExtractionText = async (
  systemPrompt: string,
  prompt: string,
  settings: AISettings,
): Promise<string> => {
  const messages: ModelMessage[] = [{ role: 'user', content: prompt }];
  const useApiRoute = typeof window !== 'undefined' && settings.provider === 'ai-gateway';
  if (useApiRoute) {
    return await streamViaApiRoute(messages, systemPrompt, settings);
  }
  const provider = getAIProvider(settings);
  let text = '';
  const result = streamText({
    model: provider.getModel(),
    system: systemPrompt,
    messages,
  });
  for await (const chunk of result.textStream) {
    text += chunk;
  }
  return text;
};

const generateXRayExtraction = async (
  systemPrompt: string,
  prompt: string,
  settings: AISettings,
): Promise<XRayExtractionV1> => {
  const useApiRoute = typeof window !== 'undefined' && settings.provider === 'ai-gateway';
  if (useApiRoute) {
    return await fetchStructuredXRay(prompt, systemPrompt, settings);
  }

  const provider = getAIProvider(settings);
  const { output } = await generateText({
    model: provider.getModel(),
    system: systemPrompt,
    prompt,
    output: Output.object({ schema: xrayExtractionSchema }),
  });

  return output as XRayExtractionV1;
};

const mapEvidence = (evidence: XRayEvidence[], textUnits: XRayTextUnit[], maxPage: number) => {
  return filterEvidence(evidence, textUnits, maxPage);
};

const applyInferences = (
  entities: XRayEntity[],
  relationships: XRayRelationship[],
  textUnits: XRayTextUnit[],
  bookHash: string,
  maxPage: number,
): { entities: XRayEntity[]; relationships: XRayRelationship[] } => {
  // Apply possessive parsing
  const possessiveParser = new PossessiveParser();
  const possessiveChains: import('./xray/possessiveParser').PossessiveChain[] = [];

  for (const unit of textUnits) {
    const chains = possessiveParser.parsePossessiveChains(unit.text, unit.page, unit.chunkId);
    possessiveChains.push(...chains);
  }

  const possessiveResult = possessiveParser.generateImpliedEntitiesAndRelationships(
    possessiveChains,
    entities,
    bookHash,
    maxPage,
  );

  // Merge possessive inferences
  const allEntities = [...entities, ...possessiveResult.entities];
  const allRelationships = [...relationships, ...possessiveResult.relationships];

  // Apply coreference resolution
  const coreferenceResolver = new CoreferenceResolver();
  coreferenceResolver.resolveCoreferences(textUnits, allEntities);

  // Apply graph inference (triadic closure, community detection)
  const graphBuilder = new XRayGraphBuilder();
  graphBuilder.buildFromSnapshot(allEntities, allRelationships, []);
  const graph = graphBuilder.getGraph();

  const graphInference = new XRayGraphInference();
  const inferenceResult = graphInference.inferRelationships(graph, allEntities, bookHash, maxPage);

  // Add inferred relationships from graph inference
  allRelationships.push(...inferenceResult.inferredRelationships);

  return {
    entities: allEntities,
    relationships: allRelationships,
  };
};

const toEntities = (
  extraction: XRayExtractionV1,
  textUnits: XRayTextUnit[],
  maxPage: number,
  bookHash: string,
  existingByName: Map<string, XRayEntity>,
): XRayEntity[] => {
  const now = Date.now();
  const entities: XRayEntity[] = [];
  for (const entity of extraction.entities) {
    const canonical = entity.name.trim();
    if (!canonical) continue;
    if (isNoisyEntityName(canonical, entity.type)) continue;
    const normalized = normalizeName(canonical);
    const existing = existingByName.get(normalized);
    const facts = entity.facts
      .map((fact) => ({
        key: fact.key,
        value: fact.value,
        evidence: mapEvidence(fact.evidence, textUnits, maxPage),
        inferred: fact.inferred,
      }))
      .filter((fact) => fact.evidence.length > 0);

    if (existing) {
      const description =
        entity.description && entity.description.length >= existing.description.length
          ? entity.description
          : existing.description;
      const mergedFacts = [...existing.facts];
      const factKey = new Set(mergedFacts.map((f) => `${f.key}:${f.value}`));
      for (const fact of facts) {
        const key = `${fact.key}:${fact.value}`;
        if (!factKey.has(key)) {
          mergedFacts.push(fact);
          factKey.add(key);
        }
      }
      const mergedAliases = uniqueStrings([...existing.aliases, ...entity.aliases]);
      entities.push({
        ...existing,
        aliases: mergedAliases,
        description,
        firstSeenPage: Math.min(existing.firstSeenPage, entity.first_seen_page),
        lastSeenPage: Math.max(existing.lastSeenPage, entity.last_seen_page),
        facts: mergedFacts,
        maxPageIncluded: Math.max(existing.maxPageIncluded, maxPage),
        lastUpdated: now,
      });
    } else {
      entities.push({
        id: `xray_${nanoid(10)}`,
        type: entity.type,
        canonicalName: canonical,
        aliases: uniqueStrings(entity.aliases),
        description: entity.description || '',
        firstSeenPage: entity.first_seen_page,
        lastSeenPage: entity.last_seen_page,
        facts,
        bookHash,
        maxPageIncluded: maxPage,
        lastUpdated: now,
        version: XRAY_VERSION,
      });
    }
  }
  return entities;
};

const toRelationships = (
  extraction: XRayExtractionV1,
  textUnits: XRayTextUnit[],
  maxPage: number,
  bookHash: string,
  entityByName: Map<string, XRayEntity>,
  aliasMap: Map<string, XRayEntity[]>,
  existing: XRayRelationship[],
): XRayRelationship[] => {
  const now = Date.now();
  const merged: XRayRelationship[] = [];
  const existingMap = new Map(
    existing.map((rel) => [`${rel.sourceId}:${rel.targetId}:${rel.type}`, rel]),
  );
  for (const rel of extraction.relationships) {
    const source = resolveEntityId(rel.source, entityByName, aliasMap);
    const target = resolveEntityId(rel.target, entityByName, aliasMap);
    if (!source || !target) continue;
    const evidence = mapEvidence(rel.evidence, textUnits, maxPage);
    if (evidence.length === 0) continue;
    const key = `${source.id}:${target.id}:${rel.type}`;
    const existingRel = existingMap.get(key);
    if (existingRel) {
      const combinedEvidence = [...existingRel.evidence, ...evidence];
      existingMap.set(key, {
        ...existingRel,
        description: rel.description || existingRel.description,
        evidence: combinedEvidence,
        inferred: rel.inferred ?? existingRel.inferred,
        lastSeenPage: Math.max(existingRel.lastSeenPage, rel.last_seen_page),
        maxPageIncluded: Math.max(existingRel.maxPageIncluded, maxPage),
        lastUpdated: now,
      });
    } else {
      existingMap.set(key, {
        id: `xray_${nanoid(10)}`,
        sourceId: source.id,
        targetId: target.id,
        type: rel.type,
        description: rel.description || '',
        evidence,
        inferred: rel.inferred,
        firstSeenPage: rel.first_seen_page,
        lastSeenPage: rel.last_seen_page,
        bookHash,
        maxPageIncluded: maxPage,
        lastUpdated: now,
        version: XRAY_VERSION,
      });
    }
  }
  existingMap.forEach((value) => merged.push(value));
  return merged;
};

const toEvents = (
  extraction: XRayExtractionV1,
  textUnits: XRayTextUnit[],
  maxPage: number,
  bookHash: string,
  entityByName: Map<string, XRayEntity>,
  aliasMap: Map<string, XRayEntity[]>,
  existing: XRayTimelineEvent[],
): XRayTimelineEvent[] => {
  const now = Date.now();
  const merged = new Map(existing.map((event) => [`${event.page}:${event.summary}`, event]));
  for (const event of extraction.events) {
    if (event.page > maxPage) continue;
    const evidence = mapEvidence(event.evidence, textUnits, maxPage);
    if (evidence.length === 0) continue;
    const involvedIds = event.involved_entities
      .map((name) => resolveEntityId(name, entityByName, aliasMap))
      .filter(Boolean)
      .map((entity) => entity!.id);
    const key = `${event.page}:${event.summary}`;
    const existingEvent = merged.get(key);
    if (existingEvent) {
      merged.set(key, {
        ...existingEvent,
        importance: Math.max(existingEvent.importance, event.importance),
        evidence: [...existingEvent.evidence, ...evidence],
        involvedEntityIds: uniqueStrings([...existingEvent.involvedEntityIds, ...involvedIds]),
        maxPageIncluded: Math.max(existingEvent.maxPageIncluded, maxPage),
        lastUpdated: now,
      });
    } else {
      merged.set(key, {
        id: `xray_${nanoid(10)}`,
        page: event.page,
        summary: event.summary,
        importance: event.importance,
        involvedEntityIds: involvedIds,
        evidence,
        bookHash,
        maxPageIncluded: maxPage,
        lastUpdated: now,
        version: XRAY_VERSION,
      });
    }
  }
  return Array.from(merged.values());
};

const toClaims = (
  extraction: XRayExtractionV1,
  textUnits: XRayTextUnit[],
  maxPage: number,
  bookHash: string,
  entityByName: Map<string, XRayEntity>,
  aliasMap: Map<string, XRayEntity[]>,
  existing: XRayClaim[],
): XRayClaim[] => {
  const now = Date.now();
  const merged = new Map(
    existing.map((claim) => [
      `${claim.type}:${claim.description}:${claim.subjectId}:${claim.objectId}`,
      claim,
    ]),
  );
  for (const claim of extraction.claims) {
    const evidence = mapEvidence(claim.evidence, textUnits, maxPage);
    if (evidence.length === 0) continue;
    const subject = claim.subject ? resolveEntityId(claim.subject, entityByName, aliasMap) : null;
    const object = claim.object ? resolveEntityId(claim.object, entityByName, aliasMap) : null;
    const key = `${claim.type}:${claim.description}:${subject?.id || ''}:${object?.id || ''}`;
    const existingClaim = merged.get(key);
    if (existingClaim) {
      merged.set(key, {
        ...existingClaim,
        evidence: [...existingClaim.evidence, ...evidence],
        status: claim.status || existingClaim.status,
        maxPageIncluded: Math.max(existingClaim.maxPageIncluded, maxPage),
        lastUpdated: now,
      });
    } else {
      merged.set(key, {
        id: `xray_${nanoid(10)}`,
        type: claim.type,
        description: claim.description,
        subjectId: subject?.id,
        objectId: object?.id,
        status: claim.status,
        evidence,
        bookHash,
        maxPageIncluded: maxPage,
        lastUpdated: now,
        version: XRAY_VERSION,
      });
    }
  }
  return Array.from(merged.values());
};

const formatLogSection = (title: string, items: string[]): string => {
  if (items.length === 0) return '';
  return `\n## ${title}\n${items.map((item) => `- ${item}`).join('\n')}\n`;
};

const buildXRayLogEntry = (
  bookTitle: string,
  bookHash: string,
  maxPage: number,
  extraction: XRayExtractionV1,
): string => {
  const timestamp = new Date().toISOString();
  const header = [
    `\n# X-Ray Update`,
    `- Book: ${bookTitle}`,
    `- BookHash: ${bookHash}`,
    `- Updated: ${timestamp}`,
    `- MaxPageIncluded: ${maxPage}`,
    '',
  ].join('\n');

  const entityLines = extraction.entities.map((entity) => `${entity.name} (${entity.type})`);
  const relationshipLines = extraction.relationships.map(
    (rel) => `${rel.source} -> ${rel.target} (${rel.type})`,
  );
  const eventLines = extraction.events.map((event) => `Page ${event.page}: ${event.summary}`);

  const rawJson = `\n## Raw Extraction (JSON)\n\n\`\`\`json\n${JSON.stringify(
    extraction,
    null,
    2,
  )}\n\`\`\`\n`;

  return [
    header,
    formatLogSection('Entities', entityLines),
    formatLogSection('Relationships', relationshipLines),
    formatLogSection('Timeline', eventLines),
    rawJson,
  ].join('\n');
};

const buildAliasMap = (
  entities: XRayEntity[],
  aliases: XRayAliasEntry[],
): Map<string, XRayEntity[]> => {
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const aliasMap = new Map<string, XRayEntity[]>();
  aliases.forEach((entry) => {
    const mapped = entry.entityIds.map((id) => entityById.get(id)).filter(Boolean) as XRayEntity[];
    if (mapped.length === 0) return;
    aliasMap.set(entry.normalized, mapped);
  });
  return aliasMap;
};

export const ensureXRayState = async (bookHash: string): Promise<XRayState> => {
  const existing = await aiStore.getXRayState(bookHash);
  if (existing) return existing;
  const state: XRayState = {
    bookHash,
    lastAnalyzedPage: 0,
    lastUpdated: Date.now(),
    version: XRAY_VERSION,
  };
  await aiStore.saveXRayState(state);
  return state;
};

export const getXRaySnapshot = async (
  bookHash: string,
  maxPageIncluded: number,
): Promise<XRaySnapshot> => {
  const [entities, relationships, events, claims, state] = await Promise.all([
    aiStore.getXRayEntities(bookHash),
    aiStore.getXRayRelationships(bookHash),
    aiStore.getXRayEvents(bookHash),
    aiStore.getXRayClaims(bookHash),
    aiStore.getXRayState(bookHash),
  ]);
  const maxPage = Math.min(maxPageIncluded, state?.lastAnalyzedPage ?? maxPageIncluded);
  const visibleEntities = entities.filter(
    (entity) =>
      entity.lastSeenPage <= maxPage && !isNoisyEntityName(entity.canonicalName, entity.type),
  );
  const visibleEntityIds = new Set(visibleEntities.map((entity) => entity.id));
  return {
    entities: visibleEntities,
    relationships: relationships.filter(
      (rel) =>
        rel.lastSeenPage <= maxPage &&
        visibleEntityIds.has(rel.sourceId) &&
        visibleEntityIds.has(rel.targetId),
    ),
    events: events.filter((event) => event.page <= maxPage),
    claims: claims.filter((claim) => claim.maxPageIncluded <= maxPage),
    maxPageIncluded: maxPage,
    lastUpdated: state?.lastUpdated ?? 0,
  };
};

export const updateXRayForProgress = async (params: {
  bookHash: string;
  currentPage: number;
  settings: AISettings;
  bookTitle: string;
  appService?: AppService | null;
  force?: boolean;
}): Promise<void> => {
  const { bookHash, currentPage, settings, bookTitle, appService, force = false } = params;

  if (!settings.enabled) {
    return;
  }

  const isIndexed = await isBookIndexed(bookHash);

  if (!isIndexed) {
    throw new Error('Book must be indexed before X-Ray extraction');
  }

  if (processingBooks.has(bookHash)) {
    return;
  }

  processingBooks.add(bookHash);

  try {
    const state = await ensureXRayState(bookHash);
    const pageDelta = currentPage - state.lastAnalyzedPage;
    if (currentPage <= state.lastAnalyzedPage) {
      await aiStore.saveXRayState({
        ...state,
        lastReadAt: Date.now(),
        lastUpdated: Date.now(),
      });
      return;
    }
    if (!force && pageDelta < XRAY_MIN_PAGE_DELTA) {
      if (currentPage > state.lastAnalyzedPage) {
        await aiStore.saveXRayState({
          ...state,
          lastReadAt: Date.now(),
          lastUpdated: Date.now(),
        });
      }
      return;
    }

    const pageStart = state.lastAnalyzedPage + 1;
    const pageEnd = Math.min(currentPage, pageStart + XRAY_MAX_BATCH_PAGES - 1);
    const allChunks = await aiStore.getChunks(bookHash);
    const textUnits = allChunks
      .filter((chunk) => chunk.pageNumber >= pageStart && chunk.pageNumber <= pageEnd)
      .slice(0, XRAY_MAX_TEXT_UNITS)
      .map((chunk) => ({
        id: `${chunk.id}-unit`,
        bookHash,
        chunkId: chunk.id,
        page: chunk.pageNumber,
        text: chunk.text,
      }));

    if (textUnits.length === 0) {
      await aiStore.saveXRayState({
        ...state,
        lastAnalyzedPage: pageEnd,
        lastUpdated: Date.now(),
        lastReadAt: Date.now(),
      });
      return;
    }

    const [existingEntities, existingRelationships, existingEvents, existingClaims, aliasEntries] =
      await Promise.all([
        aiStore.getXRayEntities(bookHash),
        aiStore.getXRayRelationships(bookHash),
        aiStore.getXRayEvents(bookHash),
        aiStore.getXRayClaims(bookHash),
        aiStore.getXRayAliases(bookHash),
      ]);

    const entityByName = new Map(
      existingEntities.map((entity) => [normalizeName(entity.canonicalName), entity]),
    );
    const knownEntities = uniqueStrings([
      ...existingEntities.map((entity) => entity.canonicalName),
      ...existingEntities.flatMap((entity) => entity.aliases),
    ]);

    const systemPrompt = buildXRaySystemPrompt();
    const extractionPrompt = buildXRayExtractionPrompt({
      maxPageIncluded: pageEnd,
      pageStart,
      pageEnd,
      textUnits,
      knownEntities: knownEntities.slice(0, 200),
    });

    let extraction: XRayExtractionV1 | null = null;
    try {
      extraction = await generateXRayExtraction(systemPrompt, extractionPrompt, settings);
    } catch (error) {
      aiLogger.chat.error(`xray extraction failed: ${(error as Error).message}`);
      if (force) {
        throw error;
      }
    }

    if (!extraction) {
      await aiStore.saveXRayState({
        ...state,
        lastUpdated: Date.now(),
        lastReadAt: Date.now(),
      });
      return;
    }

    const newEntities = toEntities(extraction, textUnits, pageEnd, bookHash, entityByName);
    const updatedEntityMap = new Map(
      [...existingEntities, ...newEntities].map((entity) => [
        normalizeName(entity.canonicalName),
        entity,
      ]),
    );
    const aliasUpdates = Array.from(updatedEntityMap.values()).flatMap((entity) =>
      buildAliasEntries(bookHash, entity),
    );
    const updatedAliases = mergeAliasEntries(aliasEntries, aliasUpdates);
    const updatedAliasMap = buildAliasMap(Array.from(updatedEntityMap.values()), updatedAliases);

    let updatedRelationships = toRelationships(
      extraction,
      textUnits,
      pageEnd,
      bookHash,
      updatedEntityMap,
      updatedAliasMap,
      existingRelationships,
    );
    const updatedEvents = toEvents(
      extraction,
      textUnits,
      pageEnd,
      bookHash,
      updatedEntityMap,
      updatedAliasMap,
      existingEvents,
    );
    const updatedClaims = toClaims(
      extraction,
      textUnits,
      pageEnd,
      bookHash,
      updatedEntityMap,
      updatedAliasMap,
      existingClaims,
    );

    // Apply inference modules (possessive parsing, coreference resolution, graph inference)
    const inferred = applyInferences(
      Array.from(updatedEntityMap.values()),
      updatedRelationships,
      textUnits,
      bookHash,
      pageEnd,
    );

    // Merge inferred entities and relationships
    const allEntities = [...Array.from(updatedEntityMap.values()), ...inferred.entities];
    updatedRelationships = [...updatedRelationships, ...inferred.relationships];

    await Promise.all([
      aiStore.saveXRayEntities(allEntities),
      aiStore.saveXRayRelationships(updatedRelationships),
      aiStore.saveXRayEvents(updatedEvents),
      aiStore.saveXRayClaims(updatedClaims),
      aiStore.saveXRayTextUnits(textUnits),
      aiStore.saveXRayAliases(updatedAliases),
      aiStore.saveXRayState({
        ...state,
        lastAnalyzedPage: pageEnd,
        lastUpdated: Date.now(),
        lastReadAt: Date.now(),
      }),
    ]);

    if (appService) {
      const logEntry = buildXRayLogEntry(bookTitle, bookHash, pageEnd, extraction);
      await appendXRayLog(appService, bookTitle, bookHash, logEntry);
    }

    await eventDispatcher.dispatch('xray-updated', { bookHash, maxPageIncluded: pageEnd });
  } finally {
    processingBooks.delete(bookHash);
  }
};

export const rebuildXRayToPage = async (params: {
  bookHash: string;
  currentPage: number;
  settings: AISettings;
  bookTitle: string;
  appService?: AppService | null;
}): Promise<void> => {
  const { bookHash, currentPage, settings, bookTitle, appService } = params;
  if (!settings.enabled) return;
  if (processingBooks.has(bookHash)) return;
  await aiStore.clearXRayBook(bookHash);
  await ensureXRayState(bookHash);

  let lastAnalyzed = 0;
  const maxIterations = Math.max(1, Math.ceil((currentPage + 1) / XRAY_MAX_BATCH_PAGES) + 2);
  for (let i = 0; i < maxIterations && lastAnalyzed < currentPage; i++) {
    await updateXRayForProgress({
      bookHash,
      currentPage,
      settings,
      bookTitle,
      appService,
      force: true,
    });
    const state = await aiStore.getXRayState(bookHash);
    const next = state?.lastAnalyzedPage ?? lastAnalyzed;
    if (next <= lastAnalyzed) break;
    lastAnalyzed = next;
  }
};

export const lookupTerm = async (params: {
  bookHash: string;
  term: string;
  maxPageIncluded: number;
  settings: AISettings;
  language?: string;
}): Promise<XRayLookupResult> => {
  const { bookHash, term, maxPageIncluded, settings, language } = params;
  const entities = await aiStore.getXRayEntities(bookHash);
  const aliases = await aiStore.getXRayAliases(bookHash);
  const entityByName = new Map(
    entities.map((entity) => [normalizeName(entity.canonicalName), entity]),
  );
  const aliasMap = buildAliasMap(entities, aliases);
  const direct = resolveEntityId(term, entityByName, aliasMap);
  if (direct) {
    return {
      term,
      summary: summarizeEntity(direct),
      evidence: direct.facts.flatMap((fact) => fact.evidence).slice(0, 3),
      source: 'entity',
      entity: direct,
      maxPageIncluded,
    };
  }

  const variants = buildTermVariants(term);
  const results = await hybridSearch(bookHash, term, settings, XRAY_LOOKUP_TOPK, maxPageIncluded);
  const units = buildTextUnitsFromChunks(results, bookHash);
  const combinedText = units.map((unit) => unit.text).join('\n');
  const sentences = extractTermContext(combinedText, language || 'en', variants, {
    maxSentences: 4,
    contextBefore: 1,
    contextAfter: 1,
    maxCharacters: 1200,
  });

  if (sentences.length === 0) {
    return {
      term,
      summary: '',
      evidence: [],
      source: 'none',
      maxPageIncluded,
    };
  }

  const evidence: XRayEvidence[] = [];
  for (const sentence of sentences) {
    const matchUnit = units.find((unit) => unit.text.includes(sentence));
    if (!matchUnit) continue;
    evidence.push({
      quote: sentence,
      page: matchUnit.page,
      chunkId: matchUnit.chunkId,
    });
  }

  return {
    term,
    summary: sentences.join(' '),
    evidence,
    source: 'lexrank',
    maxPageIncluded,
  };
};

export const getRecapIfNeeded = async (params: {
  bookHash: string;
  bookTitle: string;
  maxPageIncluded: number;
  settings: AISettings;
  appService?: AppService | null;
}): Promise<string | null> => {
  const { bookHash, bookTitle, maxPageIncluded, settings, appService } = params;
  const state = await ensureXRayState(bookHash);
  const lastReadAt = state.lastReadAt ?? 0;
  if (!lastReadAt || Date.now() - lastReadAt < XRAY_RECAP_INACTIVITY_MS) return null;
  if (state.lastRecapAt && state.lastRecapAt > lastReadAt) return state.lastRecapText || null;

  const events = (await aiStore.getXRayEvents(bookHash))
    .filter((event) => event.page <= maxPageIncluded)
    .sort((a, b) => b.page - a.page)
    .slice(0, 8)
    .reverse();

  if (events.length === 0) return null;
  let recapText = events.map((event) => event.summary).join(' ');

  if (settings.enabled) {
    try {
      const systemPrompt = buildXRaySystemPrompt();
      const prompt = buildXRayRecapPrompt({
        maxPageIncluded,
        events: events.map((event) => event.summary),
        entities: [],
      });
      recapText = (await generateExtractionText(systemPrompt, prompt, settings)).trim();
    } catch (error) {
      aiLogger.chat.error(`xray recap failed: ${(error as Error).message}`);
    }
  }

  const updatedState: XRayState = {
    ...state,
    lastRecapAt: Date.now(),
    lastRecapPage: maxPageIncluded,
    lastRecapText: recapText,
    lastUpdated: Date.now(),
  };
  await aiStore.saveXRayState(updatedState);
  if (appService) {
    const logEntry = `\n## Recap (${new Date().toISOString()})\n${recapText}\n`;
    await appendXRayLog(appService, bookTitle, bookHash, logEntry);
  }
  return recapText;
};
