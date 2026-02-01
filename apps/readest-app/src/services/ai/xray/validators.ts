import { z } from 'zod';

import type {
  XRayExtractionV1,
  XRayEvidence,
  XRayTextUnit,
  XRayExtractionEvidence,
  XRayEntityType,
  XRayExtractionFact,
} from './types';

const evidenceSchema = z.object({
  quote: z.string().min(1),
  page: z.number().int().min(0),
  chunkId: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  inferred: z.boolean().optional(),
});

const factSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
  evidence: z.array(evidenceSchema).optional().default([]),
  inferred: z.boolean().optional(),
});

const entitySchema = z.object({
  name: z.string().min(1),
  type: z.enum([
    'character',
    'location',
    'organization',
    'artifact',
    'term',
    'event',
    'theme',
    'concept',
  ]),
  aliases: z.array(z.string()).optional().default([]),
  description: z.string().optional().default(''),
  first_seen_page: z.number().int().min(0).optional().default(0),
  last_seen_page: z.number().int().min(0).optional().default(0),
  facts: z.array(factSchema).optional().default([]),
});

const relationshipSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.string().min(1),
  description: z.string().optional().default(''),
  evidence: z.array(evidenceSchema).optional().default([]),
  inferred: z.boolean().optional(),
  first_seen_page: z.number().int().min(0).optional().default(0),
  last_seen_page: z.number().int().min(0).optional().default(0),
});

const eventSchema = z.object({
  page: z.number().int().min(0).optional().default(0),
  summary: z.string().min(1),
  importance: z.number().int().min(1).max(10).optional().default(5),
  involved_entities: z.array(z.string()).optional().default([]),
  evidence: z.array(evidenceSchema).optional().default([]),
});

const claimSchema = z.object({
  type: z.string().min(1),
  subject: z.string().optional(),
  object: z.string().optional(),
  description: z.string().min(1),
  status: z.enum(['TRUE', 'FALSE', 'SUSPECTED']).optional(),
  evidence: z.array(evidenceSchema).optional().default([]),
});

export const xrayExtractionSchema = z.object({
  entities: z.array(entitySchema).optional().default([]),
  relationships: z.array(relationshipSchema).optional().default([]),
  events: z.array(eventSchema).optional().default([]),
  claims: z.array(claimSchema).optional().default([]),
});

const normalizeText = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/-\s*\n\s*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getValue = (record: Record<string, unknown>, key: string): unknown => record[key];

const toString = (value: unknown): string => (typeof value === 'string' ? value : '');

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeEntityType = (value: unknown): XRayEntityType => {
  const raw = toString(value).trim().toLowerCase();
  const map: Record<string, XRayEntityType> = {
    person: 'character',
    people: 'character',
    character: 'character',
    protagonist: 'character',
    narrator: 'character',
    creature: 'character',
    place: 'location',
    location: 'location',
    setting: 'location',
    organization: 'organization',
    organisation: 'organization',
    group: 'organization',
    guild: 'organization',
    artifact: 'artifact',
    item: 'artifact',
    object: 'artifact',
    term: 'term',
    concept: 'concept',
    idea: 'concept',
    theme: 'theme',
    event: 'event',
  };
  if (map[raw]) return map[raw];
  if (raw.startsWith('person')) return 'character';
  if (raw.startsWith('char')) return 'character';
  if (raw.startsWith('loc') || raw.startsWith('place')) return 'location';
  if (raw.startsWith('org') || raw.startsWith('group')) return 'organization';
  if (raw.startsWith('artifact') || raw.startsWith('item')) return 'artifact';
  if (raw.startsWith('concept')) return 'concept';
  if (raw.startsWith('theme')) return 'theme';
  if (raw.startsWith('event')) return 'event';
  return 'term';
};

const normalizeEvidenceItem = (item: Record<string, unknown>): XRayExtractionEvidence | null => {
  const quote = toString(getValue(item, 'quote'));
  const chunkId = toString(getValue(item, 'chunkId') || getValue(item, 'chunk_id'));
  const page = toNumber(
    getValue(item, 'page') ?? getValue(item, 'pageNumber') ?? getValue(item, 'page_number'),
  );
  if (!quote || !chunkId || page === null) return null;
  const evidence: XRayExtractionEvidence = { quote, page, chunkId };
  if (typeof getValue(item, 'confidence') === 'number')
    evidence.confidence = getValue(item, 'confidence') as number;
  if (typeof getValue(item, 'inferred') === 'boolean')
    evidence.inferred = getValue(item, 'inferred') as boolean;
  return evidence;
};

const normalizeEvidence = (
  input: unknown,
  fallback?: Record<string, unknown>,
): XRayExtractionEvidence[] => {
  const output: XRayExtractionEvidence[] = [];
  if (Array.isArray(input)) {
    for (const entry of input) {
      if (!isRecord(entry)) continue;
      const normalized = normalizeEvidenceItem(entry);
      if (normalized) output.push(normalized);
    }
  } else if (isRecord(input)) {
    const normalized = normalizeEvidenceItem(input);
    if (normalized) output.push(normalized);
  }

  if (output.length === 0 && fallback) {
    const normalized = normalizeEvidenceItem(fallback);
    if (normalized) output.push(normalized);
  }

  return output;
};

const normalizeFacts = (item: Record<string, unknown>): XRayExtractionFact[] => {
  const factsRaw = getValue(item, 'facts');
  const facts = Array.isArray(factsRaw) ? factsRaw.filter(isRecord) : [];
  if (facts.length > 0) {
    return facts
      .map((fact) => {
        const evidence = normalizeEvidence(getValue(fact, 'evidence'), fact);
        const key = toString(getValue(fact, 'key') || getValue(fact, 'name')) || 'fact';
        const value = toString(getValue(fact, 'value') || getValue(fact, 'description'));
        return {
          key,
          value,
          evidence,
          inferred: getValue(fact, 'inferred') === true,
        } as XRayExtractionFact;
      })
      .filter((fact) => fact.value.length > 0);
  }

  const evidence = normalizeEvidence(getValue(item, 'evidence'), item);
  if (evidence.length === 0) return [];
  const value = toString(getValue(item, 'description')) || 'Mentioned in text';
  return [
    {
      key: 'mention',
      value,
      evidence,
      inferred: getValue(item, 'inferred') === true,
    },
  ];
};

const normalizeEntities = (input: unknown): XRayExtractionV1['entities'] => {
  if (!Array.isArray(input)) return [];
  return input
    .filter(isRecord)
    .map((entity) => {
      const name = toString(
        getValue(entity, 'name') || getValue(entity, 'title') || getValue(entity, 'entity'),
      );
      const evidence = normalizeEvidence(getValue(entity, 'evidence'), entity);
      const pageFallback = evidence[0]?.page ?? toNumber(getValue(entity, 'page')) ?? 0;
      return {
        name,
        type: normalizeEntityType(getValue(entity, 'type')),
        aliases: Array.isArray(getValue(entity, 'aliases'))
          ? (getValue(entity, 'aliases') as unknown[])
              .map((alias) => toString(alias))
              .filter(Boolean)
          : [],
        description: toString(getValue(entity, 'description')),
        first_seen_page:
          toNumber(
            getValue(entity, 'first_seen_page') ??
              getValue(entity, 'firstSeenPage') ??
              pageFallback,
          ) ?? 0,
        last_seen_page:
          toNumber(
            getValue(entity, 'last_seen_page') ?? getValue(entity, 'lastSeenPage') ?? pageFallback,
          ) ?? 0,
        facts: normalizeFacts({ ...entity, evidence }),
      };
    })
    .filter((entity) => entity.name.length > 0);
};

const normalizeRelationships = (input: unknown): XRayExtractionV1['relationships'] => {
  if (!Array.isArray(input)) return [];
  return input
    .filter(isRecord)
    .map((rel) => {
      const evidence = normalizeEvidence(getValue(rel, 'evidence'), rel);
      const pageFallback = evidence[0]?.page ?? toNumber(getValue(rel, 'page')) ?? 0;
      return {
        source: toString(
          getValue(rel, 'source') || getValue(rel, 'from') || getValue(rel, 'subject'),
        ),
        target: toString(getValue(rel, 'target') || getValue(rel, 'to') || getValue(rel, 'object')),
        type:
          toString(
            getValue(rel, 'type') ||
              getValue(rel, 'relationship') ||
              getValue(rel, 'relation') ||
              'related_to',
          ) || 'related_to',
        description: toString(getValue(rel, 'description')),
        evidence,
        inferred: getValue(rel, 'inferred') === true,
        first_seen_page: toNumber(getValue(rel, 'first_seen_page') ?? pageFallback) ?? 0,
        last_seen_page: toNumber(getValue(rel, 'last_seen_page') ?? pageFallback) ?? 0,
      };
    })
    .filter((rel) => rel.source.length > 0 && rel.target.length > 0 && rel.type.length > 0);
};

const normalizeEvents = (input: unknown): XRayExtractionV1['events'] => {
  if (!Array.isArray(input)) return [];
  return input
    .filter(isRecord)
    .map((event) => {
      const evidence = normalizeEvidence(getValue(event, 'evidence'), event);
      const pageFallback = evidence[0]?.page ?? toNumber(getValue(event, 'page')) ?? 0;
      return {
        page: toNumber(getValue(event, 'page') ?? pageFallback) ?? 0,
        summary: toString(
          getValue(event, 'summary') || getValue(event, 'event') || getValue(event, 'description'),
        ),
        importance: toNumber(getValue(event, 'importance')) ?? 5,
        involved_entities: Array.isArray(getValue(event, 'involved_entities'))
          ? (getValue(event, 'involved_entities') as unknown[])
              .map((entity) => toString(entity))
              .filter(Boolean)
          : [],
        evidence,
      };
    })
    .filter((event) => event.summary.length > 0);
};

const normalizeClaims = (input: unknown): XRayExtractionV1['claims'] => {
  if (!Array.isArray(input)) return [];
  return input
    .filter(isRecord)
    .map((claim) => {
      const evidence = normalizeEvidence(getValue(claim, 'evidence'), claim);
      return {
        type: toString(getValue(claim, 'type') || 'claim') || 'claim',
        subject:
          toString(
            getValue(claim, 'subject') ||
              getValue(claim, 'supporter') ||
              getValue(claim, 'speaker') ||
              getValue(claim, 'source'),
          ) || undefined,
        object: toString(getValue(claim, 'object') || getValue(claim, 'target')) || undefined,
        description: toString(
          getValue(claim, 'description') ||
            getValue(claim, 'claim') ||
            getValue(claim, 'statement'),
        ),
        status: toString(
          getValue(claim, 'status'),
        ).toUpperCase() as XRayExtractionV1['claims'][number]['status'],
        evidence,
      };
    })
    .filter((claim) => claim.description.length > 0 && claim.type.length > 0);
};

const normalizeExtraction = (input: unknown): XRayExtractionV1 | null => {
  if (!isRecord(input)) return null;
  return {
    entities: normalizeEntities(getValue(input, 'entities')),
    relationships: normalizeRelationships(getValue(input, 'relationships')),
    events: normalizeEvents(getValue(input, 'events')),
    claims: normalizeClaims(getValue(input, 'claims')),
  };
};

const stripCodeFences = (raw: string): string => {
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1]!.trim() : raw.trim();
};

const escapeNewlinesInStrings = (raw: string): string => {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        result += char;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        result += char;
        continue;
      }
      if (char === '"') {
        inString = false;
        result += char;
        continue;
      }
      if (char === '\n') {
        result += '\\n';
        continue;
      }
      if (char === '\r') {
        result += '\\r';
        continue;
      }
      result += char;
      continue;
    }

    if (char === '"') {
      inString = true;
    }
    result += char;
  }

  return result;
};

const sanitizeJson = (raw: string): string => {
  return escapeNewlinesInStrings(raw.replace(/^\uFEFF/, '')).replace(/,\s*([}\]])/g, '$1');
};

const extractJsonObject = (raw: string): unknown | null => {
  const cleaned = stripCodeFences(raw);
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const char = cleaned[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const slice = cleaned.slice(start, i + 1).trim();
        const normalized = sanitizeJson(slice);
        try {
          return JSON.parse(normalized) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
};

export const parseXRayExtraction = (raw: string): XRayExtractionV1 | null => {
  const json = extractJsonObject(raw);
  if (!json) return null;
  const normalized = normalizeExtraction(json) ?? json;
  const parsed = xrayExtractionSchema.safeParse(normalized);
  if (!parsed.success) {
    return null;
  }
  return parsed.data as XRayExtractionV1;
};

export const filterEvidence = (
  evidence: XRayEvidence[],
  textUnits: XRayTextUnit[],
  maxPageIncluded: number,
): XRayEvidence[] => {
  if (evidence.length === 0) return [];
  const textMap = new Map(textUnits.map((unit) => [unit.chunkId, unit.text]));
  return evidence.filter((item) => {
    if (item.page > maxPageIncluded) return false;
    const text = textMap.get(item.chunkId);
    if (!text) return false;
    const normalizedQuote = normalizeText(item.quote);
    if (!normalizedQuote) return false;
    const normalizedText = normalizeText(text);
    return normalizedText.includes(normalizedQuote);
  });
};

export const hasEvidence = (
  evidence: XRayEvidence[],
  textUnits: XRayTextUnit[],
  maxPageIncluded: number,
): boolean => {
  return filterEvidence(evidence, textUnits, maxPageIncluded).length > 0;
};
