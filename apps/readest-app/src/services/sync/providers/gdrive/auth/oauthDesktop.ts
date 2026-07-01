/**
 * Desktop wiring of the OAuth authorization-code + PKCE flow: the system browser
 * plus a reverse-DNS custom-scheme deep link.
 *
 * Readest uses ONE iOS-type Google client (no secret) on every platform, whose
 * only Google-accepted redirect is the reverse-DNS scheme
 * `com.googleusercontent.apps.<id>:/oauthredirect`. On desktop we open consent in
 * the user's default browser; Google redirects to that scheme; the OS routes it
 * back to the app (which self-registers it via `deep_link().register_all()` — no
 * installer, no admin), and the `single-instance` / `onOpenUrl` channels deliver
 * the redirect URL. Same client, same reverse-DNS redirect, same PKCE exchange —
 * only the capture differs from the mobile runners.
 *
 * The one Windows subtlety: a browser process only recognises the scheme if it
 * STARTED AFTER the scheme was registered (Windows snapshots protocol
 * associations per-process at launch). The user's everyday browser is usually
 * already running, so it may silently fail to route the redirect. To stay
 * reliable we open the default browser first (best UX — keeps the Google
 * session) and, if no redirect returns within a grace period, re-open consent in
 * a freshly-spawned cold browser (the native `spawn_fresh_browser` command).
 * Whichever browser returns first wins.
 *
 * Adapted from ratatabananana-bit/Readest-google-drive-mod-patcher (AGPL-3.0),
 * used with the author's explicit permission.
 */
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { openUrl } from '@tauri-apps/plugin-opener';
import { createPkcePair } from './pkce';
import {
  deriveReverseDnsRedirectScheme,
  deriveReverseDnsRedirectUri,
  matchesReverseDnsRedirect,
} from './reverseDnsRedirect';
import { runOAuthFlow, type OAuthClientConfig } from './oauthFlow';
import { exchangeCode, type FetchFn, type TokenSet } from './tokenStore';

/**
 * Grace period before the cold-browser fallback. Long enough that a user
 * consenting in their already-cold default browser completes first (so most
 * connects never spawn a second window), short enough that the silent
 * already-running-browser failure is recovered without the user feeling stuck.
 */
export const DEFAULT_FALLBACK_DELAY_MS = 25_000;

/**
 * Hard deadline after which an unfinished connect gives up and REJECTS, so the
 * UI spinner clears and the user can retry. The external browser gives the app
 * no signal when the user closes the consent tab, so without this an abandoned
 * sign-in would hang forever. Deliberately generous: a real sign-in (account
 * pick + password + 2FA, in a session-less window) can take many minutes.
 */
export const CONNECT_DEADLINE_MS = 15 * 60_000;

/** Native command that opens a URL in a freshly-spawned, isolated browser. */
const SPAWN_FRESH_BROWSER_COMMAND = 'spawn_fresh_browser';

/** Payload of the desktop `single-instance` event (mirrors `useAppUrlIngress`). */
interface SingleInstancePayload {
  args: string[];
  cwd: string;
}

/**
 * Platform mechanics the desktop runner needs, injected so the
 * open-browser/capture/fallback orchestration can be exercised headlessly. The
 * production default ({@link defaultDesktopDeepLinkDeps}) binds these to the real
 * Tauri plugins; tests pass fakes.
 */
export interface DesktopDeepLinkDeps {
  /** Open the consent URL in the user's default browser. */
  openDefaultBrowser: (url: string) => Promise<void>;
  /** Open the consent URL in a freshly-spawned cold browser process (fallback). */
  spawnFreshBrowser: (url: string) => Promise<void>;
  /**
   * Subscribe to every redirect URL the OS delivers, invoking `onUrl` for each.
   * Resolves with an unlisten function. The runner filters the stream down to
   * this client's reverse-DNS redirect itself.
   */
  subscribeRedirects: (onUrl: (url: string) => void) => Promise<() => void>;
  /** Grace period before the cold-browser fallback fires. */
  fallbackDelayMs: number;
  /** Hard deadline after which an unfinished connect rejects. */
  connectDeadlineMs: number;
}

/**
 * Real Tauri capture: the OS hands a routed deep link to an already-running app
 * via the `single-instance` event (Windows/Linux relaunch — the URL is `args[1]`)
 * and via the Tauri v2 `onOpenUrl` channel. Both are armed; the caller unlistens
 * on resolve. Cold-start launch URLs are intentionally not read here.
 */
const subscribeRedirectsViaTauri = async (onUrl: (url: string) => void): Promise<() => void> => {
  const unlistenSingleInstance = await getCurrentWindow().listen<SingleInstancePayload>(
    'single-instance',
    ({ payload }) => {
      const url = payload.args?.[1];
      if (url) onUrl(url);
    },
  );
  let unlistenOpenUrl: () => void;
  try {
    unlistenOpenUrl = await onOpenUrl((urls) => {
      urls.forEach(onUrl);
    });
  } catch (error) {
    // Don't leak the already-attached first listener if the second registration
    // fails — an orphaned listener would cross-wire a later attempt.
    unlistenSingleInstance();
    throw error;
  }
  return () => {
    unlistenSingleInstance();
    unlistenOpenUrl();
  };
};

/** Production desktop deps, bound to the real Tauri plugins. */
export const defaultDesktopDeepLinkDeps: DesktopDeepLinkDeps = {
  openDefaultBrowser: (url) => openUrl(url),
  spawnFreshBrowser: (url) => invoke<void>(SPAWN_FRESH_BROWSER_COMMAND, { url }),
  subscribeRedirects: subscribeRedirectsViaTauri,
  fallbackDelayMs: DEFAULT_FALLBACK_DELAY_MS,
  connectDeadlineMs: CONNECT_DEADLINE_MS,
};

/**
 * Await the reverse-DNS redirect, arming the cold-browser fallback and a hard
 * deadline. Resolves with the first incoming URL whose scheme matches `scheme`;
 * ignores every other URL; rejects if nothing arrives before the deadline.
 * Listeners and timers are torn down on any outcome so a later attempt cannot
 * cross-wire this one.
 */
const awaitRedirectWithFallback = (
  scheme: string,
  authUrlReady: Promise<string>,
  deps: DesktopDeepLinkDeps,
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    let unlisten: (() => void) | undefined;
    let settled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const cleanup = () => {
      timers.forEach(clearTimeout);
      unlisten?.();
    };
    const finish = (url: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(url);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    deps
      .subscribeRedirects((url) => {
        if (matchesReverseDnsRedirect(url, scheme)) finish(url);
      })
      .then((dispose) => {
        unlisten = dispose;
        // The redirect can land before `subscribeRedirects` resolves its
        // unlisten; dispose immediately if so to avoid leaking the listener.
        if (settled) dispose();
      })
      .catch(fail);

    // Fallback: the user's default browser may have started before the app
    // registered the scheme, so it can't route the redirect. After a grace
    // period, open consent again in a freshly-spawned (cold) browser process,
    // which CAN route it back. The original listeners stay armed, so whichever
    // browser returns first wins. A fallback failure (e.g. Edge absent) is
    // logged, not fatal — the deadline below still bounds the wait.
    timers.push(
      setTimeout(() => {
        authUrlReady
          .then((authUrl) => deps.spawnFreshBrowser(authUrl))
          .catch((error) => console.warn('Drive sync: cold-browser fallback failed', error));
      }, deps.fallbackDelayMs),
    );

    // Hard deadline so an abandoned sign-in rejects and clears the UI spinner.
    timers.push(
      setTimeout(
        () => fail(new Error('Google sign-in did not complete in time')),
        deps.connectDeadlineMs,
      ),
    );
  });

/**
 * Run the desktop reverse-DNS deep-link OAuth flow and return the resulting
 * tokens. Wires {@link runOAuthFlow} with the desktop mechanics: open consent in
 * the default browser and resolve with the redirect the OS routes back, falling
 * back to a cold browser if the default one cannot route it.
 *
 * @param config - OAuth client identity + scopes (the iOS-type client, no secret).
 * @param fetchFn - platform `fetch` used for the token exchange.
 * @param deps - injected platform mechanics; defaults to the real Tauri wiring.
 */
export const runDesktopDeepLinkOAuth = (
  config: OAuthClientConfig,
  fetchFn: FetchFn,
  deps: DesktopDeepLinkDeps = defaultDesktopDeepLinkDeps,
): Promise<TokenSet> => {
  const redirectUri = deriveReverseDnsRedirectUri(config.clientId);
  const scheme = deriveReverseDnsRedirectScheme(config.clientId);

  // The cold-browser fallback needs the consent URL, which `runOAuthFlow` only
  // hands to `openUrl`. Bridge the two with a deferred: `openUrl` supplies the
  // URL, the fallback awaits it.
  let provideAuthUrl!: (url: string) => void;
  const authUrlReady = new Promise<string>((resolve) => {
    provideAuthUrl = resolve;
  });

  return runOAuthFlow(config.scope, {
    createPkcePair,
    newState: () => crypto.randomUUID(),
    clientId: config.clientId,
    openUrl: async (url) => {
      provideAuthUrl(url);
      await deps.openDefaultBrowser(url);
    },
    awaitRedirect: () => awaitRedirectWithFallback(scheme, authUrlReady, deps),
    redirectUri,
    exchange: ({ code, verifier, redirectUri: uri }) =>
      exchangeCode({ code, verifier, clientId: config.clientId, redirectUri: uri }, fetchFn),
  });
};
