import { NextResponse } from 'next/server';
import { embed, embedMany, createGateway } from 'ai';
import { validateUserAndToken } from '@/utils/access';

// The client embeds in batches of at most 100 (maxEmbeddingsPerCall), so these
// caps bound a single request to the paid gateway without affecting indexing.
const MAX_EMBED_TEXTS = 100;
const MAX_EMBED_TOTAL_CHARS = 500_000;
const REQUEST_TIMEOUT_MS = 60_000;

export async function POST(req: Request): Promise<Response> {
  try {
    const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
    if (!user || !token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
    }

    const { texts, single, apiKey } = await req.json();

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return NextResponse.json({ error: 'Texts array required' }, { status: 400 });
    }

    const totalChars = texts.reduce(
      (sum: number, t: unknown) => sum + (typeof t === 'string' ? t.length : 0),
      0,
    );
    if (texts.length > MAX_EMBED_TEXTS || totalChars > MAX_EMBED_TOTAL_CHARS) {
      return NextResponse.json({ error: 'Request too large' }, { status: 413 });
    }

    const gatewayApiKey = apiKey || process.env['AI_GATEWAY_API_KEY'];
    if (!gatewayApiKey) {
      return NextResponse.json({ error: 'API key required' }, { status: 401 });
    }

    const gateway = createGateway({ apiKey: gatewayApiKey });
    const model = gateway.embeddingModel(
      process.env['AI_GATEWAY_EMBEDDING_MODEL'] || 'openai/text-embedding-3-small',
    );

    const abortSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    if (single) {
      const { embedding } = await embed({ model, value: texts[0], abortSignal });
      return NextResponse.json({ embedding });
    } else {
      const { embeddings } = await embedMany({ model, values: texts, abortSignal });
      return NextResponse.json({ embeddings });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Embedding failed: ${errorMessage}` }, { status: 500 });
  }
}
