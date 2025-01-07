export class AsyncQueue<T> {
  private queue: T[] = [];
  private resolves: ((value: void) => void)[] = [];
  private done = false;

  enqueue(item: T) {
    this.queue.push(item);
    if (this.resolves.length > 0) {
      const resolve = this.resolves.shift();
      resolve?.();
    }
  }

  finish() {
    this.done = true;
    while (this.resolves.length > 0) {
      const resolve = this.resolves.shift();
      resolve?.();
    }
  }

  async dequeue(): Promise<T | null> {
    if (this.queue.length > 0) {
      return this.queue.shift()!;
    }
    if (this.done) {
      return null;
    }
    return new Promise<T | null>((resolve) => {
      this.resolves.push(() => {
        if (this.queue.length > 0) {
          resolve(this.queue.shift()!);
        } else {
          resolve(null);
        }
      });
    });
  }
}
