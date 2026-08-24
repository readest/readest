import { extractTermContext } from './lexrank';
import type { ReedyXRaySource, XRaySourceSlice } from './source/ReedyXRaySource';
import type { XRayStore } from './storage/XRayStore';
import type {
  XRayClaim,
  XRayEntity,
  XRayEvidenceLocator,
  XRayExtractionBatch,
  XRayFact,
  XRayLookupResult,
  XRayRelationship,
  XRaySnapshot,
  XRayTimelineEvent,
} from './types';

export class XRaySnapshotService {
  constructor(
    private readonly source: Pick<ReedyXRaySource, 'readThrough'>,
    private readonly store: XRayStore,
  ) {}

  async getSnapshot(bookHash: string, currentCfi: string): Promise<XRaySnapshot> {
    const source = await this.source.readThrough(bookHash, currentCfi);
    return this.snapshotForSource(source);
  }

  async lookup(
    bookHash: string,
    currentCfi: string,
    term: string,
    language: string,
  ): Promise<XRayLookupResult> {
    const source = await this.source.readThrough(bookHash, currentCfi);
    const displayTerm = term.normalize('NFKC').trim().replace(/\s+/g, ' ');
    const key = normalize(displayTerm);
    if (!key) return emptyLookup(displayTerm, source.maxPositionIndex);
    const cacheKey = JSON.stringify([normalize(language), key]);

    const cached = await this.store.getLookup(
      cacheKey,
      bookHash,
      source.maxPositionIndex,
      source.fingerprint,
    );
    if (cached) return cached;

    const snapshot = await this.snapshotForSource(source);
    const matchedEntity = snapshot.entities.find((entity) =>
      [entity.name, ...entity.aliases].some((name) => normalize(name) === key),
    );
    const result = matchedEntity
      ? entityLookup(displayTerm, matchedEntity, source.maxPositionIndex)
      : contextLookup(displayTerm, source, language);

    await this.store.saveLookup({
      key: cacheKey,
      bookHash,
      maxPositionIndex: source.maxPositionIndex,
      fingerprint: source.fingerprint,
      result,
    });
    return result;
  }

  private async snapshotForSource(source: XRaySourceSlice): Promise<XRaySnapshot> {
    const batches = (
      await this.store.listBatches(source.fingerprint.bookHash, source.maxPositionIndex)
    ).filter((batch) => batch.fingerprint.contentHash === source.fingerprint.contentHash);
    return mergeBatches(source, batches);
  }
}

const mergeBatches = (
  source: XRaySourceSlice,
  batches: readonly XRayExtractionBatch[],
): XRaySnapshot => {
  const entities: XRayEntity[] = [];
  const relationships: XRayRelationship[] = [];
  const events: XRayTimelineEvent[] = [];
  const claims: XRayClaim[] = [];

  for (const batch of batches) {
    for (const incoming of batch.output.entities) mergeEntity(entities, incoming);
    for (const incoming of batch.output.relationships) {
      mergeRelationship(relationships, incoming);
    }
    for (const incoming of batch.output.events) mergeEvent(events, incoming);
    for (const incoming of batch.output.claims) mergeClaim(claims, incoming);
  }

  const byEvidencePosition = (
    left: { evidence: readonly XRayEvidenceLocator[] },
    right: {
      evidence: readonly XRayEvidenceLocator[];
    },
  ): number => firstPosition(left.evidence) - firstPosition(right.evidence);
  entities.sort(
    (left, right) => byEvidencePosition(left, right) || left.name.localeCompare(right.name),
  );
  relationships.sort(byEvidencePosition);
  events.sort(byEvidencePosition);
  claims.sort(byEvidencePosition);

  return {
    fingerprint: source.fingerprint,
    entities,
    relationships,
    events,
    claims,
    maxPositionIndex: batches.at(-1)?.maxPositionIndex ?? -1,
    updatedAt: batches.reduce((latest, batch) => Math.max(latest, batch.createdAt), 0),
  };
};

const mergeEntity = (entities: XRayEntity[], incoming: XRayEntity): void => {
  const incomingNames = new Set([incoming.name, ...incoming.aliases].map(normalize));
  const index = entities.findIndex(
    (entity) =>
      entity.type === incoming.type &&
      [entity.name, ...entity.aliases].some((name) => incomingNames.has(normalize(name))),
  );
  if (index === -1) {
    entities.push(copyEntity(incoming));
    return;
  }

  const current = entities[index]!;
  const aliases = uniqueStrings([...current.aliases, incoming.name, ...incoming.aliases]).filter(
    (alias) => normalize(alias) !== normalize(current.name),
  );
  entities[index] = {
    ...current,
    aliases,
    description:
      incoming.description.length > current.description.length
        ? incoming.description
        : current.description,
    evidence: mergeEvidence(current.evidence, incoming.evidence),
    facts: mergeFacts(current.facts, incoming.facts),
  };
};

const copyEntity = (entity: XRayEntity): XRayEntity => ({
  ...entity,
  aliases: uniqueStrings(entity.aliases),
  evidence: mergeEvidence(entity.evidence),
  facts: entity.facts.map((fact) => ({ ...fact, evidence: mergeEvidence(fact.evidence) })),
});

const mergeFacts = (current: readonly XRayFact[], incoming: readonly XRayFact[]): XRayFact[] => {
  const facts = current.map((fact) => ({ ...fact, evidence: [...fact.evidence] }));
  for (const fact of incoming) {
    const index = facts.findIndex(
      (item) =>
        normalize(item.key) === normalize(fact.key) &&
        normalize(item.value) === normalize(fact.value),
    );
    if (index === -1) {
      facts.push({ ...fact, evidence: mergeEvidence(fact.evidence) });
    } else {
      facts[index] = {
        ...facts[index]!,
        evidence: mergeEvidence(facts[index]!.evidence, fact.evidence),
      };
    }
  }
  return facts;
};

const mergeRelationship = (relationships: XRayRelationship[], incoming: XRayRelationship): void => {
  const index = relationships.findIndex(
    (item) =>
      normalize(item.source) === normalize(incoming.source) &&
      normalize(item.target) === normalize(incoming.target) &&
      normalize(item.type) === normalize(incoming.type),
  );
  if (index === -1) {
    relationships.push({ ...incoming, evidence: mergeEvidence(incoming.evidence) });
  } else {
    const current = relationships[index]!;
    relationships[index] = {
      ...current,
      description:
        incoming.description.length > current.description.length
          ? incoming.description
          : current.description,
      evidence: mergeEvidence(current.evidence, incoming.evidence),
    };
  }
};

const mergeEvent = (events: XRayTimelineEvent[], incoming: XRayTimelineEvent): void => {
  const index = events.findIndex((item) => normalize(item.summary) === normalize(incoming.summary));
  if (index === -1) {
    events.push({
      ...incoming,
      involvedEntities: uniqueStrings(incoming.involvedEntities),
      evidence: mergeEvidence(incoming.evidence),
    });
  } else {
    const current = events[index]!;
    events[index] = {
      ...current,
      importance: Math.max(current.importance, incoming.importance),
      involvedEntities: uniqueStrings([...current.involvedEntities, ...incoming.involvedEntities]),
      evidence: mergeEvidence(current.evidence, incoming.evidence),
    };
  }
};

const mergeClaim = (claims: XRayClaim[], incoming: XRayClaim): void => {
  const key = claimKey(incoming);
  const index = claims.findIndex((item) => claimKey(item) === key);
  if (index === -1) {
    claims.push({ ...incoming, evidence: mergeEvidence(incoming.evidence) });
  } else {
    claims[index] = {
      ...claims[index]!,
      evidence: mergeEvidence(claims[index]!.evidence, incoming.evidence),
    };
  }
};

const claimKey = (claim: XRayClaim): string =>
  [claim.type, claim.subject ?? '', claim.object ?? '', claim.description, claim.status ?? '']
    .map(normalize)
    .join('\u0000');

const mergeEvidence = (
  ...groups: ReadonlyArray<readonly XRayEvidenceLocator[]>
): XRayEvidenceLocator[] => {
  const evidence = new Map<string, XRayEvidenceLocator>();
  for (const item of groups.flat()) {
    const key = [item.unitId, item.exactQuote, item.positionIndex, item.inferred].join('\u0000');
    if (!evidence.has(key)) evidence.set(key, item);
  }
  return [...evidence.values()].sort(
    (left, right) =>
      left.positionIndex - right.positionIndex || left.exactQuote.localeCompare(right.exactQuote),
  );
};

const entityLookup = (
  term: string,
  entity: XRayEntity,
  maxPositionIndex: number,
): XRayLookupResult => {
  const facts = entity.facts.map((fact) => `${fact.key}: ${fact.value}`).join('; ');
  return {
    term,
    summary: [entity.description, facts].filter(Boolean).join(' ') || entity.name,
    evidence: mergeEvidence(entity.evidence, ...entity.facts.map((fact) => fact.evidence)),
    source: 'entity',
    entity,
    maxPositionIndex,
  };
};

const contextLookup = (
  term: string,
  source: XRaySourceSlice,
  language: string,
): XRayLookupResult => {
  const key = normalize(term);
  const contexts: Array<{ sentence: string; evidence: XRayEvidenceLocator }> = [];
  for (const unit of source.units) {
    if (!normalize(unit.text).includes(key)) continue;
    const sentences = extractTermContext(unit.text, language, [term], {
      maxSentences: 1,
      contextBefore: 0,
      contextAfter: 0,
      maxCharacters: 400,
    });
    for (const sentence of sentences) {
      contexts.push({
        sentence,
        evidence: {
          unitId: unit.unitId,
          exactQuote: sentence,
          startCfi: unit.startCfi,
          endCfi: unit.endCfi,
          sectionIndex: unit.sectionIndex,
          positionIndex: unit.positionIndex,
          ...(unit.displayPage === undefined ? {} : { displayPage: unit.displayPage }),
          confidence: 1,
          inferred: false,
        },
      });
    }
    if (contexts.length >= 3) break;
  }

  if (contexts.length === 0) return emptyLookup(term, source.maxPositionIndex);
  return {
    term,
    summary: contexts.map((item) => item.sentence).join(' '),
    evidence: contexts.map((item) => item.evidence),
    source: 'lexrank',
    maxPositionIndex: source.maxPositionIndex,
  };
};

const emptyLookup = (term: string, maxPositionIndex: number): XRayLookupResult => ({
  term,
  summary: '',
  evidence: [],
  source: 'none',
  maxPositionIndex,
});

const normalize = (value: string): string =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

const uniqueStrings = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const firstPosition = (evidence: readonly XRayEvidenceLocator[]): number =>
  evidence.reduce((first, item) => Math.min(first, item.positionIndex), Number.MAX_SAFE_INTEGER);
