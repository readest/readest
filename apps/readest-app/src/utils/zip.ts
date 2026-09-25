import { Configuration } from '@zip.js/zip.js';

// Offload inflate/deflate to a web worker so ZIP decompression stops
// competing with layout/pagination on the main thread — the win that matters
// on weak-CPU (e-ink) devices where a single inflate can block rendering for
// tens of ms. zip.js 2.8's browser build embeds its worker (code + wasm) as
// an inline blob, so enabling workers needs no extra assets; if the platform
// has no Worker at all or CSP blocks `blob:` workers, `new Worker` throws and
// zip.js falls back to main-thread execution on its own. The probe below adds
// a cheap message round trip (cached for the session) so a webview that
// constructs workers but cannot actually run them — the only failure mode
// zip.js does NOT cover — degrades to main-thread too instead of failing
// mid-read on the book path.
let webWorkerProbe: Promise<boolean> | null = null;

const probeWebWorkers = (): Promise<boolean> => {
  if (!webWorkerProbe) {
    webWorkerProbe = (async () => {
      try {
        const url = URL.createObjectURL(
          new Blob(['self.onmessage=e=>self.postMessage(e.data)'], {
            type: 'text/javascript',
          }),
        );
        const worker = new Worker(url);
        try {
          return await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), 2_000);
            worker.onmessage = () => {
              clearTimeout(timer);
              resolve(true);
            };
            worker.onerror = () => {
              clearTimeout(timer);
              resolve(false);
            };
            worker.postMessage(0);
          });
        } finally {
          worker.terminate();
          try {
            URL.revokeObjectURL(url);
          } catch {
            // ignore — probe result already decided above
          }
        }
      } catch {
        return false;
      }
    })();
  }
  return webWorkerProbe;
};

export const configureZip = async (configuration?: Partial<Configuration>) => {
  const { configure } = await import('@zip.js/zip.js');
  // Callers may force a mode (e.g. backup writes); by default workers are
  // used only when the runtime can actually run them.
  const useWebWorkers = configuration?.useWebWorkers ?? (await probeWebWorkers());
  configure({
    useCompressionStream: false,
    ...(configuration ? configuration : {}),
    useWebWorkers,
  });
};
