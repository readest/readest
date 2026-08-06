import type { ContextTranslationDetailLevel, ContextTranslationInput } from './contextTranslationTypes';

const NORMAL_PROMPT = `You are a contextual ebook translator.

Translate the selected text into the target language using the surrounding context.
Prioritize the meaning intended in this passage, not a literal word-by-word translation.
Preserve names, titles, citations, technical terms, numbers, and formatting.
If the selected text is a single word, phrase, or idiom, explain its meaning in this context.
Keep the output concise because it will be shown in a reader popup.

Return only valid JSON with this shape:
{
  "mode": "normal",
  "headword": "selected text",
  "translation": "natural translation in the target language",
  "explanation": "brief explanation in the target language"
}`;

const DETAILED_PROMPT = `You are a contextual ebook translator and vocabulary tutor.

Analyze the selected text using the surrounding context. Ground the analysis only in the provided passage. Do not invent facts about the book.

If detailLevel is "detailed", provide:
- grammar pattern or part-of-speech pattern for the selected word or phrase
- IPA pronunciation if the selected text is English and pronunciation is reasonably clear
- concise English definition
- natural translation in the target language
- detailed explanation of how the selected text works in this passage
- 3 examples with explanations
- 3 synonyms or alternative phrases with example sentences and nuance notes

If a field is uncertain, omit it or use an empty string rather than guessing.

Return only valid JSON with this shape:
{
  "mode": "detailed",
  "headword": "selected text",
  "grammarPattern": "noun + adverb + verb phrase",
  "pronunciation": "/.../",
  "definition": "concise English definition",
  "translation": "natural translation in the target language",
  "explanation": "detailed contextual explanation",
  "examples": [
    {"sentence": "...", "explanation": "..."}
  ],
  "synonyms": [
    {"phrase": "...", "example": "...", "nuance": "..."}
  ]
}`;

export const buildContextTranslationSystemPrompt = (
  detailLevel: ContextTranslationDetailLevel,
): string => (detailLevel === 'detailed' ? DETAILED_PROMPT : NORMAL_PROMPT);

export const buildContextTranslationUserPayload = (input: ContextTranslationInput): string =>
  JSON.stringify({
    selectedText: input.selectedText,
    beforeContext: input.beforeContext,
    afterContext: input.afterContext,
    sentence: input.sentence ?? '',
    paragraph: input.paragraph ?? '',
    sourceLanguage: input.sourceLanguage ?? 'auto',
    targetLanguage: input.targetLanguage,
    bookTitle: input.bookTitle ?? '',
    chapterTitle: input.chapterTitle ?? '',
    detailLevel: input.detailLevel,
  });
