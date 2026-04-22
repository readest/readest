import { NextRequest } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createInlineInsightLogFilename,
  extractInlineInsightStreamDeltaFromSseText,
  formatInlineInsightLog,
  getInlineInsightMessagesFromBody,
} from '@/services/inlineInsight/logging';

export const runtime = 'nodejs';

function isInlineInsightDebugLoggingEnabled(): boolean {
  return process.env['INLINE_INSIGHT_DEBUG_LOGGING'] === 'true';
}

async function writeInlineInsightLog(entry: {
  timestamp: string;
  endpoint: string;
  body: unknown;
  responseText?: string;
  reasoningText?: string;
  error?: string;
  status?: number;
  durationMs?: number;
}) {
  try {
    const logDir = path.join(process.cwd(), 'logs', 'inlineinsight');
    await mkdir(logDir, { recursive: true });
    await writeFile(
      path.join(logDir, createInlineInsightLogFilename(new Date(entry.timestamp))),
      formatInlineInsightLog({
        timestamp: entry.timestamp,
        endpoint: entry.endpoint,
        requestBody: entry.body,
        messages: getInlineInsightMessagesFromBody(entry.body),
        responseText: entry.responseText,
        reasoningText: entry.reasoningText,
        error: entry.error,
        status: entry.status,
        durationMs: entry.durationMs,
      }),
      'utf-8',
    );
  } catch (error) {
    console.error('Failed to write Inline Insight log', error);
  }
}

export async function POST(request: NextRequest) {
  // Proxies requests from web build to skip CORS requirement. Return as stream
  const endpoint = request.headers.get('X-InlineInsight-Endpoint') ?? '';
  const apiKey = request.headers.get('X-InlineInsight-Api-Key') ?? undefined;
  const body = (await request.json()) as unknown;
  const startedAt = Date.now();
  const timestamp = new Date(startedAt).toISOString();
  const debugLogging = isInlineInsightDebugLoggingEnabled();

  if (!endpoint) {
    return Response.json({ error: 'Missing endpoint' }, { status: 400 });
  }

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    return Response.json({ error: 'Invalid endpoint URL' }, { status: 400 });
  }
  // The proxy intentionally only forwards HTTP(S) requests to user-configured LLM servers.
  if (!['http:', 'https:'].includes(parsedEndpoint.protocol)) {
    return Response.json({ error: 'Unsupported endpoint protocol' }, { status: 400 });
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
      signal: request.signal,
    });

    // POST Error handling
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      if (debugLogging) {
        await writeInlineInsightLog({
          timestamp,
          endpoint,
          body,
          error: `Upstream error ${upstream.status}: ${text}`,
          status: upstream.status,
          durationMs: Date.now() - startedAt,
        });
      }
      return Response.json(
        { error: `Upstream error ${upstream.status}: ${text}` },
        { status: upstream.status },
      );
    }

    const upstreamBody = upstream.body;
    if (!upstreamBody) {
      return Response.json({ error: 'Upstream response body is empty' }, { status: 502 });
    }

    // Streaming
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstreamBody.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let responseText = '';
        let reasoningText = '';
        let errorMessage = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() ?? '';
            // Each upstream chunk may contain partial SSE frames. Only parse complete lines
            // and keep the unfinished tail for the next read.
            const delta = extractInlineInsightStreamDeltaFromSseText(lines.join('\n'));
            responseText += delta.content;
            reasoningText += delta.reasoning;
            controller.enqueue(value);
          }
          sseBuffer += decoder.decode();
          const delta = extractInlineInsightStreamDeltaFromSseText(sseBuffer);
          responseText += delta.content;
          reasoningText += delta.reasoning;
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : 'Upstream stream failed';
          // upstream closed or aborted — stop cleanly
        } finally {
          reader.releaseLock();
          if (debugLogging) {
            await writeInlineInsightLog({
              timestamp,
              endpoint,
              body,
              responseText,
              reasoningText,
              error: errorMessage || undefined,
              status: upstream.status,
              durationMs: Date.now() - startedAt,
            });
          }
          controller.close();
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
    if (debugLogging) {
      await writeInlineInsightLog({
        timestamp,
        endpoint,
        body,
        error: error instanceof Error ? error.message : 'Failed to reach upstream',
        status: 500,
        durationMs: Date.now() - startedAt,
      });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to reach upstream' },
      { status: 500 },
    );
  }
}
