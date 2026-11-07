import { afterEach, describe, expect, test, vi } from 'vitest';

const configure = vi.fn();
vi.mock('@zip.js/zip.js', () => ({ configure }));

import { configureZip } from '@/utils/zip';

describe('configureZip', () => {
  afterEach(() => {
    configure.mockClear();
    vi.unstubAllGlobals();
  });

  test("uses zip.js's own codec where WebAssembly runs it", async () => {
    await configureZip();
    expect(configure).toHaveBeenCalledWith({ useWebWorkers: false, useCompressionStream: false });
  });

  // zip.js's codec is WebAssembly; without it (Readest Lite's QuickJS runtime) zip.js can only
  // inflate through the platform's DecompressionStream.
  test('uses the compression streams where there is no WebAssembly', async () => {
    vi.stubGlobal('WebAssembly', undefined);
    await configureZip();
    expect(configure).toHaveBeenCalledWith({ useWebWorkers: false, useCompressionStream: true });
  });

  test('an explicit option still wins', async () => {
    vi.stubGlobal('WebAssembly', undefined);
    await configureZip({ useCompressionStream: false });
    expect(configure).toHaveBeenCalledWith({ useWebWorkers: false, useCompressionStream: false });
  });
});
