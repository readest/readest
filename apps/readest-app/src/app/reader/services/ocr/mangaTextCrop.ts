import type { MokuroPoint, MokuroTextLine } from '@/app/reader/services/manga/mokuroTextDetector';
import type { OcrBoundingBox } from '@/app/reader/services/ocr/types';

interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const TEXT_THICKNESS = 64;
const BORDER = 8;
const MAXIMUM_HORIZONTAL_RATIO = 8;
const MAXIMUM_VERTICAL_RATIO = 16;

const pixelOffset = (image: Pick<RgbaImage, 'width'>, x: number, y: number): number =>
  (y * image.width + x) * 4;

const pointDistance = (left: MokuroPoint, right: MokuroPoint): number =>
  Math.hypot(right.x - left.x, right.y - left.y);

const channelAt = (image: RgbaImage, x: number, y: number, channel: number): number => {
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const xWeight = Math.max(0, Math.min(1, x - Math.floor(x)));
  const yWeight = Math.max(0, Math.min(1, y - Math.floor(y)));
  const top =
    image.data[pixelOffset(image, x0, y0) + channel]! * (1 - xWeight) +
    image.data[pixelOffset(image, x1, y0) + channel]! * xWeight;
  const bottom =
    image.data[pixelOffset(image, x0, y1) + channel]! * (1 - xWeight) +
    image.data[pixelOffset(image, x1, y1) + channel]! * xWeight;
  return top * (1 - yWeight) + bottom * yWeight;
};

const perspectiveWarp = (
  image: RgbaImage,
  polygon: readonly MokuroPoint[],
  vertical: boolean,
): RgbaImage | null => {
  if (polygon.length !== 4) return null;
  const [topLeft, topRight, bottomRight, bottomLeft] = polygon;
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) return null;
  const sourceWidth =
    (pointDistance(topLeft, topRight) + pointDistance(bottomLeft, bottomRight)) / 2;
  const sourceHeight =
    (pointDistance(topLeft, bottomLeft) + pointDistance(topRight, bottomRight)) / 2;
  if (sourceWidth < 1 || sourceHeight < 1) return null;

  const height = vertical
    ? Math.min(
        TEXT_THICKNESS * MAXIMUM_VERTICAL_RATIO,
        Math.max(TEXT_THICKNESS, Math.round((TEXT_THICKNESS * sourceHeight) / sourceWidth)),
      )
    : TEXT_THICKNESS;
  const width = vertical
    ? TEXT_THICKNESS
    : Math.min(
        TEXT_THICKNESS * MAXIMUM_HORIZONTAL_RATIO,
        Math.max(1, Math.round((TEXT_THICKNESS * sourceWidth) / sourceHeight)),
      );
  const dx1 = topRight.x - bottomRight.x;
  const dx2 = bottomLeft.x - bottomRight.x;
  const dx3 = topLeft.x - topRight.x + bottomRight.x - bottomLeft.x;
  const dy1 = topRight.y - bottomRight.y;
  const dy2 = bottomLeft.y - bottomRight.y;
  const dy3 = topLeft.y - topRight.y + bottomRight.y - bottomLeft.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  const projective = Math.abs(dx3) + Math.abs(dy3) > 1e-6 && Math.abs(denominator) > 1e-6;
  const g = projective ? (dx3 * dy2 - dx2 * dy3) / denominator : 0;
  const h = projective ? (dx1 * dy3 - dx3 * dy1) / denominator : 0;
  const a = topRight.x - topLeft.x + g * topRight.x;
  const b = bottomLeft.x - topLeft.x + h * bottomLeft.x;
  const c = topLeft.x;
  const d = topRight.y - topLeft.y + g * topRight.y;
  const e = bottomLeft.y - topLeft.y + h * bottomLeft.y;
  const f = topLeft.y;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const v = height === 1 ? 0 : y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = width === 1 ? 0 : x / (width - 1);
      const scale = g * u + h * v + 1;
      const sourceX = (a * u + b * v + c) / scale;
      const sourceY = (d * u + e * v + f) / scale;
      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        data[target + channel] = channelAt(image, sourceX, sourceY, channel);
      }
    }
  }
  return { data, width, height };
};

const cropBox = (image: RgbaImage, box: OcrBoundingBox): RgbaImage | null => {
  const left = Math.max(0, Math.floor(box.xMin));
  const top = Math.max(0, Math.floor(box.yMin));
  const right = Math.min(image.width, Math.ceil(box.xMax));
  const bottom = Math.min(image.height, Math.ceil(box.yMax));
  if (right <= left || bottom <= top) return null;
  const width = right - left;
  const height = bottom - top;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const start = pixelOffset(image, left, top + y);
    data.set(image.data.subarray(start, start + width * 4), y * width * 4);
  }
  return { data, width, height };
};

export const readCanvasRgba = (canvas: HTMLCanvasElement): RgbaImage => {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('OCR could not read the manga page canvas');
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return { data: image.data, width: image.width, height: image.height };
};

export const makeMangaTextLineCrop = (
  source: HTMLCanvasElement,
  image: RgbaImage,
  line: MokuroTextLine,
): HTMLCanvasElement | null => {
  const cropped = perspectiveWarp(image, line.polygon, line.vertical) ?? cropBox(image, line.box);
  if (!cropped) return null;
  const doc = source.ownerDocument.defaultView?.frameElement?.ownerDocument ?? source.ownerDocument;
  const canvas = doc.createElement('canvas');
  canvas.width = cropped.width + BORDER * 2;
  canvas.height = cropped.height + BORDER * 2;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const imageData = context.createImageData(cropped.width, cropped.height);
  imageData.data.set(cropped.data);
  context.putImageData(imageData, BORDER, BORDER);
  return canvas;
};
