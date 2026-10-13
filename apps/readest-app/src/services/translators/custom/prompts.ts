import { getLanguageName, normalizeToShortLang } from '@/utils/lang';

export const DEFAULT_PROMPT_ID = 'default';

export const DEFAULT_TRANSLATION_PROMPT = `You are a professional literary translator translating a book from {{sourceLang}} into {{targetLang}}.
Book: {{bookTitle}} by {{bookAuthor}}
Translate faithfully and naturally, preserving the tone, style and meaning of the original. Keep names and terminology consistent.`;

export interface PromptVars {
  sourceLang: string;
  targetLang: string;
  bookTitle?: string;
  bookAuthor?: string;
}

const toLanguageName = (code: string): string => {
  if (!code || code.toUpperCase() === 'AUTO') return 'the source language';
  const short = normalizeToShortLang(code);
  if (short === 'zh-Hans') return 'Simplified Chinese';
  if (short === 'zh-Hant') return 'Traditional Chinese';
  return getLanguageName(code);
};

export const renderPrompt = (template: string, vars: PromptVars): string =>
  template
    .replaceAll('{{sourceLang}}', toLanguageName(vars.sourceLang))
    .replaceAll('{{targetLang}}', toLanguageName(vars.targetLang))
    .replaceAll('{{bookTitle}}', vars.bookTitle ?? '')
    .replaceAll('{{bookAuthor}}', vars.bookAuthor ?? '');
