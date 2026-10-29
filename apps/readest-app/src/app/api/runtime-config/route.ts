import { NextResponse } from 'next/server';
import { getServerRuntimeConfig, pickPublicRuntimeConfig } from '@/services/runtimeConfig';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

// The native apps (statically exported, so they can't load /runtime-config.js)
// fetch this when the user points them at a self-hosted server. Plain data,
// never a script: the app validates it instead of executing it. Only the
// allowlisted public keys are published.
//
// Served only where the operator opts in with ALLOW_APP_CONNECTIONS=true. The
// Docker image defaults it on; deployments that never set it (web.readest.com)
// answer 403, which the app reports as "connections disabled" rather than the
// 404 it reads as an outdated server. Not a secret boundary: the same values
// are public in /runtime-config.js.
export function GET() {
  if (process.env['ALLOW_APP_CONNECTIONS'] !== 'true') {
    return NextResponse.json({}, { status: 403, headers: NO_STORE });
  }
  return NextResponse.json(pickPublicRuntimeConfig(getServerRuntimeConfig()), {
    headers: NO_STORE,
  });
}
