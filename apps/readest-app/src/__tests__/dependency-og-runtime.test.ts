// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

const vinextRequire = createRequire(
  `${realpathSync(new URL('../../node_modules/vinext', import.meta.url))}/package.json`,
);
const ogPath = vinextRequire.resolve('@vercel/og');

describe('patched Open Graph renderer', () => {
  it('renders a PNG in Node with the font shaper available', () => {
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
          const { ImageResponse } = await import(${JSON.stringify(ogPath)});
          const image = new ImageResponse({
            type: 'div',
            props: {
              style: { display: 'flex', fontSize: 28 },
              children: 'Book <title> & author',
            },
          }, { width: 600, height: 315 });
          const bytes = new Uint8Array(await image.arrayBuffer());
          console.log(JSON.stringify({
            status: image.status,
            type: image.headers.get('content-type'),
            signature: Array.from(bytes.slice(0, 8)),
            size: bytes.length,
          }));
        `,
      ],
      { cwd: dirname(ogPath), encoding: 'utf8', timeout: 15000 },
    );
    const result: { status: number; type: string; signature: number[]; size: number } =
      JSON.parse(output);
    expect(result.status).toBe(200);
    expect(result.type).toBe('image/png');
    expect(result.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(result.size).toBeGreaterThan(1000);
  });
});
