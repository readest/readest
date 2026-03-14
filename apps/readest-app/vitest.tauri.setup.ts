// Vitest runs tests inside an iframe, but Tauri injects its plugin internals
// only into the top-level window. Copy them into the iframe so that Tauri
// plugin APIs (e.g. @tauri-apps/plugin-os, @tauri-apps/plugin-fs) work
// in test code that imports them at the module level.
//
// Cross-frame IPC fixes:
// 1. REQUEST: binary args (Uint8Array/ArrayBuffer) created in the iframe fail
//    cross-frame `instanceof` checks in Tauri's IPC serializer. We convert
//    them to top-window equivalents before forwarding.
// 2. RESPONSE: invoke responses containing ArrayBuffer from the top window fail
//    `instanceof ArrayBuffer` in the iframe context. We convert them back.

const topWindow = (window.top ?? window) as unknown as Record<string, unknown>;
const iframeWindow = window as unknown as Record<string, unknown>;

type InvokeFn = (cmd: string, args?: unknown, options?: unknown) => Promise<unknown>;
type TauriInternals = { invoke: InvokeFn; [key: string]: unknown };

const topTauri = topWindow['__TAURI_INTERNALS__'] as TauriInternals | undefined;
if (topTauri && !iframeWindow['__TAURI_INTERNALS__']) {
  if (window.top && window.top !== window) {
    // We're in an iframe — create a shallow copy with a wrapped invoke
    const origInvoke = topTauri.invoke.bind(topTauri);

    // Top window constructors (for cross-frame instanceof checks)
    const TopUint8Array = (window.top as unknown as Record<string, unknown>)[
      'Uint8Array'
    ] as typeof Uint8Array;
    const TopArrayBuffer = (window.top as unknown as Record<string, unknown>)[
      'ArrayBuffer'
    ] as typeof ArrayBuffer;

    // Convert iframe-context binary args to top-window equivalents
    function fixRequest(args: unknown): unknown {
      if (args instanceof Uint8Array && !(args instanceof TopUint8Array)) {
        const src = args as Uint8Array;
        const fixed = new TopUint8Array(src.length);
        fixed.set(src);
        return fixed;
      }
      if (args instanceof ArrayBuffer && !(args instanceof TopArrayBuffer)) {
        const src = args as ArrayBuffer;
        const fixed = new TopArrayBuffer(src.byteLength);
        new TopUint8Array(fixed).set(new Uint8Array(src));
        return fixed;
      }
      return args;
    }

    // Convert top-window ArrayBuffer responses to iframe-context equivalents
    function fixResponse(value: unknown): unknown {
      if (value instanceof TopArrayBuffer) {
        const src = new Uint8Array(value as unknown as ArrayBuffer);
        const dst = new ArrayBuffer(src.byteLength);
        new Uint8Array(dst).set(src);
        return dst;
      }
      return value;
    }

    const wrappedInvoke: InvokeFn = (cmd, args, options) => {
      return origInvoke(cmd, fixRequest(args), options).then(fixResponse);
    };

    // Create a shallow copy (original object is frozen) with wrapped invoke
    const wrapper: Record<string, unknown> = {};
    for (const key of Object.getOwnPropertyNames(topTauri)) {
      wrapper[key] = key === 'invoke' ? wrappedInvoke : topTauri[key];
    }
    iframeWindow['__TAURI_INTERNALS__'] = wrapper;
  } else {
    iframeWindow['__TAURI_INTERNALS__'] = topTauri;
  }
}

// Copy other Tauri plugin internals as-is
const otherKeys = ['__TAURI_OS_PLUGIN_INTERNALS__'] as const;
for (const key of otherKeys) {
  if (topWindow[key] && !iframeWindow[key]) {
    iframeWindow[key] = topWindow[key];
  }
}
