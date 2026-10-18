import type { NarrationClock } from './NarrationClock';

// Start the prepared browser clock from the media boundary itself, independently
// of the controller's next speak() or an in-progress section/page navigation.
export class AudioHandover {
  started = false;
  #timer: ReturnType<typeof setInterval>;
  #current: NarrationClock;
  #next: NarrationClock;
  #end: number;
  #start: number;
  #canStart: () => boolean;
  #check = () => {
    if (this.started || !this.#canStart()) return;
    if (this.#current.ended) {
      this.#onEnded();
      return;
    }
    if (this.#current.paused || this.#current.currentTime < this.#end) return;
    this.started = true;
    this.cancel();
    this.#current.pause();
    this.#next.currentTime = this.#start;
    void this.#next.play().catch(() => {
      this.started = false;
    });
  };

  constructor(
    current: NarrationClock,
    next: NarrationClock,
    end: number,
    start: number,
    canStart = () => true,
  ) {
    this.#current = current;
    this.#next = next;
    this.#end = end;
    this.#start = start;
    this.#canStart = canStart;
    current.addEventListener('timeupdate', this.#check);
    current.addEventListener('ended', this.#onEnded);
    this.#timer = setInterval(this.#check, 10);
  }

  #onEnded = () => {
    if (this.started || !this.#canStart()) return;
    // Container rounding can put EOF just before the final SMIL timestamp.
    this.started = true;
    this.cancel();
    this.#next.currentTime = this.#start;
    void this.#next.play().catch(() => {
      this.started = false;
    });
  };

  advance(): void {
    this.#check();
  }

  cancel(): void {
    clearInterval(this.#timer);
    this.#current.removeEventListener('timeupdate', this.#check);
    this.#current.removeEventListener('ended', this.#onEnded);
  }
}
