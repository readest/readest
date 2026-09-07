/**
 * Consume-once bookkeeping for URLs the OS hands the app (#6104).
 *
 * `tauri-plugin-deep-link` never clears the URL it stores, so `getCurrent()`
 * keeps returning it for the whole process: macOS/iOS replace it on every
 * `RunEvent::Opened`, Windows/Linux in `handle_cli_arguments`, Android in
 * `load()` from the sticky `activity.intent`. Every fresh document re-reads it
 * as its own cold start — a reader window the app spawned, an Android Activity
 * the OS recreated, an iOS WebContent process WebKit recycled — and the guards
 * that used to stop that (a module flag, a sessionStorage key) all die with
 * the document.
 *
 * So the marker has to outlive the document but still expire on a genuine
 * relaunch, or opening the same bookmark twice in a row would do nothing the
 * second time. The Rust init script mints `__READEST_APP_RUN_ID__` once per
 * process, which is exactly that lifetime; the marker lives in localStorage
 * keyed on it. Without the id (web build, older shell) fall back to
 * sessionStorage, the document-scoped behaviour this replaces.
 *
 * URLs are tracked as a per-run SET, not a last-seen value: `getCurrent()` can
 * replay the launch URL long after a different link was acted on, and a single
 * stamp would have been overwritten by then (A -> B -> A).
 */

declare global {
  interface Window {
    __READEST_APP_RUN_ID__?: string;
  }
}

/** Launch deliveries are rare; this only bounds a pathological run. */
const MAX_URLS_PER_SCOPE = 16;

interface LaunchUrlRecord {
  run: string;
  urls: string[];
}

const getAppRunId = () =>
  typeof window === 'undefined' ? '' : window.__READEST_APP_RUN_ID__ || '';

/**
 * Record that this app run acted on `url` under `scope`, returning whether it
 * is new to the run. A cold-start read must skip a URL that is not new; a live
 * delivery is always processed but still recorded, so that a document reload
 * re-reporting it through `getCurrent()` is recognised as a replay.
 */
export const markLaunchUrl = (scope: string, url: string) => {
  try {
    const run = getAppRunId();
    const store = run ? localStorage : sessionStorage;
    let record: LaunchUrlRecord | null = null;
    try {
      record = JSON.parse(store.getItem(scope) || 'null');
    } catch {
      // Unreadable marker - treat as absent.
    }
    const urls = record?.run === run && Array.isArray(record.urls) ? record.urls : [];
    if (urls.includes(url)) return false;
    urls.push(url);
    store.setItem(scope, JSON.stringify({ run, urls: urls.slice(-MAX_URLS_PER_SCOPE) }));
  } catch {
    // Storage unavailable (private mode, blocked site data) - better to open
    // the book twice than to never open it.
  }
  return true;
};
