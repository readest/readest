import type { ComicPoint, ComicTextLine } from './comicTextDetector';
import { createOcrCanvas, isHtmlCanvas, type OcrCanvas } from './canvas';

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** A line of text, or a part of a long one, as it's written on the page. */
export interface MangaTextCrop extends RgbaImage {
  vertical: boolean;
}

interface MangaTextCropOptions {
  split?: boolean;
  vertical?: boolean;
}

const TEXT_THICKNESS = 64;
export const MANGA_CROP_BORDER = 8;
const MAXIMUM_HORIZONTAL_RATIO = 8;
const MAXIMUM_VERTICAL_RATIO = 16;
const ANCHOR_WINDOW = TEXT_THICKNESS * 2;
const GAUSSIAN_LENGTH = TEXT_THICKNESS * 2;
const GAUSSIAN_SIGMA = TEXT_THICKNESS / 8;
// The distance, in standard deviations, from the middle of the kernel.
const CUT_POINT_KERNEL = Float64Array.from({ length: GAUSSIAN_LENGTH }, (_, index) => {
  const distance = (index - (GAUSSIAN_LENGTH - 1) / 2) / GAUSSIAN_SIGMA;
  return Math.exp(-(distance * distance) / 2);
});

type Polygon = readonly [ComicPoint, ComicPoint, ComicPoint, ComicPoint];

const getPolygon = ({ polygon, box }: ComicTextLine): Polygon =>
  polygon.length === 4
    ? (polygon as unknown as Polygon)
    : [
        { x: box.xMin, y: box.yMin },
        { x: box.xMax, y: box.yMin },
        { x: box.xMax, y: box.yMax },
        { x: box.xMin, y: box.yMax },
      ];

const pointDistance = (left: ComicPoint, right: ComicPoint): number =>
  Math.hypot(right.x - left.x, right.y - left.y);

const getWarpDimensions = (
  [topLeft, topRight, bottomRight, bottomLeft]: Polygon,
  vertical: boolean,
): { width: number; height: number } | null => {
  const sourceWidth =
    (pointDistance(topLeft, topRight) + pointDistance(bottomLeft, bottomRight)) / 2;
  const sourceHeight =
    (pointDistance(topLeft, bottomLeft) + pointDistance(topRight, bottomRight)) / 2;
  if (sourceWidth < 1 || sourceHeight < 1) return null;
  return vertical
    ? {
        width: TEXT_THICKNESS,
        height: Math.max(TEXT_THICKNESS, Math.round((TEXT_THICKNESS * sourceHeight) / sourceWidth)),
      }
    : {
        width: Math.max(1, Math.round((TEXT_THICKNESS * sourceWidth) / sourceHeight)),
        height: TEXT_THICKNESS,
      };
};

const perspectiveWarp = (
  image: RgbaImage,
  [topLeft, topRight, bottomRight, bottomLeft]: Polygon,
  width: number,
  height: number,
): Uint8ClampedArray => {
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
  const { data: pixels, width: sourceWidth, height: sourceHeight } = image;
  const data = new Uint8ClampedArray(width * height * 4);

  let target = 0;
  for (let y = 0; y < height; y += 1) {
    const v = height === 1 ? 0 : y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = width === 1 ? 0 : x / (width - 1);
      const scale = g * u + h * v + 1;
      const sourceX = (a * u + b * v + c) / scale;
      const sourceY = (d * u + e * v + f) / scale;
      const column = Math.floor(sourceX);
      const row = Math.floor(sourceY);
      const xWeight = sourceX - column;
      const yWeight = sourceY - row;
      const x0 = Math.max(0, Math.min(sourceWidth - 1, column));
      const y0 = Math.max(0, Math.min(sourceHeight - 1, row)) * sourceWidth;
      const right = x0 < sourceWidth - 1 ? 4 : 0;
      const below = y0 < (sourceHeight - 1) * sourceWidth ? sourceWidth * 4 : 0;
      const pixel = (y0 + x0) * 4;
      for (let channel = pixel; channel < pixel + 4; channel += 1) {
        const top = pixels[channel]! * (1 - xWeight) + pixels[channel + right]! * xWeight;
        const bottom =
          pixels[channel + below]! * (1 - xWeight) + pixels[channel + below + right]! * xWeight;
        data[target++] = top * (1 - yWeight) + bottom * yWeight;
      }
    }
  }
  return data;
};

/** Where to cut a line, along its text, so that it doesn't cut through a letter. */
const findCutPoints = (
  { data, width, height, vertical }: MangaTextCrop,
  chunks: number,
): number[] => {
  const length = vertical ? height : width;
  const along = vertical ? width * 4 : 4;
  const across = vertical ? 4 : width * 4;
  // How much the green of the pixels changes across the line, which is little
  // between two letters.
  const density = new Float64Array(length);
  for (let position = 0; position < length; position += 1) {
    let pixel = position * along + 1;
    for (let row = 1; row < TEXT_THICKNESS; row += 1) {
      density[position]! += Math.abs(data[pixel + across]! - data[pixel]!);
      pixel += across;
    }
  }
  const getSmoothed = (position: number): number => {
    let sum = 0;
    for (let offset = 0; offset < GAUSSIAN_LENGTH; offset += 1) {
      const source = position + offset - GAUSSIAN_LENGTH / 2;
      if (source >= 0 && source < length) sum += density[source]! * CUT_POINT_KERNEL[offset]!;
    }
    return sum;
  };
  return Array.from({ length: chunks - 1 }, (_, index) => {
    const anchor = Math.round((length * (index + 1)) / chunks);
    const start = Math.max(1, anchor - ANCHOR_WINDOW / 2);
    const end = Math.min(length - 1, anchor + ANCHOR_WINDOW / 2);
    let best = start;
    let least = getSmoothed(start);
    for (let position = start + 1; position < end; position += 1) {
      const value = getSmoothed(position);
      if (value < least) [best, least] = [position, value];
    }
    return best;
  });
};

const sliceCrop = (crop: MangaTextCrop, start: number, end: number): MangaTextCrop => {
  const { data, width, height, vertical } = crop;
  if (vertical) {
    return {
      ...crop,
      data: data.subarray(start * width * 4, end * width * 4),
      height: end - start,
    };
  }
  const sliced = new Uint8ClampedArray((end - start) * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    sliced.set(data.subarray((row + start) * 4, (row + end) * 4), y * (end - start) * 4);
  }
  return { ...crop, data: sliced, width: end - start };
};

export const readCanvasRgba = (canvas: OcrCanvas): RgbaImage => {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('OCR could not read the manga page canvas');
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return { data: image.data, width: image.width, height: image.height };
};

export const makeMangaTextCrops = (
  image: RgbaImage,
  line: ComicTextLine,
  { split = true, vertical = line.vertical }: MangaTextCropOptions = {},
): MangaTextCrop[] => {
  const polygon = getPolygon(line);
  const dimensions = getWarpDimensions(polygon, vertical);
  if (!dimensions) return [];
  const { width, height } = dimensions;
  const crop = { data: perspectiveWarp(image, polygon, width, height), width, height, vertical };
  const length = vertical ? height : width;
  const maximumRatio = vertical ? MAXIMUM_VERTICAL_RATIO : MAXIMUM_HORIZONTAL_RATIO;
  const chunks = split ? Math.ceil(length / TEXT_THICKNESS / maximumRatio) : 1;
  if (chunks === 1) return [crop];
  const boundaries = [0, ...findCutPoints(crop, chunks), length];
  return boundaries.slice(1).flatMap((end, index) => {
    const start = boundaries[index]!;
    return end > start ? [sliceCrop(crop, start, end)] : [];
  });
};

/** Draws a crop, in the document of `source` when that's an HTML canvas. */
export const drawMangaTextCrop = (
  crop: MangaTextCrop,
  border: number,
  source?: OcrCanvas,
): OcrCanvas => {
  const canvas = createOcrCanvas(
    crop.width + border * 2,
    crop.height + border * 2,
    isHtmlCanvas(source) ? source : undefined,
  );
  const context = canvas.getContext('2d');
  if (!context) throw new Error('OCR could not draw the text crop');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const imageData = context.createImageData(crop.width, crop.height);
  imageData.data.set(crop.data);
  context.putImageData(imageData, border, border);
  return canvas;
};
