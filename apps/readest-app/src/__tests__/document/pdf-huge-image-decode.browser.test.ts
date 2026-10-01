import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installPDFImageShrink } from '@/libs/pdfImageShrink';

// Scanned scores ship 1-bit pages of ~9000x12000 px (readest#6521). pdf.js
// downscales an image above `canvasMaxAreaInBytes`, but its resizer first
// decodes the whole image from a BMP blob to a full-size bitmap. On iOS that
// bitmap (~430 MB) lands in the WebKit GPU process, which jetsam kills past
// ~300 MB; after the first kill every image the worker decodes stays blank
// until the app restarts. The worker hook must shrink such images while it
// decodes them, never holding a bitmap or canvas bigger than the cap.

const MAX_AREA = 1 << 20; // pixels
const PAGE_SIZE = 612;

const deflate = async (data: Uint8Array<ArrayBuffer>) => {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

// A one-page PDF filled by a single image XObject; a null colour space makes
// it a 1-bit image mask painted in red.
const makeImagePDF = async (
  width: number,
  height: number,
  colorSpace: string | null,
  bitsPerComponent: number,
  pixels: Uint8Array<ArrayBuffer>,
) => {
  const image = await deflate(pixels);
  const content = `q 1 0 0 rg ${PAGE_SIZE} 0 0 ${PAGE_SIZE} 0 0 cm /Im0 Do Q`;
  const encoder = new TextEncoder();
  const objects: (string | Uint8Array)[][] = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_SIZE} ${PAGE_SIZE}] ` +
        '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
    ],
    [
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
        `${colorSpace ? `/ColorSpace /${colorSpace}` : '/ImageMask true'} /BitsPerComponent ${bitsPerComponent} ` +
        `/Filter /FlateDecode /Length ${image.length} >>\nstream\n`,
      image,
      '\nendstream',
    ],
    [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
  ];
  const chunks: Uint8Array[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  push('%PDF-1.7\n');
  const offsets = objects.map((parts, i) => {
    const offset = length;
    push(`${i + 1} 0 obj\n`);
    parts.forEach(push);
    push('\nendobj\n');
    return offset;
  });
  const xref = length;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  offsets.forEach((offset) => push(`${String(offset).padStart(10, '0')} 00000 n \n`));
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const pdf = new Uint8Array(length);
  let pos = 0;
  for (const chunk of chunks) {
    pdf.set(chunk, pos);
    pos += chunk.length;
  }
  return pdf;
};

type PDFJS = {
  getDocument: (src: Record<string, unknown>) => {
    promise: Promise<{
      getPage: (n: number) => Promise<{
        getViewport: (o: { scale: number }) => { width: number; height: number };
        render: (o: Record<string, unknown>) => { promise: Promise<void> };
      }>;
    }>;
    destroy: () => Promise<void>;
  };
};

const allocations: { kind: string; area: number }[] = [];
const restores: (() => void)[] = [];
const record = (kind: string, area: number) => allocations.push({ kind, area });

beforeAll(async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  // Run the real worker code on the main thread so its allocations are visible.
  // @ts-expect-error the worker build ships no type declarations
  g['pdfjsWorker'] = await import('@pdfjs/pdf.worker.min.mjs');
  await import('@pdfjs/pdf.min.mjs');

  const createImageBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
    const bitmap = await createImageBitmap(...args);
    record('createImageBitmap', bitmap.width * bitmap.height);
    return bitmap;
  }) as typeof createImageBitmap;
  restores.push(() => (globalThis.createImageBitmap = createImageBitmap));

  const transfer = OffscreenCanvas.prototype.transferToImageBitmap;
  OffscreenCanvas.prototype.transferToImageBitmap = function (this: OffscreenCanvas) {
    record('OffscreenCanvas', this.width * this.height);
    return transfer.call(this);
  };
  restores.push(() => (OffscreenCanvas.prototype.transferToImageBitmap = transfer));

  // Blobs are copied into browser-side storage (WebKit's Networking process),
  // so a full-size BMP blob is itself a full-size copy.
  const NativeBlob = globalThis.Blob;
  globalThis.Blob = class extends NativeBlob {
    constructor(...args: ConstructorParameters<typeof Blob>) {
      super(...args);
      if (this.type === 'image/bmp') record('Blob image/bmp (bytes)', this.size);
    }
  } as typeof Blob;
  restores.push(() => (globalThis.Blob = NativeBlob));

  const Decoder = g['ImageDecoder'] as (new (init: { type: string }) => object) | undefined;
  if (Decoder) {
    g['ImageDecoder'] = class extends Decoder {
      constructor(init: { type: string }) {
        record(`ImageDecoder ${init.type}`, Infinity);
        super(init);
      }
    };
    restores.push(() => (g['ImageDecoder'] = Decoder));
  }

  const drawImage = OffscreenCanvasRenderingContext2D.prototype.drawImage;
  restores.push(() => (OffscreenCanvasRenderingContext2D.prototype.drawImage = drawImage));

  // What the worker wrapper installs before pdf.js loads.
  installPDFImageShrink(MAX_AREA);
});

afterAll(() => {
  restores.forEach((restore) => restore());
  Reflect.deleteProperty(globalThis, 'pdfjsWorker');
});

const renderPage = async (data: Uint8Array) => {
  const { pdfjsLib } = globalThis as unknown as { pdfjsLib: PDFJS };
  // The options foliate-js passes on mobile WebViews.
  const loadingTask = pdfjsLib.getDocument({
    data,
    isEvalSupported: false,
    canvasMaxAreaInBytes: MAX_AREA * 4,
  });
  try {
    const page = await (await loadingTask.promise).getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    return (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
  } finally {
    await loadingTask.destroy();
  }
};

const expectNoFullSizeBitmap = () => {
  expect(allocations.length).toBeGreaterThan(0);
  // ImageDecoder would decode the resize BMP at full size, out of the hook's reach.
  expect(allocations.filter(({ kind }) => kind.startsWith('ImageDecoder image/bmp'))).toEqual([]);
  for (const { kind, area } of allocations) expect(area, kind).toBeLessThanOrEqual(MAX_AREA);
};

describe('pdf.js huge image decode (#6521)', () => {
  it('shrinks a 1-bit scan without a full-size bitmap and keeps the lines', async () => {
    allocations.length = 0;
    // Not a multiple of the shrink factor (5 here), like real scans (8885, 9405 px wide).
    const SIZE = 4103;
    const PERIOD = 64;
    const LINE = 16;
    const rowBytes = Math.ceil(SIZE / 8);
    const pixels = new Uint8Array(rowBytes * SIZE).fill(0xff);
    for (let y = 0; y < SIZE; y++) {
      if (y % PERIOD < LINE) pixels.fill(0, y * rowBytes, (y + 1) * rowBytes);
    }
    const pixelAt = await renderPage(await makeImagePDF(SIZE, SIZE, 'DeviceGray', 1, pixels));

    expectNoFullSizeBitmap();
    const scale = PAGE_SIZE / SIZE;
    for (const k of [3, 10, 40]) {
      expect(pixelAt(PAGE_SIZE / 2, Math.round((k * PERIOD + LINE / 2) * scale))[0]).toBeLessThan(
        96,
      );
      expect(
        pixelAt(PAGE_SIZE / 2, Math.round((k * PERIOD + PERIOD / 2) * scale))[0],
      ).toBeGreaterThan(224);
    }
  });

  it('shrinks a large RGB image and keeps its colours', async () => {
    allocations.length = 0;
    // pdf.js only resizes images above 2048 px on a side.
    const SIZE = 3072;
    // Left half red, right half blue.
    const pixels = new Uint8Array(SIZE * SIZE * 3);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = (y * SIZE + x) * 3;
        if (x < SIZE / 2) pixels[i] = 255;
        else pixels[i + 2] = 255;
      }
    }
    const pixelAt = await renderPage(await makeImagePDF(SIZE, SIZE, 'DeviceRGB', 8, pixels));

    expectNoFullSizeBitmap();
    const [r1, g1, b1] = pixelAt(PAGE_SIZE / 4, PAGE_SIZE / 2);
    expect([r1! > 200, g1! < 50, b1! < 50]).toEqual([true, true, true]);
    const [r2, g2, b2] = pixelAt((PAGE_SIZE * 3) / 4, PAGE_SIZE / 2);
    expect([r2! < 50, g2! < 50, b2! > 200]).toEqual([true, true, true]);
  });

  it('shrinks a 1-bit image mask and paints it in the fill colour', async () => {
    allocations.length = 0;
    const SIZE = 4103;
    const PERIOD = 64;
    const LINE = 16;
    const rowBytes = Math.ceil(SIZE / 8);
    // Mask samples of 0 are painted.
    const pixels = new Uint8Array(rowBytes * SIZE).fill(0xff);
    for (let y = 0; y < SIZE; y++) {
      if (y % PERIOD < LINE) pixels.fill(0, y * rowBytes, (y + 1) * rowBytes);
    }
    const pixelAt = await renderPage(await makeImagePDF(SIZE, SIZE, null, 1, pixels));

    expectNoFullSizeBitmap();
    const scale = PAGE_SIZE / SIZE;
    for (const k of [3, 10, 40]) {
      const [r, g] = pixelAt(PAGE_SIZE / 2, Math.round((k * PERIOD + LINE / 2) * scale));
      expect([r! > 200, g! < 128]).toEqual([true, true]);
      expect(
        pixelAt(PAGE_SIZE / 2, Math.round((k * PERIOD + PERIOD / 2) * scale))[1],
      ).toBeGreaterThan(224);
    }
  });

  // WebKit (iOS) has no ImageDecoder; Chromium (Android) does.
  it.runIf('ImageDecoder' in globalThis)(
    'keeps native ImageDecoder for everything but the resize BMP',
    async () => {
      const { ImageDecoder } = globalThis as unknown as {
        ImageDecoder: { isTypeSupported(type: string): Promise<boolean> };
      };
      expect(await ImageDecoder.isTypeSupported('image/bmp')).toBe(false);
      expect(await ImageDecoder.isTypeSupported('image/jpeg')).toBe(true);
    },
  );
});
