import type { TTSWordBoundary } from '@/libs/edgeTTS';
import { getReadestVoiceAPIBaseUrl } from '@/services/environment';
import { getAccessToken, getSubscriptionPlan, isVoiceTierInPlan } from '@/utils/access';
import { fetchWithAuth } from '@/utils/fetch';
import { readNDJSON } from '@/utils/ndjson';
import { estimateSentenceSeconds } from '../ttsDuration';
import type { TTSVoice } from '../types';
import {
  DAILY_QUOTA_EXCEEDED,
  type PrefetchOptions,
  type SpeechProvider,
  SpeechSynthesisFatalError,
  SpeechSynthesisPermanentError,
  type SpeechSynthesisRequest,
  type SpeechSynthesisResult,
  type TTSLane,
} from './types';

// Readest Voice: premium voices synthesized by the Readest Voice service on a
// GPU worker, behind /api/tts/readest/stream. Sentences are requested in
// windows (one synthesis job per window, one NDJSON line back per sentence),
// one window in flight per lane:
// - listen: windows grow 1 -> 4 -> 8 sentences so the first audio after play,
//   seek or a voice change waits for one sentence only, and hold at most about
//   20 s of estimated audio (60 s for a window of background preloads only):
//   a sentence that falls due waits behind the window in flight. Requests the
//   current paragraph is waiting on fill a window before background preloads
//   of later paragraphs, never mixing languages. A window frees the lane as
//   soon as its last sentence arrives.
// - download: chapter downloads, in windows of up to 2000 characters (about
//   two minutes of audio, so progress moves often and work spreads across
//   workers), submitted as durable jobs that any worker may run
//   (/api/tts/readest/jobs), up to two at a time, and collected when done.
//   A server without jobs (off Workers) gets streamed windows instead, one
//   at a time, like listening.
// A sentence stays requested while any caller that asked for it is still
// interested; once every such signal is aborted it is withdrawn, and a window
// nobody wants any more is aborted, which cancels its GPU job server-side.

const LISTEN_WINDOW_SIZES = [1, 4, 8];
const LISTEN_WINDOW_CHARS = 2000;
const LISTEN_WINDOW_SEC = 20;
// A window of background preloads only: nobody waits on it, so it may carry
// more audio, amortizing the per-request overhead and batching on the GPU.
const LISTEN_BACKGROUND_WINDOW_SEC = 60;
// The most sentences a download window may hold (the route's limit).
const DOWNLOAD_WINDOW_SENTENCES = 64;
const DOWNLOAD_WINDOW_CHARS = 2000;
// Download jobs in flight per app: enough to keep two workers busy (the
// GPU endpoint runs at most two) without one download taking every worker.
const DOWNLOAD_JOBS = 2;
const BUSY_RETRY_MS = 5000;
// After a quota refusal, ask the server again no sooner than this: a retry,
// an upgrade or a new day may have made room.
const QUOTA_RECHECK_MS = 60_000;
// Refusals within this long of the last notice (a toast's lifetime) are one
// notice: a download refuses many sentences at once.
const QUOTA_NOTICE_MS = 5_000;
// Route codes that will fail again for the same sentences.
const PERMANENT_CODES = new Set(['UNKNOWN_VOICE', 'VOICE_TIER_REQUIRED', 'INVALID_INPUT']);
// Job codes worth submitting the window again for: another device of the user
// cancelled the shared job, or its result is gone.
const RESUBMIT_CODES = new Set(['CANCELLED', 'NOT_FOUND']);

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

interface Window {
  entries: Entry[];
  controller: AbortController;
}

interface Lane {
  name: TTSLane;
  queue: Entry[];
  inflight: Window[];
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
  inflight: [],
  sizeIndex: 0,
  retryTimer: null,
});

const SAVED_CATALOG_KEY = 'readest-voice-catalog';

const readSavedCatalog = (): TTSVoice[] | null => {
  try {
    const raw = localStorage.getItem(SAVED_CATALOG_KEY);
    const voices = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(voices) ? (voices as TTSVoice[]) : null;
  } catch {
    return null;
  }
};

const saveCatalog = (voices: TTSVoice[]) => {
  try {
    localStorage.setItem(SAVED_CATALOG_KEY, JSON.stringify(voices));
  } catch {
    // Storage unavailable: the next session asks the server again.
  }
};

export class ReadestVoiceProvider implements SpeechProvider {
  readonly id = 'readest-tts';
  readonly label = 'Readest Voice';
  readonly cacheable = true;
  // A sentence in a language without a Readest voice is skipped, never read
  // with a wrong-language voice.
  readonly sameLanguageVoicesOnly = true;

  readonly #events: EventTarget | undefined;
  #voices: Promise<TTSVoice[]> | null = null;
  // When the server last refused for quota (0: not refused).
  #quotaExhaustedAt = 0;
  #quotaNoticeAt = 0;
  #warmupFired = false;
  // Whether the server runs download jobs (null: not known yet, so one
  // download goes out at a time); without them downloads stream.
  #jobsAvailable: boolean | null = null;
  readonly #entries = new Map<string, Entry>();
  // Names this app instance to the server, which queues the windows of a
  // user's devices one after another but lets this instance replace its own.
  readonly #clientId = crypto.randomUUID();
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

  // Available to every reader, on any plan: a voice the plan lacks is listed
  // disabled and gated only when it is picked or played.
  async init(): Promise<boolean> {
    // A new session (or day) may have fresh quota.
    this.#quotaExhaustedAt = 0;
    this.#voices = null; // the next listing asks again (plan or catalog may change)
    return true;
  }

  // Plus voices before Pro ones, each by name.
  compareVoices(a: TTSVoice, b: TTSVoice): number {
    const rank = (voice: TTSVoice) => (voice.tier === 'pro' ? 1 : 0);
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  }

  // Boots a worker when the voice picker opens; once per provider.
  warmup(): void {
    if (this.#warmupFired) return;
    this.#warmupFired = true;
    fetchWithAuth(`${getReadestVoiceAPIBaseUrl()}/tts/readest`, {
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
    if (this.#quotaExhausted()) {
      this.#noticeQuota();
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
    if (this.#quotaExhausted() || signal.aborted) return;
    const background = lane === 'listen' && !!options?.background;
    const onDelivered = options?.onDelivered;
    for (const req of reqs) {
      if (!req.voice) continue;
      let entry = this.#entries.get(entryKey(req));
      if (entry) {
        this.#want(entry, signal);
        if (lane === 'download') this.#takeListenPreload(entry);
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

  // The cache has the sentence now (a synced pack arrived): settle it, drop
  // it from windows not sent yet, and cancel a window left with nothing to
  // deliver, so no worker synthesizes it again.
  fulfill(req: SpeechSynthesisRequest, result: SpeechSynthesisResult): void {
    const entry = this.#entries.get(entryKey(req));
    if (!entry || entry.settled) return;
    entry.settled = true;
    entry.resolve(result);
    for (const lane of Object.values(this.#lanes)) {
      lane.queue = lane.queue.filter((e) => e !== entry);
      for (const window of lane.inflight) {
        if (window.entries.every((e) => e.settled)) window.controller.abort();
      }
    }
  }

  async shutdown(): Promise<void> {
    for (const lane of Object.values(this.#lanes)) {
      if (lane.retryTimer) clearTimeout(lane.retryTimer);
      lane.retryTimer = null;
      lane.queue = [];
      for (const window of lane.inflight) window.controller.abort();
    }
    for (const entry of this.#entries.values()) this.#settle(entry, abortError());
    this.#entries.clear();
  }

  // Every offered voice, for readers on any plan: the ones the plan lacks stay
  // listed but disabled, so the picker shows what an upgrade unlocks. The
  // service is always on: the last list the server gave answers at once and
  // outlives any failed or slow request (offline, cold server).
  async #fetchVoices(): Promise<TTSVoice[]> {
    const token = await getAccessToken();
    const refreshed = this.#fetchCatalog(token);
    const catalog = readSavedCatalog() ?? (await refreshed) ?? [];
    const plan = token ? getSubscriptionPlan(token) : 'free';
    return catalog.map((voice) =>
      voice.tier && isVoiceTierInPlan(voice.tier, plan) ? voice : { ...voice, disabled: true },
    );
  }

  // The server's list, saved for next time; null when it could not say.
  async #fetchCatalog(token: string | null): Promise<TTSVoice[] | null> {
    const url = `${getReadestVoiceAPIBaseUrl()}/tts/readest?all=1`;
    try {
      // Signed in, the server answers even before it knows `all` (with the
      // plan's voices); signed out, the catalog needs no auth.
      const res = token ? await fetchWithAuth(url, { method: 'GET' }) : await fetch(url);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { voices?: TTSVoice[] };
      const voices = Array.isArray(data.voices)
        ? data.voices.map(({ id, name, lang, tier }) => ({ id, name, lang, tier }))
        : [];
      saveCatalog(voices);
      return voices;
    } catch {
      return null;
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

  // A download of the chapter being read finds its sentences queued as
  // listening preloads, which the listen lane serves a window at a time. Ones
  // only queued in the background go out as download jobs instead; what the
  // listener waits on, or a window already carries, stays.
  #takeListenPreload(entry: Entry) {
    const listen = this.#lanes.listen;
    const index = listen.queue.indexOf(entry);
    if (index < 0 || !entry.background) return;
    listen.queue.splice(index, 1);
    this.#lanes.download.queue.push(entry);
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
      // Withdrawn sentences the listener waited on; delivered ones do not count.
      if (!entry.background && !entry.settled) hadForeground = true;
      if (entry.wanted.size === 0) {
        this.#settle(entry, abortError());
        this.#entries.delete(entry.key);
      }
    }
    // The next listen window starts small again: first audio waits for one.
    if (hadForeground) this.#lanes.listen.sizeIndex = 0;
    for (const lane of Object.values(this.#lanes)) {
      for (const window of lane.inflight) {
        if (window.entries.every((e) => e.settled || e.wanted.size === 0)) {
          window.controller.abort();
        }
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
    const [current] = lane.inflight;
    if (lane.name === 'listen' && current) {
      // Something the listener is waiting on preempts a window of preloads.
      // A window whose sentences have all arrived is just finishing; leave it.
      const waiting = lane.queue.some((e) => !e.background);
      const unanswered = current.entries.filter((e) => !e.settled);
      const serving = unanswered.some((e) => !e.background);
      if (waiting && unanswered.length > 0 && !serving) {
        lane.sizeIndex = 0;
        current.controller.abort();
      }
      return;
    }
    const jobs = lane.name === 'download' && this.#jobsAvailable !== false;
    while (lane.inflight.length < (jobs && this.#jobsAvailable ? DOWNLOAD_JOBS : 1)) {
      const entries = this.#takeWindow(lane);
      if (!entries.length) return;
      void this.#runWindow(lane, entries, jobs);
    }
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
      const backgroundOnly = entry.background && picked.every((e) => e.background);
      const capSec = backgroundOnly ? LISTEN_BACKGROUND_WINDOW_SEC : LISTEN_WINDOW_SEC;
      if (picked.length && seconds + entrySeconds > capSec) break;
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

  async #runWindow(lane: Lane, entries: Entry[], job: boolean) {
    const controller = new AbortController();
    const window = { entries, controller };
    lane.inflight.push(window);
    const byId = new Map(entries.map((entry, i) => [`s${i}`, entry]));
    let busy = false;
    try {
      // fetchWithAuth throws on non-OK responses with the route's flat error
      // code as the message (DAILY_QUOTA_EXCEEDED, BUSY, ...).
      const request = JSON.stringify({
        client: this.#clientId,
        lane: lane.name,
        lang: entries[0]!.req.lang,
        segments: [...byId].map(([id, e]) => ({ id, text: e.req.text, voice: e.req.voice })),
      });
      const body = job
        ? await this.#collectJob(request, controller.signal)
        : (
            await fetchWithAuth(`${getReadestVoiceAPIBaseUrl()}/tts/readest/stream`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: request,
              signal: controller.signal,
            })
          ).body;
      if (!body) throw new Error('UPSTREAM_FAILED');
      let endError: string | undefined;
      for await (const raw of readNDJSON(body)) {
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
        // Every sentence is in: the terminal line only waits on the job's
        // final status, seconds later. Free the lane for the next window now.
        if (entries.every((e) => e.settled)) {
          controller.abort();
          break;
        }
      }
      // Sentences the window never answered are worth retrying. Answered ones
      // stay for the caller that has not consumed them yet (#onAbort drops
      // them if nobody does).
      for (const entry of entries) {
        if (!entry.settled) this.#fail(entry, new Error(endError ?? 'UPSTREAM_FAILED'));
      }
    } catch (error) {
      const unanswered = entries.filter((e) => !e.settled);
      if (controller.signal.aborted) {
        // Preempted or withdrawn: put back whatever is still wanted.
        lane.queue.unshift(...unanswered.filter((e) => e.wanted.size > 0));
      } else {
        const code = error instanceof Error ? error.message : String(error);
        if (code === DAILY_QUOTA_EXCEEDED) {
          this.#exhaustQuota();
        } else if (code === 'JOBS_UNAVAILABLE' || (job && RESUBMIT_CODES.has(code))) {
          if (code === 'JOBS_UNAVAILABLE') this.#jobsAvailable = false;
          lane.queue.unshift(...unanswered);
        } else if (code === 'BUSY') {
          // The endpoint is saturated (no turn within the server's wait, or
          // too many windows of this user waiting): wait, retry.
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
      lane.inflight = lane.inflight.filter((w) => w !== window);
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

  // A download job: submitted, then collected once a worker has finished it.
  // The result is the NDJSON a stream window sends. Nobody wanting the window
  // any more cancels the job, so its worker stops too.
  async #collectJob(request: string, signal: AbortSignal) {
    const jobs = `${getReadestVoiceAPIBaseUrl()}/tts/readest/jobs`;
    const submitted = await fetchWithAuth(jobs, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: request,
      signal,
    });
    const { jobId } = (await submitted.json()) as { jobId: string };
    if (!this.#jobsAvailable) {
      this.#jobsAvailable = true;
      this.#pumpAll();
    }
    const cancel = () => {
      fetchWithAuth(`${jobs}/${jobId}`, { method: 'DELETE' }).catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      for (;;) {
        // Long-polls; 202 while the job runs.
        const res = await fetchWithAuth(`${jobs}/${jobId}`, { method: 'GET', signal });
        if (res.status !== 202) return res.body;
      }
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }

  #quotaExhausted() {
    return Date.now() - this.#quotaExhaustedAt < QUOTA_RECHECK_MS;
  }

  // Tells the user why a request was refused (tts-quota-exceeded), once per
  // burst of refusals.
  #noticeQuota() {
    if (Date.now() - this.#quotaNoticeAt < QUOTA_NOTICE_MS) return;
    this.#quotaNoticeAt = Date.now();
    this.#events?.dispatchEvent(new CustomEvent('tts-quota-exceeded'));
  }

  // Further requests would be refused too for a while: fail everything and
  // tell the user. init() (a new session) clears it.
  #exhaustQuota() {
    this.#noticeQuota();
    this.#quotaExhaustedAt = Date.now();
    const fatal = new SpeechSynthesisFatalError(DAILY_QUOTA_EXCEEDED);
    for (const lane of Object.values(this.#lanes)) {
      lane.queue = [];
      for (const window of lane.inflight) window.controller.abort();
    }
    for (const entry of [...this.#entries.values()]) this.#fail(entry, fatal);
  }
}
