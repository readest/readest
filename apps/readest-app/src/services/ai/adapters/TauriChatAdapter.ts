import { streamText } from 'ai';
import type { ChatModelAdapter, ChatModelRunResult } from '@assistant-ui/react';
import { getAIProvider } from '../providers';
import { hybridSearch, isBookIndexed } from '../ragService';
import { aiLogger } from '../logger';
import type { AISettings, ScoredChunk } from '../types';

// store last sources for UI access
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
      ? `\n\nRelevant passages:\n${chunks.map((c, i) => `[${i + 1}] "${c.text}"`).join('\n\n')}`
      : '';
  const spoilerNote = spoilerProtection ? '\nOnly use info from passages provided.' : '';
  return `You are a reading companion for "${bookTitle}"${authorName ? ` by ${authorName}` : ''}. Answer based on context. Be concise and helpful.${spoilerNote}${contextSection}`;
}

export function createTauriAdapter(options: TauriAdapterOptions): ChatModelAdapter {
  const { settings, bookHash, bookTitle, authorName, currentSection } = options;

  return {
    async *run({ messages, abortSignal }): AsyncGenerator<ChatModelRunResult> {
      const provider = getAIProvider(settings);
      let chunks: ScoredChunk[] = [];

      // get last user message for RAG query
      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
      const query =
        lastUserMessage?.content
          ?.filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join(' ') || '';

      aiLogger.chat.send(query.length, false);

      // perform hybrid search if book is indexed
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

      // build system prompt with context
      const systemPrompt = buildSystemPrompt(
        bookTitle,
        authorName,
        chunks,
        settings.spoilerProtection,
      );

      // convert messages to AI SDK format
      const aiMessages = messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n'),
      }));

      try {
        const result = streamText({
          model: provider.getModel(),
          system: systemPrompt,
          messages: aiMessages,
          abortSignal,
        });

        let text = '';
        for await (const chunk of result.textStream) {
          text += chunk;
          yield {
            content: [{ type: 'text', text }],
          };
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
