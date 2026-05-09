import { getAPIBaseUrl } from '@/services/environment';
import { fetchWithAuth } from '@/utils/fetch';

const SHARE_API = getAPIBaseUrl() + '/share';

export interface CreateShareInput {
  bookHash: string;
  expirationDays: number; // must be one of [1, 3, 7]
  title: string;
  author?: string | null;
  format: string;
  // Note: `size` is intentionally not part of the input. The server reads the
  // canonical size from the user's `files` row to avoid client/server drift.
  cfi?: string | null;
}

export interface CreateShareResponse {
  token: string;
  url: string;
  expiresAt: string;
}

export interface ShareMetadata {
  title: string;
  author: string | null;
  format: string;
  size: number;
  expiresAt: string;
  hasCover: boolean;
  hasCfi: boolean;
  downloadCount: number;
  // Owner-only fields (returned only when the caller is the sharer).
  token?: string;
  bookHash?: string;
  createdAt?: string;
  revokedAt?: string | null;
}

export interface ShareListResponse {
  shares: Array<
    ShareMetadata & {
      token: string;
      bookHash: string;
      createdAt: string;
      revokedAt: string | null;
    }
  >;
  nextCursor: string | null;
}

export interface ImportShareResponse {
  fileId: string;
  alreadyOwned: boolean;
  bookHash: string;
  cfi: string | null;
}

export class ShareApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ShareApiError';
  }
}

const parseError = async (response: Response): Promise<ShareApiError> => {
  let code: string | undefined;
  let message = response.statusText || 'Request failed';
  try {
    const body = (await response.json()) as { error?: string; code?: string };
    if (body?.error) message = body.error;
    if (body?.code) code = body.code;
  } catch {
    // Body wasn't JSON; keep the default message.
  }
  return new ShareApiError(response.status, code, message);
};

const jsonHeaders = { 'Content-Type': 'application/json' };

// Owner-only. Creates a share row for an already-uploaded book.
export const createShare = async (input: CreateShareInput): Promise<CreateShareResponse> => {
  const response = await fetchWithAuth(`${SHARE_API}/create`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as CreateShareResponse;
};

// Public. Used by the landing page to render metadata.
export const getShare = async (token: string): Promise<ShareMetadata> => {
  const response = await fetch(`${SHARE_API}/${encodeURIComponent(token)}`, {
    method: 'GET',
    cache: 'no-store',
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as ShareMetadata;
};

// Owner-only. Revokes a share immediately. Note that already-minted presigned
// download URLs remain valid until their TTL expires (max ~5 min).
export const revokeShare = async (token: string): Promise<void> => {
  const response = await fetchWithAuth(`${SHARE_API}/${encodeURIComponent(token)}/revoke`, {
    method: 'POST',
  });
  if (!response.ok) throw await parseError(response);
};

// Owner-only. Paginated list of the caller's shares (active + expired).
export const listShares = async (cursor?: string | null): Promise<ShareListResponse> => {
  // SHARE_API is relative in dev (`/api/share`) and absolute in prod, so we
  // can't use `new URL()` here unconditionally — relative paths throw
  // "Invalid URL" without a base. Build the query string manually.
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const response = await fetchWithAuth(`${SHARE_API}/list${qs}`, { method: 'GET' });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as ShareListResponse;
};

// Recipient-side, requires auth. Adds the shared book to the caller's library
// by R2 server-side byte-copy. Idempotent: if the recipient already owns a
// non-deleted file with the same book_hash, returns alreadyOwned: true and
// the existing fileId.
export const importShare = async (token: string): Promise<ImportShareResponse> => {
  const response = await fetchWithAuth(`${SHARE_API}/${encodeURIComponent(token)}/import`, {
    method: 'POST',
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as ImportShareResponse;
};

// Public. Best-effort analytics ping fired by the landing page Download button
// and the in-app deeplink hook on a successful import. Failures are silent —
// the user-visible action does NOT depend on this succeeding.
export const confirmDownload = async (token: string): Promise<void> => {
  try {
    await fetch(`${SHARE_API}/${encodeURIComponent(token)}/download/confirm`, {
      method: 'POST',
      cache: 'no-store',
      keepalive: true,
    });
  } catch {
    // Intentionally swallowed; this is analytics, not a gate.
  }
};
