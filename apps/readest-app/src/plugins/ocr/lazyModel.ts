/** A model that's loaded on first use, again after a failure, and released at the end. */
export class LazyModel<T> {
  readonly #load: (signal: AbortSignal) => Promise<T>;
  readonly #release: (model: T) => Promise<unknown>;
  readonly #runs = new Set<Promise<unknown>>();
  #attempt = new AbortController();
  #model: Promise<T> | null = null;
  #terminated = false;

  constructor(load: (signal: AbortSignal) => Promise<T>, release: (model: T) => Promise<unknown>) {
    this.#load = load;
    this.#release = release;
  }

  throwIfTerminated(): void {
    if (this.#terminated) throw new DOMException('OCR engine has been terminated', 'AbortError');
  }

  async load(): Promise<T> {
    this.throwIfTerminated();
    if (!this.#model) {
      const attempt = new AbortController();
      this.#attempt = attempt;
      this.#model = this.#load(attempt.signal).catch((error: unknown) => {
        // Stops what else it was loading.
        attempt.abort(error);
        if (this.#attempt === attempt) this.#model = null;
        throw error;
      });
    }
    const model = await this.#model;
    this.throwIfTerminated();
    return model;
  }

  async use<R>(work: (model: T) => Promise<R>): Promise<R> {
    const run = this.load().then(work);
    this.#runs.add(run);
    try {
      return await run;
    } finally {
      this.#runs.delete(run);
    }
  }

  /** Releases the model, for the next use to load it again. */
  async discard(): Promise<void> {
    const loading = this.#model;
    this.#model = null;
    this.#attempt.abort();
    const model = await loading?.catch(() => null);
    await Promise.allSettled(this.#runs);
    if (model) await this.#release(model);
  }

  async terminate(): Promise<void> {
    this.#terminated = true;
    await this.discard();
  }
}
