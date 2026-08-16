export interface DeinflectionCandidate {
  term: string;
  rules: string[];
  reasons: string[];
}

interface TransformResult {
  term: string;
  rule: string;
  reason: string;
}

const MAX_DEPTH = 3;
const MAX_CANDIDATES = 64;

const I_ROW_TO_DICTIONARY: Record<string, string> = {
  い: 'う',
  き: 'く',
  ぎ: 'ぐ',
  し: 'す',
  ち: 'つ',
  に: 'ぬ',
  び: 'ぶ',
  み: 'む',
  り: 'る',
};

const A_ROW_TO_DICTIONARY: Record<string, string> = {
  わ: 'う',
  か: 'く',
  が: 'ぐ',
  さ: 'す',
  た: 'つ',
  な: 'ぬ',
  ば: 'ぶ',
  ま: 'む',
  ら: 'る',
};

const E_ROW_TO_DICTIONARY: Record<string, string> = {
  え: 'う',
  け: 'く',
  げ: 'ぐ',
  せ: 'す',
  て: 'つ',
  ね: 'ぬ',
  べ: 'ぶ',
  め: 'む',
  れ: 'る',
};

const replaceLastKana = (stem: string, mapping: Record<string, string>): string | undefined => {
  const chars = [...stem];
  const last = chars.at(-1);
  if (!last || !mapping[last]) return undefined;
  chars[chars.length - 1] = mapping[last]!;
  return chars.join('');
};

const stemCandidates = (
  stem: string,
  mapping: Record<string, string>,
  reason: string,
): TransformResult[] => {
  if (!stem) return [];
  const output: TransformResult[] = [{ term: `${stem}る`, rule: 'v1', reason }];
  const godan = replaceLastKana(stem, mapping);
  if (godan) output.push({ term: godan, rule: 'v5', reason });
  if (stem.endsWith('し')) {
    output.push({ term: `${stem.slice(0, -1)}する`, rule: 'vs', reason });
  }
  if (stem === 'き') output.push({ term: 'くる', rule: 'vk', reason });
  if (stem === '来') output.push({ term: '来る', rule: 'vk', reason });
  return output;
};

const suffix = (
  term: string,
  ending: string,
  replacement: string,
  rule: string,
  reason: string,
): TransformResult[] =>
  term.endsWith(ending) && term.length > ending.length
    ? [{ term: `${term.slice(0, -ending.length)}${replacement}`, rule, reason }]
    : [];

const directTransforms = (term: string): TransformResult[] => {
  const output: TransformResult[] = [];
  const polite: [string, string][] = [
    ['ませんでした', 'polite negative past'],
    ['ません', 'polite negative'],
    ['ました', 'polite past'],
    ['ます', 'polite'],
    ['ましょう', 'volitional'],
  ];
  for (const [ending, reason] of polite) {
    if (term.endsWith(ending) && term.length > ending.length) {
      output.push(...stemCandidates(term.slice(0, -ending.length), I_ROW_TO_DICTIONARY, reason));
    }
  }

  for (const [ending, reason] of [
    ['なかった', 'negative past'],
    ['ない', 'negative'],
  ] as const) {
    if (term.endsWith(ending) && term.length > ending.length) {
      output.push(...stemCandidates(term.slice(0, -ending.length), A_ROW_TO_DICTIONARY, reason));
    }
  }

  const godanPast: [string, string][] = [
    ['った', 'う'],
    ['った', 'つ'],
    ['った', 'る'],
    ['んだ', 'む'],
    ['んだ', 'ぶ'],
    ['んだ', 'ぬ'],
    ['いた', 'く'],
    ['いだ', 'ぐ'],
    ['した', 'す'],
  ];
  for (const [ending, replacement] of godanPast) {
    output.push(...suffix(term, ending, replacement, 'v5', 'past'));
  }
  const godanTe: [string, string][] = [
    ['って', 'う'],
    ['って', 'つ'],
    ['って', 'る'],
    ['んで', 'む'],
    ['んで', 'ぶ'],
    ['んで', 'ぬ'],
    ['いて', 'く'],
    ['いで', 'ぐ'],
    ['して', 'す'],
  ];
  for (const [ending, replacement] of godanTe) {
    output.push(...suffix(term, ending, replacement, 'v5', 'te-form'));
  }
  output.push(...suffix(term, 'た', 'る', 'v1', 'past'));
  output.push(...suffix(term, 'て', 'る', 'v1', 'te-form'));

  if (term.endsWith('られる') && term.length > 3) {
    output.push({ term: `${term.slice(0, -3)}る`, rule: 'v1', reason: 'potential or passive' });
  }
  if (term.endsWith('れる') && term.length > 2) {
    const stem = term.slice(0, -2);
    const godan = replaceLastKana(stem, A_ROW_TO_DICTIONARY);
    if (godan) output.push({ term: godan, rule: 'v5', reason: 'potential or passive' });
  }
  if (term.endsWith('る') && term.length > 1) {
    const potential = replaceLastKana(term.slice(0, -1), E_ROW_TO_DICTIONARY);
    if (potential) output.push({ term: potential, rule: 'v5', reason: 'potential' });
  }

  output.push(...suffix(term, 'くなかった', 'い', 'adj-i', 'negative past'));
  output.push(...suffix(term, 'くない', 'い', 'adj-i', 'negative'));
  output.push(...suffix(term, 'かった', 'い', 'adj-i', 'past'));
  output.push(...suffix(term, 'くて', 'い', 'adj-i', 'te-form'));
  return output;
};

export const deinflectJapanese = (term: string): DeinflectionCandidate[] => {
  const exact: DeinflectionCandidate = { term, rules: [], reasons: [] };
  const output = [exact];
  const seen = new Set([`${term}:`]);
  const queue: { candidate: DeinflectionCandidate; depth: number }[] = [
    { candidate: exact, depth: 0 },
  ];

  while (queue.length > 0 && output.length < MAX_CANDIDATES) {
    const current = queue.shift()!;
    if (current.depth >= MAX_DEPTH) continue;
    for (const transformed of directTransforms(current.candidate.term)) {
      const candidate: DeinflectionCandidate = {
        term: transformed.term,
        rules: [transformed.rule],
        reasons: [...current.candidate.reasons, transformed.reason],
      };
      const key = `${candidate.term}:${candidate.rules.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(candidate);
      if (output.length >= MAX_CANDIDATES) break;
      queue.push({ candidate, depth: current.depth + 1 });
    }
  }
  return output;
};
