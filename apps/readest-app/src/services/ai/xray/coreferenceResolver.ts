import type { XRayEntityType, XRaySourceUnit } from './types';

export interface CoreferenceEntity {
  readonly id: string;
  readonly type: XRayEntityType;
  readonly canonicalName: string;
  readonly aliases: readonly string[];
}

export interface CoreferenceMapping {
  readonly mention: string;
  readonly resolvedEntityId: string;
  readonly unitId: string;
  readonly sectionIndex: number;
  readonly positionIndex: number;
  readonly offsetStart: number;
  readonly offsetEnd: number;
  readonly confidence: number;
  readonly kind: 'alias' | 'pronoun';
}

interface MentionCandidate {
  readonly entity: CoreferenceEntity;
  readonly offsetStart: number;
  readonly offsetEnd: number;
  readonly kind: 'alias' | 'pronoun';
}

const PRONOUNS = ['he', 'she', 'they', 'him', 'her', 'them', 'his', 'their', 'theirs'] as const;
const PLURAL_PRONOUNS = new Set(['they', 'them', 'their', 'theirs']);

const cleanAlias = (alias: string): string => alias.normalize('NFKC').trim().replace(/\s+/g, ' ');

export const normalizeEntityAliases = (entity: CoreferenceEntity): string[] => {
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const value of [entity.canonicalName, ...entity.aliases]) {
    const alias = cleanAlias(value);
    const key = alias.toLocaleLowerCase();
    if (!alias || seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  return aliases;
};

const isWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && /[\p{L}\p{N}_]/u.test(character);

const hasWordBoundaries = (text: string, start: number, end: number): boolean =>
  !isWordCharacter(text[start - 1]) && !isWordCharacter(text[end]);

const aliasCandidates = (
  text: string,
  entities: readonly CoreferenceEntity[],
): MentionCandidate[] => {
  const lowerText = text.toLocaleLowerCase();
  const candidates: MentionCandidate[] = [];
  for (const entity of [...entities].sort((left, right) => left.id.localeCompare(right.id))) {
    for (const alias of normalizeEntityAliases(entity)) {
      const lowerAlias = alias.toLocaleLowerCase();
      let offset = lowerText.indexOf(lowerAlias);
      while (offset !== -1) {
        const end = offset + alias.length;
        if (hasWordBoundaries(text, offset, end)) {
          candidates.push({ entity, offsetStart: offset, offsetEnd: end, kind: 'alias' });
        }
        offset = lowerText.indexOf(lowerAlias, offset + 1);
      }
    }
  }

  candidates.sort(
    (left, right) =>
      left.offsetStart - right.offsetStart ||
      right.offsetEnd - right.offsetStart - (left.offsetEnd - left.offsetStart) ||
      left.entity.id.localeCompare(right.entity.id),
  );
  const selected: MentionCandidate[] = [];
  for (const candidate of candidates) {
    if (
      selected.some(
        (item) => candidate.offsetStart < item.offsetEnd && candidate.offsetEnd > item.offsetStart,
      )
    ) {
      continue;
    }
    selected.push(candidate);
  }
  return selected;
};

const pronounCandidates = (text: string): Array<Omit<MentionCandidate, 'entity'>> => {
  const lowerText = text.toLocaleLowerCase();
  const candidates: Array<Omit<MentionCandidate, 'entity'>> = [];
  for (const pronoun of PRONOUNS) {
    let offset = lowerText.indexOf(pronoun);
    while (offset !== -1) {
      const end = offset + pronoun.length;
      if (hasWordBoundaries(text, offset, end)) {
        candidates.push({ offsetStart: offset, offsetEnd: end, kind: 'pronoun' });
      }
      offset = lowerText.indexOf(pronoun, offset + 1);
    }
  }
  return candidates.sort(
    (left, right) => left.offsetStart - right.offsetStart || left.offsetEnd - right.offsetEnd,
  );
};

const remember = (recent: CoreferenceEntity[], entity: CoreferenceEntity): void => {
  const priorIndex = recent.findIndex((item) => item.id === entity.id);
  if (priorIndex !== -1) recent.splice(priorIndex, 1);
  recent.unshift(entity);
  if (recent.length > 5) recent.length = 5;
};

export const resolveCoreferences = (
  sourceUnits: readonly XRaySourceUnit[],
  entities: readonly CoreferenceEntity[],
): CoreferenceMapping[] => {
  const mappings: CoreferenceMapping[] = [];
  const recent: CoreferenceEntity[] = [];
  const units = [...sourceUnits].sort(
    (left, right) =>
      left.positionIndex - right.positionIndex ||
      left.sectionIndex - right.sectionIndex ||
      left.unitId.localeCompare(right.unitId),
  );

  for (const unit of units) {
    const aliases = aliasCandidates(unit.text, entities);
    const pronouns = pronounCandidates(unit.text).filter(
      (pronoun) =>
        !aliases.some(
          (alias) => pronoun.offsetStart < alias.offsetEnd && pronoun.offsetEnd > alias.offsetStart,
        ),
    );
    const mentions = [
      ...aliases,
      ...pronouns.map((pronoun) => ({ ...pronoun, entity: undefined })),
    ].sort(
      (left, right) =>
        left.offsetStart - right.offsetStart ||
        (left.kind === right.kind ? 0 : left.kind === 'alias' ? -1 : 1) ||
        left.offsetEnd - right.offsetEnd,
    );

    for (const mention of mentions) {
      let entity = mention.entity;
      if (mention.kind === 'alias' && entity) {
        remember(recent, entity);
      } else {
        const word = unit.text.slice(mention.offsetStart, mention.offsetEnd).toLowerCase();
        entity = PLURAL_PRONOUNS.has(word)
          ? (recent.find((candidate) => candidate.type === 'organization') ?? recent[0])
          : recent.find((candidate) => candidate.type === 'character');
      }
      if (!entity) continue;
      mappings.push({
        mention: unit.text.slice(mention.offsetStart, mention.offsetEnd),
        resolvedEntityId: entity.id,
        unitId: unit.unitId,
        sectionIndex: unit.sectionIndex,
        positionIndex: unit.positionIndex,
        offsetStart: mention.offsetStart,
        offsetEnd: mention.offsetEnd,
        confidence: mention.kind === 'alias' ? 1 : 0.6,
        kind: mention.kind,
      });
    }
  }
  return mappings;
};
