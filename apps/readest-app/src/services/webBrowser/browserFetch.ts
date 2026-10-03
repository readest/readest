import { invoke } from '@tauri-apps/api/core';

interface BrowserResource {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

/** Native GET using the browser's persistent cookie store. Cookies never cross IPC. */
export async function browserFetch(url: string, init?: RequestInit): Promise<Response> {
  const signal = init?.signal;
  signal?.throwIfAborted();
  const resource = await new Promise<BrowserResource>((resolve, reject) => {
    const abort = () => reject(new DOMException('Request cancelled', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    invoke<BrowserResource>('fetch_web_browser_resource', {
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    })
      .then(resolve, reject)
      .finally(() => signal?.removeEventListener('abort', abort));
  });
  signal?.throwIfAborted();
  const bytes = Uint8Array.from(atob(resource.body), (c) => c.charCodeAt(0));
  const response = new Response([204, 205, 304].includes(resource.status) ? null : bytes, {
    status: resource.status,
    headers: { 'content-type': resource.contentType },
  });
  Object.defineProperty(response, 'url', { value: resource.url });
  return response;
}
