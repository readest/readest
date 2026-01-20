/**
 * server-side chat endpoint for web/mobile
 * protects api key by keeping it server-side
 *
 * PLACEHOLDER - not yet implemented
 * will be activated when implementing free/paid tiers
 */

import { NextResponse } from 'next/server';

export const runtime = 'edge';

// placeholder: uncomment when implementing free/paid tiers
/*
import { gateway } from 'ai';

export async function POST(req: Request) {
  try {
    const { messages, bookHash, currentSection, context, settings } = await req.json();

    // validate request
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Messages required' }, { status: 400 });
    }

    // use server-side api key (never exposed to client)
    const model = gateway(process.env.AI_GATEWAY_MODEL || 'openai/gpt-5.2');

    // build system prompt with context
    const systemPrompt = buildSystemPrompt(context, settings);

    const result = streamText({
      model,
      system: systemPrompt,
      messages,
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error('[AI Chat Route]', error);
    return NextResponse.json(
      { error: 'Chat failed' },
      { status: 500 }
    );
  }
}

function buildSystemPrompt(context: string[], settings: { spoilerProtection?: boolean }): string {
  const contextSection = context?.length
    ? `\n\nRelevant passages:\n${context.map((c, i) => `[${i + 1}] "${c}"`).join('\n\n')}`
    : '';
  const spoilerNote = settings?.spoilerProtection
    ? '\nOnly use info from passages provided.'
    : '';
  return `You are a reading companion. Answer based on context. Be concise and helpful.${spoilerNote}${contextSection}`;
}
*/

// placeholder response until implemented
export async function POST() {
  return NextResponse.json(
    {
      error: 'Server-side AI chat not yet implemented. Use client-side with your own API key.',
      hint: 'This endpoint will be active when free/paid tiers are implemented.',
    },
    { status: 501 },
  );
}
