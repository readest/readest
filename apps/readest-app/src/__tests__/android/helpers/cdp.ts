import http from 'node:http';
import { adbShell, forwardTcpToLocalAbstract } from './adb';

// The Android WebView exposes a Chrome DevTools endpoint on the abstract unix
// socket `webview_devtools_remote_<pid>` whenever remote debugging is enabled.
// We adb-forward it to a host TCP port and drive the page with the CDP
// Runtime domain. NOTE: the WebView's HTTP framing confuses curl — use
// node:http with an explicit `Host: localhost` header.

export interface CdpTarget {
  id: string;
  url: string;
  title: string;
  type: string;
}

const httpGetJson = (port: number, path: string): Promise<CdpTarget[]> =>
  new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path, headers: { Host: 'localhost' } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error(`timeout GET ${path}`)));
  });

export const forwardWebViewDevtools = async (pkg: string, port: number): Promise<void> => {
  const pid = (await adbShell(`pidof ${pkg}`)).trim().split(/\s+/)[0];
  if (!pid) throw new Error(`${pkg} is not running`);
  const sockets = await adbShell('cat /proc/net/unix');
  const name = `webview_devtools_remote_${pid}`;
  if (!sockets.includes(`@${name}`)) {
    throw new Error(`no devtools socket ${name}; is WebView debugging enabled?`);
  }
  await forwardTcpToLocalAbstract(port, name);
};

export const listPages = (port: number): Promise<CdpTarget[]> => httpGetJson(port, '/json/list');

interface CdpResponse {
  id?: number;
  error?: { message?: string };
  result?: {
    result?: { value?: unknown };
    exceptionDetails?: { exception?: { description?: string }; text?: string };
  };
}

export class CdpPage {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: CdpResponse) => void; reject: (e: Error) => void }
  >();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data)) as CdpResponse;
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message ?? 'CDP error'));
        else resolve(msg);
      }
    });
  }

  static async connect(port: number, pageId: string): Promise<CdpPage> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${pageId}`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error('CDP websocket failed to connect')));
    });
    const page = new CdpPage(ws);
    await page.send('Runtime.enable');
    return page;
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<CdpResponse> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Run `body` as the body of an async IIFE in the page and return its
   * (JSON-serializable) return value.
   */
  async evaluate<T>(body: string): Promise<T> {
    const res = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${body} })()`,
      awaitPromise: true,
      returnByValue: true,
      timeout: 30_000,
    });
    const details = res.result?.exceptionDetails;
    if (details) {
      throw new Error(
        `page evaluate threw: ${details.exception?.description ?? details.text ?? 'unknown'}`,
      );
    }
    return res.result?.result?.value as T;
  }

  /**
   * Touch double-tap through the WebView's own input pipeline (gesture
   * recognition and click synthesis included). adb `input tap` spawns a whole
   * Java process per tap — 300ms to 1s on a loaded CI emulator — so two adb
   * taps cannot reliably land inside the app's 250ms double-click window.
   * A single tapCount:2 gesture is timed inside the renderer (measured click
   * gap ~200ms on a busy emulator); two separate synthesizeTapGesture
   * commands are too slow, since each resolves long after its gesture.
   * Coordinates are CSS pixels.
   */
  async doubleTap(cssX: number, cssY: number): Promise<void> {
    await this.send('Input.synthesizeTapGesture', {
      x: cssX,
      y: cssY,
      tapCount: 2,
      duration: 20,
      gestureSourceType: 'touch',
    });
  }

  close(): void {
    this.ws.close();
  }
}
