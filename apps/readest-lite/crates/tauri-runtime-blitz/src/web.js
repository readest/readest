// Web APIs a Tauri page needs that blitz-qjs-script's bootstrap.js does not provide: fetch (to the
// webview's custom-scheme handlers, which is how Tauri's IPC and asset protocols are reached),
// Headers/Request/Response, URL/URLSearchParams, TextEncoder/TextDecoder, crypto.getRandomValues,
// structuredClone, and window.ipc.postMessage. Rust ops live on `__tauri` (webview.rs).
(() => {
  const t = globalThis.__tauri;
  const define = (o, props) => {
    for (const [k, v] of Object.entries(props))
      Object.defineProperty(o, k, { value: v, writable: true, configurable: true });
  };

  class TextEncoder {
    get encoding() {
      return 'utf-8';
    }
    encode(s = '') {
      return new Uint8Array(t.utf8Encode(String(s)));
    }
  }
  class TextDecoder {
    constructor(label = 'utf-8') {
      this.encoding = String(label).toLowerCase();
    }
    decode(buf) {
      if (buf === undefined) return '';
      const ab = ArrayBuffer.isView(buf)
        ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        : buf;
      return t.utf8Decode(ab);
    }
  }

  class URLSearchParams {
    constructor(init = '') {
      this._list = [];
      if (typeof init === 'string') {
        for (const part of init.replace(/^\?/, '').split('&')) {
          if (!part) continue;
          const i = part.indexOf('=');
          const dec = (s) => decodeURIComponent(s.replace(/\+/g, ' '));
          this._list.push(
            i < 0 ? [dec(part), ''] : [dec(part.slice(0, i)), dec(part.slice(i + 1))],
          );
        }
      } else if (init) {
        for (const [k, v] of Symbol.iterator in init ? init : Object.entries(init))
          this._list.push([String(k), String(v)]);
      }
    }
    get(k) {
      const e = this._list.find(([n]) => n === k);
      return e ? e[1] : null;
    }
    getAll(k) {
      return this._list.filter(([n]) => n === k).map(([, v]) => v);
    }
    has(k) {
      return this._list.some(([n]) => n === k);
    }
    set(k, v) {
      this.delete(k);
      this._list.push([k, String(v)]);
    }
    append(k, v) {
      this._list.push([k, String(v)]);
    }
    delete(k) {
      this._list = this._list.filter(([n]) => n !== k);
    }
    forEach(f, self) {
      for (const [k, v] of this._list) f.call(self, v, k, this);
    }
    entries() {
      return this._list[Symbol.iterator]();
    }
    keys() {
      return this._list.map(([k]) => k)[Symbol.iterator]();
    }
    values() {
      return this._list.map(([, v]) => v)[Symbol.iterator]();
    }
    [Symbol.iterator]() {
      return this.entries();
    }
    toString() {
      return this._list
        .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
        .join('&');
    }
  }

  const URL_PARTS = [
    'href',
    'protocol',
    'username',
    'password',
    'host',
    'hostname',
    'port',
    'pathname',
    'search',
    'hash',
    'origin',
  ];
  class URL {
    constructor(href, base) {
      const p = t.parseUrl(String(href), base === undefined ? null : String(base));
      if (!p) throw new TypeError(`Invalid URL: ${href}`);
      URL_PARTS.forEach((k, i) => {
        this['_' + k] = p[i];
      });
    }
    static canParse(href, base) {
      return !!t.parseUrl(String(href), base === undefined ? null : String(base));
    }
    get searchParams() {
      return new URLSearchParams(this._search);
    }
    toString() {
      return this._href;
    }
    toJSON() {
      return this._href;
    }
  }
  for (const k of URL_PARTS)
    Object.defineProperty(URL.prototype, k, {
      get() {
        return this['_' + k];
      },
    });

  class Headers {
    constructor(init) {
      this._map = new Map();
      if (init instanceof Headers) init.forEach((v, k) => this.append(k, v));
      else if (Array.isArray(init)) for (const [k, v] of init) this.append(k, v);
      else if (init) for (const k of Object.keys(init)) this.append(k, init[k]);
    }
    append(k, v) {
      k = String(k).toLowerCase();
      const o = this._map.get(k);
      this._map.set(k, o === undefined ? String(v) : o + ', ' + v);
    }
    set(k, v) {
      this._map.set(String(k).toLowerCase(), String(v));
    }
    get(k) {
      const v = this._map.get(String(k).toLowerCase());
      return v === undefined ? null : v;
    }
    has(k) {
      return this._map.has(String(k).toLowerCase());
    }
    delete(k) {
      this._map.delete(String(k).toLowerCase());
    }
    forEach(f, self) {
      for (const [k, v] of this._map) f.call(self, v, k, this);
    }
    entries() {
      return this._map.entries();
    }
    keys() {
      return this._map.keys();
    }
    values() {
      return this._map.values();
    }
    [Symbol.iterator]() {
      return this._map.entries();
    }
  }

  // Blob/File over one ArrayBuffer.
  const partBytes = (p) => {
    if (p instanceof Blob) return new Uint8Array(p._buf);
    if (p instanceof ArrayBuffer) return new Uint8Array(p);
    if (ArrayBuffer.isView(p)) return new Uint8Array(p.buffer, p.byteOffset, p.byteLength);
    return new Uint8Array(t.utf8Encode(String(p)));
  };
  class Blob {
    constructor(parts = [], opts = {}) {
      const bytes = [...parts].map(partBytes);
      const all = new Uint8Array(bytes.reduce((n, b) => n + b.length, 0));
      let o = 0;
      for (const b of bytes) {
        all.set(b, o);
        o += b.length;
      }
      this._buf = all.buffer;
      this.type = String(opts.type || '').toLowerCase();
    }
    get size() {
      return this._buf.byteLength;
    }
    slice(a = 0, b = this.size, type = '') {
      return new Blob([this._buf.slice(a, b)], { type });
    }
    arrayBuffer() {
      return Promise.resolve(this._buf.slice(0));
    }
    bytes() {
      return Promise.resolve(new Uint8Array(this._buf.slice(0)));
    }
    text() {
      return Promise.resolve(t.utf8Decode(this._buf));
    }
  }
  class File extends Blob {
    constructor(parts, name, opts = {}) {
      super(parts, opts);
      this.name = String(name);
      this.lastModified = opts.lastModified ?? Date.now();
    }
  }

  const toBuffer = (body) => {
    if (body === undefined || body === null) return null;
    if (typeof body === 'string') return t.utf8Encode(body);
    if (body instanceof Blob) return body._buf.slice(0);
    if (body instanceof ArrayBuffer) return body;
    if (ArrayBuffer.isView(body))
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    if (body instanceof URLSearchParams) return t.utf8Encode(body.toString());
    return t.utf8Encode(String(body));
  };

  class Response {
    constructor(body = null, init = {}) {
      this._buf = toBuffer(body) || new ArrayBuffer(0);
      this.status = init.status === undefined ? 200 : init.status;
      this.statusText = init.statusText || '';
      this.headers = new Headers(init.headers);
      this.ok = this.status >= 200 && this.status < 300;
      this.url = init.url || '';
      this.bodyUsed = false;
    }
    arrayBuffer() {
      this.bodyUsed = true;
      return Promise.resolve(this._buf);
    }
    text() {
      this.bodyUsed = true;
      return Promise.resolve(t.utf8Decode(this._buf));
    }
    json() {
      return this.text().then(JSON.parse);
    }
    blob() {
      this.bodyUsed = true;
      return Promise.resolve(
        new Blob([this._buf], { type: this.headers.get('content-type') || '' }),
      );
    }
    clone() {
      return new Response(this._buf.slice(0), {
        status: this.status,
        statusText: this.statusText,
        headers: this.headers,
        url: this.url,
      });
    }
  }

  class Request {
    constructor(input, init = {}) {
      this.url = input instanceof Request ? input.url : String(input);
      this.method = (
        init.method || (input instanceof Request ? input.method : 'GET')
      ).toUpperCase();
      this.headers = new Headers(
        init.headers || (input instanceof Request ? input.headers : undefined),
      );
      this.body =
        init.body === undefined ? (input instanceof Request ? input.body : null) : init.body;
      this.signal = init.signal || null;
    }
  }

  const pending = new Map();
  let nextId = 1;
  function fetch(input, init = {}) {
    const req = input instanceof Request && !init.method ? input : new Request(input, init);
    const url = new URL(req.url, location.href).href;
    const headers = [];
    req.headers.forEach((v, k) => headers.push(k, v));
    if (!req.headers.has('origin')) headers.push('origin', t.origin);
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, url });
      const err = t.fetch(id, url, req.method, headers, toBuffer(req.body));
      if (err) {
        pending.delete(id);
        reject(new TypeError(err));
      }
    });
  }

  class FormData {
    constructor() {
      this._list = [];
    }
    append(k, v) {
      this._list.push([String(k), v]);
    }
    set(k, v) {
      this.delete(k);
      this.append(k, v);
    }
    get(k) {
      const e = this._list.find(([n]) => n === k);
      return e ? e[1] : null;
    }
    getAll(k) {
      return this._list.filter(([n]) => n === k).map(([, v]) => v);
    }
    has(k) {
      return this._list.some(([n]) => n === k);
    }
    delete(k) {
      this._list = this._list.filter(([n]) => n !== k);
    }
    forEach(f, self) {
      for (const [k, v] of this._list) f.call(self, v, k, this);
    }
    entries() {
      return this._list[Symbol.iterator]();
    }
    keys() {
      return this._list.map(([k]) => k)[Symbol.iterator]();
    }
    values() {
      return this._list.map(([, v]) => v)[Symbol.iterator]();
    }
    [Symbol.iterator]() {
      return this.entries();
    }
  }

  // No network sockets here: a WebSocket that fails to connect (error + close on the next tick), so
  // clients that only need the class to exist (Supabase realtime) construct and back off.
  class WebSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = String(url);
      this.readyState = 0;
      this.protocol = '';
      this.extensions = '';
      this.bufferedAmount = 0;
      this.binaryType = 'blob';
      setTimeout(() => {
        this.readyState = 3;
        const err = new Event('error');
        if (this.onerror) this.onerror(err);
        this.dispatchEvent(err);
        const close = new Event('close');
        close.code = 1006;
        close.reason = 'no network in this runtime';
        close.wasClean = false;
        if (this.onclose) this.onclose(close);
        this.dispatchEvent(close);
      }, 0);
    }
    send() {
      throw new Error('WebSocket is not connected');
    }
    close() {
      this.readyState = 3;
    }
  }
  Object.assign(WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });

  // In-memory Web Storage (nothing persists across launches yet).
  class Storage {
    constructor() {
      define(this, { _m: new Map() });
    }
    get length() {
      return this._m.size;
    }
    key(i) {
      return [...this._m.keys()][i] ?? null;
    }
    getItem(k) {
      const v = this._m.get(String(k));
      return v === undefined ? null : v;
    }
    setItem(k, v) {
      this._m.set(String(k), String(v));
    }
    removeItem(k) {
      this._m.delete(String(k));
    }
    clear() {
      this._m.clear();
    }
  }

  define(globalThis, {
    Storage,
    localStorage: new Storage(),
    sessionStorage: new Storage(),
    Blob,
    File,
    FormData,
    WebSocket,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Headers,
    Request,
    Response,
    fetch,
    crypto: {
      getRandomValues(a) {
        const bytes = new Uint8Array(t.random(a.byteLength));
        new Uint8Array(a.buffer, a.byteOffset, a.byteLength).set(bytes);
        return a;
      },
      randomUUID() {
        const b = new Uint8Array(t.random(16));
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
      },
    },
    // Structured clone of plain data, typed arrays and ArrayBuffers (no Map/Set/Date/cycles).
    structuredClone(v) {
      if (v === null || typeof v !== 'object') return v;
      if (v instanceof ArrayBuffer) return v.slice(0);
      if (ArrayBuffer.isView(v)) return new v.constructor(v);
      if (Array.isArray(v)) return v.map(globalThis.structuredClone);
      const o = {};
      for (const k of Object.keys(v)) o[k] = globalThis.structuredClone(v[k]);
      return o;
    },
    // What wry gives a page for Tauri's postMessage IPC fallback.
    ipc: { postMessage: (s) => t.postMessage(String(s)) },
    // Called by the runtime when a custom-scheme handler responds: (id, status, [k, v, ...], ArrayBuffer).
    __tauriFetchDone(id, status, headers, body) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      const h = new Headers();
      for (let i = 0; i < headers.length; i += 2) h.append(headers[i], headers[i + 1]);
      p.resolve(new Response(body, { status, headers: h, url: p.url }));
    },
  });
})();
