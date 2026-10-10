import type { TTSWordBoundary } from '@/libs/edgeTTS';
import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken, getSubscriptionPlan, isTTSInPlan } from '@/utils/access';
import { fetchWithAuth } from '@/utils/fetch';
import { readNDJSON } from '@/utils/ndjson';
import { estimateSentenceSeconds } from '../ttsDuration';
import type { TTSVoice } from '../types';
import {
  type PrefetchOptions,
  type SpeechProvider,
  SpeechSynthesisFatalError,
  SpeechSynthesisPermanentError,
  type SpeechSynthesisRequest,
  type SpeechSynthesisResult,
  type TTSLane,
} from './types';

// Readest Voice: premium voices synthesized on a GPU worker behind
// /api/tts/readest/stream. Sentences are requested in windows (one RunPod job
// per window, one NDJSON line back per sentence), one window in flight per
// lane:
// - listen: windows grow 1 -> 4 -> 8 sentences so the first audio after play,
//   seek or a voice change waits for one sentence only, and hold at most about
//   20 s of estimated audio: a sentence that falls due waits behind the window
//   in flight. Requests the current paragraph is waiting on fill a window
//   before background preloads of later paragraphs, never mixing languages.
// - download: chapter downloads, up to 64 sentences per window.
// A sentence stays requested while any caller that asked for it is still
// interested; once every such signal is aborted it is withdrawn, and a window
// nobody wants any more is aborted, which cancels its GPU job server-side.

export const DAILY_QUOTA_EXCEEDED = 'DAILY_QUOTA_EXCEEDED';

const LISTEN_WINDOW_SIZES = [1, 4, 8];
const LISTEN_WINDOW_CHARS = 2000;
const LISTEN_WINDOW_SEC = 20;
const DOWNLOAD_WINDOW_SENTENCES = 64;
const DOWNLOAD_WINDOW_CHARS = 12000;
const BUSY_RETRY_MS = 5000;
// Route codes that will fail again for the same sentences.
const PERMANENT_CODES = new Set(['UNKNOWN_VOICE', 'VOICE_TIER_REQUIRED', 'INVALID_INPUT']);

interface Entry {
  key: string;
  req: SpeechSynthesisRequest;
  background: boolean;
  // Signals of the callers still interested in this sentence.
  wanted: Set<AbortSignal>;
  settled: boolean;
  promise: Promise<SpeechSynthesisResult>;
  resolve: (result: SpeechSynthesisResult) => void;
  reject: (error: unknown) => void;
}

interface Lane {
  name: TTSLane;
  queue: Entry[];
  inflight: { entries: Entry[]; controller: AbortController } | null;
  // Listen lane: position in LISTEN_WINDOW_SIZES for the next window.
  sizeIndex: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

interface WindowLine {
  id?: unknown;
  audio?: unknown;
  boundaries?: unknown;
  error?: unknown;
  done?: unknown;
}

const abortError = () => new DOMException('Aborted', 'AbortError');
const entryKey = (req: SpeechSynthesisRequest) => `${req.voice}\u0000${req.lang}\u0000${req.text}`;

const decodeBase64 = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
};

const newLane = (name: TTSLane): Lane => ({
  name,
  queue: [],
  inflight: null,
  sizeIndex: 0,
  retryTimer: null,
});

export class ReadestVoiceProvider implements SpeechProvider {
  readonly id = 'readest-tts';
  readonly label = 'Readest Voice';
  readonly cacheable = true;
  // A sentence in a language without a Readest voice is skipped, never read
  // with a wrong-language voice.
  readonly sameLanguageVoicesOnly = true;

  readonly #events: EventTarget | undefined;
  #voices: Promise<TTSVoice[]> | null = null;
  #quotaExhausted = false;
  #warmupFired = false;
  readonly #entries = new Map<string, Entry>();
  readonly #lanes: Record<TTSLane, Lane> = {
    listen: newLane('listen'),
    download: newLane('download'),
  };
  readonly #watched = new WeakSet<AbortSignal>();

  // `events` receives tts-quota-exceeded.
  constructor(events?: EventTarget) {
    this.#events = events;
  }

  // BufferedTTSClient calls getAllVoices before init: both share one request.
  getAllVoices(): Promise<TTSVoice[]> {
    this.#voices ??= this.#fetchVoices();
    return this.#voices;
  }

  async init(): Promise<boolean> {
    // A new session (or day) may have fresh quota.
    this.#quotaExhausted = false;
    const voices = await this.getAllVoices();
    this.#voices = null; // the next init asks again (plan or catalog may change)
    return voices.length > 0;
  }

  // Boots a worker when the voice picker opens; once per provider.
  warmup(): void {
    if (this.#warmupFired) return;
    this.#warmupFired = true;
    fetchWithAuth(`${getAPIBaseUrl()}/tts/readest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warmup: true }),
    }).catch(() => {});
  }

  synthesize(
    req: SpeechSynthesisRequest,
    signal: AbortSignal,
    options?: PrefetchOptions,
  ): Promise<SpeechSynthesisResult> {
    if (this.#quotaExhausted) {
      return Promise.reject(new SpeechSynthesisFatalError(DAILY_QUOTA_EXCEEDED));
    }
    // No Readest voice for this sentence's language: skip it rather than read
    // it with a wrong-language voice.
    if (!req.voice) {
      return Promise.reject(
        new SpeechSynthesisPermanentError('no Readest Voice for this language'),
      );
    }
    if (signal.aborted) return Promise.reject(abortError());
    const background = !!options?.background;
    let entry = this.#entries.get(entryKey(req));
    if (entry) {
      this.#want(entry, signal);
      if (!background) entry.background = false;
    } else {
      entry = this.#enqueue(req, this.#lanes.listen, signal, background, !background);
    }
    this.#pumpAll();
    const consumed = entry;
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortError());
      signal.addEventListener('abort', onAbort, { once: true });
      consumed.promise
        .then((result) => {
          // Consumed: a later request for the same sentence synthesizes again.
          if (this.#entries.get(consumed.key) === consumed) this.#entries.delete(consumed.key);
          resolve({ audio: result.audio.slice(0), boundaries: result.boundaries });
        }, reject)
        .finally(() => signal.removeEventListener('abort', onAbort));
    });
  }

  prefetch(
    reqs: SpeechSynthesisRequest[],
    lane: TTSLane,
    signal: AbortSignal,
    options?: PrefetchOptions,
  ): void {
    if (this.#quotaExhausted || signal.aborted) return;
    const background = lane === 'listen' && !!options?.background;
    const onDelivered = options?.onDelivered;
    for (const req of reqs) {
      if (!req.voice) continue;
      let entry = this.#entries.get(entryKey(req));
      if (entry) {
        this.#want(entry, signal);
        if (!background) entry.background = false;
      } else {
        entry = this.#enqueue(req, this.#lanes[lane], signal, background, false);
      }
      if (onDelivered)
        entry.promise.then(
          (result) => onDelivered(req, result),
          () => {},
        );
    }
    this.#pumpAll();
  }

  async shutdown(): Promise<void> {
    for (const lane of Object.values(this.#lanes)) {
      if (lane.retryTimer) clearTimeout(lane.retryTimer);
      lane.retryTimer = null;
      lane.queue = [];
      lane.inflight?.controller.abort();
    }
    for (const entry of this.#entries.values()) this.#settle(entry, abortError());
    this.#entries.clear();
  }

  async #fetchVoices(): Promise<TTSVoice[]> {
    try {
      const token = await getAccessToken();
      // Cheap local gate; the route re-checks the plan on every request.
      if (!token || !isTTSInPlan(getSubscriptionPlan(token))) return [];
      const res = await fetchWithAuth(`${getAPIBaseUrl()}/tts/readest`, { method: 'GET' });
      const data = (await res.json()) as { voices?: TTSVoice[] };
      return Array.isArray(data.voices)
        ? data.voices.map(({ id, name, lang }) => ({ id, name, lang }))
        : [];
    } catch {
      // 503 kill switch, 403 lapsed plan, offline: the engine is unavailable.
      return [];
    }
  }

  #enqueue(
    req: SpeechSynthesisRequest,
    lane: Lane,
    signal: AbortSignal,
    background: boolean,
    front: boolean,
  ): Entry {
    let resolve!: Entry['resolve'];
    let reject!: Entry['reject'];
    const promise = new Promise<SpeechSynthesisResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => {}); // a prefetch nobody consumes must not surface
    const entry: Entry = {
      key: entryKey(req),
      req,
      background,
      wanted: new Set(),
      settled: false,
      promise,
      resolve,
      reject,
    };
    this.#entries.set(entry.key, entry);
    if (front) lane.queue.unshift(entry);
    else lane.queue.push(entry);
    this.#want(entry, signal);
    return entry;
  }

  #want(entry: Entry, signal: AbortSignal) {
    entry.wanted.add(signal);
    if (this.#watched.has(signal)) return;
    this.#watched.add(signal);
    signal.addEventListener('abort', () => this.#onAbort(signal), { once: true });
  }

  // A caller went away (stop, seek, voice change, cancelled download).
  #onAbort(signal: AbortSignal) {
    let hadForeground = false;
    for (const entry of [...this.#entries.values()]) {
      if (!entry.wanted.delete(signal)) continue;
      if (!entry.background) hadForeground = true;
      if (entry.wanted.size === 0) {
        this.#settle(entry, abortError());
        this.#entries.delete(entry.key);
      }
    }
    // The next listen window starts small again: first audio waits for one.
    if (hadForeground) this.#lanes.listen.sizeIndex = 0;
    for (const lane of Object.values(this.#lanes)) {
      const inflight = lane.inflight;
      if (inflight?.entries.every((e) => e.settled || e.wanted.size === 0)) {
        inflight.controller.abort();
      }
    }
    this.#pumpAll();
  }

  #settle(entry: Entry, error: unknown) {
    if (entry.settled) return;
    entry.settled = true;
    entry.reject(error);
  }

  #fail(entry: Entry, error: unknown) {
    this.#settle(entry, error);
    if (this.#entries.get(entry.key) === entry) this.#entries.delete(entry.key);
  }

  #pumpAll() {
    this.#pump(this.#lanes.listen);
    this.#pump(this.#lanes.download);
  }

  #pump(lane: Lane) {
    if (lane.retryTimer) return;
    lane.queue = lane.queue.filter((e) => !e.settled && e.wanted.size > 0);
    if (lane.inflight) {
      // Something the listener is waiting on preempts a window of preloads.
      // A window whose sentences have all arrived is just finishing; leave it.
      const waiting = lane.queue.some((e) => !e.background);
      const unanswered = lane.inflight.entries.filter((e) => !e.settled);
      const serving = unanswered.some((e) => !e.background);
      if (lane.name === 'listen' && waiting && unanswered.length > 0 && !serving) {
        lane.sizeIndex = 0;
        lane.inflight.controller.abort();
      }
      return;
    }
    const entries = this.#takeWindow(lane);
    if (entries.length) void this.#runWindow(lane, entries);
  }

  #takeWindow(lane: Lane): Entry[] {
    const listen = lane.name === 'listen';
    const ordered = listen
      ? [...lane.queue.filter((e) => !e.background), ...lane.queue.filter((e) => e.background)]
      : lane.queue;
    const maxSentences = listen ? LISTEN_WINDOW_SIZES[lane.sizeIndex]! : DOWNLOAD_WINDOW_SENTENCES;
    const maxChars = listen ? LISTEN_WINDOW_CHARS : DOWNLOAD_WINDOW_CHARS;
    const picked: Entry[] = [];
    let chars = 0;
    let seconds = 0;
    for (const entry of ordered) {
      if (picked.length >= maxSentences) break;
      // One language per window (the route takes a single lang).
      if (picked.length && entry.req.lang !== picked[0]!.req.lang) break;
      if (picked.length && chars + entry.req.text.length > maxChars) break;
      const { text, lang, voice } = entry.req;
      const entrySeconds = listen ? estimateSentenceSeconds(text, lang, voice ?? '') : 0;
      if (picked.length && seconds + entrySeconds > LISTEN_WINDOW_SEC) break;
      picked.push(entry);
      chars += text.length;
      seconds += entrySeconds;
    }
    lane.queue = lane.queue.filter((e) => !picked.includes(e));
    if (listen && picked.length) {
      lane.sizeIndex = Math.min(lane.sizeIndex + 1, LISTEN_WINDOW_SIZES.length - 1);
    }
    return picked;
  }

  async #runWindow(lane: Lane, entries: Entry[]) {
    const controller = new AbortController();
    lane.inflight = { entries, controller };
    const byId = new Map(entries.map((entry, i) => [`s${i}`, entry]));
    let busy = false;
    try {
      // fetchWithAuth throws on non-OK responses with the route's flat error
      // code as the message (DAILY_QUOTA_EXCEEDED, BUSY, ...).
      const res = await fetchWithAuth(`${getAPIBaseUrl()}/tts/readest/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lane: lane.name,
          lang: entries[0]!.req.lang,
          segments: [...byId].map(([id, e]) => ({ id, text: e.req.text, voice: e.req.voice })),
        }),
        signal: controller.signal,
      });
      if (!res.body) throw new Error('UPSTREAM_FAILED');
      let endError: string | undefined;
      for await (const raw of readNDJSON(res.body)) {
        const line = raw as WindowLine;
        if (line.done) {
          endError = typeof line.error === 'string' ? line.error : undefined;
          break;
        }
        const entry = typeof line.id === 'string' ? byId.get(line.id) : undefined;
        if (!entry || entry.settled) continue;
        if (typeof line.audio === 'string') {
          entry.settled = true;
          entry.resolve({
            audio: decodeBase64(line.audio),
            boundaries: Array.isArray(line.boundaries)
              ? (line.boundaries as TTSWordBoundary[])
              : [],
          });
        } else {
          this.#fail(entry, new SpeechSynthesisPermanentError('synthesis failed'));
        }
      }
      // Sentences the window never answered are worth retrying.
      for (const entry of entries) this.#fail(entry, new Error(endError ?? 'UPSTREAM_FAILED'));
    } catch (error) {
      const unanswered = entries.filter((e) => !e.settled);
      if (controller.signal.aborted) {
        // Preempted or withdrawn: put back whatever is still wanted.
        lane.queue.unshift(...unanswered.filter((e) => e.wanted.size > 0));
      } else {
        const code = error instanceof Error ? error.message : String(error);
        if (code === DAILY_QUOTA_EXCEEDED) {
          this.#exhaustQuota();
        } else if (code === 'BUSY') {
          // Another download window of this user is in flight: wait, retry.
          busy = true;
          lane.queue.unshift(...unanswered);
        } else {
          const failure = PERMANENT_CODES.has(code)
            ? new SpeechSynthesisPermanentError(code)
            : error;
          for (const entry of unanswered) this.#fail(entry, failure);
        }
      }
    } finally {
      lane.inflight = null;
      if (busy) {
        lane.retryTimer = setTimeout(() => {
          lane.retryTimer = null;
          this.#pump(lane);
        }, BUSY_RETRY_MS);
      } else {
        this.#pump(lane);
      }
    }
  }

  // Every further request would be refused too: fail everything and tell the
  // user once. init() (a new session) clears it.
  #exhaustQuota() {
    if (!this.#quotaExhausted) {
      this.#quotaExhausted = true;
      this.#events?.dispatchEvent(new CustomEvent('tts-quota-exceeded'));
    }
    const fatal = new SpeechSynthesisFatalError(DAILY_QUOTA_EXCEEDED);
    for (const lane of Object.values(this.#lanes)) {
      lane.queue = [];
      lane.inflight?.controller.abort();
    }
    for (const entry of [...this.#entries.values()]) this.#fail(entry, fatal);
  }
}
