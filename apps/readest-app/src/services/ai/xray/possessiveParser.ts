export interface PossessiveChain {
  readonly rootEntity: string;
  readonly chain: readonly string[];
  readonly exactQuote: string;
  readonly offsetStart: number;
  readonly offsetEnd: number;
}

const RELATIONS = new Set([
  'brother',
  'sister',
  'son',
  'daughter',
  'father',
  'mother',
  'wife',
  'husband',
  'spouse',
  'friend',
  'enemy',
  'mentor',
  'teacher',
  'student',
  'apprentice',
]);

const POSSESSIVE_PATTERN =
  /(?:^|[^\p{L}\p{N}])(\p{Lu}[\p{L}\p{M}\p{N}.-]*(?:\s+\p{Lu}[\p{L}\p{M}\p{N}.-]*)*)['’]s\s+([\p{L}-]+(?:['’]s\s+[\p{L}-]+)*)/gu;

export const parsePossessiveChains = (text: string): PossessiveChain[] => {
  const chains: PossessiveChain[] = [];
  for (const match of text.matchAll(POSSESSIVE_PATTERN)) {
    const rootEntity = match[1];
    const rawChain = match[2];
    if (!rootEntity || !rawChain) continue;
    const chain = rawChain.split(/['’]s\s+/).map((relation) => relation.toLowerCase());
    if (chain.some((relation) => !RELATIONS.has(relation))) continue;

    const exactQuote = `${rootEntity}'s ${rawChain}`;
    const prefixLength = match[0].indexOf(rootEntity);
    const offsetStart = match.index + prefixLength;
    chains.push({
      rootEntity,
      chain,
      exactQuote: text.slice(offsetStart, offsetStart + exactQuote.length),
      offsetStart,
      offsetEnd: offsetStart + exactQuote.length,
    });
  }
  return chains;
};
