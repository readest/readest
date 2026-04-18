import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';

const LOG_DIR = path.join(process.cwd(), 'logs', 'smartask');

interface ChatBody {
  model?: string;
  temperature?: number;
  messages?: { role: string; content: string }[];
}

async function writeDebugLog(endpoint: string, requestBody: unknown, responseText: string) {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');

    const body = requestBody as ChatBody;
    const sections: string[] = [
      `# SmartAsk Debug Log`,
      ``,
      `**Time**: ${new Date().toISOString()}`,
      `**Endpoint**: ${endpoint}`,
      `**Model**: ${body.model ?? ''}`,
      `**Temperature**: ${body.temperature ?? ''}`,
    ];

    for (const msg of body.messages ?? []) {
      const role = msg.role[0]!.toUpperCase() + msg.role.slice(1);
      sections.push(``, `## ${role}`, ``, msg.content);
    }

    sections.push(``, `## Response`, ``, responseText);

    await fs.writeFile(path.join(LOG_DIR, `${ts}.md`), sections.join('\n'), 'utf-8');
  } catch {
    // logging is best-effort — never fail the request
  }
}

function extractTextDelta(parsed: unknown): string {
  if (parsed === null || typeof parsed !== 'object') return '';
  const choices = (parsed as Record<string, unknown>)['choices'];
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const delta = (choices[0] as Record<string, unknown>)['delta'];
  if (delta === null || typeof delta !== 'object') return '';
  const content = (delta as Record<string, unknown>)['content'];
  return typeof content === 'string' ? content : '';
}

export async function POST(request: NextRequest) {
  const { endpoint, apiKey, body } = (await request.json()) as {
    endpoint: string;
    apiKey?: string;
    body: unknown;
  };

  if (!endpoint) {
    return Response.json({ error: 'Missing endpoint' }, { status: 400 });
  }

  try {
    new URL(endpoint);
  } catch {
    return Response.json({ error: 'Invalid endpoint URL' }, { status: 400 });
  }

  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return Response.json(
        { error: `Upstream error ${upstream.status}: ${text}` },
        { status: upstream.status },
      );
    }

    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let responseText = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);

            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() ?? '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const data = trimmed.slice(5).trim();
              if (data === '[DONE]') continue;
              try {
                const delta = extractTextDelta(JSON.parse(data));
                if (delta) responseText += delta;
              } catch {
                // malformed SSE line — skip
              }
            }
          }
        } catch {
          // upstream closed or aborted — stop cleanly
        } finally {
          controller.close();
          void writeDebugLog(endpoint, body, responseText);
        }
      },
    });

    return new Response(stream, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to reach upstream' },
      { status: 500 },
    );
  }
}
