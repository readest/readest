// Fake Web Audio primitives for jsdom tests. The fake clock is manual:
// advanceTo(t) fires due onended callbacks in end-time order, awaiting
// microtasks between each so schedulers and waiters can react, matching how
// the real audio clock interleaves with the JS task queue.

import type {
  TTSAudioBuffer,
  TTSAudioBufferSourceNode,
  TTSAudioContext,
} from '@/services/tts/WebAudioPlayer';

export class FakeAudioBuffer implements TTSAudioBuffer {
  constructor(
    public samples: Float32Array,
    public readonly sampleRate: number,
  ) {}
  get length() {
    return this.samples.length;
  }
  get duration() {
    return this.samples.length / this.sampleRate;
  }
  getChannelData(_channel: number): Float32Array {
    return this.samples;
  }
  copyToChannel(source: Float32Array, _channel: number): void {
    this.samples.set(source.subarray(0, this.samples.length));
  }
}

export class FakeSourceNode implements TTSAudioBufferSourceNode {
  buffer: TTSAudioBuffer | null = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;
  connected = false;
  endedFired = false;

  constructor(private ctx: FakeAudioContext) {}

  connect(_destination: unknown): void {
    this.connected = true;
  }
  disconnect(): void {
    this.connected = false;
  }
  start(when = 0): void {
    this.startedAt = Math.max(when, this.ctx.currentTime);
    this.ctx.sources.push(this);
  }
  stop(_when?: number): void {
    this.stopped = true;
    this.onended?.();
  }
  get endTime(): number {
    return (this.startedAt ?? 0) + (this.buffer?.duration ?? 0);
  }
}

export class FakeAudioContext implements TTSAudioContext {
  currentTime = 0;
  state = 'running';
  destination = {};
  onstatechange: (() => void) | null = null;
  sources: FakeSourceNode[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;
  sampleRate: number;
  // Overridable resume behavior for interruption-refusal tests.
  resumeImpl: (() => void) | null = null;
  decodeImpl: (data: ArrayBuffer) => Promise<TTSAudioBuffer> = async (data) =>
    new FakeAudioBuffer(new Float32Array(data.byteLength), this.sampleRate);

  constructor(sampleRate = 24000) {
    this.sampleRate = sampleRate;
  }

  async resume(): Promise<void> {
    this.resumeCalls++;
    if (this.resumeImpl) {
      this.resumeImpl();
    } else {
      this.state = 'running';
    }
    this.onstatechange?.();
  }
  async suspend(): Promise<void> {
    this.suspendCalls++;
    this.state = 'suspended';
    this.onstatechange?.();
  }
  async close(): Promise<void> {
    this.closeCalls++;
    this.state = 'closed';
    this.onstatechange?.();
  }
  createBufferSource(): FakeSourceNode {
    return new FakeSourceNode(this);
  }
  createBuffer(_channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(new Float32Array(length), sampleRate);
  }
  decodeAudioData(data: ArrayBuffer): Promise<TTSAudioBuffer> {
    return this.decodeImpl(data);
  }

  setState(state: string): void {
    this.state = state;
    this.onstatechange?.();
  }

  async advanceTo(t: number): Promise<void> {
    for (;;) {
      const due = this.sources
        .filter((s) => s.startedAt !== null && !s.stopped && !s.endedFired && s.endTime <= t)
        .sort((a, b) => a.endTime - b.endTime)[0];
      if (!due) break;
      this.currentTime = Math.max(this.currentTime, due.endTime);
      due.endedFired = true;
      due.onended?.();
      await Promise.resolve();
      await Promise.resolve();
    }
    this.currentTime = Math.max(this.currentTime, t);
    await Promise.resolve();
    await Promise.resolve();
  }
}

export const makeBuffer = (seconds: number, sampleRate = 24000): FakeAudioBuffer =>
  new FakeAudioBuffer(new Float32Array(Math.round(seconds * sampleRate)), sampleRate);
