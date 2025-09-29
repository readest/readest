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
