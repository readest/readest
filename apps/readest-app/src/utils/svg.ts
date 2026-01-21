function parseSvgLength(value: string) {
  const n = parseFloat(value);
  if (!isNaN(n)) return n;

  return undefined;
}

async function getSvgSize(
  svgBlob: Blob,
  defaultWidth: number = 700,
  defaultHeight: number = 1050,
): Promise<{ width: number; height: number }> {
  const text = await svgBlob.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;

  const widthAttr = svg.getAttribute('width');
  const heightAttr = svg.getAttribute('height');

  if (widthAttr && heightAttr) {
    return {
      width: parseSvgLength(widthAttr) || defaultWidth,
      height: parseSvgLength(heightAttr) || defaultHeight,
    };
  }

  const viewBox = svg.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.split(/\s+/).map(Number);
    if (parts.length === 4 && !parts.some(isNaN)) {
      const [, , vbWidth, vbHeight] = parts;
      return { width: vbWidth || defaultWidth, height: vbHeight || defaultHeight };
    }
  }

  return { width: defaultWidth, height: defaultHeight };
}

export async function svg2png(svgBlob: Blob, quality: number = 0.9): Promise<Blob> {
  const svgText = await svgBlob.text();

  const svgUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));

  const img = new Image();
  img.crossOrigin = 'anonymous';

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load SVG'));
    img.src = svgUrl;
  });

  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const canvas = document.createElement('canvas');
  const { width, height } = await getSvgSize(svgBlob);
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  URL.revokeObjectURL(svgUrl);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), 'image/png', quality);
  });
}
