import type {
  ContextTranslationDetailedResult,
  ContextTranslationDetailLevel,
  ContextTranslationNormalResult,
  ContextTranslationResult,
} from './contextTranslationTypes';

const stripMarkdownFence = (content: string): string => {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  return typeof value === 'string' ? value : '';
};

const readObjectArray = <T>(
  value: unknown,
  mapItem: (record: Record<string, unknown>) => T,
): T[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map(mapItem);
};

export const parseContextTranslationResult = (
  content: string,
  detailLevel: ContextTranslationDetailLevel,
): ContextTranslationResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripMarkdownFence(content));
  } catch {
    throw new Error('AI provider returned invalid JSON');
  }

  if (!isRecord(parsed)) throw new Error('AI provider returned invalid JSON');
  if (parsed.mode !== detailLevel) {
    throw new Error('AI provider returned a result for the wrong detail level');
  }

  if (detailLevel === 'normal') {
    const result: ContextTranslationNormalResult = {
      mode: 'normal',
      headword: readString(parsed, 'headword'),
      translation: readString(parsed, 'translation'),
      explanation: readString(parsed, 'explanation'),
    };
    if (!result.headword || !result.translation || !result.explanation) {
      throw new Error('AI provider returned an incomplete normal result');
    }
    return result;
  }

  const result: ContextTranslationDetailedResult = {
    mode: 'detailed',
    headword: readString(parsed, 'headword'),
    grammarPattern: readString(parsed, 'grammarPattern') || undefined,
    pronunciation: readString(parsed, 'pronunciation') || undefined,
    definition: readString(parsed, 'definition'),
    translation: readString(parsed, 'translation') || undefined,
    explanation: readString(parsed, 'explanation'),
    examples: readObjectArray(parsed.examples, (item) => ({
      sentence: readString(item, 'sentence'),
      explanation: readString(item, 'explanation'),
    })).filter((item) => item.sentence && item.explanation),
    synonyms: readObjectArray(parsed.synonyms, (item) => ({
      phrase: readString(item, 'phrase'),
      example: readString(item, 'example'),
      nuance: readString(item, 'nuance'),
    })).filter((item) => item.phrase && item.example && item.nuance),
  };

  if (!result.headword || !result.definition || !result.explanation) {
    throw new Error('AI provider returned an incomplete detailed result');
  }
  return result;
};
