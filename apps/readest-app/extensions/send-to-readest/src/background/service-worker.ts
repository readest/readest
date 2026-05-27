/**
 * Send to Readest — background service worker. Orchestrates the clip:
 *
 *   popup → SW: `send-to-readest:clip` (with tabId)
 *   SW: injects `content/capture.js` into the active tab. The content
 *       script opens a long-lived Port back to the SW — that keeps the
 *       SW alive through the whole capture and gives us a clear
 *       `onDisconnect` if the inject silently fails.
 *   content script: snapshots `document.documentElement.outerHTML` and
 *       sends it on the Port.
 *   SW: hands the snapshot to the shared `convertPageToEpub` in
 *       `src/services/send/conversion/` — Readability, per-site rule
 *       fast-paths, asset bundling, cover generation, headings → TOC,
 *       and the EPUB build all happen there. Same code path the
 *       desktop / mobile `/send` URL clipping flow uses, so the EPUBs
 *       are byte-identical for the same URL.
 *   SW: POSTs the resulting EPUB to /api/send/inbox/file.
 *   SW → popup: `send-to-readest:progress` broadcasts at each phase.
 */

import type {
  ClipErrorCode,
  ClipProgress,
  ClipRequest,
  PageSnapshot,
  StatusRequest,
  StatusResponse,
} from '../lib/messages';
import { readToken } from '../lib/auth';
import { translate as _ } from '../lib/i18n';
import { setBadge } from './badge';
import { clipAndUploadViaOffscreen } from './offscreen';

const LOG = '[send-to-readest/sw]';

interface State {
  inFlight: boolean;
  lastProgress: ClipProgress | null;
}

const state: State = { inFlight: false, lastProgress: null };

function broadcast(progress: ClipProgress): void {
  state.lastProgress = progress;
  chrome.runtime.sendMessage({ type: 'send-to-readest:progress', progress }).catch(() => undefined);
}

function emitError(code: ClipErrorCode, message: string): void {
  console.warn(LOG, 'clip error', { code, message });
  setBadge('err');
  broadcast({ phase: 'error', code, message });
  state.inFlight = false;
}

interface CaptureResult {
  snapshot: PageSnapshot | null;
  reason?: string;
}

interface PendingCapture {
  resolve: (result: CaptureResult) => void;
}

const CAPTURE_PORT_NAME = 'send-to-readest:capture';
const CAPTURE_HARD_TIMEOUT_MS = 25_000;
const PORT_CONNECT_GRACE_MS = 4_000;
const pendingByTab = new Map<number, PendingCapture>();

async function injectCapture(tabId: number): Promise<CaptureResult> {
  const waitForResult = new Promise<CaptureResult>((resolve) => {
    let settled = false;
    const finish = (result: CaptureResult): void => {
      if (settled) return;
      settled = true;
      pendingByTab.delete(tabId);
      resolve(result);
    };
    pendingByTab.set(tabId, { resolve: finish });
    setTimeout(() => finish({ snapshot: null, reason: 'hard-timeout' }), CAPTURE_HARD_TIMEOUT_MS);
    setTimeout(() => {
      const pending = pendingByTab.get(tabId);
      if (pending && !settled) {
        console.warn(
          LOG,
          'no port connected after grace window — the content script likely failed to inject',
          { tabId, graceMs: PORT_CONNECT_GRACE_MS },
        );
      }
    }, PORT_CONNECT_GRACE_MS);
  });

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ['content/capture.js'],
      world: 'ISOLATED',
    });
  } catch (err) {
    pendingByTab.delete(tabId);
    console.warn(LOG, 'capture script inject failed', err);
    throw new Error(
      `Could not inject capture script: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return waitForResult;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== CAPTURE_PORT_NAME) return;
  const tabId = port.sender?.tab?.id;
  if (typeof tabId !== 'number') {
    console.warn(LOG, 'capture port with no tab.id; closing');
    port.disconnect();
    return;
  }

  let received = false;
  port.onMessage.addListener((msg: unknown) => {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as { snapshot?: PageSnapshot | null; reason?: string };
    received = true;
    const pending = pendingByTab.get(tabId);
    if (pending) {
      pending.resolve({ snapshot: m.snapshot ?? null, reason: m.reason });
    }
  });
  port.onDisconnect.addListener(() => {
    if (!received) {
      const pending = pendingByTab.get(tabId);
      if (pending) pending.resolve({ snapshot: null, reason: 'port-disconnect' });
    }
  });
});

async function runClip(tabId: number): Promise<void> {
  if (state.inFlight) return;
  state.inFlight = true;

  try {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !tab.url) return emitError('no-active-tab', _('No active tab'));
    if (!/^https?:/i.test(tab.url)) {
      return emitError('restricted-page', _('This page cannot be clipped'));
    }

    const stored = await readToken();
    if (!stored) {
      return emitError('not-signed-in', _('Sign in at web.readest.com first'));
    }

    setBadge('cap');
    broadcast({ phase: 'capturing' });

    let captureResult: CaptureResult;
    try {
      captureResult = await injectCapture(tabId);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return emitError(
        'capture-failed',
        _('Could not inject capture script: {reason}', { reason }),
      );
    }
    const snapshot = captureResult.snapshot;
    if (!snapshot) {
      const why = captureResult.reason;
      const friendly =
        why === 'hard-timeout'
          ? _('Page took too long to read')
          : why === 'port-disconnect'
            ? _('Capture script could not start on this page')
            : _("Couldn't read this page");
      return emitError('no-readable-content', friendly);
    }

    // Convert + upload happen together in the offscreen document — the
    // EPUB bytes never cross the SW↔offscreen boundary so they can't be
    // mangled by runtime.sendMessage's JSON-serialization fallback. The
    // SW only sees a small JSON result.
    setBadge('epub');
    broadcast({ phase: 'converting' });

    let outcome;
    try {
      outcome = await clipAndUploadViaOffscreen({
        html: snapshot.html,
        url: snapshot.sourceUrl,
        token: stored.token,
        pageTitle: snapshot.pageTitle,
      });
    } catch (err) {
      return emitError('unknown', err instanceof Error ? err.message : _('Unknown error'));
    }
    if (!outcome.ok) {
      return emitError(outcome.failure.code, outcome.failure.message);
    }

    setBadge('ok');
    setTimeout(() => setBadge('clear'), 5_000);
    broadcast({ phase: 'done' });
  } finally {
    state.inFlight = false;
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse): boolean => {
  if (!message || typeof message !== 'object') return false;
  const m = message as { type?: string };

  if (m.type === 'send-to-readest:clip') {
    const { tabId } = message as ClipRequest;
    runClip(tabId).catch((err) =>
      emitError('unknown', err instanceof Error ? err.message : _('Unknown error')),
    );
    sendResponse({ accepted: true });
    return true;
  }

  if (m.type === 'send-to-readest:status') {
    void (async (): Promise<void> => {
      const token = await readToken();
      const response: StatusResponse = {
        signedIn: token !== null,
        inFlight: state.inFlight,
        lastProgress: state.lastProgress,
      };
      sendResponse(response);
    })();
    void (message as StatusRequest);
    return true;
  }

  return false;
});
