import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import type { UserPlan } from '@/types/quota';
import { getSubscriptionPlan, isTTSInPlan, validateUserAndToken } from '@/utils/access';
import { type CatalogVoice, getCatalog } from './catalog';
import { getRunPodConfig, type RunPodConfig } from './runpod';

// Checks shared by the Readest Voice routes, in order: auth, kill switch,
// plan, catalog. Error bodies are flat string codes: fetchWithAuth throws
// body.error as the Error message, so an object would reach the client as
// "[object Object]".

export interface ReadestVoiceContext {
  user: User;
  plan: UserPlan;
  config: RunPodConfig;
  catalog: CatalogVoice[];
}

export const errorResponse = (error: string, status: number, headers?: HeadersInit) =>
  NextResponse.json({ error }, { status, headers });

export const gateReadestVoice = async (
  request: Request,
): Promise<{ ok: true; ctx: ReadestVoiceContext } | { ok: false; response: NextResponse }> => {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) return { ok: false, response: errorResponse('NOT_AUTHENTICATED', 403) };
  const config = getRunPodConfig();
  if (!config) return { ok: false, response: errorResponse('NOT_CONFIGURED', 503) };
  const plan = getSubscriptionPlan(token);
  if (!isTTSInPlan(plan)) return { ok: false, response: errorResponse('PLAN_REQUIRED', 403) };
  const catalog = await getCatalog();
  if (!catalog) return { ok: false, response: errorResponse('NOT_CONFIGURED', 503) };
  return { ok: true, ctx: { user, plan, config, catalog } };
};
