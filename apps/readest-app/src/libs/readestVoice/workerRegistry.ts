// What the TTSDispatcher Durable Object knows about the workers that run
// Readest Voice download jobs, for the admin dashboard. Pure and
// clock-injected like jobQueue.ts; no path aliases, since wrangler bundles it
// from worker.ts.
//
// - Workers made from the dashboard hold a token; only its SHA-256 is kept.
//   Workers named in the READEST_VOICE_WORKER_TOKENS secret, and the RunPod
//   bridge, get a record the first time they are heard from.
// - Records (counters, pause) are persisted; presence (last seen, engines,
//   version) lives in memory and comes back with the next long poll.

export type WorkerSource = 'dashboard' | 'secret' | 'bridge';
// Where the token a worker called with was found.
export type TokenSource = 'dashboard' | 'secret';

export interface WorkerRecord {
  name: string;
  source: WorkerSource;
  tokenHash: string | null;
  createdAt: number;
  paused: boolean;
  done: number;
  lost: number;
  chars: number;
  lastJobAt: number | null;
}

export interface WorkerInfo {
  engines: string[];
  version: string;
}

interface Presence extends WorkerInfo {
  lastSeen: number;
  // The last lease call was turned away for its version.
  rejected: boolean;
}

export type WorkerView = Omit<WorkerRecord, 'tokenHash'> & {
  lastSeen: number | null;
  engines: string[];
  version: string;
  rejected: boolean;
};

export type CreateResult = { ok: true } | { ok: false; error: 'INVALID_NAME' | 'NAME_TAKEN' };

export const BRIDGE_WORKER = 'runpod';
const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

// READEST_VOICE_WORKER_TOKENS: "name:token,name:token".
export const parseWorkerTokens = (value: string | undefined): { name: string; token: string }[] =>
  (value ?? '').split(',').flatMap((entry) => {
    const separator = entry.indexOf(':');
    const name = entry.slice(0, separator).trim();
    const token = entry.slice(separator + 1).trim();
    return separator > 0 && name && token ? [{ name, token }] : [];
  });

export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export class WorkerRegistry {
  #records = new Map<string, WorkerRecord>();
  #presence = new Map<string, Presence>();
  #dirty = new Set<string>();

  constructor(private readonly now: () => number = Date.now) {}

  create(name: string, tokenHash: string): CreateResult {
    if (!NAME.test(name)) return { ok: false, error: 'INVALID_NAME' };
    if (name === BRIDGE_WORKER || this.#records.has(name)) {
      return { ok: false, error: 'NAME_TAKEN' };
    }
    this.#put(this.#record(name, 'dashboard', tokenHash));
    return { ok: true };
  }

  // Forgets a worker: a dashboard token stops working at once. A worker
  // named in the secret comes back if it still polls.
  remove(name: string): boolean {
    if (name === BRIDGE_WORKER || !this.#records.delete(name)) return false;
    this.#presence.delete(name);
    this.#dirty.add(name);
    return true;
  }

  authenticate(tokenHash: string): string | null {
    for (const record of this.#records.values()) {
      if (record.tokenHash === tokenHash) return record.name;
    }
    return null;
  }

  // A record for a worker not heard from yet (the configured bridge).
  known(name: string): void {
    if (!this.#records.has(name)) this.#put(this.#record(name, this.#source(name), null));
  }

  // False when the name does not belong to that kind of token: a removed
  // dashboard worker, or a secret token named like a dashboard worker or
  // the bridge. The caller must then turn the worker away.
  seen(name: string, info: WorkerInfo, via: TokenSource): boolean {
    return this.#heard(name, info, false, via);
  }

  rejected(name: string, info: WorkerInfo, via: TokenSource): boolean {
    return this.#heard(name, info, true, via);
  }

  // A heartbeat: keeps the engines and version a worker last reported. Only
  // the bridge gets a record this way; a removed worker stays removed.
  touch(name: string): void {
    if (!this.#records.has(name) && name !== BRIDGE_WORKER) return;
    this.known(name);
    const presence = this.#presence.get(name);
    if (presence) presence.lastSeen = this.now();
    else
      this.#presence.set(name, { engines: [], version: '', lastSeen: this.now(), rejected: false });
  }

  jobDone(name: string, chars: number): void {
    const record = this.#records.get(name);
    if (!record) return;
    record.done += 1;
    record.chars += chars;
    record.lastJobAt = this.now();
    this.#dirty.add(name);
  }

  jobLost(name: string): void {
    const record = this.#records.get(name);
    if (!record) return;
    record.lost += 1;
    this.#dirty.add(name);
  }

  setPaused(name: string, paused: boolean): boolean {
    const record = this.#records.get(name);
    if (!record) return false;
    record.paused = paused;
    this.#dirty.add(name);
    return true;
  }

  isPaused(name: string): boolean {
    return this.#records.get(name)?.paused ?? false;
  }

  paused(): string[] {
    return [...this.#records.values()].filter((r) => r.paused).map((r) => r.name);
  }

  list(): WorkerView[] {
    return [...this.#records.values()].map(({ tokenHash: _, ...record }) => {
      const presence = this.#presence.get(record.name);
      return {
        ...record,
        lastSeen: presence?.lastSeen ?? null,
        engines: presence?.engines ?? [],
        version: presence?.version ?? '',
        rejected: presence?.rejected ?? false,
      };
    });
  }

  // Records changed (to store) and removed (to delete) since the last call.
  takeChanges(): { put: WorkerRecord[]; deleted: string[] } {
    const put: WorkerRecord[] = [];
    const deleted: string[] = [];
    for (const name of this.#dirty) {
      const record = this.#records.get(name);
      if (record) put.push({ ...record });
      else deleted.push(name);
    }
    this.#dirty.clear();
    return { put, deleted };
  }

  restore(records: WorkerRecord[]): void {
    for (const record of records) this.#records.set(record.name, { ...record });
  }

  #heard(name: string, info: WorkerInfo, rejected: boolean, via: TokenSource): boolean {
    const record = this.#records.get(name);
    const owned =
      via === 'dashboard'
        ? record?.source === 'dashboard'
        : record?.source !== 'dashboard' && record?.source !== 'bridge';
    if (!owned) return false;
    this.known(name);
    this.#presence.set(name, { ...info, lastSeen: this.now(), rejected });
    return true;
  }

  #source(name: string): WorkerSource {
    return name === BRIDGE_WORKER ? 'bridge' : 'secret';
  }

  #record(name: string, source: WorkerSource, tokenHash: string | null): WorkerRecord {
    return {
      name,
      source,
      tokenHash,
      createdAt: this.now(),
      paused: false,
      done: 0,
      lost: 0,
      chars: 0,
      lastJobAt: null,
    };
  }

  #put(record: WorkerRecord) {
    this.#records.set(record.name, record);
    this.#dirty.add(record.name);
  }
}
