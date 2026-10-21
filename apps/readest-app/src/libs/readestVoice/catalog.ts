import type { UserPlan } from '@/types/quota';
import { isVoiceTierInPlan } from '@/utils/access';

// Readest Voice catalog: server-owned data exported by the TTS worker
// (scripts/export_catalog.py) and uploaded with each worker release, so adding
// a preset voice never needs an app release. Fetched instead of asked from the
// worker because a catalog job would cold-start a GPU on every reader open.

export interface CatalogVoice {
  id: string;
  engine: string;
  name: string;
  langs: string[];
}

export interface PlanVoice {
  id: string;
  name: string;
  lang: string;
  // The plan that unlocks the voice, shown as its badge.
  tier: 'plus' | 'pro';
}

const CATALOG_TTL_MS = 10 * 60 * 1000;

// Which plan unlocks each engine. An engine missing here is hidden (fail
// closed), so a new worker engine never reaches users before this is decided.
// Qwen3 is left out on purpose: its voices stay blocked for every plan.
export const ENGINE_MIN_PLAN: Record<string, 'plus' | 'pro'> = {
  kokoro: 'plus',
  omnivoice: 'pro',
};

let cached: { voices: CatalogVoice[]; fetchedAt: number } | null = null;

const isCatalogVoice = (v: unknown): v is CatalogVoice => {
  const r = v as Partial<CatalogVoice> | null;
  return (
    !!r &&
    typeof r.id === 'string' &&
    typeof r.engine === 'string' &&
    typeof r.name === 'string' &&
    Array.isArray(r.langs) &&
    r.langs.every((l) => typeof l === 'string')
  );
};

export const getCatalog = async (): Promise<CatalogVoice[] | null> => {
  const url = process.env['READEST_TTS_CATALOG_URL'];
  if (!url) return null;
  if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) return cached.voices;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`);
    const data = (await res.json()) as { voices?: unknown };
    const voices = Array.isArray(data.voices) ? data.voices.filter(isCatalogVoice) : [];
    cached = { voices, fetchedAt: Date.now() };
    return voices;
  } catch (error) {
    console.warn('Readest Voice catalog unavailable:', error);
    // A failed refresh keeps serving the last good catalog.
    return cached?.voices ?? null;
  }
};

export const isVoiceInPlan = (voice: CatalogVoice, plan: UserPlan): boolean => {
  const minPlan = ENGINE_MIN_PLAN[voice.engine];
  return !!minPlan && isVoiceTierInPlan(minPlan, plan);
};

// One row per (voice, language): multilingual voices appear under each
// language they are listed for, as the per-language voice picker expects.
const toPlanVoices = (voices: CatalogVoice[]): PlanVoice[] =>
  voices.flatMap((voice) =>
    voice.langs.map((lang) => ({
      id: voice.id,
      name: voice.name,
      lang,
      tier: ENGINE_MIN_PLAN[voice.engine]!,
    })),
  );

export const voicesForPlan = (catalog: CatalogVoice[], plan: UserPlan): PlanVoice[] =>
  toPlanVoices(catalog.filter((voice) => isVoiceInPlan(voice, plan)));

// Every voice some plan unlocks, for readers on any plan: the picker greys
// out the ones theirs lacks.
export const offeredVoices = (catalog: CatalogVoice[]): PlanVoice[] =>
  toPlanVoices(catalog.filter((voice) => !!ENGINE_MIN_PLAN[voice.engine]));

export const findVoice = (catalog: CatalogVoice[], id: string): CatalogVoice | undefined =>
  catalog.find((voice) => voice.id === id);
