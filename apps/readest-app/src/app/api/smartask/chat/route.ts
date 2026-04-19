import { NextRequest } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createSmartAskLogFilename,
  extractSmartAskDeltaFromSseText,
  formatSmartAskLog,
  getSmartAskMessagesFromBody,
} from '@/services/smartAsk/logging';

export const runtime = 'nodejs';

async function writeSmartAskLog(entry: {
  timestamp: string;
  endpoint: string;
  body: unknown;
  responseText?: string;
  error?: string;
  status?: number;
  durationMs?: number;
}) {
  try {
    const logDir = path.join(process.cwd(), 'logs', 'smartask');
    await mkdir(logDir, { recursive: true });
    await writeFile(
      path.join(logDir, createSmartAskLogFilename(new Date(entry.timestamp))),
      formatSmartAskLog({
        timestamp: entry.timestamp,
        endpoint: entry.endpoint,
        requestBody: entry.body,
        messages: getSmartAskMessagesFromBody(entry.body),
        responseText: entry.responseText,
        error: entry.error,
        status: entry.status,
        durationMs: entry.durationMs,
      }),
      'utf-8',
    );
  } catch (error) {
    console.error('Failed to write SmartAsk log', error);
  }
}

export async function POST(request: NextRequest) {
  const { endpoint, apiKey, body } = (await request.json()) as {
    endpoint: string;
    apiKey?: string;
    body: unknown;
  };
  const startedAt = Date.now();
  const timestamp = new Date(startedAt).toISOString();

  if (!endpoint) {
    return Response.json({ error: 'Missing endpoint' }, { status: 400 });
  }

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    return Response.json({ error: 'Invalid endpoint URL' }, { status: 400 });
  }
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

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      await writeSmartAskLog({
        timestamp,
        endpoint,
        body,
        error: `Upstream error ${upstream.status}: ${text}`,
        status: upstream.status,
        durationMs: Date.now() - startedAt,
      });
      return Response.json(
        { error: `Upstream error ${upstream.status}: ${text}` },
        { status: upstream.status },
      );
    }
    const upstreamBody = upstream.body;
    if (!upstreamBody) {
      return Response.json({ error: 'Upstream response body is empty' }, { status: 502 });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstreamBody.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let responseText = '';
        let errorMessage = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() ?? '';
            responseText += extractSmartAskDeltaFromSseText(lines.join('\n'));
            controller.enqueue(value);
          }
          sseBuffer += decoder.decode();
          responseText += extractSmartAskDeltaFromSseText(sseBuffer);
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : 'Upstream stream failed';
          // upstream closed or aborted — stop cleanly
        } finally {
          reader.releaseLock();
          await writeSmartAskLog({
            timestamp,
            endpoint,
            body,
            responseText,
            error: errorMessage || undefined,
            status: upstream.status,
            durationMs: Date.now() - startedAt,
          });
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
    await writeSmartAskLog({
      timestamp,
      endpoint,
      body,
      error: error instanceof Error ? error.message : 'Failed to reach upstream',
      status: 500,
      durationMs: Date.now() - startedAt,
    });
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to reach upstream' },
      { status: 500 },
    );
  }
}
