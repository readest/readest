import tinycolor from 'tinycolor2';

function srgbToLinear(v: number): number {
  // Standard formula for gamma decoding of sRGB
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function hexToOklch(hexColor: string): string {
  // 1) Convert from hex → sRGB (0..255) → [0..1]
  const { r, g, b } = tinycolor(hexColor).toRgb();
  const R = srgbToLinear(r / 255);
  const G = srgbToLinear(g / 255);
  const B = srgbToLinear(b / 255);

  // 2) Convert linear sRGB → L'M'S'  (the Oklab-specific "LMS" space)
  const l_ = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m_ = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s_ = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);

  // 3) Convert L'M'S' → Oklab
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  // 4) Convert Oklab → Oklch
  const C = Math.sqrt(a * a + b_ * b_);
  let h = Math.atan2(b_, a) * (180 / Math.PI);
  if (h < 0) h += 360;

  // 5) Format as l% c h, with a bit of rounding
  const lPercent = (L * 100).toFixed(4);
  const cValue = C.toFixed(6);
  const hValue = h.toFixed(6);

  return `${lPercent}% ${cValue} ${hValue}`;
}

export const getContrastOklch = (hexColor: string): string => {
  return tinycolor(hexColor).isDark() ? '100% 0 0' : '0% 0 0';
};
