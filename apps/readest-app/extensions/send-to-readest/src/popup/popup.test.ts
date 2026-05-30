import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  installChromeMock,
  uninstallChromeMock,
  type ChromeMock,
} from '../__test-utils__/chromeMock';
import type { ClipProgress, StatusResponse } from '../lib/messages';

/**
 * `popup.ts` runs `init()` synchronously at module load — it queries
 * tabs, asks the SW for status, and grabs DOM nodes by id. We re-build
 * the DOM scaffold before each test and `vi.resetModules()` so each
 * case sees a fresh popup wiring.
 */

const POPUP_DOM = `
  <header>
    <h1>Send to Readest</h1>
    <span id="auth-badge" class="signed-out-badge hidden">Signed out</span>
  </header>
  <section id="signed-in-view">
    <div class="page">
      <p id="page-title" class="page-title">Loading…</p>
      <p id="page-url" class="page-url"></p>
    </div>
    <button id="send" class="primary" disabled>Send to Readest</button>
    <div id="progress" class="progress">
      <div class="progress-label" id="progress-label">Preparing…</div>
      <div class="progress-bar indeterminate"><div class="progress-bar-fill"></div></div>
    </div>
    <p id="status" class="status"></p>
  </section>
  <section id="signed-out-view" class="sign-in hidden">
    <p>Sign in to Readest to start clipping pages.</p>
    <button id="open-readest" class="primary">Open web.readest.com</button>
  </section>
`;

let chromeMock: ChromeMock;
let progressHandler: ((message: unknown) => void) | null = null;

function setStatus(overrides: Partial<StatusResponse> = {}): void {
  chromeMock.runtime.sendMessage.mockImplementation(async (msg: unknown) => {
    if (
      msg &&
      typeof msg === 'object' &&
      (msg as { type?: string }).type === 'send-to-readest:status'
    ) {
      return {
        signedIn: true,
        inFlight: false,
        lastProgress: null,
        ...overrides,
      } satisfies StatusResponse;
    }
    return undefined;
  });
}

beforeEach(() => {
  document.body.innerHTML = POPUP_DOM;
  chromeMock = installChromeMock();
  chromeMock.tabs.query.mockResolvedValue([
    { id: 7, url: 'https://example.com/article', title: 'Hello Article' },
  ] as unknown as chrome.tabs.Tab[]);
  setStatus();
  progressHandler = null;
  chromeMock.runtime.onMessage.addListener.mockImplementation((handler: (m: unknown) => void) => {
    progressHandler = handler;
  });
  vi.resetModules();
});

afterEach(() => {
  uninstallChromeMock();
  document.body.innerHTML = '';
});

async function loadPopup(): Promise<void> {
  await import('./popup');
  // init() is async; let its promise chain settle before assertions.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function pushProgress(progress: ClipProgress): void {
  if (!progressHandler) throw new Error('progress handler never registered');
  progressHandler({ type: 'send-to-readest:progress', progress });
}

describe('popup — initial render', () => {
  test('renders the active tab title + url and enables Send when signed in', async () => {
    await loadPopup();

    expect(document.getElementById('page-title')?.textContent).toBe('Hello Article');
    expect(document.getElementById('page-url')?.textContent).toBe('https://example.com/article');
    expect(document.getElementById('signed-in-view')?.classList.contains('hidden')).toBe(false);
    expect((document.getElementById('send') as HTMLButtonElement).disabled).toBe(false);
  });

  test('routes to the signed-out view when the SW reports no token', async () => {
    setStatus({ signedIn: false });
    await loadPopup();

    expect(document.getElementById('signed-in-view')?.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('signed-out-view')?.classList.contains('hidden')).toBe(false);
  });

  test('refuses to clip non-http URLs', async () => {
    chromeMock.tabs.query.mockResolvedValue([
      { id: 1, url: 'chrome://extensions', title: 'Extensions' },
    ] as unknown as chrome.tabs.Tab[]);
    await loadPopup();
    expect(document.getElementById('page-title')?.textContent).toBe('This page cannot be clipped');
    expect((document.getElementById('send') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('popup — render(progress)', () => {
  test('"capturing" disables Send and shows the reading label', async () => {
    await loadPopup();
    pushProgress({ phase: 'capturing' });
    expect(document.getElementById('progress-label')?.textContent).toBe('Reading page…');
    expect((document.getElementById('send') as HTMLButtonElement).disabled).toBe(true);
    expect(document.getElementById('progress')?.classList.contains('show')).toBe(true);
  });

  test('"converting" shows the EPUB-build label', async () => {
    await loadPopup();
    pushProgress({ phase: 'converting' });
    expect(document.getElementById('progress-label')?.textContent).toBe('Building EPUB…');
  });

  test('"uploading" shows the send-to-Readest label', async () => {
    await loadPopup();
    pushProgress({ phase: 'uploading' });
    expect(document.getElementById('progress-label')?.textContent).toBe('Sending to Readest…');
  });

  test('"done" hides progress, re-enables Send, shows success status', async () => {
    await loadPopup();
    pushProgress({ phase: 'done' });
    expect(document.getElementById('progress')?.classList.contains('show')).toBe(false);
    expect((document.getElementById('send') as HTMLButtonElement).disabled).toBe(false);
    const status = document.getElementById('status')!;
    expect(status.classList.contains('ok')).toBe(true);
    expect(status.textContent).toContain('Sent');
  });

  test('"done" with missingAssets surfaces the image-fetch failure count', async () => {
    await loadPopup();
    pushProgress({ phase: 'done', missingAssets: 3 });
    expect(document.getElementById('status')?.textContent).toContain(
      '3 images could not be fetched',
    );
  });

  test('"done" with a single missing asset uses singular grammar', async () => {
    await loadPopup();
    pushProgress({ phase: 'done', missingAssets: 1 });
    expect(document.getElementById('status')?.textContent).toContain(
      '1 image could not be fetched',
    );
  });

  test('"error" surfaces the message and re-enables Send', async () => {
    await loadPopup();
    pushProgress({ phase: 'error', code: 'server-error', message: 'Server returned 500' });
    expect((document.getElementById('send') as HTMLButtonElement).disabled).toBe(false);
    expect(document.getElementById('status')?.classList.contains('err')).toBe(true);
    expect(document.getElementById('status')?.textContent).toBe('Server returned 500');
  });

  test('"error" with session-expired flips to the signed-out view', async () => {
    await loadPopup();
    pushProgress({ phase: 'error', code: 'session-expired', message: 'Session expired' });
    expect(document.getElementById('signed-in-view')?.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('signed-out-view')?.classList.contains('hidden')).toBe(false);
  });
});

describe('popup — Send button', () => {
  test('clicking Send dispatches a clip request with the active tabId', async () => {
    await loadPopup();
    chromeMock.runtime.sendMessage.mockClear();
    document.getElementById('send')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const clipCall = chromeMock.runtime.sendMessage.mock.calls.find((c) => {
      const m = c[0] as { type?: string };
      return m?.type === 'send-to-readest:clip';
    });
    expect(clipCall).toBeDefined();
    expect(clipCall![0]).toEqual({ type: 'send-to-readest:clip', tabId: 7 });
  });
});
