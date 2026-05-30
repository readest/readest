/**
 * Upload a built EPUB to the user's Readest inbox. Posts the EPUB bytes
 * directly to `POST /api/send/inbox/file` with metadata in headers — the
 * server stores the bytes in R2 verbatim and the drainer imports the EPUB
 * on the next Readest open. We use a raw binary body (not multipart) so the
 * server-side handler can stream-read without pulling in a multipart parser.
 */

import type { ClipErrorCode } from '../lib/messages';
import { translate as _ } from '../lib/i18n';

const DEFAULT_API_BASE = 'https://web.readest.com';
const INBOX_FILE_PATH = '/api/send/inbox/file';

/**
 * Compute the full upload endpoint URL. Reads `readestApiBase` from
 * `chrome.storage.local` so a developer can point the extension at a
 * local server via:
 *
 *     chrome.storage.local.set({ readestApiBase: 'http://localhost:3000' });
 *
 * This is called from the service worker — `chrome.storage` is reliable
 * there. The offscreen page receives the resolved URL as a parameter so
 * it never touches `chrome.storage` itself (some Chrome builds expose
 * `chrome.runtime` to an offscreen document while leaving
 * `chrome.storage` undefined until the page has been alive for a beat).
 */
export async function resolveUploadEndpoint(): Promise<string> {
  try {
    if (chrome?.storage?.local) {
      const stored = (await chrome.storage.local.get('readestApiBase')) as {
        readestApiBase?: unknown;
      };
      const base = stored.readestApiBase;
      if (typeof base === 'string' && /^https?:\/\//.test(base)) {
        return `${base.replace(/\/$/, '')}${INBOX_FILE_PATH}`;
      }
    }
  } catch (err) {
    console.warn('[send-to-readest/upload] could not read readestApiBase', err);
  }
  return `${DEFAULT_API_BASE}${INBOX_FILE_PATH}`;
}

export interface UploadResult {
  ok: true;
  id: string;
}

export interface UploadError {
  ok: false;
  code: ClipErrorCode;
  message: string;
}

/** RFC 5987 encoding so non-ASCII titles survive HTTP-header transport. */
function encodeHeaderValue(value: string): string {
  return `UTF-8''${encodeURIComponent(value)}`;
}

export async function uploadEpub(opts: {
  /** Full upload URL — caller resolves this (typically in the SW where
   *  `chrome.storage` is reliable) so the offscreen page never has to
   *  read storage itself. */
  endpoint: string;
  token: string;
  /** EPUB payload — `File` from the shared converter, or any `Blob`. */
  epub: Blob | File;
  title: string;
  sourceUrl: string;
}): Promise<UploadResult | UploadError> {
  const target = opts.endpoint;
  let res: Response;
  try {
    res = await fetch(target, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        'Content-Type': 'application/epub+zip',
        'X-Readest-Title': encodeHeaderValue(opts.title || 'Page clip'),
        'X-Readest-Url': encodeHeaderValue(opts.sourceUrl),
      },
      body: opts.epub,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: 'network-error',
      message: _('Could not reach {host} — {reason}', {
        host: new URL(target).host,
        reason,
      }),
    };
  }

  if (res.status === 403 || res.status === 401) {
    return { ok: false, code: 'session-expired', message: _('Session expired') };
  }
  if (res.status === 429) {
    return { ok: false, code: 'inbox-full', message: _('Inbox is full') };
  }
  if (res.status === 413) {
    return { ok: false, code: 'server-error', message: _('Article is too large to send') };
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      /* non-JSON body */
    }
    return {
      ok: false,
      code: 'server-error',
      message: detail || _('Server returned {status}', { status: res.status }),
    };
  }
  let body: { id?: string };
  try {
    body = (await res.json()) as { id?: string };
  } catch {
    return { ok: false, code: 'server-error', message: _('Unexpected server response') };
  }
  return { ok: true, id: body.id ?? '' };
}
