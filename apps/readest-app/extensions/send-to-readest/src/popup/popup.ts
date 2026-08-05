/**
 * Popup UI. Thin presentation layer over the service worker — the SW owns
 * all state and the popup re-renders on every progress broadcast.
 *
 * The popup may close at any moment (Chrome auto-dismisses on focus loss),
 * so we never persist work here. On re-open we ask the SW for the current
 * status and render whatever phase it's in.
 */

import type { ClipProgress, ClipRequest, StatusRequest, StatusResponse } from '../lib/messages';
import { localizeDom, translate as _ } from '../lib/i18n';
import {
  extensionSettingsUrl,
  hasFileSchemeAccess,
  isClippableUrl,
  isLocalFileUrl,
} from '../lib/localPage';

const LOGIN_URL = 'https://web.readest.com/';

localizeDom();

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

const signedInView = $('signed-in-view');
const signedOutView = $('signed-out-view');
const authBadge = $('auth-badge');
const pageTitle = $('page-title');
const pageUrl = $('page-url');
const sendBtn = $<HTMLButtonElement>('send');
const openReadestBtn = $<HTMLButtonElement>('open-readest');
const enableFileAccessBtn = $<HTMLButtonElement>('enable-file-access');
const progressEl = $('progress');
const progressLabel = $('progress-label');
const progressBar = progressEl.querySelector('.progress-bar') as HTMLDivElement;
const progressFill = progressEl.querySelector('.progress-bar-fill') as HTMLDivElement;
const statusEl = $('status');

let currentTabId: number | null = null;

function setStatus(message: string, kind?: 'ok' | 'err'): void {
  statusEl.textContent = message;
  statusEl.className = `status ${kind ?? ''}`.trim();
}

function showProgress(label: string, determinate?: { done: number; total: number }): void {
  progressEl.classList.add('show');
  progressLabel.textContent = label;
  if (determinate && determinate.total > 0) {
    progressBar.classList.remove('indeterminate');
    progressFill.style.width = `${Math.round((determinate.done / determinate.total) * 100)}%`;
  } else {
    progressBar.classList.add('indeterminate');
    progressFill.style.width = '';
  }
}

function hideProgress(): void {
  progressEl.classList.remove('show');
}

function render(progress: ClipProgress | null): void {
  switch (progress?.phase) {
    case 'capturing':
      sendBtn.disabled = true;
      showProgress(_('Reading page…'));
      setStatus('');
      break;
    case 'converting':
      sendBtn.disabled = true;
      showProgress(_('Building EPUB…'));
      setStatus('');
      break;
    case 'uploading':
      sendBtn.disabled = true;
      showProgress(_('Sending to Readest…'));
      setStatus('');
      break;
    case 'done':
      sendBtn.disabled = false;
      hideProgress();
      setStatus(doneMessage(progress.missingAssets ?? 0), 'ok');
      break;
    case 'error':
      sendBtn.disabled = false;
      hideProgress();
      setStatus(progress.message, 'err');
      if (progress.code === 'session-expired' || progress.code === 'not-signed-in') {
        showSignedOut();
      }
      break;
    default:
      sendBtn.disabled = false;
      hideProgress();
      setStatus('');
  }
}

function doneMessage(missing: number): string {
  if (missing <= 0) return _('Saved to your library.');
  if (missing === 1) return _('Sent. 1 image could not be fetched.');
  return _('Sent. {count} images could not be fetched.', { count: missing });
}

function showSignedOut(): void {
  signedInView.classList.add('hidden');
  signedOutView.classList.remove('hidden');
  authBadge.classList.add('hidden');
}

function showSignedIn(): void {
  signedInView.classList.remove('hidden');
  signedOutView.classList.add('hidden');
  authBadge.classList.add('hidden');
}

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) currentTabId = tab.id ?? null;

  if (!tab || !isClippableUrl(tab.url)) {
    pageTitle.textContent = _('This page cannot be clipped');
    pageUrl.textContent = '';
    sendBtn.disabled = true;
    return;
  }

  const url = tab.url;
  pageTitle.textContent = tab.title || url;
  pageUrl.textContent = url;

  const status = await chrome.runtime.sendMessage<StatusRequest, StatusResponse>({
    type: 'send-to-readest:status',
  });

  if (!status.signedIn) {
    showSignedOut();
    return;
  }

  showSignedIn();

  // A local page needs "Allow access to file URLs" on top of the extension's
  // host permissions. Ask for it up front — otherwise the clip dies deep in
  // `chrome.scripting.executeScript` with an unreadable permission error.
  if (isLocalFileUrl(url) && !(await hasFileSchemeAccess())) {
    sendBtn.disabled = true;
    enableFileAccessBtn.classList.remove('hidden');
    setStatus(_('Readest needs permission to read local files.'));
    return;
  }

  if (status.inFlight || status.lastProgress) {
    render(status.lastProgress);
  } else {
    sendBtn.disabled = false;
  }
}

sendBtn.addEventListener('click', async () => {
  if (currentTabId === null) return;
  sendBtn.disabled = true;
  showProgress(_('Starting…'));
  const request: ClipRequest = { type: 'send-to-readest:clip', tabId: currentTabId };
  await chrome.runtime.sendMessage(request).catch(() => undefined);
});

openReadestBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: LOGIN_URL });
});

enableFileAccessBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: extensionSettingsUrl() });
});

chrome.runtime.onMessage.addListener((message: unknown): void => {
  if (!message || typeof message !== 'object') return;
  const m = message as { type?: string; progress?: ClipProgress };
  if (m.type === 'send-to-readest:progress' && m.progress) {
    render(m.progress);
  }
});

init().catch((err: unknown) => {
  setStatus(err instanceof Error ? err.message : String(err), 'err');
});
