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
  const hasher = md5.create();

  for (let i = -1; i <= 10; i++) {
    const start = Math.min(file.size, step << (2 * i));
    const end = Math.min(start + size, file.size);

    if (start >= file.size) break;

    const blobSlice = file.slice(start, end);
    const arrayBuffer = await blobSlice.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    hasher.update(uint8Array);
  }

  return hasher.hex();
}
