import { NextRequest, NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';

const CAMB_AI_API_BASE = 'https://client.camb.ai/apis';

const getCambApiKey = (): string | undefined => {
  return process.env['CAMB_API_KEY'];
};

// Cache voices and languages server-side (they rarely change)
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let voicesCache: { data: unknown; timestamp: number } | null = null;
let languagesCache: { data: unknown; timestamp: number } | null = null;

export async function POST(request: NextRequest) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }

  const apiKey = getCambApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: { message: 'CAMB AI API key not configured', type: 'configuration_error' } },
      { status: 500 },
    );
  }

  try {
    const body = await request.json();
    const { text, language = 'en-us', voice_id, rate = 1.0, speech_model = 'mars-flash' } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: { message: 'Missing or invalid "text" field', type: 'invalid_request_error' } },
        { status: 400 },
      );
    }

    if (!voice_id || typeof voice_id !== 'number') {
      return NextResponse.json(
        {
          error: { message: 'Missing or invalid "voice_id" field', type: 'invalid_request_error' },
        },
        { status: 400 },
      );
    }

    const response = await fetch(`${CAMB_AI_API_BASE}/tts-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        language,
        voice_id,
        speech_model,
        output_configuration: { format: 'mp3' },
        voice_settings: { speaking_rate: rate },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return NextResponse.json(
        { error: { message: `CAMB AI API error: ${errorText}`, type: 'upstream_error' } },
        { status: response.status },
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': arrayBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error('CAMB AI TTS API error:', error);
    return NextResponse.json(
      {
        error: {
          message: error instanceof Error ? error.message : 'Internal server error',
          type: 'internal_error',
        },
      },
      { status: 500 },
    );
  }
}

async function filterVoicesByLang(
  voices: Array<{ language: number; [key: string]: unknown }>,
  lang: string,
  apiKey: string,
): Promise<Array<{ language: number; [key: string]: unknown }>> {
  const langResponse = await fetch(`${CAMB_AI_API_BASE}/target-languages`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!langResponse.ok) return voices;
  const langData = await langResponse.json();
  const langList = Array.isArray(langData) ? langData : (langData.languages ?? []);
  const langMap = new Map<number, string>();
  for (const l of langList) {
    langMap.set(l.id, (l.short_name as string).toLowerCase());
  }
  return voices.filter((v) => {
    const shortName = langMap.get(v.language) || '';
    return shortName.startsWith(lang.toLowerCase());
  });
}

export async function GET(request: NextRequest) {
  const apiKey = getCambApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: { message: 'CAMB AI API key not configured', type: 'configuration_error' } },
      { status: 500 },
    );
  }

  try {
    const query = request.nextUrl.searchParams;
    const action = query.get('action') || 'voices';
    const now = Date.now();

    if (action === 'languages') {
      if (languagesCache && now - languagesCache.timestamp < CACHE_TTL_MS) {
        return NextResponse.json({ languages: languagesCache.data });
      }
      const response = await fetch(`${CAMB_AI_API_BASE}/target-languages`, {
        headers: { 'x-api-key': apiKey },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch languages: ${response.status}`);
      }
      const raw = await response.json();
      const languages = Array.isArray(raw) ? raw : (raw.languages ?? []);
      languagesCache = { data: languages, timestamp: now };
      return NextResponse.json({ languages });
    }

    if (voicesCache && now - voicesCache.timestamp < CACHE_TTL_MS) {
      let voices = voicesCache.data as Array<{ language: number; [key: string]: unknown }>;
      const lang = query.get('lang') || '';
      if (lang) {
        voices = await filterVoicesByLang(voices, lang, apiKey);
      }
      return NextResponse.json({ voices });
    }

    const response = await fetch(`${CAMB_AI_API_BASE}/list-voices`, {
      headers: { 'x-api-key': apiKey },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch voices: ${response.status}`);
    }
    const raw = await response.json();
    let voices: Array<{ language: number; [key: string]: unknown }> = Array.isArray(raw)
      ? raw
      : (raw.voices ?? []);
    voicesCache = { data: voices, timestamp: now };

    const lang = query.get('lang') || '';
    if (lang) {
      voices = await filterVoicesByLang(voices, lang, apiKey);
    }

    return NextResponse.json({ voices });
  } catch (error) {
    console.error('CAMB AI voices API error:', error);
    return NextResponse.json(
      { error: { message: 'Failed to fetch voices', type: 'internal_error' } },
      { status: 500 },
    );
  }
}
