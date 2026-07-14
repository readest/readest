export interface ParsedDataUrl {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * Decode a `data:` URL into raw bytes plus its MIME type. Used to turn the
 * in-memory image shown in the gallery viewer back into a file for the
 * share / export flow.
 */
export function dataUrlToBytes(dataUrl: string): ParsedDataUrl {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new Error('Not a data URL');
  }
  const mimeType = match[1] || 'application/octet-stream';
  const isBase64 = !!match[2];
  const data = match[3] ?? '';
  if (isBase64) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { bytes, mimeType };
  }
  // Non-base64 data URLs hold percent-encoded text (e.g. inline SVG).
  return { bytes: new TextEncoder().encode(decodeURIComponent(data)), mimeType };
}

/** Derive a file extension from an image MIME type (e.g. image/svg+xml -> svg). */
export function imageExtensionFromMime(mimeType: string): string {
  const subtype = (mimeType.split('/')[1] || 'png').toLowerCase();
  const base = subtype.split('+')[0]!;
  return base === 'jpeg' ? 'jpg' : base;
}

// Strictly increasing so two saves in the same millisecond still get distinct
// names.
let lastGalleryStamp = 0;

const pad = (value: number, width: number) => String(value).padStart(width, '0');

/**
 * A collision-free name for an image handed to the gallery. Android's MediaStore
 * neither overwrites an existing display name nor de-duplicates it consistently:
 * AOSP renames to `image (1).png`, while stricter OEM providers reject the row
 * outright. Naming each save ourselves keeps the insert independent of that.
 */
export function galleryFileName(filename: string, now = Date.now()): string {
  const dot = filename.lastIndexOf('.');
  const ext = dot > 0 ? filename.slice(dot) : '';
  lastGalleryStamp = Math.max(now, lastGalleryStamp + 1);
  const d = new Date(lastGalleryStamp);
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
  const time = `${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`;
  return `readest-${date}-${time}-${pad(d.getMilliseconds(), 3)}${ext}`;
}

/**
 * Process book cover for Discord Rich Presence:
 * - Fit to 512x512 with transparent background
 * - Add Readest icon overlay at bottom right (10px padding)
 * - Return as JPEG blob
 */
export async function processDiscordCover(coverUrl: string, iconUrl: string): Promise<Blob> {
  const SIZE = 512;
  const ICON_WIDTH = 224;
  const ICON_HEIGHT = 182;
  const PADDING = 10;

  try {
    const coverResponse = await fetch(coverUrl);
    const coverBlob = await coverResponse.blob();
    const coverImg = new Image();
    coverImg.crossOrigin = 'anonymous';

    const iconResponse = await fetch(iconUrl);
    const iconBlob = await iconResponse.blob();
    const iconImg = new Image();
    iconImg.crossOrigin = 'anonymous';

    return new Promise((resolve, reject) => {
      let coverLoaded = false;
      let iconLoaded = false;

      const checkBothLoaded = () => {
        if (!coverLoaded || !iconLoaded) return;

        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          canvas.width = SIZE;
          canvas.height = SIZE;

          // Calculate cover dimensions to fit in 512x512
          const aspectRatio = coverImg.width / coverImg.height;
          let drawWidth, drawHeight, offsetX, offsetY;

          if (aspectRatio > 1) {
            // Wider than tall
            drawWidth = SIZE;
            drawHeight = SIZE / aspectRatio;
            offsetX = 0;
            offsetY = (SIZE - drawHeight) / 2;
          } else {
            // Taller than wide
            drawHeight = SIZE;
            drawWidth = SIZE * aspectRatio;
            offsetX = (SIZE - drawWidth) / 2;
            offsetY = 0;
          }

          // Draw cover image centered
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(coverImg, offsetX, offsetY, drawWidth, drawHeight);

          // Draw icon at bottom right
          ctx.drawImage(
            iconImg,
            SIZE - ICON_WIDTH - PADDING,
            SIZE - ICON_HEIGHT - PADDING,
            ICON_WIDTH,
            ICON_HEIGHT,
          );

          // Convert to JPEG blob
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Failed to create blob'));
              }
            },
            'image/jpeg',
            0.9,
          );
        } catch (error) {
          reject(new Error(`Failed to process cover: ${error}`));
        }
      };

      coverImg.onload = () => {
        coverLoaded = true;
        checkBothLoaded();
      };

      iconImg.onload = () => {
        iconLoaded = true;
        checkBothLoaded();
      };

      coverImg.onerror = () => reject(new Error('Failed to load cover image'));
      iconImg.onerror = () => reject(new Error('Failed to load icon image'));

      const coverObjectUrl = URL.createObjectURL(coverBlob);
      const iconObjectUrl = URL.createObjectURL(iconBlob);

      coverImg.src = coverObjectUrl;
      iconImg.src = iconObjectUrl;

      coverImg.onload = function () {
        URL.revokeObjectURL(coverObjectUrl);
        coverLoaded = true;
        checkBothLoaded();
      };

      iconImg.onload = function () {
        URL.revokeObjectURL(iconObjectUrl);
        iconLoaded = true;
        checkBothLoaded();
      };
    });
  } catch (error) {
    console.error('Error processing Discord cover:', error);
    throw error;
  }
}

export async function fetchImageAsBase64(
  url: string,
  options: {
    targetWidth?: number;
    format?: 'image/jpeg' | 'image/png' | 'image/webp';
    quality?: number;
  } = {},
): Promise<string> {
  const { targetWidth = 256, format = 'image/jpeg', quality = 0.85 } = options;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();

    const img = new Image();
    img.crossOrigin = 'anonymous';

    return new Promise((resolve, reject) => {
      img.onload = () => {
        try {
          const aspectRatio = img.height / img.width;
          const newWidth = targetWidth;
          const newHeight = Math.round(newWidth * aspectRatio);

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          canvas.width = newWidth;
          canvas.height = newHeight;

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          ctx.drawImage(img, 0, 0, newWidth, newHeight);

          const base64 = canvas.toDataURL(format, quality);
          resolve(base64);
        } catch (error) {
          reject(new Error(`Failed to scale image: ${error}`));
        }
      };

      img.onerror = () => reject(new Error('Failed to load image for scaling'));

      const objectUrl = URL.createObjectURL(blob);
      img.src = objectUrl;

      const cleanup = () => URL.revokeObjectURL(objectUrl);
      const originalOnload = img.onload;
      const originalOnerror = img.onerror;

      img.onload = function (ev) {
        cleanup();
        if (originalOnload) originalOnload.call(this, ev);
      };

      img.onerror = function (ev) {
        cleanup();
        if (originalOnerror) originalOnerror.call(this, ev);
      };
    });
  } catch (error) {
    console.error('Error fetching and encoding image:', error);
    throw error;
  }
}
