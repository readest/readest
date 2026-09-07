/**
 * Consume-once bookkeeping for the URL the app was launched with (#6104).
 *
 * The OS hands that URL over and then keeps handing it back:
 *   - `tauri-plugin-deep-link` never clears its stored URL, so `getCurrent()`
 *     returns it for the whole process (macOS replaces it on every
 *     `RunEvent::Opened`, Windows/Linux in `handle_cli_arguments`);
 *   - Android's `activity.intent` is sticky, so `DeepLinkPlugin.load()`
 *     re-reads it and re-emits it as a *fresh* delivery every time the OS
 *     recreates the Activity (resume after a kill, rotation, theme flip);
 *   - iOS reloads the document from scratch when WebKit recycles the
 *     WebContent process.
 *
 * So the marker has to outlive the document — module state and sessionStorage
 * both die with it — while still expiring on a genuine relaunch, or opening
 * the same bookmark twice in a row would do nothing the second time. The Rust
 * init script mints `__READEST_APP_RUN_ID__` once per process, which is
 * exactly that lifetime; keying localStorage on it gives a marker scoped to
 * the app run. Without the id (web build, older shell) fall back to
 * sessionStorage, which is the document-scoped behaviour this replaces.
 */

declare global {
  interface Window {
    __READEST_APP_RUN_ID__?: string;
  }
}

/**
 * A live delivery arriving this soon after the document loaded is the launch
 * URL being replayed at startup, not a user acting on a link: the tap that
 * would deliver a URL is also what starts the app, so anything this early is
 * the launch itself. Generous, because a slow Android boot delays the replay.
 */
const LAUNCH_REPLAY_WINDOW_MS = 10_000;

const documentLoadedAt = Date.now();

const getAppRunId = () =>
  typeof window === 'undefined' ? '' : window.__READEST_APP_RUN_ID__ || '';

/** Whether a live `app-incoming-url` delivery is really a launch-URL replay. */
export const isLaunchReplayWindow = () => Date.now() - documentLoadedAt < LAUNCH_REPLAY_WINDOW_MS;

/**
 * Claim `url` for `scope`, returning false when this app run already acted on
 * it. One key per scope: the run id travels in the value, so a new run's stamp
 * simply differs instead of leaving stale keys behind.
 */
export const consumeLaunchUrl = (scope: string, url: string) => {
  try {
    const runId = getAppRunId();
    const store = runId ? localStorage : sessionStorage;
    const stamp = `${runId}\n${url}`;
    if (store.getItem(scope) === stamp) return false;
    store.setItem(scope, stamp);
  } catch {
    // Storage unavailable (private mode, blocked site data) - better to open
    // the book twice than to never open it.
  }
  return true;
};
