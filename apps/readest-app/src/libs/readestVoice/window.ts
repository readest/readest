import type { UserPlan } from '@/types/quota';
import type { TTSLane } from '@/services/tts/providers/types';
import { READEST_VOICE_PREVIEW_MAX_CHARS } from '@/services/constants';
import { type CatalogVoice, ENGINE_MIN_PLAN, findVoice, isVoiceInPlan } from './catalog';

// A window of sentences as the app sends it, shared by the stream route
// (listening, voice previews) and the jobs route (downloads).

export interface Segment {
  id: string;
  text: string;
  voice: string;
}

// 'preview': one short sample in any offered voice, for a reader choosing one.
export type WindowLane = TTSLane | 'preview';

export interface WindowRequest {
  clientId: string;
  lane: WindowLane;
  lang: string;
  segments: Segment[];
}

const LANE_LIMITS: Record<WindowLane, { segments: number; chars: number }> = {
  listen: { segments: 8, chars: 2000 },
  download: { segments: 64, chars: 12000 },
  preview: { segments: 1, chars: READEST_VOICE_PREVIEW_MAX_CHARS },
};
const MAX_SEGMENT_CHARS = 2000;
const MAX_CLIENT_ID_CHARS = 64;
// Apps that send no client id share one: their listen windows replace each
// other, as before per-client queueing.
const DEFAULT_CLIENT_ID = 'default';

export const parseWindow = (body: unknown): WindowRequest | null => {
  const {
    client = DEFAULT_CLIENT_ID,
    lane,
    lang,
    segments,
  } = (body ?? {}) as Record<string, unknown>;
  if (typeof client !== 'string' || !client || client.length > MAX_CLIENT_ID_CHARS) return null;
  if (lane !== 'listen' && lane !== 'download' && lane !== 'preview') return null;
  if (typeof lang !== 'string' || !Array.isArray(segments)) return null;
  const limits = LANE_LIMITS[lane];
  if (segments.length === 0 || segments.length > limits.segments) return null;
  const ids = new Set<string>();
  let chars = 0;
  // Only the validated fields go on, to the worker and into stored jobs.
  const clean: Segment[] = [];
  for (const raw of segments) {
    const { id, text, voice } = (raw ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || !id || ids.has(id)) return null;
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_SEGMENT_CHARS) return null;
    if (typeof voice !== 'string') return null;
    ids.add(id);
    chars += text.length;
    clean.push({ id, text, voice });
  }
  if (chars > limits.chars) return null;
  return { clientId: client, lane, lang: lang.slice(0, 35), segments: clean };
};

// The engines the window needs, or the flat error code that refuses it. A
// preview may use any voice some plan offers, whatever the reader's plan.
export const checkVoices = (
  catalog: CatalogVoice[],
  plan: UserPlan,
  segments: Segment[],
  preview = false,
): { engines: string[] } | { error: 'UNKNOWN_VOICE' | 'VOICE_TIER_REQUIRED'; status: number } => {
  const engines = new Set<string>();
  for (const segment of segments) {
    const voice = findVoice(catalog, segment.voice);
    if (!voice) return { error: 'UNKNOWN_VOICE', status: 400 };
    const allowed = preview ? !!ENGINE_MIN_PLAN[voice.engine] : isVoiceInPlan(voice, plan);
    if (!allowed) return { error: 'VOICE_TIER_REQUIRED', status: 403 };
    engines.add(voice.engine);
  }
  return { engines: [...engines] };
};
