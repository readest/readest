import { md5 } from 'js-md5';

export function isMd5(value: string): boolean {
  return /^[0-9a-f]{32}$/.test(value);
}

export function md5Fingerprint(value: string): string {
  return md5(value).slice(0, 7);
}

export async function partialMD5(file: File): Promise<string> {
  const step = 1024;
  const size = 1024;

  const ranges: Array<[number, number]> = [];
  for (let i = -1; i <= 10; i++) {
    const start = Math.min(file.size, step << (2 * i));
    const end = Math.min(start + size, file.size);
    if (start >= file.size) break;
    ranges.push([start, end]);
  }
  const chunks = await Promise.all(
    ranges.map(([start, end]) => file.slice(start, end).arrayBuffer()),
  );
  const hasher = md5.create();
  for (const buf of chunks) {
    hasher.update(new Uint8Array(buf));
  }
  return hasher.hex();
}

export { md5 };
