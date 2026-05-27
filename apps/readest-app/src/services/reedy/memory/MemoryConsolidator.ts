import { generateText, type ModelMessage } from 'ai';
import { z } from 'zod';
import type { ChatModel } from '../models/ChatModel';
import type { MemoryService } from './MemoryService';

/**
 * One message in the consolidator's input window. Shape mirrors what a
 * future session/messages persistence layer will emit; for now callers
 * (tests, Phase 4 store hooks) build these from whatever transcript
 * they hold in memory.
 */
export interface ConsolidatorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface ConsolidatedMemory {
  scope: 'user' | 'book';
  key: string;
  summary: string;
  sourceMessageId?: string;
}

export interface MemoryConsolidatorOptions {
  /** Low-cost ChatModel used for summarization. */
  model: ChatModel;
  /** Sink the consolidator writes its output to. */
  memory: MemoryService;
  /** Required for any `scope: 'book'` memory the model proposes. */
  bookHash?: string;
  /** Required for any `scope: 'user'` memory the model proposes. */
  userId?: string;
  /**
   * Minimum new messages required before the consolidator does anything.
   * Cheap consolidation passes (a single short reply) just add noise to
   * the memory store. Default: 6 (≈3 turns).
   */
  threshold?: number;
  /** Hard cap on memories written per consolidation pass. Default: 3. */
  maxPerRun?: number;
  /** Override the default summarization system prompt. */
  systemPrompt?: string;
  /** Invoked for every error so callers can surface to telemetry/UI. */
  onError?: (err: Error) => void;
}

const DEFAULT_THRESHOLD = 6;
const DEFAULT_MAX_PER_RUN = 3;

const DEFAULT_SYSTEM_PROMPT = `You are Reedy's memory consolidator. You read recent conversation turns and distill the durable facts that should survive into the agent's long-term memory.

Output a JSON array of memory rows. Each row has:
  - scope: "user" | "book"
  - key: a short stable identifier (alphanumeric, hyphen, underscore, colon, dot; ≤128 chars; do NOT use keys containing "system", "policy", "prompt", "injection", or "override")
  - summary: 1-3 sentences capturing the durable fact

Choose "user" for user preferences, taste, or recurring patterns. Choose "book" for character notes, themes, or plot summaries.

Write at most {{MAX_PER_RUN}} rows. Write fewer (or none) when nothing in the recent turns is worth remembering long-term. Output ONLY the JSON array — no prose, no markdown fences.`;

const memoryRowSchema = z.object({
  scope: z.enum(['user', 'book']),
  key: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9_\-:.]{0,127}$/i)
    .refine((k) => !/system|policy|prompt|injection|override/i.test(k), {
      message: 'key matches the policy-injection blocklist',
    }),
  summary: z.string().min(1).max(2_000),
});
const memoryArraySchema = z.array(memoryRowSchema).max(20);

/**
 * Periodically reads recent conversation turns and writes 1–3 durable
 * memories. Plan §3.2 — designed for fire-and-forget invocation from a
 * post-turn hook (after N completed messages) or a session-close hook.
 *
 * The consolidator is intentionally NOT a class with hidden state: each
 * `consolidate(messages, opts?)` call processes its arg slice and
 * returns the (already-written) memory rows so the caller can persist a
 * "lastConsolidated" cursor however it likes. This keeps it trivially
 * testable and keeps state ownership at the caller.
 */
export class MemoryConsolidator {
  constructor(private readonly opts: MemoryConsolidatorOptions) {}

  async consolidate(messages: ConsolidatorMessage[]): Promise<ConsolidatedMemory[]> {
    const threshold = this.opts.threshold ?? DEFAULT_THRESHOLD;
    const maxPerRun = this.opts.maxPerRun ?? DEFAULT_MAX_PER_RUN;
    if (messages.length < threshold) return [];

    let rawText: string;
    try {
      rawText = await this.summarize(messages, maxPerRun);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.opts.onError?.(error);
      return [];
    }

    const parsed = parseMemoryArray(rawText);
    if (!parsed.ok) {
      this.opts.onError?.(
        new Error(`MemoryConsolidator: model output failed validation — ${parsed.reason}`),
      );
      return [];
    }

    const lastMessageId = messages.at(-1)?.id;
    const proposed = parsed.value.slice(0, maxPerRun);
    const written: ConsolidatedMemory[] = [];
    for (const row of proposed) {
      const scopeKey = row.scope === 'user' ? this.opts.userId : this.opts.bookHash;
      if (!scopeKey) {
        this.opts.onError?.(
          new Error(`MemoryConsolidator: missing ${row.scope}Id; skipping memory "${row.key}"`),
        );
        continue;
      }
      try {
        await this.opts.memory.write({
          scope: row.scope,
          scopeKey,
          key: row.key,
          summary: row.summary,
          sourceMessageId: lastMessageId,
        });
        written.push({
          scope: row.scope,
          key: row.key,
          summary: row.summary,
          sourceMessageId: lastMessageId,
        });
      } catch (err) {
        this.opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
    return written;
  }

  private async summarize(messages: ConsolidatorMessage[], maxPerRun: number): Promise<string> {
    const systemPrompt = (this.opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT).replace(
      '{{MAX_PER_RUN}}',
      String(maxPerRun),
    );

    const modelMessages: ModelMessage[] = [
      {
        role: 'user',
        content:
          'Recent conversation turns to consolidate:\n\n' +
          messages.map((m) => `[${m.role}] ${m.content}`).join('\n---\n'),
      },
    ];

    const result = await generateText({
      model: this.opts.model.getLanguageModel(),
      system: systemPrompt,
      messages: modelMessages,
    });

    return result.text;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface ParseOk {
  ok: true;
  value: Array<z.infer<typeof memoryRowSchema>>;
}
interface ParseErr {
  ok: false;
  reason: string;
}

function parseMemoryArray(raw: string): ParseOk | ParseErr {
  const trimmed = stripCodeFences(raw).trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty model output' };
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (err) {
    return { ok: false, reason: `JSON parse failed: ${(err as Error).message}` };
  }
  const parsed = memoryArraySchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: `schema validation failed: ${parsed.error.message}` };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Strip a markdown code fence if the model wrapped its JSON in one
 * despite our instructions. Cheap defense against models that ignore
 * "no markdown fences" in their system prompt.
 */
function stripCodeFences(s: string): string {
  const fenceMatch = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  return fenceMatch ? fenceMatch[1]! : s;
}
