import type {
  MokuroMask,
  MokuroPageSize,
  MokuroPoint,
  MokuroTextLine,
} from '@/app/reader/services/manga/mokuroTextDetector';

interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface RasterImage {
  data: ArrayLike<number>;
  width: number;
  height: number;
  channels: number;
}

interface MangaTextCropOptions {
  keepVertical?: boolean;
  mask?: MokuroMask;
  page?: MokuroPageSize;
  vertical?: boolean;
}

const TEXT_THICKNESS = 64;
const BORDER = 8;
const MAXIMUM_HORIZONTAL_RATIO = 8;
const MAXIMUM_VERTICAL_RATIO = 16;
const ANCHOR_WINDOW = TEXT_THICKNESS * 2;
const GAUSSIAN_LENGTH = TEXT_THICKNESS * 2;
const GAUSSIAN_SIGMA = TEXT_THICKNESS / 8;

const pointDistance = (left: MokuroPoint, right: MokuroPoint): number =>
  Math.hypot(right.x - left.x, right.y - left.y);

const getWarpDimensions = (
  polygon: readonly MokuroPoint[],
  vertical: boolean,
): { width: number; height: number } | null => {
  if (polygon.length !== 4) return null;
  const [topLeft, topRight, bottomRight, bottomLeft] = polygon;
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) return null;
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
  image: RasterImage,
  polygon: readonly MokuroPoint[],
  width: number,
  height: number,
): RasterImage | null => {
  if (polygon.length !== 4) return null;
  const [topLeft, topRight, bottomRight, bottomLeft] = polygon;
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) return null;
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
  const data = new Uint8ClampedArray(width * height * image.channels);

  for (let y = 0; y < height; y += 1) {
    const v = height === 1 ? 0 : y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = width === 1 ? 0 : x / (width - 1);
      const scale = g * u + h * v + 1;
      const sourceX = (a * u + b * v + c) / scale;
      const sourceY = (d * u + e * v + f) / scale;
      const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(sourceX)));
      const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(sourceY)));
      const x1 = Math.min(image.width - 1, x0 + 1);
      const y1 = Math.min(image.height - 1, y0 + 1);
      const xWeight = Math.max(0, Math.min(1, sourceX - Math.floor(sourceX)));
      const yWeight = Math.max(0, Math.min(1, sourceY - Math.floor(sourceY)));
      const topLeft = (y0 * image.width + x0) * image.channels;
      const topRight = (y0 * image.width + x1) * image.channels;
      const bottomLeft = (y1 * image.width + x0) * image.channels;
      const bottomRight = (y1 * image.width + x1) * image.channels;
      const target = (y * width + x) * image.channels;
      for (let channel = 0; channel < image.channels; channel += 1) {
        const top =
          Number(image.data[topLeft + channel]) * (1 - xWeight) +
          Number(image.data[topRight + channel]) * xWeight;
        const bottom =
          Number(image.data[bottomLeft + channel]) * (1 - xWeight) +
          Number(image.data[bottomRight + channel]) * xWeight;
        data[target + channel] = top * (1 - yWeight) + bottom * yWeight;
      }
    }
  }
  return { data, width, height, channels: image.channels };
};

const rotateCounterClockwise = (image: RasterImage): RasterImage => {
  const width = image.height;
  const height = image.width;
  const data = new Uint8ClampedArray(width * height * image.channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = image.width - 1 - y;
      const sourceY = x;
      const source = (sourceY * image.width + sourceX) * image.channels;
      for (let channel = 0; channel < image.channels; channel += 1) {
        data[(y * width + x) * image.channels + channel] = Number(image.data[source + channel]);
      }
    }
  }
  return { data, width, height, channels: image.channels };
};

const rotateClockwise = (image: RasterImage): RasterImage => {
  const width = image.height;
  const height = image.width;
  const data = new Uint8ClampedArray(width * height * image.channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = y;
      const sourceY = image.height - 1 - x;
      const source = (sourceY * image.width + sourceX) * image.channels;
      for (let channel = 0; channel < image.channels; channel += 1) {
        data[(y * width + x) * image.channels + channel] = Number(image.data[source + channel]);
      }
    }
  }
  return { data, width, height, channels: image.channels };
};

const gaussianKernel = (): Float64Array => {
  const kernel = new Float64Array(GAUSSIAN_LENGTH);
  const center = (GAUSSIAN_LENGTH - 1) / 2;
  for (let index = 0; index < kernel.length; index += 1) {
    const distance = (index - center) / GAUSSIAN_SIGMA;
    kernel[index] = Math.exp(-(distance * distance) / 2);
  }
  return kernel;
};

const CUT_POINT_KERNEL = gaussianKernel();

const findCutPoints = (mask: RasterImage | undefined, width: number, chunks: number): number[] => {
  const anchors = Array.from({ length: chunks - 1 }, (_, index) =>
    Math.round((width * (index + 1)) / chunks),
  );
  if (!mask || mask.width !== width || mask.height <= 0) return anchors;
  const density = new Float64Array(width);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < mask.height; y += 1) {
      density[x] = density[x]! + Number(mask.data[(y * width + x) * mask.channels]);
    }
  }
  const kernel = CUT_POINT_KERNEL;
  const radius = Math.floor(kernel.length / 2);
  const smoothed = new Float64Array(width);
  for (let x = 0; x < width; x += 1) {
    for (let offset = 0; offset < kernel.length; offset += 1) {
      const sourceX = x + offset - radius;
      if (sourceX >= 0 && sourceX < width) {
        smoothed[x] = smoothed[x]! + density[sourceX]! * kernel[offset]!;
      }
    }
  }
  return anchors.map((anchor) => {
    const start = Math.max(1, anchor - Math.floor(ANCHOR_WINDOW / 2));
    const end = Math.min(width - 1, anchor + Math.ceil(ANCHOR_WINDOW / 2));
    let best = start;
    for (let x = start + 1; x < end; x += 1) {
      if (smoothed[x]! < smoothed[best]!) best = x;
    }
    return best;
  });
};

const sliceRaster = (image: RasterImage, left: number, right: number): RasterImage => {
  const width = right - left;
  const data = new Uint8ClampedArray(width * image.height * image.channels);
  for (let y = 0; y < image.height; y += 1) {
    const source = (y * image.width + left) * image.channels;
    const target = y * width * image.channels;
    for (let index = 0; index < width * image.channels; index += 1) {
      data[target + index] = Number(image.data[source + index]);
    }
  }
  return { data, width, height: image.height, channels: image.channels };
};

const splitRaster = (
  image: RasterImage,
  mask: RasterImage | undefined,
  maximumRatio: number,
): RasterImage[] => {
  const chunks = Math.ceil(image.width / image.height / maximumRatio);
  if (chunks <= 1) return [image];
  const boundaries = [0, ...findCutPoints(mask, image.width, chunks), image.width];
  return boundaries.slice(0, -1).flatMap((left, index) => {
    const right = boundaries[index + 1]!;
    return right > left ? [sliceRaster(image, left, right)] : [];
  });
};

const scalePolygon = (
  polygon: readonly MokuroPoint[],
  from: MokuroPageSize,
  to: MokuroPageSize,
): MokuroPoint[] =>
  polygon.map(({ x, y }) => ({
    x: (x * to.width) / from.width,
    y: (y * to.height) / from.height,
  }));

const makeCanvas = (source: HTMLCanvasElement, image: RasterImage): HTMLCanvasElement | null => {
  if (image.channels !== 4) return null;
  const doc = source.ownerDocument.defaultView?.frameElement?.ownerDocument ?? source.ownerDocument;
  const canvas = doc.createElement('canvas');
  canvas.width = image.width + BORDER * 2;
  canvas.height = image.height + BORDER * 2;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const imageData = context.createImageData(image.width, image.height);
  imageData.data.set(image.data);
  context.putImageData(imageData, BORDER, BORDER);
  return canvas;
};

export const readCanvasRgba = (canvas: HTMLCanvasElement): RgbaImage => {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('OCR could not read the manga page canvas');
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return { data: image.data, width: image.width, height: image.height };
};

export const makeMangaTextLineCrops = (
  source: HTMLCanvasElement,
  image: RgbaImage,
  line: MokuroTextLine,
  options: MangaTextCropOptions = {},
): HTMLCanvasElement[] => {
  const vertical = options.vertical ?? line.vertical;
  const polygon =
    line.polygon.length === 4
      ? line.polygon
      : [
          { x: line.box.xMin, y: line.box.yMin },
          { x: line.box.xMax, y: line.box.yMin },
          { x: line.box.xMax, y: line.box.yMax },
          { x: line.box.xMin, y: line.box.yMax },
        ];
  const dimensions = getWarpDimensions(polygon, vertical);
  if (!dimensions) return [];
  const warped = perspectiveWarp(
    { ...image, channels: 4 },
    polygon,
    dimensions.width,
    dimensions.height,
  );
  if (!warped) return [];
  const normalized = vertical ? rotateCounterClockwise(warped) : warped;
  const maximumRatio = vertical ? MAXIMUM_VERTICAL_RATIO : MAXIMUM_HORIZONTAL_RATIO;
  const needsSplit = normalized.width > normalized.height * maximumRatio;
  const maskPolygon =
    needsSplit && options.mask && options.page
      ? scalePolygon(polygon, options.page, {
          width: options.mask.width,
          height: options.mask.height,
        })
      : undefined;
  const warpedMask =
    options.mask && maskPolygon
      ? (perspectiveWarp(
          { ...options.mask, channels: 1 },
          maskPolygon,
          dimensions.width,
          dimensions.height,
        ) ?? undefined)
      : undefined;
  const normalizedMask = vertical && warpedMask ? rotateCounterClockwise(warpedMask) : warpedMask;
  const chunks = splitRaster(normalized, normalizedMask, maximumRatio);
  return chunks.flatMap((chunk) => {
    const oriented = vertical && options.keepVertical ? rotateClockwise(chunk) : chunk;
    const canvas = makeCanvas(source, oriented);
    return canvas ? [canvas] : [];
  });
};
