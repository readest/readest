import { streamText } from 'ai';
import type { ChatModelAdapter, ChatModelRunResult } from '@assistant-ui/react';
import { getAIProvider } from '../providers';
import { hybridSearch, isBookIndexed } from '../ragService';
import { aiLogger } from '../logger';
import type { AISettings, ScoredChunk } from '../types';

let lastSources: ScoredChunk[] = [];

export function getLastSources(): ScoredChunk[] {
  return lastSources;
}

export function clearLastSources(): void {
  lastSources = [];
}

interface TauriAdapterOptions {
  settings: AISettings;
  bookHash: string;
  bookTitle: string;
  authorName: string;
  currentSection: number;
}

function buildSystemPrompt(
  bookTitle: string,
  authorName: string,
  chunks: ScoredChunk[],
  spoilerProtection: boolean,
): string {
  const contextSection =
    chunks.length > 0
      ? `\n\nBook Content:\n${chunks
          .map((c) => {
            const header = c.chapterTitle || `Section ${c.sectionIndex + 1}`;
            return `--- ${header} ---\n${c.text}`;
          })
          .join('\n\n')}`
      : '';
  const spoilerNote = spoilerProtection ? '\nOnly use info from the book content provided.' : '';
  const citationNote =
    '\nDo not use internal passage numbers or indices like [1] or [2]. If you need to cite a source, use the official chapter or section headings provided in the headers.';

  return `You are a reading companion for "${bookTitle}"${
    authorName ? ` by ${authorName}` : ''
  }. Answer based on the book content. Be concise and helpful.${spoilerNote}${citationNote}${contextSection}`;
}

async function* streamViaApiRoute(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  settings: AISettings,
  abortSignal?: AbortSignal,
): AsyncGenerator<string> {
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      system: systemPrompt,
      apiKey: settings.aiGatewayApiKey,
      model: settings.aiGatewayModel || 'google/gemini-2.5-flash-lite',
    }),
    signal: abortSignal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Chat failed: ${response.status}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }
}

export function createTauriAdapter(options: TauriAdapterOptions): ChatModelAdapter {
  const { settings, bookHash, bookTitle, authorName, currentSection } = options;

  return {
    async *run({ messages, abortSignal }): AsyncGenerator<ChatModelRunResult> {
      const provider = getAIProvider(settings);
      let chunks: ScoredChunk[] = [];

      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
      const query =
        lastUserMessage?.content
          ?.filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join(' ') || '';

      aiLogger.chat.send(query.length, false);

      if (await isBookIndexed(bookHash)) {
        try {
          chunks = await hybridSearch(
            bookHash,
            query,
            settings,
            settings.maxContextChunks || 5,
            settings.spoilerProtection ? currentSection : undefined,
          );
          aiLogger.chat.context(chunks.length, chunks.map((c) => c.text).join('').length);
          lastSources = chunks;
        } catch (e) {
          aiLogger.chat.error(`RAG failed: ${(e as Error).message}`);
          lastSources = [];
        }
      } else {
        lastSources = [];
      }

      const systemPrompt = buildSystemPrompt(
        bookTitle,
        authorName,
        chunks,
        settings.spoilerProtection,
      );

      const aiMessages = messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n'),
      }));

      try {
        const useApiRoute = typeof window !== 'undefined' && settings.provider === 'ai-gateway';

        let text = '';

        if (useApiRoute) {
          for await (const chunk of streamViaApiRoute(
            aiMessages,
            systemPrompt,
            settings,
            abortSignal,
          )) {
            text += chunk;
            yield { content: [{ type: 'text', text }] };
          }
        } else {
          const result = streamText({
            model: provider.getModel(),
            system: systemPrompt,
            messages: aiMessages,
            abortSignal,
          });

          for await (const chunk of result.textStream) {
            text += chunk;
            yield { content: [{ type: 'text', text }] };
          }
        }

        aiLogger.chat.complete(text.length);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          aiLogger.chat.error((error as Error).message);
          throw error;
        }
      }
    },
  };
}
