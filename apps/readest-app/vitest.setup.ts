// Node 22 exposes File globally while jsdom supplies a different Blob
// implementation. Passing a Blob from one realm to File from another
// serializes it as "[object Blob]", which corrupts in-memory EPUBs in
// conversion tests. Keep both binary primitives in jsdom's realm so they
// remain mutually compatible and pdfjs sees the expected File implementation.
if (typeof window !== 'undefined') {
  Object.assign(globalThis, { Blob: window.Blob, File: window.File });

  // zip.js uses Node's Response.blob() under Vitest, which returns a Node Blob
  // even though the tests use jsdom's File. Normalize that boundary so a
  // cross-realm Blob is not stringified as "[object Blob]" by File/Blob.
  const responseBlob = Response.prototype.blob;
  Response.prototype.blob = async function (this: Response) {
    const blob = await responseBlob.call(this);
    return new window.Blob([await blob.arrayBuffer()], { type: blob.type });
  };
}

// jsdom does not implement the CSS namespace; foliate-js TTS uses CSS.escape
// (mark[name="…"] lookups). Provide the standard polyfill so those paths work.
const globalWithCSS = globalThis as { CSS?: { escape?: (value: string) => string } };
if (!globalWithCSS.CSS) globalWithCSS.CSS = {};
if (typeof globalWithCSS.CSS.escape !== 'function') {
  globalWithCSS.CSS.escape = (value: string): string => {
    const string = String(value);
    const length = string.length;
    const firstCodeUnit = string.charCodeAt(0);
    let result = '';
    let index = -1;
    while (++index < length) {
      const codeUnit = string.charCodeAt(index);
      if (codeUnit === 0x0000) {
        result += '�';
      } else if (
        (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
        codeUnit === 0x007f ||
        (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002d)
      ) {
        result += '\\' + codeUnit.toString(16) + ' ';
      } else if (index === 0 && length === 1 && codeUnit === 0x002d) {
        result += '\\' + string.charAt(index);
      } else if (
        codeUnit >= 0x0080 ||
        codeUnit === 0x002d ||
        codeUnit === 0x005f ||
        (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
        (codeUnit >= 0x0061 && codeUnit <= 0x007a)
      ) {
        result += string.charAt(index);
      } else {
        result += '\\' + string.charAt(index);
      }
    }
    return result;
  };
}

// jsdom's Blob has no stream(); every WebView the app runs in does.
if (typeof Blob !== 'undefined' && !Blob.prototype.stream) {
  const { arrayBuffer } = Blob.prototype;
  Blob.prototype.stream = function (this: Blob) {
    return new ReadableStream({
      pull: async (controller) => {
        controller.enqueue(new Uint8Array(await arrayBuffer.call(this)));
        controller.close();
      },
    });
  } as Blob['stream'];
}

// matchMedia mock
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom reports these unimplemented methods to its virtual console even when
// the calling test passes. Tests that need media behavior replace them locally.
if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
}

// Unit tests never reach the Readest Voice API: a controller built for a
// signed-out reader would otherwise fetch the voice catalog over the network.
// Nor the app's own origin: happy-dom resolves a relative URL such as i18n's
// /locales/en/translation.json against http://localhost:3000 and connects,
// so a running dev server would answer. It fails here as Node's fetch fails
// on a relative URL under jsdom. Tests that exercise a request spy on fetch
// themselves.
if (typeof globalThis.fetch === 'function') {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/tts/readest')) {
      return Promise.resolve(Response.json({ error: 'NOT_CONFIGURED' }, { status: 503 }));
    }
    if (
      url.startsWith('/') ||
      (typeof location !== 'undefined' && url.startsWith(location.origin))
    ) {
      return Promise.reject(new TypeError(`Failed to parse URL from ${url}`));
    }
    return realFetch(input, init);
  };
}
