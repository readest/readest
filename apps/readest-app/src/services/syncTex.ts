import { gunzipSync } from 'fflate';

export interface SyncTexRecord {
  page: number;
  input: number;
  line: number;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

export interface SyncTexIndex {
  inputs: Map<number, string>;
  records: SyncTexRecord[];
}

export interface SyncTexLocation extends Omit<SyncTexRecord, 'input'> {
  sourceFile: string;
}

const SCALED_POINTS_PER_BIG_POINT = 65_781.76;

const decodeSyncTex = (input: string | Uint8Array | ArrayBuffer): string => {
  if (typeof input === 'string') return input.replace(/\r\n?/g, '\n');
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  return new TextDecoder().decode(bytes).replace(/\r\n?/g, '\n');
};

export const parseSyncTex = (input: string | Uint8Array | ArrayBuffer): SyncTexIndex => {
  const text = decodeSyncTex(input);
  if (!text.startsWith('SyncTeX Version:') || !text.includes('\nContent:\n')) {
    throw new Error('SyncTeX 文件无效');
  }

  const inputs = new Map<number, string>();
  let unit = 1;
  let magnification = 1000;
  let xOffset = 0;
  let yOffset = 0;
  let page = 0;
  const records: SyncTexRecord[] = [];

  for (const line of text.split('\n')) {
    const inputMatch = line.match(/^Input:(\d+):(.*)$/);
    if (inputMatch) {
      inputs.set(Number(inputMatch[1]), inputMatch[2]!);
      continue;
    }
    if (line.startsWith('Unit:')) unit = Number(line.slice(5)) || 1;
    else if (line.startsWith('Magnification:')) magnification = Number(line.slice(14)) || 1000;
    else if (line.startsWith('X Offset:')) xOffset = Number(line.slice(9)) || 0;
    else if (line.startsWith('Y Offset:')) yOffset = Number(line.slice(9)) || 0;
    else if (/^\{\d+$/.test(line)) page = Number(line.slice(1));
    else if (/^\}\d+$/.test(line)) page = 0;
    else if (page > 0) {
      const recordMatch = line.match(
        /^[([hvkxg](\d+),(\d+)(?::\d+)?:([+-]?\d+),([+-]?\d+)(?::([+-]?\d+),([+-]?\d+),([+-]?\d+))?/,
      );
      if (!recordMatch) continue;
      const scale = (unit * magnification) / 1000 / SCALED_POINTS_PER_BIG_POINT;
      records.push({
        page,
        input: Number(recordMatch[1]),
        line: Number(recordMatch[2]),
        x: (Number(recordMatch[3]) + xOffset) * scale,
        y: (Number(recordMatch[4]) + yOffset) * scale,
        width: Number(recordMatch[5] ?? 0) * scale,
        height: Number(recordMatch[6] ?? 0) * scale,
        depth: Number(recordMatch[7] ?? 0) * scale,
      });
    }
  }

  if (inputs.size === 0 || records.length === 0) throw new Error('SyncTeX 文件无效');
  return { inputs, records };
};

const normalizedPath = (value: string) => value.replace(/\\/g, '/').toLocaleLowerCase();

const matchesSourceFile = (actual: string, requested: string) => {
  const normalizedActual = normalizedPath(actual);
  const normalizedRequested = normalizedPath(requested);
  return (
    normalizedActual === normalizedRequested ||
    normalizedActual.endsWith(`/${normalizedRequested.split('/').pop()}`)
  );
};

const location = (index: SyncTexIndex, record: SyncTexRecord): SyncTexLocation => ({
  ...record,
  sourceFile: index.inputs.get(record.input)!,
});

export const findPdfLocation = (
  index: SyncTexIndex,
  sourceFile: string,
  line: number,
): SyncTexLocation | null => {
  const candidates = index.records.filter((record) => {
    const input = index.inputs.get(record.input);
    return input?.toLocaleLowerCase().endsWith('.tex') && matchesSourceFile(input, sourceFile);
  });
  candidates.sort(
    (left, right) =>
      Math.abs(left.line - line) - Math.abs(right.line - line) ||
      left.page - right.page ||
      left.y - right.y,
  );
  return candidates[0] ? location(index, candidates[0]) : null;
};

const distanceToRecord = (record: SyncTexRecord, x: number, y: number) => {
  const right = record.x + Math.max(record.width, 0);
  const top = record.y - Math.max(record.height, 0);
  const bottom = record.y + Math.max(record.depth, 0);
  const dx = x < record.x ? record.x - x : x > right ? x - right : 0;
  const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
  return dx * dx + dy * dy;
};

export const findSourceLocation = (
  index: SyncTexIndex,
  page: number,
  x: number,
  y: number,
): SyncTexLocation | null => {
  const candidates = index.records.filter((record) => {
    const input = index.inputs.get(record.input);
    return record.page === page && input?.toLocaleLowerCase().endsWith('.tex');
  });
  candidates.sort(
    (left, right) =>
      distanceToRecord(left, x, y) - distanceToRecord(right, x, y) ||
      Math.abs(left.y - y) - Math.abs(right.y - y),
  );
  return candidates[0] ? location(index, candidates[0]) : null;
};
