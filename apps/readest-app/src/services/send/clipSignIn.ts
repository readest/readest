/**
 * Login-wall recovery for the article-clip pipeline (#5262).
 *
 * The clip WebView runs in Readest's own cookie jar, so a page behind a
 * sign-in serves only its free preview — the OS sandbox makes the external
 * browser's session unreachable. The fallback here re-runs the clip in
 * *interactive* mode: the native controller shows the page with a
 * Cancel/Capture bar, the user signs in once, and because the cookie jar
 * is app-wide and persistent, every later clip (including RSS tap-to-open)
 * is authenticated headlessly.
 */

import { invoke } from '@tauri-apps/api/core';
import type { AppService } from '@/types/system';
import { eventDispatcher } from '@/utils/event';
import { getClipOptions } from './clipOptions';
import { convertToEpubWithWorker } from './conversion/conversionWorker';
import { ConversionError, type ConvertedBook } from './conversion/types';

type Translate = (key: string) => string;

/** Sync event consumed by `ClipSignInAlert`. Detail: `{ url, respond }`. */
export const CLIP_SIGNIN_CONFIRM_EVENT = 'clip-signin-confirm';

/** Native cancel message from both mobile controllers — a user closing the
 *  interactive capture is not an error, so callers stay quiet on it. */
const CLIP_CANCELLED_MESSAGE = 'Capture cancelled';

export function isClipCancelled(err: unknown): boolean {
  // Tauri `invoke` rejects with the raw string from the native side; our own
  // wrappers throw Error objects. Accept both shapes.
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return message === CLIP_CANCELLED_MESSAGE;
}

export async function clipPageToBook(
  url: string,
  _: Translate,
  interactive = false,
): Promise<ConvertedBook> {
  const html = await invoke<string>('clip_url', {
    url,
    options: { ...getClipOptions(_), interactive },
  });
  return await convertToEpubWithWorker({ kind: 'page', html, url });
}

/** Ask the mounted `ClipSignInAlert` whether to open the page for a manual
 *  sign-in + capture. Resolves false when no confirm UI is mounted. */
function confirmClipSignIn(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const handled = eventDispatcher.dispatchSync(CLIP_SIGNIN_CONFIRM_EVENT, {
      url,
      respond: resolve,
    });
    if (!handled) resolve(false);
  });
}

/**
 * Clip `url` and convert it to a book. When extraction hits a login wall on
 * mobile, offer the user an interactive sign-in + manual capture and retry.
 * Declining (or having no confirm UI mounted) rethrows the original error;
 * cancelling the interactive capture rejects with the native
 * "Capture cancelled" message — check `isClipCancelled` to stay quiet.
 */
export async function clipPageWithSignInFallback(
  url: string,
  _: Translate,
  appService: AppService | null,
): Promise<ConvertedBook> {
  try {
    return await clipPageToBook(url, _);
  } catch (err) {
    // Interactive capture only exists in the mobile native controllers.
    if (!appService?.isMobileApp) throw err;
    if (!(err instanceof ConversionError) || err.code !== 'login_wall') throw err;
    if (!(await confirmClipSignIn(url))) throw err;
    return await clipPageToBook(url, _, true);
  }
}
