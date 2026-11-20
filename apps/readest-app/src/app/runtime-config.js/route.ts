import { NextResponse } from 'next/server';
import { getServerRuntimeConfig, RUNTIME_CONFIG_STORAGE_KEY } from '@/services/runtimeConfig';

export const dynamic = 'force-dynamic';

export function GET() {
  const serializedConfig = JSON.stringify(getServerRuntimeConfig())
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  // Saved for the next page load, whose modules can read the config before this
  // script runs (see getRuntimeConfig).
  const script =
    `window.__READEST_RUNTIME_CONFIG=${serializedConfig};` +
    `try{localStorage.setItem('${RUNTIME_CONFIG_STORAGE_KEY}',JSON.stringify(window.__READEST_RUNTIME_CONFIG))}catch(e){}`;
  return new NextResponse(script, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
