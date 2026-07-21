import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('reader window events on mobile', () => {
  it('registers close-window events only when the Window API is available', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/reader/components/ReaderContent.tsx'),
      'utf8',
    );

    expect(source).toMatch(
      /if \(appService\?\.hasWindow\) \{\s+unlistenOnCloseWindow = tauriHandleOnCloseWindow/,
    );
    expect(source).toMatch(/tauriHandleOnCloseWindow\(handleCloseBooks\)\.catch\(\(error\) => \{/);
  });
});
