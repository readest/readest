/**
 * Paints the theme "paper" shown on the back of the WebGL page curl
 * (readest#555): the solid theme background color plus the active
 * background texture, composited the way the viewer's ::before layer draws
 * it (background-size, mix-blend-mode, opacity). The texture styles are
 * read from the live ::before pseudo-element so custom textures, blob URLs,
 * and the user's opacity/size settings all flow through unchanged.
 */
export const renderTurnBackdrop = async (
  viewer: Element | null,
  bg: string,
  width: number,
  height: number,
): Promise<HTMLCanvasElement | null> => {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const style = viewer ? getComputedStyle(viewer, '::before') : null;
  const url = style?.backgroundImage.match(/url\("?(.*?)"?\)/)?.[1];
  if (!style || !url) return canvas;
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    ctx.globalAlpha = parseFloat(style.opacity) || 1;
    // The multiply/lighten keywords the texture layer uses exist as canvas
    // composite operations too; anything unsupported leaves source-over.
    ctx.globalCompositeOperation = style.mixBlendMode as GlobalCompositeOperation;
    const size = style.backgroundSize;
    const scale =
      size === 'cover'
        ? Math.max(w / img.width, h / img.height)
        : size === 'contain'
          ? Math.min(w / img.width, h / img.height)
          : 1;
    const tileW = Math.max(1, img.width * scale);
    const tileH = Math.max(1, img.height * scale);
    for (let y = 0; y < h; y += tileH) {
      for (let x = 0; x < w; x += tileW) {
        ctx.drawImage(img, x, y, tileW, tileH);
      }
    }
  } catch {
    // Texture failed to load: the plain theme color is still the right paper.
  }
  return canvas;
};
