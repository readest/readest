const STOPWORDS: Record<string, readonly string[]> = {
  en: [
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'by',
    'for',
    'from',
    'has',
    'in',
    'is',
    'it',
    'of',
    'on',
    'that',
    'the',
    'to',
    'was',
    'were',
    'will',
    'with',
  ],
  fr: ['de', 'la', 'le', 'les', 'des', 'et', 'en', 'un', 'une', 'du', 'au'],
  es: ['de', 'la', 'el', 'los', 'las', 'y', 'en', 'un', 'una', 'del', 'al'],
  de: ['der', 'die', 'das', 'und', 'ein', 'eine', 'im', 'in', 'zu', 'mit'],
  it: ['di', 'la', 'il', 'lo', 'gli', 'le', 'e', 'un', 'una', 'in', 'da'],
  pt: ['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'um', 'uma', 'para'],
  nl: ['de', 'het', 'een', 'en', 'van', 'in', 'op', 'te', 'voor'],
};

export interface LexRankOptions {
  readonly threshold?: number;
  readonly maxIterations?: number;
  readonly damping?: number;
}

export interface RankedSentence {
  readonly sentence: string;
  readonly index: number;
  readonly score: number;
}

export interface TermContextOptions {
  readonly maxSentences?: number;
  readonly contextBefore?: number;
  readonly contextAfter?: number;
  readonly maxCharacters?: number;
}

const languageCode = (language: string): string => language.toLowerCase().split(/[-_]/, 1)[0] ?? '';

const isCjk = (text: string, language: string): boolean =>
  ['zh', 'ja', 'ko'].includes(languageCode(language)) ||
  /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(text);

const splitSentences = (text: string, language: string): string[] => {
  if (!text.trim()) return [];
  const enders = isCjk(text, language)
    ? new Set(['\n', '\r', '\u3002', '\uff01', '\uff1f'])
    : new Set(['.', '!', '?', '\n']);
  const sentences: string[] = [];
  let buffer = '';
  for (const character of text) {
    buffer += character;
    if (!enders.has(character)) continue;
    const sentence = buffer.trim();
    if (sentence.length > 2) sentences.push(sentence);
    buffer = '';
  }
  const tail = buffer.trim();
  if (tail.length > 2) sentences.push(tail);
  return sentences;
};

const tokenize = (sentence: string, language: string): string[] => {
  if (isCjk(sentence, language)) {
    return sentence
      .replace(/[^\p{L}\p{N}]/gu, '')
      .split('')
      .filter(Boolean);
  }
  const stopwords = new Set(STOPWORDS[languageCode(language)] ?? STOPWORDS['en']);
  return sentence
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopwords.has(token));
};

const tfIdfVectors = (sentences: readonly string[], language: string): Map<string, number>[] => {
  const tokenized = sentences.map((sentence) => tokenize(sentence, language));
  const documentFrequency = new Map<string, number>();
  for (const tokens of tokenized) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  return tokenized.map((tokens) => {
    const termFrequency = new Map<string, number>();
    for (const token of tokens) {
      termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
    }
    const vector = new Map<string, number>();
    for (const [token, count] of termFrequency) {
      const idf = Math.log((sentences.length + 1) / ((documentFrequency.get(token) ?? 0) + 1)) + 1;
      vector.set(token, (count / Math.max(tokens.length, 1)) * idf);
    }
    return vector;
  });
};

const cosineSimilarity = (left: Map<string, number>, right: Map<string, number>): number => {
  let dotProduct = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const [token, value] of left) {
    leftNorm += value * value;
    dotProduct += value * (right.get(token) ?? 0);
  }
  for (const value of right.values()) rightNorm += value * value;
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator === 0 ? 0 : dotProduct / denominator;
};

const lexRankScores = (
  sentences: readonly string[],
  language: string,
  options: LexRankOptions,
): number[] => {
  const count = sentences.length;
  if (count === 0) return [];
  const threshold = options.threshold ?? 0.1;
  const maxIterations = options.maxIterations ?? 20;
  const damping = options.damping ?? 0.85;
  const vectors = tfIdfVectors(sentences, language);
  const weights = Array.from({ length: count }, () => Array<number>(count).fill(0));
  const rowSums = Array<number>(count).fill(0);

  for (let left = 0; left < count; left += 1) {
    for (let right = left + 1; right < count; right += 1) {
      const similarity = cosineSimilarity(vectors[left]!, vectors[right]!);
      if (similarity < threshold) continue;
      weights[left]![right] = similarity;
      weights[right]![left] = similarity;
      rowSums[left]! += similarity;
      rowSums[right]! += similarity;
    }
  }

  let scores = Array<number>(count).fill(1 / count);
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const next = Array<number>(count).fill((1 - damping) / count);
    for (let source = 0; source < count; source += 1) {
      const rowSum = rowSums[source]!;
      if (rowSum === 0) {
        const share = (damping * scores[source]!) / count;
        for (let target = 0; target < count; target += 1) next[target]! += share;
        continue;
      }
      for (let target = 0; target < count; target += 1) {
        const weight = weights[source]![target]!;
        if (weight === 0) continue;
        next[target]! += damping * scores[source]! * (weight / rowSum);
      }
    }
    scores = next;
  }
  return scores;
};

export const rankSentences = (
  text: string,
  language: string,
  termVariants: readonly string[] = [],
  options: LexRankOptions = {},
): RankedSentence[] => {
  const sentences = splitSentences(text, language);
  const scores = lexRankScores(sentences, language, options);
  const variants = termVariants.map((variant) => variant.trim().toLowerCase()).filter(Boolean);
  return sentences
    .map((sentence, index) => {
      const positionBoost = 1 + (1 - index / Math.max(sentences.length, 1)) * 0.12;
      const lower = sentence.toLowerCase();
      const termBoost = variants.some((variant) => lower.includes(variant)) ? 1.18 : 1;
      return { sentence, index, score: scores[index]! * positionBoost * termBoost };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);
};

export const extractTermContext = (
  text: string,
  language: string,
  termVariants: readonly string[],
  options: TermContextOptions = {},
): string[] => {
  const sentences = splitSentences(text, language);
  if (sentences.length === 0) return [];
  const variants = termVariants.map((variant) => variant.trim().toLowerCase()).filter(Boolean);
  const ranked = rankSentences(text, language, variants).filter((item) => {
    if (variants.length === 0) return true;
    const lower = item.sentence.toLowerCase();
    return variants.some((variant) => lower.includes(variant));
  });
  const selected = ranked.slice(0, options.maxSentences ?? 4);
  const indices = new Set<number>();
  for (const item of selected) {
    const start = Math.max(0, item.index - (options.contextBefore ?? 1));
    const end = Math.min(sentences.length - 1, item.index + (options.contextAfter ?? 1));
    for (let index = start; index <= end; index += 1) indices.add(index);
  }

  const result: string[] = [];
  let characters = 0;
  for (const index of [...indices].sort((left, right) => left - right)) {
    const sentence = sentences[index]!;
    const nextLength = characters + sentence.length + (result.length === 0 ? 0 : 1);
    if (nextLength > (options.maxCharacters ?? 1200)) break;
    result.push(sentence);
    characters = nextLength;
  }
  return result;
};
