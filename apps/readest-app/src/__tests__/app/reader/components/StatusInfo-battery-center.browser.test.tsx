import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import StatusInfo from '@/app/reader/components/StatusInfo';
import '@/styles/globals.css';

const h = vi.hoisted(() => ({ level: 4 }));
vi.mock('@/app/reader/hooks/useCurrentBattery', () => ({
  useCurrentBatteryStatus: () => h.level,
}));
vi.mock('@/app/reader/hooks/useCurrentTime', () => ({ useCurrentTime: () => '09:32' }));

afterEach(cleanup);

const decode = async (base64: string) => {
  const bitmap = await createImageBitmap(
    await (await fetch(`data:image/png;base64,${base64}`)).blob(),
  );
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
};

const darkness = (image: ImageData, x: number, y: number) =>
  255 - image.data[(y * image.width + x) * 4]!;

// How far (in CSS px) the number's ink sits below the battery body's middle.
// The body is the 21x11 rect at x 0.5, y 0.5 of the 25x12 icon; its middle
// comes from the strokes (and fill) right of the number. The number's rows
// are those with ink between the body's inner edges, less the fill behind it.
const offsetFromBody = (image: ImageData) => {
  const px = image.height / 12;
  const [bx0, bx1] = [Math.round(17 * px), Math.round(20 * px)];
  const [nx0, nx1] = [Math.round(4 * px), Math.round(17 * px)];
  const [ny0, ny1] = [Math.ceil(1.5 * px), Math.floor(10.5 * px)];
  let bodySum = 0;
  let bodyWeight = 0;
  const ink: number[] = [];
  for (let y = 0; y < image.height; y++) {
    let fill = 0;
    for (let x = bx0; x < bx1; x++) fill += darkness(image, x, y);
    bodySum += y * fill;
    bodyWeight += fill;
    if (y < ny0 || y >= ny1) continue;
    fill /= bx1 - bx0;
    let row = 0;
    for (let x = nx0; x < nx1; x++) row += Math.max(0, darkness(image, x, y) - fill);
    ink[y] = row;
  }
  const max = Math.max(...ink.filter((v) => v !== undefined));
  const rows = ink.flatMap((v, y) => (v !== undefined && v > max * 0.3 ? [y] : []));
  const numberMiddle = (rows[0]! + rows[rows.length - 1]! + 1) / 2;
  return (numberMiddle - bodySum / bodyWeight - 0.5) / px;
};

// Engines read different ascent and descent from the same font file. The
// overrides stand in for that: Inter's own metrics, and a platform reporting
// a taller ascent or a deeper descent.
it.each([
  ['Inter as is', {}],
  ['a taller ascent', { ascentOverride: '110%', descentOverride: '10%' }],
  ['a deeper descent', { ascentOverride: '85%', descentOverride: '35%' }],
])('centers the battery number on the body with %s', async (_, metrics) => {
  const face = new FontFace('Battery Inter', 'url(/fonts/InterVariable.woff2)', {
    weight: '100 900',
    ...metrics,
  });
  document.fonts.add(await face.load());
  try {
    for (const level of [4, 100]) {
      h.level = level;
      const { container, unmount } = render(
        <div style={{ padding: 4, background: '#fff', color: '#000', fontFamily: 'Battery Inter' }}>
          <StatusInfo showTime={false} showBattery showBatteryPercentage />
        </div>,
      );
      const icon = container.querySelector('svg')!.parentElement!;
      const image = await decode(await page.screenshot({ element: icon, save: false }));
      expect
        .soft(Math.abs(offsetFromBody(image)), `${level}%: offset from the body's middle`)
        .toBeLessThanOrEqual(0.35);
      unmount();
    }
  } finally {
    document.fonts.delete(face);
  }
});
