/** Longest edge of the cover thumbnail embedded in a transfer request. */
const COVER_PREVIEW_MAX_EDGE = 192;

/** Upper bound on a peer-supplied preview; larger payloads are dropped. */
const MAX_PREVIEW_BASE64_LENGTH = 256 * 1024;

/**
 * Turns the base64 `preview` of a LocalSend file DTO into an `img`-safe data
 * URL. The bytes come from an arbitrary peer, so only well-formed base64 with
 * a recognized image signature passes; anything else returns null and the UI
 * falls back to no thumbnail.
 */
export function previewDataUrl(preview: string | null | undefined): string | null {
  if (!preview) return null;
  const base64 = preview.trim();
  if (!base64 || base64.length > MAX_PREVIEW_BASE64_LENGTH) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  const mime = base64.startsWith('/9j/')
    ? 'image/jpeg'
    : base64.startsWith('iVBOR')
      ? 'image/png'
      : base64.startsWith('UklGR')
        ? 'image/webp'
        : null;
  return mime ? `data:${mime};base64,${base64}` : null;
}

/**
 * Downscales a cover image to a small JPEG and returns its raw base64 (the
 * LocalSend `preview` wire format), or null when the image cannot be decoded.
 */
export async function coverPreviewBase64(bytes: ArrayBuffer): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const scale = Math.min(1, COVER_PREVIEW_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1] || null;
  } catch {
    return null;
  }
}
