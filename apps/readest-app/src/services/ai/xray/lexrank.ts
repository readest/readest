import { isCJKLang, isCJKStr, normalizedLangCode } from '@/utils/lang';

const STOPWORDS: Record<string, string[]> = {
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
    'he',
    'in',
    'is',
    'it',
    'its',
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

const getStopwords = (lang: string): Set<string> => {
  const key = normalizedLangCode(lang || '');
  return new Set(STOPWORDS[key] || STOPWORDS['en']);
};

const splitSentences = (text: string, lang: string): string[] => {
  if (!text) return [];
  const isCjk = isCJKLang(lang) || isCJKStr(text);
  const enders = isCjk
    ? new Set(['\n', '\r', '\f', '\u000b', '\u3002', '\uff01', '\uff1f'])
    : new Set(['.', '!', '?', '\n']);
  const sentences: string[] = [];
  let buffer = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    buffer += ch;
    if (enders.has(ch)) {
      const trimmed = buffer.trim();
      if (trimmed.length > 0) sentences.push(trimmed);
      buffer = '';
    }
  }
  const tail = buffer.trim();
  if (tail.length > 0) sentences.push(tail);
  return sentences.filter((s) => s.length > 2);
};

const tokenize = (sentence: string, lang: string): string[] => {
  if (!sentence) return [];
  const isCjk = isCJKLang(lang) || isCJKStr(sentence);
  if (isCjk) {
    const normalized = sentence.replace(/[^\p{L}\p{N}]/gu, '');
    return normalized.split('').filter(Boolean);
  }
  const stopwords = getStopwords(lang);
  const tokens = sentence
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/g)
    .filter((token) => token.length > 1 && !stopwords.has(token));
  return tokens;
};

const buildTfIdfVectors = (sentences: string[], lang: string) => {
  const tokenized = sentences.map((s) => tokenize(s, lang));
  const docCount = sentences.length;
  const df = new Map<string, number>();
  tokenized.forEach((tokens) => {
    const unique = new Set(tokens);
    unique.forEach((token) => {
      df.set(token, (df.get(token) || 0) + 1);
    });
  });
  const vectors = tokenized.map((tokens) => {
    const tf = new Map<string, number>();
    tokens.forEach((token) => tf.set(token, (tf.get(token) || 0) + 1));
    const weights = new Map<string, number>();
    const len = tokens.length || 1;
    tf.forEach((count, token) => {
      const idf = Math.log((docCount + 1) / ((df.get(token) || 0) + 1)) + 1;
      weights.set(token, (count / len) * idf);
    });
    return weights;
  });
  return vectors;
};

const cosineSimilarity = (a: Map<string, number>, b: Map<string, number>): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  a.forEach((value, key) => {
    normA += value * value;
    const bValue = b.get(key);
    if (bValue !== undefined) dot += value * bValue;
  });
  b.forEach((value) => {
    normB += value * value;
  });
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
};

export interface LexRankOptions {
  threshold?: number;
  maxIter?: number;
  damping?: number;
}

export const lexrank = (
  sentences: string[],
  lang: string,
  options: LexRankOptions = {},
): number[] => {
  const threshold = options.threshold ?? 0.1;
  const maxIter = options.maxIter ?? 20;
  const damping = options.damping ?? 0.85;
  const n = sentences.length;
  if (n === 0) return [];
  const vectors = buildTfIdfVectors(sentences, lang);
  const weights: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const rowSums = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = cosineSimilarity(vectors[i]!, vectors[j]!);
      if (sim >= threshold) {
        weights[i]![j] = sim;
        weights[j]![i] = sim;
        rowSums[i]! += sim;
        rowSums[j]! += sim;
      }
    }
  }
  let scores = Array(n).fill(1 / n);
  for (let iter = 0; iter < maxIter; iter++) {
    const next = Array(n).fill((1 - damping) / n);
    for (let j = 0; j < n; j++) {
      const rowSum = rowSums[j] || 0;
      for (let i = 0; i < n; i++) {
        if (weights[j]![i] === 0) continue;
        const norm = rowSum > 0 ? weights[j]![i]! / rowSum : 1 / n;
        next[i] += damping * scores[j]! * norm;
      }
    }
    scores = next;
  }
  return scores;
};

export interface RankedSentence {
  sentence: string;
  index: number;
  score: number;
}

export const rankSentences = (
  text: string,
  lang: string,
  termVariants: string[] = [],
): RankedSentence[] => {
  const sentences = splitSentences(text, lang);
  if (sentences.length === 0) return [];
  const scores = lexrank(sentences, lang);
  const normalizedVariants = termVariants
    .map((variant) => variant.toLowerCase().trim())
    .filter(Boolean);
  const ranked = sentences.map((sentence, index) => {
    const positionBoost = 1 + (1 - index / Math.max(sentences.length, 1)) * 0.12;
    let termBoost = 1;
    if (normalizedVariants.length > 0) {
      const lower = sentence.toLowerCase();
      if (normalizedVariants.some((variant) => lower.includes(variant))) {
        termBoost = 1.18;
      }
    }
    return {
      sentence,
      index,
      score: scores[index]! * positionBoost * termBoost,
    };
  });
  return ranked.sort((a, b) => b.score - a.score);
};

export interface TermContextOptions {
  maxSentences?: number;
  contextBefore?: number;
  contextAfter?: number;
  maxCharacters?: number;
}

export const extractTermContext = (
  text: string,
  lang: string,
  termVariants: string[],
  options: TermContextOptions = {},
): string[] => {
  const sentences = splitSentences(text, lang);
  if (sentences.length === 0) return [];
  const ranked = rankSentences(text, lang, termVariants);
  const maxSentences = options.maxSentences ?? 4;
  const contextBefore = options.contextBefore ?? 1;
  const contextAfter = options.contextAfter ?? 1;
  const maxCharacters = options.maxCharacters ?? 1200;
  const lowerVariants = termVariants.map((variant) => variant.toLowerCase().trim()).filter(Boolean);

  const picked = ranked
    .filter((item) =>
      lowerVariants.length === 0
        ? true
        : lowerVariants.some((variant) => item.sentence.toLowerCase().includes(variant)),
    )
    .slice(0, maxSentences);

  const indices = new Set<number>();
  picked.forEach((item) => {
    for (let i = item.index - contextBefore; i <= item.index + contextAfter; i++) {
      if (i >= 0 && i < sentences.length) indices.add(i);
    }
  });

  const ordered = Array.from(indices)
    .sort((a, b) => a - b)
    .map((i) => sentences[i]!)
    .filter(Boolean);

  const result: string[] = [];
  let count = 0;
  for (const sentence of ordered) {
    if (count + sentence.length > maxCharacters) break;
    result.push(sentence);
    count += sentence.length;
  }
  return result;
};
