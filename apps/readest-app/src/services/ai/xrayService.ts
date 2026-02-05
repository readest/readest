import { generateText, Output } from 'ai';
import { nanoid } from 'nanoid';

import { aiStore } from './storage/aiStore';
import { getAIProvider } from './providers';
import { hybridSearch, isBookIndexed } from './ragService';
import { aiLogger } from './logger';
import {
  buildXRayExtractionPrompt,
  buildXRayEntitySummaryPrompt,
  buildXRayRelationshipPrompt,
  buildXRaySummarySystemPrompt,
  buildXRaySystemPrompt,
  buildXRayTimelinePrompt,
} from './prompts';
import { extractTermContext } from './xray/lexrank';
import { appendXRayDebugLog, appendXRayLog } from './xray/logWriter';
import { filterEvidence, xrayExtractionSchema, xraySummarySchema } from './xray/validators';
import { PossessiveParser } from './xray/possessiveParser';
import { CoreferenceResolver } from './xray/coreferenceResolver';
import { XRayGraphInference } from './xray/graphInference';
import { XRayGraphBuilder } from './xray/graphBuilder';
import { detectGenre } from './xray/genre';
import { eventDispatcher } from '@/utils/event';
import type { AppService } from '@/types/system';
import type { BookMetadata } from '@/libs/document';
import type {
  AISettings,
  ScoredChunk,
  XRayAliasEntry,
  XRayClaim,
  XRayEntity,
  XRayEntityType,
  XRayEntitySummary,
  XRayEvidence,
  XRayExtractionV1,
  XRayLookupResult,
  XRayRelationship,
  XRaySnapshot,
  XRayState,
  XRayTextUnit,
  XRayTimelineEvent,
  TextChunk,
} from './types';

const XRAY_VERSION = 1;
const XRAY_PROMPT_VERSION = 4;
const XRAY_MIN_PAGE_DELTA = 1;
const XRAY_MAX_BATCH_PAGES = 10;
const XRAY_WINDOW_MAX_CHARS = 9000;
const XRAY_WINDOW_MAX_UNITS = 14;
const XRAY_WINDOW_CONCURRENCY_FALLBACK = 2;
const XRAY_MAX_BATCHES_PER_RUN = 6;
const XRAY_MAX_RUN_MS = 20000;
const XRAY_LOOKUP_TOPK = 6;
const XRAY_SUMMARY_PROMPT_VERSION = 2;
const XRAY_SUMMARY_MAX_PER_RUN = 10;
const XRAY_SUMMARY_MAX_RUN_MS = 12000;

const XRAY_ALLOWED_ENTITY_TYPES: XRayEntityType[] = [
  'character',
  'location',
  'organization',
  'artifact',
  'term',
  'event',
  'concept',
];

const processingBooks = new Set<string>();
const summaryInFlight = new Map<string, Promise<string>>();

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const yieldToMainThread = async (): Promise<void> => {
  if (typeof window === 'undefined') return;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const createYieldController = (budgetMs = 12) => {
  let lastYield = nowMs();
  return async () => {
    const now = nowMs();
    if (now - lastYield < budgetMs) return;
    lastYield = now;
    await yieldToMainThread();
  };
};

const normalizeName = (value: string): string => {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
};

const NON_HUMAN_TOKENS = new Set([
  'dragon',
  'wolf',
  'dog',
  'cat',
  'horse',
  'lion',
  'tiger',
  'bear',
  'bird',
  'rabbit',
  'snake',
  'monster',
  'beast',
  'creature',
  'alien',
  'robot',
  'android',
  'droid',
  'ai',
  'machine',
  'ship',
  'vessel',
  'car',
  'train',
  'plane',
  'airship',
]);

const shouldTitleCase = (value: string): boolean => {
  if (!/[A-Za-z]/.test(value)) return false;
  if (/[A-Z]/.test(value)) return false;
  return true;
};

const toTitleCase = (value: string): string => {
  const smallWords = new Set(['a', 'an', 'and', 'or', 'the', 'of', 'in', 'on', 'to', 'for']);
  const words = value.split(/\s+/).filter(Boolean);
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && smallWords.has(lower)) return lower;
      const parts = word.split(/([-'’])/g);
      return parts
        .map((part) => {
          if (part === '-' || part === "'" || part === '’') return part;
          const lowerPart = part.toLowerCase();
          return lowerPart.charAt(0).toUpperCase() + lowerPart.slice(1);
        })
        .join('');
    })
    .join(' ');
};

const normalizeEntityName = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (!shouldTitleCase(trimmed)) return trimmed;
  return toTitleCase(trimmed);
};

const normalizeSentence = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!/[A-Za-z]/.test(trimmed)) return trimmed;
  const first = trimmed[0] ?? '';
  let result = first ? first.toUpperCase() + trimmed.slice(1) : trimmed;
  if (!/[.!?]["')\]]?$/.test(result)) {
    result = `${result}.`;
  }
  return result;
};

const splitSentences = (value: string): string[] => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const matches = normalized.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g);
  return (matches || []).map((part) => part.trim()).filter(Boolean);
};

const stripEvidenceSentences = (sentences: string[]): string[] =>
  sentences.filter((sentence) => !/^evidence includes:/i.test(sentence.trim()));

const normalizeSentenceList = (sentences: string[]): string[] =>
  sentences.map((sentence) => normalizeSentence(sentence)).filter(Boolean);

const mergeSentencesToCount = (sentences: string[], maxCount: number): string[] => {
  if (sentences.length <= maxCount) return sentences;
  const grouped: string[] = [];
  const groupSize = Math.ceil(sentences.length / maxCount);
  for (let i = 0; i < sentences.length; i += groupSize) {
    grouped.push(sentences.slice(i, i + groupSize).join(' '));
  }
  return grouped.slice(0, maxCount);
};

const ensureSentenceRange = (
  sentences: string[],
  _minCount: number,
  maxCount: number,
  extras: string[] = [],
): string[] => {
  let output = normalizeSentenceList(sentences);
  const extraList = normalizeSentenceList(extras);
  for (const extra of extraList) {
    if (output.length >= maxCount) break;
    if (!output.includes(extra)) output.push(extra);
  }
  output = mergeSentencesToCount(output, maxCount);
  return output.slice(0, maxCount);
};

const normalizeQuote = (value: string): string => value.replace(/\s+/g, ' ').trim();

const formatInlineList = (items: string[]): string => {
  const filtered = items.map((item) => item.trim()).filter(Boolean);
  if (filtered.length === 0) return '';
  if (filtered.length === 1) return filtered[0] || '';
  if (filtered.length === 2) return `${filtered[0]} and ${filtered[1]}`;
  return `${filtered.slice(0, -1).join(', ')}, and ${filtered[filtered.length - 1]}`;
};

const formatFactValue = (fact: { key: string; value: string }): string => {
  const value = fact.value.trim();
  if (value) return value;
  return fact.key.replace(/_/g, ' ').trim();
};

const buildEntityDescription = (params: {
  name: string;
  type: XRayEntityType;
  aliases: string[];
  descriptionParts: string[];
  facts: Array<{ key: string; value: string }>;
}): string => {
  const { name, type, aliases, descriptionParts, facts } = params;
  const sentences: string[] = [];
  const combinedDescription = descriptionParts.filter(Boolean).join(' ');
  if (combinedDescription)
    sentences.push(...stripEvidenceSentences(splitSentences(combinedDescription)));
  if (name && type) sentences.push(normalizeSentence(`${name} is a ${type} in the story`));
  const aliasList = formatInlineList(aliases);
  if (aliasList) sentences.push(normalizeSentence(`${name} is also known as ${aliasList}`));
  const factList = formatInlineList(facts.map(formatFactValue));
  if (factList) sentences.push(normalizeSentence(`Notable details include ${factList}`));
  return ensureSentenceRange(sentences, 0, 4).join(' ');
};

const buildRelationshipDescription = (params: {
  descriptionParts: string[];
  source: string;
  type: string;
  target: string;
}): string => {
  const { descriptionParts, source, type, target } = params;
  const sentences = descriptionParts.flatMap((part) =>
    stripEvidenceSentences(splitSentences(part)),
  );
  if (sentences.length === 0) sentences.push(buildRelationshipSentence(source, type, target));
  return ensureSentenceRange(sentences, 0, 4).join(' ');
};

const buildEventSummary = (params: { summary: string; involvedNames: string[] }): string => {
  const { summary, involvedNames } = params;
  const sentences = stripEvidenceSentences(splitSentences(summary));
  if (sentences.length === 0) {
    const involvedList = formatInlineList(involvedNames);
    if (involvedList)
      sentences.push(normalizeSentence(`${involvedList} are involved in this event`));
  }
  return ensureSentenceRange(sentences, 0, 4).join(' ');
};

const buildClaimDescription = (params: {
  description: string;
  type: string;
  subject?: string;
  object?: string;
}): string => {
  const { description, type, subject, object } = params;
  const sentences = stripEvidenceSentences(splitSentences(description));
  if (sentences.length === 0) {
    const participants = formatInlineList([subject || '', object || '']);
    if (participants) {
      sentences.push(normalizeSentence(`A claim involves ${participants}`));
    } else if (type) {
      sentences.push(normalizeSentence(`A ${type} claim is mentioned`));
    }
  }
  return ensureSentenceRange(sentences, 0, 4).join(' ');
};

const buildEntitySummarySentences = (context: {
  entity: { name: string; type: string; aliases: string[] };
  facts: Array<{ key: string; value: string }>;
  relationships: Array<{ with: string; type: string; description: string }>;
  events: Array<{ summary: string }>;
  claims: Array<{ description: string }>;
}): string[] => {
  const sentences: string[] = [];
  const name = context.entity.name || 'This entity';
  if (context.entity.name && context.entity.type) {
    sentences.push(normalizeSentence(`${name} is a ${context.entity.type} in the story`));
  }
  const aliasList = formatInlineList(context.entity.aliases);
  if (aliasList) sentences.push(normalizeSentence(`${name} is also known as ${aliasList}`));
  const factList = formatInlineList(context.facts.map(formatFactValue));
  if (factList) sentences.push(normalizeSentence(`Notable details include ${factList}`));
  const relationshipList = formatInlineList(
    context.relationships.map((rel) => `${rel.with} (${rel.type})`),
  );
  if (relationshipList)
    sentences.push(normalizeSentence(`${name} is connected to ${relationshipList}`));
  const eventList = formatInlineList(context.events.map((event) => event.summary));
  if (eventList)
    sentences.push(normalizeSentence(`${name} is involved in events such as ${eventList}`));
  const claimList = formatInlineList(context.claims.map((claim) => claim.description));
  if (claimList) sentences.push(normalizeSentence(`Claims mention ${claimList}`));
  return ensureSentenceRange(sentences, 0, 4);
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  parent_of: 'parent of',
  child_of: 'child of',
  sibling_of: 'sibling of',
  spouse_of: 'spouse of',
  partner_of: 'partner of',
  romantic_of: 'romantic with',
  friend_of: 'friend of',
  enemy_of: 'enemy of',
  rival_of: 'rival of',
  mentor_of: 'mentor of',
  student_of: 'student of',
  employer_of: 'employer of',
  employed_by: 'employed by',
  member_of: 'member of',
  leader_of: 'leader of',
  founder_of: 'founder of',
  founded_by: 'founded by',
  guardian_of: 'guardian of',
  protected_by: 'protected by',
  colleague_of: 'colleague of',
  ally_of: 'ally of',
  related_to: 'related to',
  possibly_related: 'possibly related to',
};

const RELATIONSHIP_SENTENCES: Record<string, string> = {
  parent_of: 'is the parent of',
  child_of: 'is the child of',
  sibling_of: 'is the sibling of',
  spouse_of: 'is the spouse of',
  partner_of: 'is the partner of',
  romantic_of: 'has a romantic connection with',
  friend_of: 'is a friend of',
  enemy_of: 'is an enemy of',
  rival_of: 'is a rival of',
  mentor_of: 'is a mentor of',
  student_of: 'is a student of',
  employer_of: 'is the employer of',
  employed_by: 'is employed by',
  member_of: 'is a member of',
  leader_of: 'is the leader of',
  founder_of: 'is the founder of',
  founded_by: 'was founded by',
  guardian_of: 'is the guardian of',
  protected_by: 'is protected by',
  colleague_of: 'is a colleague of',
  ally_of: 'is an ally of',
  related_to: 'is related to',
  possibly_related: 'is possibly related to',
};

export const formatRelationshipLabel = (type: string): string => {
  const normalized = type?.trim().toLowerCase() || 'related_to';
  if (RELATIONSHIP_LABELS[normalized]) return RELATIONSHIP_LABELS[normalized];
  return normalized.replace(/_/g, ' ');
};

const buildRelationshipSentence = (source: string, type: string, target: string): string => {
  const normalized = type?.trim().toLowerCase() || 'related_to';
  const phrase = RELATIONSHIP_SENTENCES[normalized] || `is ${formatRelationshipLabel(normalized)}`;
  return normalizeSentence(`${source} ${phrase} ${target}`);
};

const normalizeRelationshipDescription = (
  description: string,
  source: string,
  type: string,
  target: string,
  _evidence: Array<{ quote: string }> = [],
): string => {
  const trimmed = description.trim();
  const parts = trimmed ? [trimmed] : [];
  return buildRelationshipDescription({
    descriptionParts: parts,
    source,
    type,
    target,
  });
};

const getWindowConcurrency = (): number => {
  if (typeof navigator === 'undefined') return XRAY_WINDOW_CONCURRENCY_FALLBACK;
  const cores = navigator.hardwareConcurrency || XRAY_WINDOW_CONCURRENCY_FALLBACK;
  if (typeof window !== 'undefined') {
    return Math.max(1, Math.min(2, Math.floor(cores / 4)));
  }
  return Math.max(1, Math.min(3, Math.floor(cores / 2)));
};

const isLivingEntityType = (type: XRayEntityType): boolean => type === 'character';

export const isHumanEntity = (entity?: XRayEntity | null): boolean => {
  if (!entity || !isLivingEntityType(entity.type)) return false;
  const normalized = normalizeName(entity.canonicalName);
  if (!normalized) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.some((token) => NON_HUMAN_TOKENS.has(token))) return false;
  const descTokens = normalizeName(entity.description || '')
    .split(/\s+/)
    .filter(Boolean);
  if (descTokens.some((token) => NON_HUMAN_TOKENS.has(token))) return false;
  return true;
};

const isLivingRelationship = (
  rel: XRayRelationship,
  entityById: Map<string, XRayEntity>,
): boolean => {
  const source = entityById.get(rel.sourceId);
  const target = entityById.get(rel.targetId);
  if (!source || !target) return false;
  return isHumanEntity(source) && isHumanEntity(target);
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

const mergeStrings = (base: string[] | undefined, next: string[] | undefined): string[] => {
  return uniqueStrings([...(base || []), ...(next || [])]);
};

const getGatewayModel = (settings: AISettings): string => {
  const requested = settings.aiGatewayModel?.trim();
  if (requested && requested.startsWith('openai/')) return requested;
  return XRAY_MODEL;
};

const getMetadataTitle = (metadata?: BookMetadata): string => {
  const raw = metadata?.title;
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  const record = raw as Record<string, string>;
  return record['en'] || record['default'] || Object.values(record)[0] || '';
};

const getMetadataSubjects = (metadata?: BookMetadata): string[] => {
  const raw = metadata?.subject;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((item) => `${item}`).filter(Boolean);
  if (typeof raw === 'string') return [raw];
  const record = raw as unknown as { name?: string | Record<string, string>; code?: string };
  const name =
    typeof record.name === 'string'
      ? record.name
      : record.name
        ? Object.values(record.name)[0]
        : '';
  return [name || record.code || ''].filter(Boolean);
};

const buildGenreHints = (metadata?: BookMetadata): string[] => {
  if (!metadata) return [];
  const subjects = getMetadataSubjects(metadata);
  const hints = detectGenre({
    subject: subjects,
    description: metadata.description,
    title: getMetadataTitle(metadata),
  });
  const focusHints = hints.extractionFocus.map((focus) => `Prioritize ${focus} when explicit.`);
  const subjectHint =
    subjects.length > 0 ? [`Book subjects: ${subjects.slice(0, 8).join(', ')}`] : [];
  return uniqueStrings([...hints.hints, ...focusHints, ...subjectHint]);
};

const buildTextUnits = (
  chunks: TextChunk[],
  bookHash: string,
  extractedAt = Date.now(),
): XRayTextUnit[] => {
  return chunks.map((chunk) => ({
    id: `${chunk.id}-unit`,
    bookHash,
    chunkId: chunk.id,
    page: chunk.pageNumber,
    text: chunk.text,
    sectionIndex: chunk.sectionIndex,
    chapterTitle: chunk.chapterTitle,
    chapterNumber: chunk.chapterNumber,
    extractedAt,
  }));
};

const buildTextUnitsFromChunks = (chunks: ScoredChunk[] | XRayTextUnit[], bookHash: string) => {
  if (chunks.length === 0) return [] as XRayTextUnit[];
  const first = chunks[0];
  if (first && 'text' in first && 'chunkId' in first) return chunks as XRayTextUnit[];
  return buildTextUnits(chunks as ScoredChunk[], bookHash);
};

const buildTextUnitWindows = (
  units: XRayTextUnit[],
  maxChars: number,
  maxUnits: number,
): XRayTextUnit[][] => {
  const windows: XRayTextUnit[][] = [];
  let current: XRayTextUnit[] = [];
  let totalChars = 0;

  for (const unit of units) {
    const nextChars = totalChars + unit.text.length;
    const exceedsChars = current.length > 0 && nextChars > maxChars;
    const exceedsUnits = current.length >= maxUnits;
    if (exceedsChars || exceedsUnits) {
      windows.push(current);
      current = [];
      totalChars = 0;
    }
    current.push(unit);
    totalChars += unit.text.length;
  }

  if (current.length > 0) windows.push(current);
  return windows;
};

const indexChunksByPage = (chunks: TextChunk[]): Map<number, TextChunk[]> => {
  const map = new Map<number, TextChunk[]>();
  const ordered = chunks.slice().sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    if (a.sectionIndex !== b.sectionIndex) return a.sectionIndex - b.sectionIndex;
    return a.id.localeCompare(b.id);
  });
  ordered.forEach((chunk) => {
    const list = map.get(chunk.pageNumber) ?? [];
    list.push(chunk);
    map.set(chunk.pageNumber, list);
  });
  return map;
};

const selectTextUnitsForRange = (
  chunksByPage: Map<number, TextChunk[]>,
  bookHash: string,
  pageStart: number,
  pageEnd: number,
): XRayTextUnit[] => {
  const range: TextChunk[] = [];
  for (let page = pageStart; page <= pageEnd; page += 1) {
    const list = chunksByPage.get(page);
    if (list) range.push(...list);
  }
  if (range.length === 0) return [];
  return buildTextUnits(range, bookHash);
};

const buildExtractionCacheKey = (
  bookHash: string,
  pageStart: number,
  pageEnd: number,
  textUnits: XRayTextUnit[],
  promptVersion: number,
  windowTag?: string,
): { key: string; chunkHash: string } => {
  const chunkHash = textUnits.map((unit) => `${unit.chunkId}:${unit.page}`).join('|');
  const windowSuffix = windowTag ? `:${windowTag}` : '';
  return {
    key: `${bookHash}:${promptVersion}:${pageStart}-${pageEnd}${windowSuffix}:${chunkHash}`,
    chunkHash,
  };
};

const normalizeExtraction = (value?: Partial<XRayExtractionV1> | null): XRayExtractionV1 => {
  const entities = Array.isArray(value?.entities)
    ? value!.entities.filter((entity) => XRAY_ALLOWED_ENTITY_TYPES.includes(entity.type))
    : [];
  return {
    entities,
    relationships: Array.isArray(value?.relationships) ? value!.relationships : [],
    events: Array.isArray(value?.events) ? value!.events : [],
    claims: Array.isArray(value?.claims) ? value!.claims : [],
  };
};

const mergeExtraction = (base: XRayExtractionV1, next: XRayExtractionV1): XRayExtractionV1 => {
  const left = normalizeExtraction(base);
  const right = normalizeExtraction(next);
  return {
    entities: [...left.entities, ...right.entities],
    relationships: [...left.relationships, ...right.relationships],
    events: [...left.events, ...right.events],
    claims: [...left.claims, ...right.claims],
  };
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
  return buildEntityDescription({
    name: entity.canonicalName,
    type: entity.type,
    aliases: entity.aliases,
    descriptionParts: [entity.description],
    facts: entity.facts.map((fact) => ({ key: fact.key, value: fact.value })),
  });
};

const hashString = (value: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0).toString(36);
};

const buildEventKey = (page: number, evidence: XRayEvidence[]): string => {
  const quotes = evidence.map((item) => normalizeQuote(item.quote)).join('|');
  return `${page}:${hashString(quotes)}`;
};

const buildClaimKey = (
  type: string,
  subjectId: string | undefined,
  objectId: string | undefined,
  evidence: XRayEvidence[],
): string => {
  const quotes = evidence.map((item) => normalizeQuote(item.quote)).join('|');
  return `${type}:${subjectId || ''}:${objectId || ''}:${hashString(quotes)}`;
};

const buildSummaryKey = (bookHash: string, entityId: string, sourceHash: string): string => {
  return `${bookHash}:${entityId}:${XRAY_SUMMARY_PROMPT_VERSION}:${sourceHash}`;
};

const truncateText = (value: string, limit = 180): string => {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trim()}...`;
};

const normalizeSummary = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const sentences = stripEvidenceSentences(splitSentences(trimmed));
  return ensureSentenceRange(sentences, 0, 4).join(' ');
};

const filterEvidenceForSummary = (
  evidence: XRayEvidence[],
  textUnits: XRayTextUnit[],
  maxPageIncluded: number,
): Array<{ quote: string; page: number }> => {
  const filtered =
    textUnits.length > 0
      ? filterEvidence(evidence, textUnits, maxPageIncluded)
      : evidence.filter((item) => item.page <= maxPageIncluded);
  return filtered.map((item) => ({
    quote: truncateText(item.quote, 200),
    page: item.page,
  }));
};

const filterEvidenceByPage = (evidence: XRayEvidence[], maxPage: number): XRayEvidence[] =>
  evidence.filter((item) => item.page <= maxPage);

const getLatestEvidencePage = (evidence: Array<{ page: number }>): number => {
  return evidence.reduce((max, item) => Math.max(max, item.page), -1);
};

const buildEntitySummaryContext = (params: {
  entity: XRayEntity;
  relationships: XRayRelationship[];
  events: XRayTimelineEvent[];
  claims: XRayClaim[];
  textUnits: XRayTextUnit[];
  maxPageIncluded: number;
  entityById: Map<string, XRayEntity>;
}) => {
  const { entity, relationships, events, claims, textUnits, maxPageIncluded, entityById } = params;

  const facts = entity.facts
    .map((fact) => {
      const evidence = filterEvidenceForSummary(fact.evidence, textUnits, maxPageIncluded);
      return {
        key: fact.key,
        value: fact.value,
        evidence,
        lastPage: getLatestEvidencePage(evidence),
      };
    })
    .filter((fact) => fact.evidence.length > 0)
    .sort((a, b) => b.lastPage - a.lastPage)
    .map(({ key, value, evidence }) => ({ key, value, evidence }));

  const relationshipsSummary = relationships
    .filter(
      (rel) =>
        rel.lastSeenPage <= maxPageIncluded &&
        (rel.sourceId === entity.id || rel.targetId === entity.id),
    )
    .map((rel) => {
      const isSource = rel.sourceId === entity.id;
      const otherId = isSource ? rel.targetId : rel.sourceId;
      const other = entityById.get(otherId);
      if (!other || !isHumanEntity(other)) return null;
      const sourceName = entityById.get(rel.sourceId)?.canonicalName || entity.canonicalName;
      const targetName = entityById.get(rel.targetId)?.canonicalName || other.canonicalName;
      const evidence = filterEvidenceForSummary(rel.evidence, textUnits, maxPageIncluded);
      if (evidence.length === 0) return null;
      return {
        with: other.canonicalName,
        type: formatRelationshipLabel(rel.type),
        description: normalizeRelationshipDescription(
          rel.description || '',
          sourceName,
          rel.type,
          targetName,
          evidence,
        ),
        evidence,
        lastPage: getLatestEvidencePage(evidence),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b?.lastPage ?? 0) - (a?.lastPage ?? 0))
    .map((rel) => ({
      with: rel!.with,
      type: rel!.type,
      description: rel!.description,
      evidence: rel!.evidence,
    }));

  const eventsSummary = events
    .filter((event) => event.page <= maxPageIncluded && event.involvedEntityIds.includes(entity.id))
    .map((event) => {
      const evidence = filterEvidenceForSummary(event.evidence, textUnits, maxPageIncluded);
      if (evidence.length === 0) return null;
      const involvedNames = event.involvedEntityIds
        .map((id) => entityById.get(id)?.canonicalName)
        .filter(Boolean) as string[];
      return {
        summary: buildEventSummary({
          summary: event.summary,
          involvedNames,
        }),
        page: event.page,
        evidence,
        lastPage: getLatestEvidencePage(evidence),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b?.lastPage ?? 0) - (a?.lastPage ?? 0))
    .map((event) => ({
      summary: event!.summary,
      page: event!.page,
      evidence: event!.evidence,
    }));

  const claimsSummary = claims
    .filter(
      (claim) =>
        claim.maxPageIncluded <= maxPageIncluded &&
        (claim.subjectId === entity.id || claim.objectId === entity.id),
    )
    .map((claim) => {
      const evidence = filterEvidenceForSummary(claim.evidence, textUnits, maxPageIncluded);
      if (evidence.length === 0) return null;
      const subjectName = claim.subjectId
        ? entityById.get(claim.subjectId)?.canonicalName
        : undefined;
      const objectName = claim.objectId ? entityById.get(claim.objectId)?.canonicalName : undefined;
      return {
        description: buildClaimDescription({
          description: claim.description,
          type: claim.type,
          subject: subjectName,
          object: objectName,
        }),
        evidence,
        lastPage: getLatestEvidencePage(evidence),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b?.lastPage ?? 0) - (a?.lastPage ?? 0))
    .map((claim) => ({
      description: claim!.description,
      evidence: claim!.evidence,
    }));

  const context = {
    entity: {
      name: entity.canonicalName,
      type: entity.type,
      aliases: entity.aliases,
    },
    facts,
    relationships: relationshipsSummary,
    events: eventsSummary,
    claims: claimsSummary,
  };

  const sourceHash = hashString(JSON.stringify(context));
  const hasSignal =
    facts.length > 0 ||
    relationshipsSummary.length > 0 ||
    eventsSummary.length > 0 ||
    claimsSummary.length > 0;

  return { context, sourceHash, hasSignal };
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
      ambiguous: false,
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
    map.set(entry.key, {
      ...current,
      entityIds: Array.from(ids),
      lastUpdated: entry.lastUpdated,
      ambiguous: ids.size > 1,
    });
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

const fetchStructuredXRay = async (
  prompt: string,
  systemPrompt: string,
  settings: AISettings,
  model: string,
): Promise<XRayExtractionV1> => {
  const response = await fetch('/api/ai/xray', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      system: systemPrompt,
      apiKey: settings.aiGatewayApiKey,
      model,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Extraction failed: ${response.status}`);
  }

  return (await response.json()) as XRayExtractionV1;
};

const generateXRayExtraction = async (
  systemPrompt: string,
  prompt: string,
  settings: AISettings,
): Promise<XRayExtractionV1> => {
  const useApiRoute = typeof window !== 'undefined' && settings.provider === 'ai-gateway';
  const model = getGatewayModel(settings);
  if (settings.provider !== 'ai-gateway') {
    throw new Error('X-Ray extraction currently requires AI Gateway');
  }
  if (useApiRoute) {
    return await fetchStructuredXRay(prompt, systemPrompt, settings, model);
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

const fetchStructuredXRaySummary = async (
  prompt: string,
  systemPrompt: string,
  settings: AISettings,
  model: string,
): Promise<{ summary: string }> => {
  const response = await fetch('/api/ai/xray/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      system: systemPrompt,
      apiKey: settings.aiGatewayApiKey,
      model,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Summary failed: ${response.status}`);
  }

  return (await response.json()) as { summary: string };
};

const generateXRaySummary = async (
  systemPrompt: string,
  prompt: string,
  settings: AISettings,
): Promise<{ summary: string }> => {
  const useApiRoute = typeof window !== 'undefined' && settings.provider === 'ai-gateway';
  const model = getGatewayModel(settings);
  if (settings.provider !== 'ai-gateway') {
    throw new Error('X-Ray summary currently requires AI Gateway');
  }
  if (useApiRoute) {
    return await fetchStructuredXRaySummary(prompt, systemPrompt, settings, model);
  }

  const provider = getAIProvider(settings);
  const { output } = await generateText({
    model: provider.getModel(),
    system: systemPrompt,
    prompt,
    output: Output.object({ schema: xraySummarySchema }),
  });

  return output as { summary: string };
};

const mapEvidence = (
  evidence: XRayEvidence[],
  textUnits: XRayTextUnit[],
  maxPage: number,
  extractedAt: number,
) => {
  return filterEvidence(evidence, textUnits, maxPage).map((item) => ({
    ...item,
    extractedAt: item.extractedAt ?? extractedAt,
  }));
};

const saveEntitySummary = async (summary: XRayEntitySummary): Promise<void> => {
  await aiStore.saveXRayEntitySummary(summary);
  await eventDispatcher.dispatch('xray-summaries-updated', {
    bookHash: summary.bookHash,
    entityId: summary.entityId,
    maxPageIncluded: summary.maxPageIncluded,
  });
};

const resolveEntitySummary = async (params: {
  bookHash: string;
  entity: XRayEntity;
  relationships: XRayRelationship[];
  events: XRayTimelineEvent[];
  claims: XRayClaim[];
  textUnits: XRayTextUnit[];
  maxPageIncluded: number;
  settings: AISettings;
  entityById: Map<string, XRayEntity>;
  mode: 'lazy' | 'eager';
}): Promise<string> => {
  const {
    bookHash,
    entity,
    relationships,
    events,
    claims,
    textUnits,
    maxPageIncluded,
    settings,
    entityById,
    mode,
  } = params;
  const { context, sourceHash, hasSignal } = buildEntitySummaryContext({
    entity,
    relationships,
    events,
    claims,
    textUnits,
    maxPageIncluded,
    entityById,
  });
  const contextSentences = buildEntitySummarySentences(context);
  const fallback = contextSentences.join(' ') || summarizeEntity(entity);

  if (!hasSignal) return fallback;

  const summaryKey = buildSummaryKey(bookHash, entity.id, sourceHash);
  const cached = await aiStore.getXRayEntitySummary(summaryKey);
  if (cached?.summary) {
    const normalized = normalizeSummary(cached.summary) || fallback;
    if (normalized !== cached.summary) {
      await saveEntitySummary({
        ...cached,
        summary: normalized,
        updatedAt: Date.now(),
      });
    }
    return normalized;
  }

  if (!settings.enabled || settings.provider !== 'ai-gateway') return fallback;
  if (typeof window !== 'undefined' && !settings.aiGatewayApiKey) return fallback;

  const runSummary = async () => {
    const prompt = buildXRayEntitySummaryPrompt({
      maxPageIncluded,
      entity: context.entity,
      facts: context.facts,
      relationships: context.relationships,
      events: context.events,
      claims: context.claims,
    });
    const systemPrompt = buildXRaySummarySystemPrompt();
    const result = await generateXRaySummary(systemPrompt, prompt, settings);
    const summary = normalizeSummary(result.summary || '') || fallback;
    const entry: XRayEntitySummary = {
      key: summaryKey,
      bookHash,
      entityId: entity.id,
      summary,
      sourceHash,
      maxPageIncluded,
      updatedAt: Date.now(),
    };
    await saveEntitySummary(entry);
    return summary;
  };

  if (mode === 'lazy') {
    if (!summaryInFlight.has(summaryKey)) {
      const promise = runSummary()
        .catch(() => fallback)
        .finally(() => summaryInFlight.delete(summaryKey));
      summaryInFlight.set(summaryKey, promise);
    }
    return fallback;
  }

  const inflight = summaryInFlight.get(summaryKey);
  if (inflight) return await inflight;
  const promise = runSummary().finally(() => summaryInFlight.delete(summaryKey));
  summaryInFlight.set(summaryKey, promise);
  return await promise;
};

export const getXRayEntitySummaries = async (params: {
  bookHash: string;
  maxPageIncluded: number;
  settings: AISettings;
  entities?: XRayEntity[];
  relationships?: XRayRelationship[];
  events?: XRayTimelineEvent[];
  claims?: XRayClaim[];
}): Promise<Record<string, string>> => {
  const { bookHash, maxPageIncluded, settings } = params;
  const entities = params.entities ?? (await aiStore.getXRayEntities(bookHash));
  const relationships = params.relationships ?? (await aiStore.getXRayRelationships(bookHash));
  const events = params.events ?? (await aiStore.getXRayEvents(bookHash));
  const claims = params.claims ?? (await aiStore.getXRayClaims(bookHash));
  const textUnits = await aiStore.getXRayTextUnits(bookHash);
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const summaries: Record<string, string> = {};
  await Promise.all(
    entities.map(async (entity) => {
      summaries[entity.id] = await resolveEntitySummary({
        bookHash,
        entity,
        relationships,
        events,
        claims,
        textUnits,
        maxPageIncluded,
        settings,
        entityById,
        mode: 'lazy',
      });
    }),
  );
  return summaries;
};

const updateXRayEntitySummaries = async (params: {
  bookHash: string;
  maxPageIncluded: number;
  settings: AISettings;
  entities: XRayEntity[];
  relationships: XRayRelationship[];
  events: XRayTimelineEvent[];
  claims: XRayClaim[];
}): Promise<void> => {
  const { bookHash, maxPageIncluded, settings, entities, relationships, events, claims } = params;
  if (!settings.enabled || settings.provider !== 'ai-gateway') return;
  if (typeof window !== 'undefined' && !settings.aiGatewayApiKey) return;
  const textUnits = await aiStore.getXRayTextUnits(bookHash);
  const startedAt = Date.now();
  let processed = 0;
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const yieldIfNeeded = createYieldController(12);

  for (const entity of entities) {
    if (processed >= XRAY_SUMMARY_MAX_PER_RUN) break;
    if (Date.now() - startedAt > XRAY_SUMMARY_MAX_RUN_MS) break;
    const { sourceHash, hasSignal } = buildEntitySummaryContext({
      entity,
      relationships,
      events,
      claims,
      textUnits,
      maxPageIncluded,
      entityById,
    });
    if (!hasSignal) {
      await yieldIfNeeded();
      continue;
    }
    const summaryKey = buildSummaryKey(bookHash, entity.id, sourceHash);
    const cached = await aiStore.getXRayEntitySummary(summaryKey);
    if (cached?.summary) {
      await yieldIfNeeded();
      continue;
    }
    await resolveEntitySummary({
      bookHash,
      entity,
      relationships,
      events,
      claims,
      textUnits,
      maxPageIncluded,
      settings,
      entityById,
      mode: 'eager',
    });
    processed += 1;
    await yieldIfNeeded();
  }
};

const applyInferences = async (
  entities: XRayEntity[],
  relationships: XRayRelationship[],
  textUnits: XRayTextUnit[],
  bookHash: string,
  maxPage: number,
  yieldIfNeeded?: () => Promise<void>,
): Promise<{ entities: XRayEntity[]; relationships: XRayRelationship[] }> => {
  const possessiveParser = new PossessiveParser();
  const possessiveChains: import('./xray/possessiveParser').PossessiveChain[] = [];

  for (const unit of textUnits) {
    const chains = possessiveParser.parsePossessiveChains(unit.text, unit.page, unit.chunkId);
    possessiveChains.push(...chains);
    if (yieldIfNeeded) await yieldIfNeeded();
  }

  const possessiveResult = possessiveParser.generateImpliedEntitiesAndRelationships(
    possessiveChains,
    entities,
    bookHash,
    maxPage,
  );

  const allEntities = [...entities, ...possessiveResult.entities];
  let allRelationships = [...relationships, ...possessiveResult.relationships];
  const entityById = new Map(allEntities.map((entity) => [entity.id, entity]));
  for (const rel of allRelationships) {
    const source = entityById.get(rel.sourceId);
    const target = entityById.get(rel.targetId);
    if (!source || !target) continue;
    rel.description = normalizeRelationshipDescription(
      rel.description || '',
      source.canonicalName,
      rel.type,
      target.canonicalName,
      rel.evidence,
    );
  }
  allRelationships = allRelationships.filter((rel) => isLivingRelationship(rel, entityById));
  if (yieldIfNeeded) await yieldIfNeeded();

  const coreferenceResolver = new CoreferenceResolver();
  await coreferenceResolver.resolveCoreferences(textUnits, allEntities, yieldIfNeeded);

  try {
    const graphBuilder = new XRayGraphBuilder();
    const graphRelationships = allRelationships.filter(
      (rel) => rel.sourceId !== rel.targetId && isLivingRelationship(rel, entityById),
    );
    graphBuilder.buildFromSnapshot(allEntities, graphRelationships, []);
    const graph = graphBuilder.getGraph();

    const graphInference = new XRayGraphInference();
    const inferenceResult = await graphInference.inferRelationships(
      graph,
      allEntities,
      bookHash,
      maxPage,
      yieldIfNeeded,
    );

    const inferred = inferenceResult.inferredRelationships.filter(
      (rel) => rel.sourceId !== rel.targetId && isLivingRelationship(rel, entityById),
    );
    inferred.forEach((rel) => {
      const source = entityById.get(rel.sourceId);
      const target = entityById.get(rel.targetId);
      if (!source || !target) return;
      rel.description = normalizeRelationshipDescription(
        rel.description || '',
        source.canonicalName,
        rel.type,
        target.canonicalName,
        rel.evidence,
      );
    });
    allRelationships.push(...inferred);
  } catch (error) {
    console.warn('xray graph inference failed', error);
  }

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
    const canonicalRaw = entity.name.trim();
    if (!canonicalRaw) continue;
    const canonical = normalizeEntityName(canonicalRaw);
    if (isNoisyEntityName(canonical, entity.type)) continue;
    const normalized = normalizeName(canonical);
    const existing = existingByName.get(normalized);
    const facts = entity.facts
      .map((fact) => ({
        key: fact.key,
        value: fact.value,
        evidence: mapEvidence(fact.evidence, textUnits, maxPage, now),
        inferred: fact.inferred,
      }))
      .filter((fact) => fact.evidence.length > 0);

    if (existing) {
      const mergedFacts = [...existing.facts];
      const factMap = new Map(mergedFacts.map((f) => [`${f.key}:${f.value}`, f]));
      for (const fact of facts) {
        const key = `${fact.key}:${fact.value}`;
        const existingFact = factMap.get(key);
        if (existingFact) {
          existingFact.evidence = [...existingFact.evidence, ...fact.evidence];
          if (typeof fact.inferred === 'boolean') existingFact.inferred = fact.inferred;
          continue;
        }
        mergedFacts.push(fact);
        factMap.set(key, fact);
      }
      const mergedAliases = uniqueStrings([
        ...existing.aliases,
        ...entity.aliases.map((alias) => normalizeEntityName(alias)),
      ]);
      const description = buildEntityDescription({
        name: canonical,
        type: entity.type,
        aliases: mergedAliases,
        descriptionParts: [entity.description || '', existing.description || ''],
        facts: mergedFacts.map((fact) => ({ key: fact.key, value: fact.value })),
      });
      entities.push({
        ...existing,
        aliases: mergedAliases,
        description,
        firstSeenPage: Math.min(existing.firstSeenPage, entity.first_seen_page),
        lastSeenPage: Math.max(existing.lastSeenPage, entity.last_seen_page),
        facts: mergedFacts,
        createdAt: existing.createdAt ?? now,
        maxPageIncluded: Math.max(existing.maxPageIncluded, maxPage),
        lastUpdated: now,
      });
    } else {
      const normalizedAliases = uniqueStrings(
        entity.aliases.map((alias) => normalizeEntityName(alias)),
      );
      const description = buildEntityDescription({
        name: canonical,
        type: entity.type,
        aliases: normalizedAliases,
        descriptionParts: [entity.description || ''],
        facts: facts.map((fact) => ({ key: fact.key, value: fact.value })),
      });
      entities.push({
        id: `xray_${nanoid(10)}`,
        type: entity.type,
        canonicalName: canonical,
        aliases: normalizedAliases,
        description,
        firstSeenPage: entity.first_seen_page,
        lastSeenPage: entity.last_seen_page,
        facts,
        bookHash,
        maxPageIncluded: maxPage,
        lastUpdated: now,
        createdAt: now,
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
  const entityById = new Map(
    Array.from(entityByName.values()).map((entity) => [entity.id, entity]),
  );
  const existingMap = new Map(
    existing
      .filter((rel) => isLivingRelationship(rel, entityById))
      .map((rel) => [`${rel.sourceId}:${rel.targetId}:${rel.type}`, rel]),
  );
  for (const rel of extraction.relationships) {
    const source = resolveEntityId(rel.source, entityByName, aliasMap);
    const target = resolveEntityId(rel.target, entityByName, aliasMap);
    if (!source || !target) continue;
    if (!isHumanEntity(source) || !isHumanEntity(target)) continue;
    const evidence = mapEvidence(rel.evidence, textUnits, maxPage, now);
    if (evidence.length === 0) continue;
    const key = `${source.id}:${target.id}:${rel.type}`;
    const existingRel = existingMap.get(key);
    if (existingRel) {
      const combinedEvidence = [...existingRel.evidence, ...evidence];
      const combinedDescription = [existingRel.description, rel.description]
        .filter(Boolean)
        .join(' ');
      existingMap.set(key, {
        ...existingRel,
        description: normalizeRelationshipDescription(
          combinedDescription,
          source.canonicalName,
          rel.type,
          target.canonicalName,
          combinedEvidence,
        ),
        evidence: combinedEvidence,
        inferred: rel.inferred ?? existingRel.inferred,
        lastSeenPage: Math.max(existingRel.lastSeenPage, rel.last_seen_page),
        maxPageIncluded: Math.max(existingRel.maxPageIncluded, maxPage),
        strength:
          typeof rel.strength === 'number'
            ? Math.max(existingRel.strength ?? 0, Math.max(0, Math.min(10, rel.strength)))
            : existingRel.strength,
        createdAt: existingRel.createdAt ?? now,
        lastUpdated: now,
      });
    } else {
      existingMap.set(key, {
        id: `xray_${nanoid(10)}`,
        sourceId: source.id,
        targetId: target.id,
        type: rel.type,
        description: normalizeRelationshipDescription(
          rel.description || '',
          source.canonicalName,
          rel.type,
          target.canonicalName,
          evidence,
        ),
        evidence,
        inferred: rel.inferred,
        firstSeenPage: rel.first_seen_page,
        lastSeenPage: rel.last_seen_page,
        strength:
          typeof rel.strength === 'number' ? Math.max(0, Math.min(10, rel.strength)) : undefined,
        bookHash,
        maxPageIncluded: maxPage,
        lastUpdated: now,
        createdAt: now,
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
  const entityById = new Map(
    Array.from(entityByName.values()).map((entity) => [entity.id, entity]),
  );
  const merged = new Map(
    existing.map((event) => [buildEventKey(event.page, event.evidence), event]),
  );
  for (const event of extraction.events) {
    if (event.page > maxPage) continue;
    const evidence = mapEvidence(event.evidence, textUnits, maxPage, now);
    if (evidence.length === 0) continue;
    const eventPage = Math.max(event.page, getLatestEvidencePage(evidence));
    const involvedIds = event.involved_entities
      .map((name) => resolveEntityId(name, entityByName, aliasMap))
      .filter(Boolean)
      .map((entity) => entity!.id);
    const involvedNames = involvedIds
      .map((id) => entityById.get(id)?.canonicalName)
      .filter(Boolean) as string[];
    const key = buildEventKey(eventPage, evidence);
    const existingEvent = merged.get(key);
    if (existingEvent) {
      const combinedEvidence = [...existingEvent.evidence, ...evidence];
      const combinedPage = Math.max(
        existingEvent.page,
        eventPage,
        getLatestEvidencePage(combinedEvidence),
      );
      const combinedNames = uniqueStrings([...existingEvent.involvedEntityIds, ...involvedIds])
        .map((id) => entityById.get(id)?.canonicalName)
        .filter(Boolean) as string[];
      const combinedSummary = [existingEvent.summary, event.summary].filter(Boolean).join(' ');
      merged.set(key, {
        ...existingEvent,
        page: combinedPage,
        importance: Math.max(existingEvent.importance, event.importance),
        evidence: combinedEvidence,
        involvedEntityIds: uniqueStrings([...existingEvent.involvedEntityIds, ...involvedIds]),
        arc: event.arc || existingEvent.arc,
        tone: event.tone || existingEvent.tone,
        emotions: mergeStrings(existingEvent.emotions, event.emotions),
        maxPageIncluded: Math.max(existingEvent.maxPageIncluded, maxPage),
        lastUpdated: now,
        summary: buildEventSummary({
          summary: combinedSummary,
          involvedNames: combinedNames,
        }),
      });
    } else {
      merged.set(key, {
        id: `xray_${nanoid(10)}`,
        page: eventPage,
        summary: buildEventSummary({ summary: event.summary, involvedNames }),
        importance: event.importance,
        involvedEntityIds: involvedIds,
        evidence,
        arc: event.arc,
        tone: event.tone,
        emotions: uniqueStrings(event.emotions ?? []),
        bookHash,
        maxPageIncluded: maxPage,
        lastUpdated: now,
        createdAt: now,
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
  const entityById = new Map(
    Array.from(entityByName.values()).map((entity) => [entity.id, entity]),
  );
  const merged = new Map(
    existing.map((claim) => [
      buildClaimKey(claim.type, claim.subjectId, claim.objectId, claim.evidence),
      claim,
    ]),
  );
  for (const claim of extraction.claims) {
    const evidence = mapEvidence(claim.evidence, textUnits, maxPage, now);
    if (evidence.length === 0) continue;
    const subject = claim.subject ? resolveEntityId(claim.subject, entityByName, aliasMap) : null;
    const object = claim.object ? resolveEntityId(claim.object, entityByName, aliasMap) : null;
    const key = buildClaimKey(claim.type, subject?.id, object?.id, evidence);
    const existingClaim = merged.get(key);
    if (existingClaim) {
      const combinedEvidence = [...existingClaim.evidence, ...evidence];
      const subjectName = existingClaim.subjectId
        ? entityById.get(existingClaim.subjectId)?.canonicalName
        : subject?.canonicalName;
      const objectName = existingClaim.objectId
        ? entityById.get(existingClaim.objectId)?.canonicalName
        : object?.canonicalName;
      const combinedDescription = [existingClaim.description, claim.description]
        .filter(Boolean)
        .join(' ');
      merged.set(key, {
        ...existingClaim,
        evidence: combinedEvidence,
        status: claim.status || existingClaim.status,
        maxPageIncluded: Math.max(existingClaim.maxPageIncluded, maxPage),
        lastUpdated: now,
        description: buildClaimDescription({
          description: combinedDescription,
          type: claim.type,
          subject: subjectName,
          object: objectName,
        }),
      });
    } else {
      const subjectName = subject?.canonicalName;
      const objectName = object?.canonicalName;
      merged.set(key, {
        id: `xray_${nanoid(10)}`,
        type: claim.type,
        description: buildClaimDescription({
          description: claim.description,
          type: claim.type,
          subject: subjectName,
          object: objectName,
        }),
        subjectId: subject?.id,
        objectId: object?.id,
        status: claim.status,
        evidence,
        bookHash,
        maxPageIncluded: maxPage,
        lastUpdated: now,
        createdAt: now,
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
    `- PromptVersion: ${XRAY_PROMPT_VERSION}`,
    `- DataVersion: ${XRAY_VERSION}`,
    '',
  ].join('\n');

  const entityLines = extraction.entities.map((entity) => `${entity.name} (${entity.type})`);
  const relationshipLines = extraction.relationships.map(
    (rel) => `${rel.source} -> ${rel.target} (${rel.type})`,
  );
  const eventLines = extraction.events.map((event) => `Page ${event.page}: ${event.summary}`);
  const claimLines = extraction.claims.map((claim) => `${claim.type}: ${claim.description}`);

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
    formatLogSection('Claims', claimLines),
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

const markPendingRange = (state: XRayState, targetPage: number) => {
  if (targetPage <= state.lastAnalyzedPage) return {};
  return {
    pendingFromPage: state.pendingFromPage ?? state.lastAnalyzedPage + 1,
    pendingToPage: Math.max(state.pendingToPage ?? 0, targetPage),
  };
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
  const normalizedEntities = visibleEntities.map((entity) => {
    const canonicalName = normalizeEntityName(entity.canonicalName);
    const aliases = uniqueStrings(entity.aliases.map((alias) => normalizeEntityName(alias)));
    const description = buildEntityDescription({
      name: canonicalName,
      type: entity.type,
      aliases,
      descriptionParts: [entity.description || ''],
      facts: entity.facts.map((fact) => ({ key: fact.key, value: fact.value })),
    });
    if (
      canonicalName === entity.canonicalName &&
      aliases.length === entity.aliases.length &&
      description === entity.description
    )
      return entity;
    return {
      ...entity,
      canonicalName,
      aliases,
      description,
    };
  });
  const visibleEntityIds = new Set(normalizedEntities.map((entity) => entity.id));
  const livingEntityIds = new Set(
    normalizedEntities.filter((entity) => isHumanEntity(entity)).map((entity) => entity.id),
  );
  const entityById = new Map(normalizedEntities.map((entity) => [entity.id, entity]));
  return {
    entities: normalizedEntities,
    relationships: relationships
      .filter(
        (rel) =>
          rel.lastSeenPage <= maxPage &&
          visibleEntityIds.has(rel.sourceId) &&
          visibleEntityIds.has(rel.targetId) &&
          livingEntityIds.has(rel.sourceId) &&
          livingEntityIds.has(rel.targetId),
      )
      .map((rel) => {
        const source = entityById.get(rel.sourceId);
        const target = entityById.get(rel.targetId);
        if (!source || !target) return rel;
        const safeEvidence = filterEvidenceByPage(rel.evidence, maxPage);
        return {
          ...rel,
          description: normalizeRelationshipDescription(
            rel.description || '',
            source.canonicalName,
            rel.type,
            target.canonicalName,
            safeEvidence,
          ),
          evidence: safeEvidence,
        };
      }),
    events: events
      .filter((event) => event.page <= maxPage)
      .map((event) => {
        const safeEvidence = filterEvidenceByPage(event.evidence, maxPage);
        const involvedNames = event.involvedEntityIds
          .map((id) => entityById.get(id)?.canonicalName)
          .filter(Boolean) as string[];
        return {
          ...event,
          summary: buildEventSummary({
            summary: event.summary,
            involvedNames,
          }),
          evidence: safeEvidence,
        };
      }),
    claims: claims
      .filter((claim) => claim.maxPageIncluded <= maxPage)
      .map((claim) => {
        const safeEvidence = filterEvidenceByPage(claim.evidence, maxPage);
        const subjectName = claim.subjectId
          ? entityById.get(claim.subjectId)?.canonicalName
          : undefined;
        const objectName = claim.objectId
          ? entityById.get(claim.objectId)?.canonicalName
          : undefined;
        return {
          ...claim,
          description: buildClaimDescription({
            description: claim.description,
            type: claim.type,
            subject: subjectName,
            object: objectName,
          }),
          evidence: safeEvidence,
        };
      }),
    maxPageIncluded: maxPage,
    lastUpdated: state?.lastUpdated ?? 0,
    state,
  };
};

export const updateXRayForProgress = async (params: {
  bookHash: string;
  currentPage: number;
  settings: AISettings;
  bookTitle: string;
  appService?: AppService | null;
  force?: boolean;
  bookMetadata?: BookMetadata;
}): Promise<void> => {
  const {
    bookHash,
    currentPage,
    settings,
    bookTitle,
    appService,
    force = false,
    bookMetadata,
  } = params;

  const debugBuffer: string[] = [];

  const flushDebug = async (): Promise<void> => {
    if (debugBuffer.length === 0) return;
    const content = debugBuffer.join('');
    debugBuffer.length = 0;
    if (!appService && typeof window !== 'undefined') {
      try {
        const key = `xray_debug_${bookHash}`;
        const existing = window.localStorage.getItem(key) || '';
        const next = `${existing}${content}`;
        const trimmed = next.length > 200000 ? next.slice(next.length - 200000) : next;
        window.localStorage.setItem(key, trimmed);
      } catch {}
      return;
    }
    if (!appService) return;
    await appendXRayDebugLog(appService, bookTitle, bookHash, content);
  };

  const logDebug = async (message: string): Promise<void> => {
    const stamp = new Date().toISOString();
    const line = `[X-Ray][${stamp}] ${message}\n`;
    console.debug(line.trimEnd());
    debugBuffer.push(line);
  };

  const yieldIfNeeded = createYieldController(12);

  if (!settings.enabled) {
    await logDebug('xray_update skipped: ai disabled');
    await flushDebug();
    return;
  }

  if (processingBooks.has(bookHash)) {
    await logDebug('xray_update skipped: already processing');
    await flushDebug();
    return;
  }

  const state = await ensureXRayState(bookHash);
  const baseState: XRayState = {
    ...state,
    bookTitle,
    lastProvider: settings.provider,
  };
  const pendingToPage = state.pendingToPage ?? 0;
  const targetPage = Math.max(currentPage, pendingToPage);

  const isIndexed = await isBookIndexed(bookHash);

  if (!isIndexed) {
    await logDebug('xray_update failed: book not indexed');
    await aiStore.saveXRayState({
      ...baseState,
      ...markPendingRange(state, targetPage),
      lastError: 'not_indexed',
      lastReadAt: Date.now(),
      lastUpdated: Date.now(),
    });
    await flushDebug();
    if (force) {
      throw new Error('Book must be indexed before X-Ray extraction');
    }
    return;
  }

  processingBooks.add(bookHash);
  void eventDispatcher.dispatch('xray-processing', { bookHash, status: 'start' });

  try {
    const forceReprocess = force && targetPage <= state.lastAnalyzedPage;
    const baseAnalyzed = forceReprocess
      ? Math.max(0, targetPage - XRAY_MAX_BATCH_PAGES)
      : state.lastAnalyzedPage;
    const pageDelta = targetPage - state.lastAnalyzedPage;
    const effectiveDelta = Math.max(0, targetPage - baseAnalyzed);

    await logDebug(
      `xray_update start currentPage=${currentPage} targetPage=${targetPage} lastAnalyzed=${state.lastAnalyzedPage} delta=${pageDelta} force=${force} provider=${settings.provider}`,
    );

    if (settings.provider !== 'ai-gateway') {
      await logDebug('xray_update skipped: provider not ai-gateway');
      await aiStore.saveXRayState({
        ...baseState,
        ...markPendingRange(state, targetPage),
        lastError: 'provider_not_supported',
        lastReadAt: Date.now(),
        lastUpdated: Date.now(),
      });
      return;
    }

    if (typeof window !== 'undefined' && !settings.aiGatewayApiKey) {
      await logDebug('xray_update skipped: missing ai gateway api key');
      await aiStore.saveXRayState({
        ...baseState,
        ...markPendingRange(state, targetPage),
        lastError: 'missing_api_key',
        lastReadAt: Date.now(),
        lastUpdated: Date.now(),
      });
      return;
    }

    if (!force && targetPage <= state.lastAnalyzedPage) {
      await logDebug('xray_update skipped: targetPage <= lastAnalyzedPage');
      await aiStore.saveXRayState({
        ...baseState,
        lastReadAt: Date.now(),
        lastUpdated: Date.now(),
      });
      return;
    }

    if (!force && pageDelta < XRAY_MIN_PAGE_DELTA) {
      await logDebug(`xray_update skipped: pageDelta < ${XRAY_MIN_PAGE_DELTA}`);
      await aiStore.saveXRayState({
        ...baseState,
        lastReadAt: Date.now(),
        lastUpdated: Date.now(),
      });
      return;
    }

    const maxBatches = force
      ? Math.max(1, Math.ceil(effectiveDelta / XRAY_MAX_BATCH_PAGES))
      : Math.min(XRAY_MAX_BATCHES_PER_RUN, Math.ceil(pageDelta / XRAY_MAX_BATCH_PAGES));
    const genreHints = buildGenreHints(bookMetadata);
    const allChunks = await aiStore.getChunks(bookHash);
    const chunksByPage = indexChunksByPage(allChunks);
    await yieldIfNeeded();
    let existingEntities = await aiStore.getXRayEntities(bookHash);
    let existingRelationships = await aiStore.getXRayRelationships(bookHash);
    let existingEvents = await aiStore.getXRayEvents(bookHash);
    let existingClaims = await aiStore.getXRayClaims(bookHash);
    let aliasEntries = await aiStore.getXRayAliases(bookHash);
    let lastAnalyzed = baseAnalyzed;
    const startedAt = Date.now();

    const runExtraction = async (
      prompt: string,
      label: string,
    ): Promise<XRayExtractionV1 | null> => {
      const systemPrompt = buildXRaySystemPrompt();
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
        try {
          const result = await generateXRayExtraction(systemPrompt, prompt, settings);
          const normalized = normalizeExtraction(result as Partial<XRayExtractionV1> | null);
          const parsed = xrayExtractionSchema.safeParse(normalized);
          if (!parsed.success) {
            const isRecord = typeof result === 'object' && result !== null;
            const entitiesLen =
              isRecord && Array.isArray((result as XRayExtractionV1).entities)
                ? (result as XRayExtractionV1).entities.length
                : -1;
            const relationshipsLen =
              isRecord && Array.isArray((result as XRayExtractionV1).relationships)
                ? (result as XRayExtractionV1).relationships.length
                : -1;
            const eventsLen =
              isRecord && Array.isArray((result as XRayExtractionV1).events)
                ? (result as XRayExtractionV1).events.length
                : -1;
            const claimsLen =
              isRecord && Array.isArray((result as XRayExtractionV1).claims)
                ? (result as XRayExtractionV1).claims.length
                : -1;
            await logDebug(
              `xray_extract ${label} invalid schema attempt=${attempt} type=${typeof result} entities=${entitiesLen} relationships=${relationshipsLen} events=${eventsLen} claims=${claimsLen}`,
            );
            if (attempt < maxAttempts) {
              await new Promise((resolve) =>
                setTimeout(resolve, 400 * attempt + Math.round(Math.random() * 200)),
              );
              continue;
            }
            await logDebug(`xray_extract ${label} fallback=empty`);
            return normalizeExtraction(null);
          }
          const durationMs =
            (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
          await logDebug(
            `xray_extract ${label} success durationMs=${Math.round(durationMs)} attempt=${attempt}`,
          );
          return parsed.data as XRayExtractionV1;
        } catch (error) {
          await logDebug(
            `xray_extract ${label} error=${(error as Error).message} attempt=${attempt}`,
          );
          if (attempt < maxAttempts) {
            await new Promise((resolve) =>
              setTimeout(resolve, 600 * attempt + Math.round(Math.random() * 200)),
            );
            continue;
          }
          aiLogger.chat.error(`xray ${label} extraction failed: ${(error as Error).message}`);
          return null;
        }
      }
      return null;
    };

    const extractWindowsWithRetry = async (params: {
      windows: XRayTextUnit[][];
      pageStart: number;
      pageEnd: number;
      knownEntitiesCore: string[];
      genreHints: string[];
    }) => {
      const { windows, pageStart, pageEnd, knownEntitiesCore, genreHints } = params;
      const queue = windows.map((units, index) => ({
        units,
        tag: `w${index}`,
      }));
      const results: XRayExtractionV1[] = [];
      let failures = 0;
      let splitCount = 0;
      let concurrency = getWindowConcurrency();

      while (queue.length > 0) {
        const batch = queue.splice(0, concurrency);
        const batchResults = await Promise.all(
          batch.map(async (item) => {
            try {
              const { key, chunkHash } = buildExtractionCacheKey(
                bookHash,
                pageStart,
                pageEnd,
                item.units,
                XRAY_PROMPT_VERSION,
                item.tag,
              );
              const cached = await aiStore.getXRayExtractionCache(key);
              if (cached?.extraction) {
                const normalized = normalizeExtraction(cached.extraction);
                const parsed = xrayExtractionSchema.safeParse(normalized);
                if (!parsed.success) {
                  return { status: 'failed', units: item.units } as const;
                }
                return {
                  status: 'ok',
                  extraction: parsed.data as XRayExtractionV1,
                } as const;
              }

              const extractionPrompt = buildXRayExtractionPrompt({
                maxPageIncluded: pageEnd,
                pageStart,
                pageEnd,
                textUnits: item.units,
                knownEntities: knownEntitiesCore,
                genreHints,
              });
              const extraction = await runExtraction(extractionPrompt, 'core');
              if (!extraction) {
                return { status: 'failed', units: item.units } as const;
              }

              await aiStore.saveXRayExtractionCache({
                key,
                bookHash,
                chunkHash,
                promptVersion: XRAY_PROMPT_VERSION,
                extraction,
                timestamp: Date.now(),
              });
              return { status: 'ok', extraction } as const;
            } catch {
              return { status: 'failed', units: item.units } as const;
            }
          }),
        );

        for (const result of batchResults) {
          if (result.status === 'ok') {
            results.push(result.extraction);
            continue;
          }

          const units = result.units;
          if (units.length <= 1) {
            failures += 1;
            continue;
          }

          const mid = Math.ceil(units.length / 2);
          queue.unshift(
            { units: units.slice(0, mid), tag: `s${splitCount}-a` },
            { units: units.slice(mid), tag: `s${splitCount}-b` },
          );
          splitCount += 1;
        }

        if (batchResults.some((item) => item.status === 'failed') && concurrency > 1) {
          concurrency = 1;
        }
        await yieldIfNeeded();
      }

      return { results, failures, splitCount, totalWindows: windows.length };
    };

    for (let batch = 0; batch < maxBatches && lastAnalyzed < targetPage; batch += 1) {
      const pageStart = lastAnalyzed + 1;
      const pageEnd = Math.min(targetPage, pageStart + XRAY_MAX_BATCH_PAGES - 1);
      const textUnits = selectTextUnitsForRange(chunksByPage, bookHash, pageStart, pageEnd);
      const textChars = textUnits.reduce((sum, unit) => sum + unit.text.length, 0);
      const windowMaxChars = typeof window !== 'undefined' ? 6000 : XRAY_WINDOW_MAX_CHARS;
      const windowMaxUnits = typeof window !== 'undefined' ? 10 : XRAY_WINDOW_MAX_UNITS;
      const windows = buildTextUnitWindows(textUnits, windowMaxChars, windowMaxUnits);
      await yieldIfNeeded();

      await logDebug(
        `xray_batch start=${pageStart} end=${pageEnd} units=${textUnits.length} chars=${textChars} windows=${windows.length}`,
      );

      if (textUnits.length === 0) {
        lastAnalyzed = pageEnd;
        const clearPending = state.pendingToPage && lastAnalyzed >= state.pendingToPage;
        await aiStore.saveXRayState({
          ...baseState,
          lastAnalyzedPage: Math.max(state.lastAnalyzedPage, lastAnalyzed),
          lastUpdated: Date.now(),
          lastReadAt: Date.now(),
          lastError: undefined,
          pendingFromPage: clearPending ? undefined : state.pendingFromPage,
          pendingToPage: clearPending ? undefined : state.pendingToPage,
        });
        await logDebug(`xray_batch skipped: no text units for ${pageStart}-${pageEnd}`);
        continue;
      }

      const entityByName = new Map(
        existingEntities.map((entity) => [normalizeName(entity.canonicalName), entity]),
      );
      const entitiesByRecency = [...existingEntities].sort(
        (a, b) => b.lastSeenPage - a.lastSeenPage,
      );
      const canonicalNames = entitiesByRecency.map((entity) => entity.canonicalName);
      const knownEntitiesCore = uniqueStrings(canonicalNames).slice(0, 80);
      const livingEntities = entitiesByRecency.filter((entity) => isLivingEntityType(entity.type));
      const livingCanonicalNames = livingEntities.map((entity) => entity.canonicalName);
      const livingAliasNames = livingEntities.flatMap((entity) => entity.aliases);
      const knownEntitiesRelations = uniqueStrings([
        ...livingCanonicalNames,
        ...livingAliasNames,
      ]).slice(0, 120);

      await logDebug(
        `xray_context knownEntitiesCore=${knownEntitiesCore.length} knownEntitiesRelations=${knownEntitiesRelations.length} existingEntities=${existingEntities.length} existingRelationships=${existingRelationships.length} existingEvents=${existingEvents.length} existingClaims=${existingClaims.length}`,
      );

      const {
        results: windowResults,
        failures,
        splitCount,
        totalWindows,
      } = await extractWindowsWithRetry({
        windows,
        pageStart,
        pageEnd,
        knownEntitiesCore,
        genreHints,
      });
      const successful = windowResults;
      const failedCount = failures;

      if (successful.length === 0) {
        if (force) {
          throw new Error('X-Ray extraction failed');
        }
        await aiStore.saveXRayState({
          ...baseState,
          ...markPendingRange(state, pageEnd),
          lastError: 'extraction_failed',
          lastUpdated: Date.now(),
          lastReadAt: Date.now(),
        });
        await logDebug('xray_batch stopped: all window extractions failed');
        break;
      }

      let extraction = normalizeExtraction(null);
      for (const result of successful) {
        extraction = mergeExtraction(extraction, result);
        await yieldIfNeeded();
      }

      await logDebug(
        `xray_extract merged windows=${totalWindows} split=${splitCount} failed=${failedCount} entities=${extraction.entities.length} relationships=${extraction.relationships.length} events=${extraction.events.length} claims=${extraction.claims.length}`,
      );

      const batchComplete = failedCount === 0;

      const shouldRelFallback =
        extraction.relationships.length === 0 && knownEntitiesRelations.length >= 2;
      const shouldTimelineFallback = extraction.events.length === 0 && textUnits.length >= 4;

      if (batchComplete && (shouldRelFallback || shouldTimelineFallback)) {
        const relPrompt = shouldRelFallback
          ? buildXRayRelationshipPrompt({
              maxPageIncluded: pageEnd,
              pageStart,
              pageEnd,
              textUnits,
              knownEntities: knownEntitiesRelations,
            })
          : null;
        const timelinePrompt = shouldTimelineFallback
          ? buildXRayTimelinePrompt({
              maxPageIncluded: pageEnd,
              pageStart,
              pageEnd,
              textUnits,
            })
          : null;

        const [relExtraction, timelineExtraction] = await Promise.all([
          relPrompt ? runExtraction(relPrompt, 'relationships') : Promise.resolve(null),
          timelinePrompt ? runExtraction(timelinePrompt, 'timeline') : Promise.resolve(null),
        ]);

        if (relExtraction) {
          extraction = mergeExtraction(extraction, relExtraction);
          await logDebug(
            `xray_extract relationships fallback=${relExtraction.relationships.length}`,
          );
        }
        if (timelineExtraction) {
          extraction = mergeExtraction(extraction, timelineExtraction);
          await logDebug(`xray_extract timeline fallback=${timelineExtraction.events.length}`);
        }
      }

      if (!batchComplete) {
        await logDebug('xray_batch incomplete: window extraction failed');
      }

      if (appService) {
        const summarizeEvidence = async (label: string, groups: XRayEvidence[][]) => {
          if (groups.length === 0) return;
          let withEvidence = 0;
          let keptItems = 0;
          let totalEvidence = 0;
          let keptEvidence = 0;
          for (const group of groups) {
            if (!group || group.length === 0) continue;
            withEvidence += 1;
            totalEvidence += group.length;
            const filtered = filterEvidence(group, textUnits, pageEnd);
            if (filtered.length > 0) {
              keptItems += 1;
              keptEvidence += filtered.length;
            }
            await yieldIfNeeded();
          }
          await logDebug(
            `xray_evidence ${label} items=${groups.length} withEvidence=${withEvidence} keptItems=${keptItems} totalEvidence=${totalEvidence} keptEvidence=${keptEvidence}`,
          );
        };

        const entityFactGroups = extraction.entities.flatMap((entity) =>
          (entity.facts || []).map((fact) => fact.evidence || []),
        );
        await summarizeEvidence('entityFacts', entityFactGroups);
        await summarizeEvidence(
          'relationships',
          extraction.relationships.map((rel) => rel.evidence || []),
        );
        await summarizeEvidence(
          'events',
          extraction.events.map((event) => event.evidence || []),
        );
        await summarizeEvidence(
          'claims',
          extraction.claims.map((claim) => claim.evidence || []),
        );
      }

      const newEntities = toEntities(extraction, textUnits, pageEnd, bookHash, entityByName);
      const entityBefore = existingEntities.length;
      const relationshipBefore = existingRelationships.length;
      const eventBefore = existingEvents.length;
      const claimBefore = existingClaims.length;
      const updatedEntityMap = new Map(
        [...existingEntities, ...newEntities].map((entity) => [
          normalizeName(entity.canonicalName),
          entity,
        ]),
      );
      const aliasUpdates = newEntities.flatMap((entity) => buildAliasEntries(bookHash, entity));
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

      const inferred = await applyInferences(
        Array.from(updatedEntityMap.values()),
        updatedRelationships,
        textUnits,
        bookHash,
        pageEnd,
        yieldIfNeeded,
      );

      const allEntities = [...Array.from(updatedEntityMap.values()), ...inferred.entities];
      updatedRelationships = [...updatedRelationships, ...inferred.relationships];

      await logDebug(
        `xray_merge entitiesNew=${newEntities.length} entitiesAdded=${allEntities.length - entityBefore} entitiesTotal=${allEntities.length} relationshipsAdded=${updatedRelationships.length - relationshipBefore} relationshipsTotal=${updatedRelationships.length} eventsAdded=${updatedEvents.length - eventBefore} eventsTotal=${updatedEvents.length} claimsAdded=${updatedClaims.length - claimBefore} claimsTotal=${updatedClaims.length} inferredEntities=${inferred.entities.length} inferredRelationships=${inferred.relationships.length}`,
      );

      const nextAnalyzed = batchComplete ? pageEnd : lastAnalyzed;
      const clearPending = state.pendingToPage && nextAnalyzed >= state.pendingToPage;

      await Promise.all([
        aiStore.saveXRayEntities(allEntities),
        aiStore.saveXRayRelationships(updatedRelationships),
        aiStore.saveXRayEvents(updatedEvents),
        aiStore.saveXRayClaims(updatedClaims),
        aiStore.saveXRayTextUnits(textUnits),
        aiStore.saveXRayAliases(updatedAliases),
        aiStore.saveXRayState({
          ...baseState,
          lastAnalyzedPage: Math.max(state.lastAnalyzedPage, nextAnalyzed),
          lastUpdated: Date.now(),
          lastReadAt: Date.now(),
          lastError: undefined,
          pendingFromPage: clearPending ? undefined : state.pendingFromPage,
          pendingToPage: clearPending ? undefined : state.pendingToPage,
        }),
      ]);

      void updateXRayEntitySummaries({
        bookHash,
        maxPageIncluded: pageEnd,
        settings,
        entities: allEntities,
        relationships: updatedRelationships,
        events: updatedEvents,
        claims: updatedClaims,
      });

      existingEntities = allEntities;
      existingRelationships = updatedRelationships;
      existingEvents = updatedEvents;
      existingClaims = updatedClaims;
      aliasEntries = updatedAliases;

      if (appService) {
        const logEntry = buildXRayLogEntry(bookTitle, bookHash, pageEnd, extraction);
        await appendXRayLog(appService, bookTitle, bookHash, logEntry);
      }

      await eventDispatcher.dispatch('xray-updated', { bookHash, maxPageIncluded: pageEnd });
      lastAnalyzed = nextAnalyzed;

      await logDebug(`xray_batch saved pageEnd=${pageEnd}`);

      await new Promise((resolve) => setTimeout(resolve, 0));

      if (!batchComplete) {
        await logDebug('xray_update paused: retry incomplete batch');
        break;
      }

      if (!force && Date.now() - startedAt > XRAY_MAX_RUN_MS) {
        await logDebug('xray_update paused: max runtime reached');
        break;
      }
    }

    await logDebug(`xray_update complete lastAnalyzed=${lastAnalyzed}`);
  } catch (error) {
    await logDebug(`xray_update error=${error instanceof Error ? error.message : 'unknown'}`);
    await aiStore.saveXRayState({
      ...baseState,
      ...markPendingRange(state, targetPage),
      lastError: error instanceof Error ? error.message : 'unknown',
      lastReadAt: Date.now(),
      lastUpdated: Date.now(),
    });
    throw error;
  } finally {
    try {
      await flushDebug();
    } catch {}
    processingBooks.delete(bookHash);
    void eventDispatcher.dispatch('xray-processing', { bookHash, status: 'end' });
  }
};

export const rebuildXRayToPage = async (params: {
  bookHash: string;
  currentPage: number;
  settings: AISettings;
  bookTitle: string;
  appService?: AppService | null;
  bookMetadata?: BookMetadata;
}): Promise<void> => {
  const { bookHash, currentPage, settings, bookTitle, appService, bookMetadata } = params;
  if (!settings.enabled) return;
  if (processingBooks.has(bookHash)) return;
  if (appService) {
    const stamp = new Date().toISOString();
    const line = `[X-Ray][${stamp}] xray_rebuild start currentPage=${currentPage}`;
    console.debug(line);
    await appendXRayDebugLog(appService, bookTitle, bookHash, `${line}\n`);
  } else {
    const stamp = new Date().toISOString();
    console.debug(`[X-Ray][${stamp}] xray_rebuild start currentPage=${currentPage}`);
  }
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
      bookMetadata,
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
  const [entities, aliases, relationships, events, claims, textUnits] = await Promise.all([
    aiStore.getXRayEntities(bookHash),
    aiStore.getXRayAliases(bookHash),
    aiStore.getXRayRelationships(bookHash),
    aiStore.getXRayEvents(bookHash),
    aiStore.getXRayClaims(bookHash),
    aiStore.getXRayTextUnits(bookHash),
  ]);
  const entityByName = new Map(
    entities.map((entity) => [normalizeName(entity.canonicalName), entity]),
  );
  const aliasMap = buildAliasMap(entities, aliases);
  const direct = resolveEntityId(term, entityByName, aliasMap);
  if (direct) {
    const entityById = new Map(entities.map((entity) => [entity.id, entity]));
    const summary = await resolveEntitySummary({
      bookHash,
      entity: direct,
      relationships,
      events,
      claims,
      textUnits,
      maxPageIncluded,
      settings,
      entityById,
      mode: 'eager',
    });
    const evidence = direct.facts.flatMap((fact) =>
      filterEvidence(fact.evidence, textUnits, maxPageIncluded),
    );
    return {
      term,
      summary: summary || summarizeEntity(direct),
      evidence: evidence.slice(0, 3),
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
  const now = Date.now();
  for (const sentence of sentences) {
    const matchUnit = units.find((unit) => unit.text.includes(sentence));
    if (!matchUnit) continue;
    evidence.push({
      quote: sentence,
      page: matchUnit.page,
      chunkId: matchUnit.chunkId,
      extractedAt: now,
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
