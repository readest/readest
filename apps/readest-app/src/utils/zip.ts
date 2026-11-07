import { Configuration } from '@zip.js/zip.js';

export const configureZip = async (configuration?: Partial<Configuration>) => {
  const { configure } = await import('@zip.js/zip.js');
  configure({
    useWebWorkers: false,
    // zip.js's own codec (CompressionStream is broken on some platforms, #3255) is WebAssembly;
    // without it, as on Readest Lite's QuickJS, only the platform's compression streams can inflate.
    useCompressionStream: typeof WebAssembly === 'undefined',
    ...(configuration ? configuration : {}),
  });
};
