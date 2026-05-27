import { renderShareOgImage } from './render';

// Intentionally NO `export const runtime = 'edge'`.
//
// OpenNext on Cloudflare can't bundle edge-runtime routes inside the default
// server function — it errors with "OpenNext requires edge runtime function
// to be defined in a separate function." Splitting into a second function
// bundle is more config surgery than this route deserves.
//
// `next/og` (Satori + WASM yoga/resvg) has supported the default Node-compat
// runtime since Next 13.4, and on Cloudflare via OpenNext the default
// function IS already a Worker, so cold-start cost is similar to edge.
//
// The route file is `.ts` (not `.tsx`) so the Tauri static-export build
// drops it via `pageExtensions: ['jsx', 'tsx']` in next.config.mjs — same
// gating used by every other share API route. JSX rendering lives in the
// sibling `render.tsx` which the bundler simply doesn't import in Tauri.

interface RouteParams {
  params: Promise<{ token: string }>;
}

// GET /api/share/[token]/og.png — server-rendered branded card for chat
// unfurls. Stable URL, cached for an hour: unfurlers (iMessage, WhatsApp,
// Twitter, Slack) cache aggressively, so a short-lived signed cover URL would
// break previews after expiry. By proxying through this route we get a stable
// URL even though the underlying R2 object is presigned per-fetch.
export async function GET(_request: Request, { params }: RouteParams) {
  const { token } = await params;
  return renderShareOgImage(token);
}
