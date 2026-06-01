import { TRANSLATOR_LANGS } from '@/services/constants';
import type { InlineInsightChatMessage } from './logging';
import type { InlineInsightSettings } from './types';

export const SYSTEM_PROMPT = `You are a reading assistant. The user selected text from a book, but may not have asked an explicit question.
Infer the most likely reading question from the selected text and surrounding context, then answer strictly in the target language specified in the user message.
The context, selected text, question directions, and examples may use another language. Do not follow their language. The final output must use only the target language.

Rules:
- Output a single JSON object only. No markdown, no code fences, no prose before or after JSON.
- Start output immediately with {"brief":[
- The root object must contain exactly two keys in this order: "brief", then "details"
- "brief" must be an array of objects: {"label":"...","content":"..."}
- "details" must be an array of objects: {"label":"...","content":"..."}
- Generate every brief item first, then generate every detail item
- Keep the same labels and the same order in both arrays
- Each brief content must be one concise sentence
- Each detail content must be 2-4 sentences and must add useful context beyond the brief content
- Labels should be short categories such as "meaning", "background", "translation", "person", "place", "allusion"
- Give the answer directly; do not output <think>, reasoning traces, or internal thoughts
- Language: you must use the target language specified in the user message. If the context language differs from the target language, still answer only in the target language. This includes "label" and "content" values.

<example>
{"brief":[{"label":"Meaning","content":"Systematic knowledge verified by reason, distinct from opinion or craft."}],"details":[{"label":"Meaning","content":"Episteme refers to knowledge validated through logical argument, in contrast with doxa or techne. Plato used it for knowledge of enduring truths, and Foucault later reused the term for the hidden framework that shapes thought in a historical era."}]}
</example>
`;

const FOLLOW_UP_SYSTEM_PROMPT = `You are a reading assistant. The user will ask follow-up questions based on selected text, context, and your previous explanation.
Answer the user's question directly, concisely, and accurately. Use strictly the target language specified in the user message.
The context, selected text, previous answer, and user question may use another language. Do not follow their language. The final output must use only the target language.
Do not output <think>, reasoning traces, or internal thoughts.`;

export function buildInlineInsightMessages(
  selectedText: string,
  context: string,
  settings: InlineInsightSettings,
  targetLanguage: string,
): InlineInsightChatMessage[] {
  const languageInstruction = formatTargetLanguageInstruction(targetLanguage);
  return [
    {
      role: 'system',
      content: settings.systemPrompt.trim() || SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: joinPromptSections([
        languageInstruction,
        formatQuestionDirections(settings),
        `Context:\n${context}`,
        `Selected text:\n${selectedText}`,
        languageInstruction,
      ]),
    },
  ];
}

export function buildInlineInsightFollowUpMessages(
  question: string,
  selectedText: string,
  context: string,
  previousAnswer: string,
  settings: InlineInsightSettings,
  targetLanguage: string,
): InlineInsightChatMessage[] {
  const languageInstruction = formatTargetLanguageInstruction(targetLanguage);

  return [
    {
      role: 'system',
      content: FOLLOW_UP_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: joinPromptSections([
        languageInstruction,
        formatQuestionDirections(settings),
        `Context:\n${context}`,
        `Selected text:\n${selectedText}`,
        `Previous answer:\n${previousAnswer.trim()}`,
        `Question:\n${question}`,
        languageInstruction,
      ]),
    },
  ];
}

function formatTargetLanguageLabel(targetLanguage: string): string {
  const normalized = targetLanguage.trim();
  if (!normalized) return 'the requested language';

  return TRANSLATOR_LANGS[normalized as keyof typeof TRANSLATOR_LANGS] ?? normalized;
}

function formatTargetLanguageInstruction(targetLanguage: string): string {
  const targetLanguageLabel = formatTargetLanguageLabel(targetLanguage);
  return [
    `TARGET LANGUAGE: ${targetLanguageLabel}`,
    `You must write the entire answer in ${targetLanguageLabel}.`,
    `Do not answer in the language of the selected text or context unless it is ${targetLanguageLabel}.`,
  ].join('\n');
}

function formatQuestionDirections(settings: InlineInsightSettings): string {
  const directions = settings.questionDirections.map((item) => item.trim()).filter(Boolean);
  if (directions.length === 0) return '';

  return `Preferred question directions:\n${directions.map((item) => `- ${item}`).join('\n')}`;
}

function joinPromptSections(items: string[]): string {
  return items.filter(Boolean).join('\n\n');
}
