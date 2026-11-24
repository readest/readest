import type { XRayData, XRayEntity, XRayFact, XRayQuote, XRayRelationship } from './types';

export const xrayKey = (name: string) =>
  name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** The first quote, and the latest two: where it came up, and where it stands. */
const addQuotes = (quotes: XRayQuote[], more: readonly XRayQuote[]): XRayQuote[] => {
  const all = [...quotes, ...more];
  return all.length > 3 ? [all[0]!, ...all.slice(-2)] : all;
};

const addNames = (list: string[], names: readonly string[], own: string) => {
  for (const name of names) {
    const key = xrayKey(name);
    if (key && key !== own && !list.some((known) => xrayKey(known) === key)) list.push(name);
  }
};

const addFacts = (list: XRayFact[], facts: readonly XRayFact[]) => {
  for (const fact of facts) {
    const key = xrayKey(fact.key);
    const value = xrayKey(fact.value);
    if (!list.some((known) => xrayKey(known.key) === key && xrayKey(known.value) === value)) {
      list.push(fact);
    }
  }
};

/** Batches in reading order, merged: one item per name, in the order first met. */
export const mergeXRay = (batches: readonly XRayData[]): XRayData => {
  const entities: XRayEntity[] = [];
  const byName = new Map<string, XRayEntity>();
  const relationships = new Map<string, XRayRelationship>();
  const events: XRayData['events'] = [];

  for (const batch of batches) {
    for (const entity of batch.entities) {
      const names = [entity.name, ...entity.aliases];
      const keys = names.map((name) => `${entity.type}\0${xrayKey(name)}`);
      let merged: XRayEntity | undefined;
      for (const key of keys) merged ??= byName.get(key);
      if (!merged) {
        merged = { ...entity, aliases: [], facts: [], quotes: [] };
        entities.push(merged);
      }
      addNames(merged.aliases, names, xrayKey(merged.name));
      addFacts(merged.facts, entity.facts);
      merged.quotes = addQuotes(merged.quotes, entity.quotes);
      if (entity.description.length > merged.description.length) {
        merged.description = entity.description;
      }
      for (const key of keys) if (!byName.has(key)) byName.set(key, merged);
    }
    for (const relationship of batch.relationships) {
      const { source, target, type, quotes } = relationship;
      const key = [source, target, type].map(xrayKey).join('\0');
      const merged = relationships.get(key);
      if (merged) merged.quotes = addQuotes(merged.quotes, quotes);
      else relationships.set(key, { ...relationship, quotes: addQuotes([], quotes) });
    }
    for (const event of batch.events) {
      events.push({ ...event, quotes: addQuotes([], event.quotes) });
    }
  }
  return { entities, relationships: [...relationships.values()], events };
};

export const findEntity = (data: XRayData, term: string): XRayEntity | undefined => {
  const key = xrayKey(term);
  return key
    ? data.entities.find(
        (entity) =>
          xrayKey(entity.name) === key || entity.aliases.some((name) => xrayKey(name) === key),
      )
    : undefined;
};

export interface XRayLink {
  relationship: XRayRelationship;
  /** The entity on the other end, when the X-Ray has one. */
  other?: XRayEntity;
}

/** The relationships an entity is part of. */
export const linksOf = (data: XRayData, entity: XRayEntity): XRayLink[] => {
  const own = new Set([entity.name, ...entity.aliases].map(xrayKey));
  return data.relationships.flatMap((relationship) => {
    const from = own.has(xrayKey(relationship.source));
    if (from === own.has(xrayKey(relationship.target))) return [];
    return [
      { relationship, other: findEntity(data, from ? relationship.target : relationship.source) },
    ];
  });
};
