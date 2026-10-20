import { NextResponse } from 'next/server';
import { embed, embedMany, createGateway } from 'ai';
import { validateUserAndToken } from '@/utils/access';

// Matches maxEmbeddingsPerCall in ProxiedGatewayEmbedding.
const MAX_TEXTS = 100;
const MAX_INPUT_CHARS = 500_000;

export async function POST(req: Request): Promise<Response> {
  try {
    const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
    if (!user || !token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
    }

    const { texts, single, apiKey } = await req.json();

    if (
      !Array.isArray(texts) ||
      texts.length === 0 ||
      !texts.every((text): text is string => typeof text === 'string')
    ) {
      return NextResponse.json({ error: 'Texts array required' }, { status: 400 });
    }
    const inputChars = texts.reduce((sum, text) => sum + text.length, 0);
    if (texts.length > MAX_TEXTS || inputChars > MAX_INPUT_CHARS) {
      return NextResponse.json({ error: 'Input too large' }, { status: 413 });
    }

    if (!apiKey) {
      return NextResponse.json({ error: 'API key required' }, { status: 401 });
    }

    const gateway = createGateway({ apiKey });
    const model = gateway.embeddingModel(
      process.env['AI_GATEWAY_EMBEDDING_MODEL'] || 'openai/text-embedding-3-small',
    );

    if (single) {
      const { embedding } = await embed({ model, value: texts[0]! });
      return NextResponse.json({ embedding });
    } else {
      const { embeddings } = await embedMany({ model, values: texts });
      return NextResponse.json({ embeddings });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Embedding failed: ${errorMessage}` }, { status: 500 });
  }
}
