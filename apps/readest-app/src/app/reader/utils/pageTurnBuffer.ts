import type { Renderer } from '@/types/view';

type Rect = { x: number; y: number; width: number; height: number };
type Image = ArrayBuffer | ImageBitmap;
let owner: PageTurnBuffer | null = null;

/** Three decoded pages of one settled EPUB layout. Consumers own their copy. */
export class PageTurnBuffer {
  #pages = new Map<string, ImageBitmap>();
  #epoch = 0;
  #pending: Promise<unknown> = Promise.resolve();
  #preparing: Promise<unknown> | null = null;
  #disposed = false;

  constructor(
    private host: {
      renderer: Renderer;
      capture: (rect: Rect) => Promise<Image>;
      cover: (rect: Rect) => Promise<() => Promise<void>>;
      allowed: () => boolean;
    },
  ) {}

  /** Close cached bitmaps and invalidate captures from the preceding layout generation. */
  clear() {
    this.#epoch++;
    for (const bitmap of this.#pages.values()) bitmap.close();
    this.#pages.clear();
  }

  /** Permanently stop preparation and release cached bitmap ownership. */
  dispose() {
    this.#disposed = true;
    this.clear();
    if (owner === this) owner = null;
  }

  /** Release the previous reader's bitmap cache before retaining this reader's pages. */
  #claim() {
    if (owner && owner !== this) owner.clear();
    owner = this;
  }

  get preparing() {
    return this.#preparing;
  }

  /** Return a caller-owned bitmap copy, caching only captures whose layout remains valid. */
  async #read(key: string, capture: () => Promise<Image>, epoch: number, valid = () => true) {
    const cached = this.#pages.get(key);
    if (cached) {
      this.#pages.delete(key);
      this.#pages.set(key, cached);
      return createImageBitmap(cached);
    }
    const image = await capture();
    // A cancelled preview can finish encoding after the real page has moved.
    // Do not decode or retain those obsolete bytes on the interaction path.
    if (this.#disposed || epoch !== this.#epoch || !this.host.allowed() || !valid()) {
      if (!(image instanceof ArrayBuffer)) image.close();
      return null;
    }
    const bitmap =
      image instanceof ArrayBuffer ? await createImageBitmap(new Blob([image])) : image;
    if (this.#disposed || epoch !== this.#epoch || !this.host.allowed() || !valid()) {
      bitmap.close();
      return null;
    }
    this.#pages.set(key, bitmap);
    while (this.#pages.size > 3) {
      const oldest = this.#pages.keys().next().value!;
      this.#pages.get(oldest)!.close();
      this.#pages.delete(oldest);
    }
    return createImageBitmap(bitmap);
  }

  /** Capture the current page after outstanding previews have restored the viewport. */
  async capture(rect: Rect): Promise<Image> {
    this.#claim();
    await this.#pending;
    const key = this.host.renderer.getPageTurnKey?.();
    if (!key || this.#disposed) return this.host.capture(rect);
    return (
      (await this.#read(key, () => this.host.capture(rect), this.#epoch)) ?? this.host.capture(rect)
    );
  }

  /** The native cover hides previews; previewPage never emits a relocation. */
  prepare(rect: Rect, signal: AbortSignal): Promise<[ImageBitmap | null, ImageBitmap | null]> {
    this.#claim();
    const epoch = this.#epoch;
    const valid = () =>
      !this.#disposed && epoch === this.#epoch && !signal.aborted && this.host.allowed();
    const run = this.#pending.then(async (): Promise<[ImageBitmap | null, ImageBitmap | null]> => {
      const images: [ImageBitmap | null, ImageBitmap | null] = [null, null];
      if (!valid() || !this.host.renderer.previewPage) return images;
      const uncover = await this.host.cover(rect);
      try {
        for (const [slot, forward] of [
          [0, false],
          [1, true],
        ] as const) {
          if (!valid()) break;
          const key = this.host.renderer.getPageTurnKey?.(forward ? 1 : -1);
          if (!key) continue;
          // A visited page needs neither a preview nor another platform call.
          if (this.#pages.has(key)) {
            images[slot] = await this.#read(key, () => this.host.capture(rect), epoch);
            continue;
          }
          const result = await this.host.renderer.previewPage(
            forward,
            () => this.#read(key, () => this.host.capture(rect), epoch, valid),
            signal,
          );
          images[slot] = result?.value ?? null;
        }
      } catch (error) {
        for (const image of images) image?.close();
        throw error;
      } finally {
        await uncover();
      }
      if (!valid()) {
        for (const image of images) image?.close();
        return [null, null];
      }
      return images;
    });
    this.#pending = run.catch(() => {});
    const preparing = this.#pending.finally(() => {
      if (this.#preparing === preparing) this.#preparing = null;
    });
    this.#preparing = preparing;
    return run;
  }
}
