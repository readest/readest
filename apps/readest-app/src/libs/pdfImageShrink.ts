// Runs inside the pdf.js worker (see configurePDFWorker in document.ts), which
// inlines it with Function.prototype.toString, so it must stay self-contained:
// no imports and no references to anything outside its own body.
//
// pdf.js shrinks an image above `canvasMaxAreaInBytes` by packing it into a
// BMP, decoding that blob to a full-size ImageBitmap, then drawing it onto
// smaller OffscreenCanvases. For a 9000x12000 scan that full-size bitmap is
// ~430 MB; on iOS it lands in the WebKit GPU process, which jetsam kills past
// ~300 MB, and after the first kill every image the worker decodes stays blank
// until the app restarts (readest#6521). This hook keeps the bytes of such BMP
// blobs, decodes them itself, box-filtering straight down to about
// `maxPixels`, and scales the source rectangle of pdf.js's next drawImage call
// to match.
export function installPDFImageShrink(maxPixels: number): void {
  if (typeof OffscreenCanvasRenderingContext2D === 'undefined') return;
  // Where ImageDecoder exists (Android's Chromium) pdf.js decodes the BMP with
  // it instead, out of this hook's reach. Report BMP as unsupported so pdf.js
  // falls back to createImageBitmap; JPEGs keep decoding natively.
  const decoder = (
    globalThis as unknown as {
      ImageDecoder?: { isTypeSupported(type: string): Promise<boolean> };
    }
  ).ImageDecoder;
  if (decoder) {
    const isTypeSupported = decoder.isTypeSupported.bind(decoder);
    decoder.isTypeSupported = (type) =>
      type === 'image/bmp' ? Promise.resolve(false) : isTypeSupported(type);
  }
  const createBitmap = globalThis.createImageBitmap.bind(globalThis);
  const shrunk = new WeakMap<object, number>();
  const pixelsOf = (bytes: Uint8Array) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getInt32(18, true) * Math.abs(view.getInt32(22, true));
  };

  // A Blob is copied into the browser's own storage (WebKit keeps it in the
  // Networking process) and would be read back here: two more full-size
  // copies. For an oversized BMP keep the bytes and hand the browser an empty
  // Blob; pdf.js passes it straight to createImageBitmap below.
  const NativeBlob = globalThis.Blob;
  const held = new WeakMap<Blob, Uint8Array<ArrayBuffer>>();
  globalThis.Blob = class extends NativeBlob {
    constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
      const part = parts?.length === 1 ? parts[0] : null;
      const bytes =
        options?.type === 'image/bmp' && part instanceof ArrayBuffer && part.byteLength > 26
          ? new Uint8Array(part)
          : null;
      const hold = bytes !== null && pixelsOf(bytes) > maxPixels;
      super(hold ? [] : parts, options);
      if (hold) held.set(this, bytes);
    }
  } as typeof Blob;

  // Decodes the BMP layouts pdf.js writes (1-bit palette, 24-bit BGR, 32-bit
  // RGBA bitfields), averaging every `factor` x `factor` block into one pixel.
  const shrinkBMP = (bytes: Uint8Array, factor: number): ImageData | null => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dataOffset = view.getUint32(10, true);
    const headerSize = view.getUint32(14, true);
    const width = view.getInt32(18, true);
    const rawHeight = view.getInt32(22, true);
    const bitsPerPixel = view.getUint16(28, true);
    if (bitsPerPixel !== 1 && bitsPerPixel !== 24 && bitsPerPixel !== 32) return null;
    const height = Math.abs(rawHeight);
    const stride = (((width * bitsPerPixel + 31) >>> 5) << 2) >>> 0;
    const outWidth = Math.floor(width / factor);
    const outHeight = Math.floor(height / factor);
    if (!outWidth || !outHeight) return null;
    const palette = 14 + headerSize;
    const area = factor * factor;
    const out = new Uint8ClampedArray(outWidth * outHeight * 4);
    const sums = new Uint32Array(outWidth * 4);
    let o = 0;
    for (let oy = 0; oy < outHeight; oy++) {
      sums.fill(0);
      for (let dy = 0; dy < factor; dy++) {
        const y = oy * factor + dy;
        const row = dataOffset + (rawHeight < 0 ? y : height - 1 - y) * stride;
        if (bitsPerPixel === 1) {
          for (let x = 0, xx = outWidth * factor; x < xx; x++) {
            if ((bytes[row + (x >>> 3)]! >> (7 - (x & 7))) & 1) sums[((x / factor) | 0) << 2]!++;
          }
        } else {
          const step = bitsPerPixel >>> 3;
          // 24-bit rows are BGR; pdf.js's 32-bit bitfields keep RGBA order.
          const [r, b] = step === 3 ? [2, 0] : [0, 2];
          for (let x = 0, xx = outWidth * factor, p = row; x < xx; x++, p += step) {
            const j = ((x / factor) | 0) << 2;
            sums[j]! += bytes[p + r]!;
            sums[j + 1]! += bytes[p + 1]!;
            sums[j + 2]! += bytes[p + b]!;
            sums[j + 3]! += step === 4 ? bytes[p + 3]! : 255;
          }
        }
      }
      for (let j = 0; j < sums.length; j += 4) {
        if (bitsPerPixel === 1) {
          // Mix the two palette entries (B, G, R) by the share of set bits.
          const ones = sums[j]!;
          for (let c = 0; c < 3; c++) {
            const zero = bytes[palette + 2 - c]!;
            const one = bytes[palette + 6 - c]!;
            out[o++] = (ones * one + (area - ones) * zero) / area;
          }
          out[o++] = 255;
        } else {
          for (let c = 0; c < 4; c++) out[o++] = sums[j + c]! / area;
        }
      }
    }
    return new ImageData(out, outWidth, outHeight);
  };

  globalThis.createImageBitmap = async function (
    source: ImageBitmapSource,
    ...rest: unknown[]
  ): Promise<ImageBitmap> {
    const create = createBitmap as (...args: unknown[]) => Promise<ImageBitmap>;
    const bytes = source instanceof NativeBlob ? held.get(source) : undefined;
    if (!bytes) return create(source, ...rest);
    held.delete(source as Blob);
    const factor = Math.ceil(Math.sqrt(pixelsOf(bytes) / maxPixels));
    const image = rest.length === 0 ? shrinkBMP(bytes, factor) : null;
    // Not a layout we decode: let the browser have the real blob after all.
    if (!image) return create(new NativeBlob([bytes], { type: 'image/bmp' }), ...rest);
    const bitmap = await createBitmap(image);
    shrunk.set(bitmap, factor);
    return bitmap;
  } as typeof createImageBitmap;

  const context = OffscreenCanvasRenderingContext2D.prototype;
  const drawImage = context.drawImage as (...args: unknown[]) => void;
  context.drawImage = function (
    this: OffscreenCanvasRenderingContext2D,
    image: CanvasImageSource,
    ...args: number[]
  ) {
    const factor = shrunk.get(image);
    // pdf.js passes the full-size source rectangle: sx, sy, sw, sh, dx, dy, dw, dh.
    // Scaled down it overshoots the floored bitmap by a fraction of a pixel,
    // and WebKit then draws nothing at all, so clamp it to the bitmap.
    if (factor && image instanceof ImageBitmap && args.length === 8) {
      for (let i = 0; i < 4; i++) args[i]! /= factor;
      args[2] = Math.min(args[2]!, image.width - args[0]!);
      args[3] = Math.min(args[3]!, image.height - args[1]!);
    }
    drawImage.call(this, image, ...args);
  } as typeof context.drawImage;
}
