import { describe, it, expect, vi } from 'vitest';
import { PageTurnBuffer } from '@/app/reader/utils/pageTurnBuffer';
import type { Renderer } from '@/types/view';

const rect = { x: 0, y: 0, width: 32, height: 48 };
const fixture = () => {
  let page = 1;
  const capture = vi.fn(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = ['red', 'green', 'blue', 'yellow', 'black'][page]!;
    ctx.fillRect(0, 0, 32, 48);
    return createImageBitmap(canvas);
  });
  const renderer = {
    getPageTurnKey: (delta = 0) => String(page + delta),
    previewPage: async <T>(forward: boolean, read: () => Promise<T>) => {
      const original = page;
      page += forward ? 1 : -1;
      try {
        return { key: String(page), value: await read() };
      } finally {
        page = original;
      }
    },
  } as Renderer;
  const uncover = vi.fn(async () => {});
  const buffer = new PageTurnBuffer({
    renderer,
    capture,
    cover: async () => uncover,
    allowed: () => true,
  });
  return {
    buffer,
    capture,
    uncover,
    setPage: (value: number) => {
      page = value;
    },
  };
};

describe('decoded EPUB page buffer', () => {
  it('prepares both neighbours and reuses the destination without another native capture', async () => {
    const f = fixture();
    try {
      ((await f.buffer.capture(rect)) as ImageBitmap).close();
      const images = await f.buffer.prepare(rect, new AbortController().signal);
      images.forEach((image) => image?.close());
      expect(f.capture).toHaveBeenCalledTimes(3);
      expect(f.uncover).toHaveBeenCalledOnce();
      f.setPage(2);
      const destination = (await f.buffer.capture(rect)) as ImageBitmap;
      expect(destination.width).toBe(32);
      destination.close();
      expect(f.capture).toHaveBeenCalledTimes(3);
    } finally {
      f.buffer.dispose();
    }
  });

  it('drops old pixels on layout invalidation and keeps at most three pages', async () => {
    const f = fixture();
    try {
      for (let page = 0; page < 4; page++) {
        f.setPage(page);
        ((await f.buffer.capture(rect)) as ImageBitmap).close();
      }
      f.setPage(0);
      ((await f.buffer.capture(rect)) as ImageBitmap).close();
      expect(f.capture).toHaveBeenCalledTimes(5);
      f.buffer.clear();
      ((await f.buffer.capture(rect)) as ImageBitmap).close();
      expect(f.capture).toHaveBeenCalledTimes(6);
    } finally {
      f.buffer.dispose();
    }
  });

  it('does not preview after a gesture has cancelled speculative work', async () => {
    const f = fixture();
    const abort = new AbortController();
    abort.abort();
    try {
      expect(await f.buffer.prepare(rect, abort.signal)).toEqual([null, null]);
      expect(f.capture).not.toHaveBeenCalled();
      expect(f.uncover).not.toHaveBeenCalled();
    } finally {
      f.buffer.dispose();
    }
  });

  it('does not cache a snapshot whose preview was cancelled in flight', async () => {
    const f = fixture();
    const abort = new AbortController();
    let complete!: (image: ImageBitmap) => void;
    f.capture.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    try {
      const preparing = f.buffer.prepare(rect, abort.signal);
      await vi.waitFor(() => expect(f.capture).toHaveBeenCalledOnce());
      abort.abort();
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 48;
      complete(await createImageBitmap(canvas));
      expect(await preparing).toEqual([null, null]);
      expect(f.uncover).toHaveBeenCalledOnce();
      f.setPage(0);
      ((await f.buffer.capture(rect)) as ImageBitmap).close();
      expect(f.capture).toHaveBeenCalledTimes(2);
    } finally {
      f.buffer.dispose();
    }
  });
});
