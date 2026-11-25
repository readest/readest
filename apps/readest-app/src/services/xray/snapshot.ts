import type { XRayData, XRayEntity, XRayFact, XRayQuote, XRayRelationship } from './types';

const keys = new Map<string, string>();

/** A name without the differences that do not tell names apart. */
const xrayKey = (name: string): string => {
  let key = keys.get(name);
  if (key === undefined) {
    key = name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    if (keys.size > 20_000) keys.clear();
    keys.set(name, key);
  }
  return key;
};

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

const typedKey = (type: XRayEntity['type'], name: string) => `${type}\0${xrayKey(name)}`;

interface XRayLink {
  relationship: XRayRelationship;
  /** The entity on the other end, when the X-Ray has one. */
  other?: XRayEntity;
}

/** Batches in reading order, merged: one item per name, in the order first met. */
export class XRay implements XRayData {
  entities: XRayEntity[] = [];
  relationships: XRayRelationship[] = [];
  events: XRayData['events'] = [];
  /** The entities by type and the names batches gave them, and by type and alias. */
  private readonly byTypedName = new Map<string, XRayEntity>();
  private readonly byTypedAlias = new Map<string, XRayEntity>();
  private readonly byName = new Map<string, XRayEntity>();
  private readonly byEnds = new Map<string, XRayRelationship>();
  private readonly byEnd = new Map<string, XRayRelationship[]>();

  add(batch: XRayData): void {
    for (const entity of batch.entities) {
      const typed = [entity.name, ...entity.aliases].map((name) => typedKey(entity.type, name));
      // An alias such as "the captain" is not enough for two entities to be one.
      const known = new Set(typed.flatMap((key) => this.byTypedName.get(key) ?? []));
      if (!known.size && this.byTypedAlias.has(typed[0]!)) {
        known.add(this.byTypedAlias.get(typed[0]!)!);
      }
      let [merged, ...others] = this.inReadingOrder(known);
      if (!merged) {
        merged = { ...entity, aliases: [], facts: [], quotes: [] };
        this.entities.push(merged);
      }
      // Named apart before this batch named them together.
      for (const other of others) {
        this.entities.splice(this.entities.indexOf(other), 1);
        this.merge(merged, other);
      }
      this.merge(merged, entity);
    }
    for (const relationship of batch.relationships) {
      const ends = [xrayKey(relationship.source), xrayKey(relationship.target)];
      const key = `${ends.join('\0')}\0${xrayKey(relationship.type)}`;
      const known = this.byEnds.get(key);
      if (known) {
        known.quotes = addQuotes(known.quotes, relationship.quotes);
        continue;
      }
      const merged = { ...relationship, quotes: addQuotes([], relationship.quotes) };
      this.byEnds.set(key, merged);
      this.relationships.push(merged);
      for (const end of ends) {
        const links = this.byEnd.get(end);
        if (links) links.push(merged);
        else this.byEnd.set(end, [merged]);
      }
    }
    for (const event of batch.events) {
      this.events.push({ ...event, quotes: addQuotes([], event.quotes) });
    }
  }

  private inReadingOrder(entities: Set<XRayEntity>): XRayEntity[] {
    const list = [...entities];
    if (list.length < 2) return list;
    return list.sort((a, b) => this.entities.indexOf(a) - this.entities.indexOf(b));
  }

  private merge(entity: XRayEntity, more: XRayEntity): void {
    const names = [more.name, ...more.aliases];
    addNames(entity.aliases, names, xrayKey(entity.name));
    addFacts(entity.facts, more.facts);
    entity.quotes = addQuotes(entity.quotes, more.quotes);
    if (more.description.length > entity.description.length) entity.description = more.description;
    this.byTypedName.set(typedKey(entity.type, more.name), entity);
    for (const name of names) {
      const typed = typedKey(entity.type, name);
      if (this.byTypedName.get(typed) === more) this.byTypedName.set(typed, entity);
      for (const [map, key] of [
        [this.byTypedAlias, typed],
        [this.byName, xrayKey(name)],
      ] as const) {
        if ((map.get(key) ?? more) === more) map.set(key, entity);
      }
    }
  }

  /** The entity known by `name`. */
  find(name: string): XRayEntity | undefined {
    return this.byName.get(xrayKey(name));
  }

  /** The relationships an entity is part of. */
  linksOf(entity: XRayEntity): XRayLink[] {
    const own = new Set([entity.name, ...entity.aliases].map(xrayKey));
    const links: XRayLink[] = [];
    for (const name of own) {
      for (const relationship of this.byEnd.get(name) ?? []) {
        const { source, target } = relationship;
        const from = own.has(xrayKey(source));
        if (from === own.has(xrayKey(target))) continue;
        links.push({ relationship, other: this.find(from ? target : source) });
      }
    }
    return links;
  }
}
