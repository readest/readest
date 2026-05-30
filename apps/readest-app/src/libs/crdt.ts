import type { FieldEnvelope, FieldsObject, Hlc, ReplicaRow } from '@/types/replica';

const MAX_PHYSICAL_MS = 0xfffffffffffff;
const MAX_COUNTER = 0xffffffff;

export const hlcPack = (physicalMs: number, counter: number, deviceId: string): Hlc => {
  if (physicalMs < 0 || physicalMs > MAX_PHYSICAL_MS) {
    throw new RangeError(`physicalMs out of range: ${physicalMs}`);
  }
  if (counter < 0 || counter > MAX_COUNTER) {
    throw new RangeError(`counter out of range: ${counter}`);
  }
  const ms = physicalMs.toString(16).padStart(13, '0');
  const c = counter.toString(16).padStart(8, '0');
  return `${ms}-${c}-${deviceId}` as Hlc;
};

export const hlcParse = (h: Hlc): { physicalMs: number; counter: number; deviceId: string } => {
  const dash1 = h.indexOf('-');
  const dash2 = h.indexOf('-', dash1 + 1);
  if (dash1 < 0 || dash2 < 0) throw new Error(`malformed HLC: ${h}`);
  return {
    physicalMs: parseInt(h.slice(0, dash1), 16),
    counter: parseInt(h.slice(dash1 + 1, dash2), 16),
    deviceId: h.slice(dash2 + 1),
  };
};

export const hlcCompare = (a: Hlc, b: Hlc): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0);

export const hlcMax = (a: Hlc | null, b: Hlc | null): Hlc | null => {
  if (!a) return b;
  if (!b) return a;
  return hlcCompare(a, b) >= 0 ? a : b;
};

export interface HlcSnapshot {
  physicalMs: number;
  counter: number;
}

export class HlcGenerator {
  private physicalMs = 0;
  private counter = 0;

  constructor(
    private readonly deviceId: string,
    private readonly now: () => number = Date.now,
  ) {}

  static restore(
    snapshot: HlcSnapshot,
    deviceId: string,
    now: () => number = Date.now,
  ): HlcGenerator {
    const gen = new HlcGenerator(deviceId, now);
    gen.physicalMs = snapshot.physicalMs;
    gen.counter = snapshot.counter;
    return gen;
  }

  next(): Hlc {
    const wallMs = this.now();
    if (wallMs > this.physicalMs) {
      this.physicalMs = wallMs;
      this.counter = 0;
    } else {
      this.counter += 1;
      if (this.counter > MAX_COUNTER) {
        this.physicalMs += 1;
        this.counter = 0;
      }
    }
    return hlcPack(this.physicalMs, this.counter, this.deviceId);
  }

  observe(remote: Hlc): void {
    const { physicalMs: rMs, counter: rC } = hlcParse(remote);
    const wallMs = this.now();
    const newMs = Math.max(this.physicalMs, rMs, wallMs);
    if (newMs === this.physicalMs && newMs === rMs) {
      this.counter = Math.max(this.counter, rC) + 1;
    } else if (newMs === rMs) {
      this.physicalMs = newMs;
      this.counter = rC + 1;
    } else if (newMs === this.physicalMs) {
      this.counter += 1;
    } else {
      this.physicalMs = newMs;
      this.counter = 0;
    }
  }

  serialize(): HlcSnapshot {
    return { physicalMs: this.physicalMs, counter: this.counter };
  }
}

export const setField = <V>(
  fields: FieldsObject,
  name: string,
  value: V,
  hlc: Hlc,
  deviceId: string,
): FieldsObject => ({
  ...fields,
  [name]: { v: value, t: hlc, s: deviceId },
});

const pickWinner = (a: FieldEnvelope, b: FieldEnvelope): FieldEnvelope => {
  const cmp = hlcCompare(a.t, b.t);
  if (cmp > 0) return a;
  if (cmp < 0) return b;
  return a.s >= b.s ? a : b;
};

export const mergeFields = (local: FieldsObject, remote: FieldsObject): FieldsObject => {
  const out: FieldsObject = { ...local };
  for (const key of Object.keys(remote)) {
    const lo = local[key];
    const re = remote[key]!;
    out[key] = lo ? pickWinner(lo, re) : re;
  }
  return out;
};

const computeUpdatedAt = (fields: FieldsObject, deletedAt: Hlc | null): Hlc => {
  let max: Hlc | null = deletedAt;
  for (const key of Object.keys(fields)) {
    const env = fields[key]!;
    max = hlcMax(max, env.t);
  }
  return (max ?? hlcPack(0, 0, '')) as Hlc;
};

export const removeReplica = (row: ReplicaRow, hlc: Hlc): ReplicaRow => {
  const deletedAt = hlcMax(row.deleted_at_ts, hlc) ?? hlc;
  return {
    ...row,
    deleted_at_ts: deletedAt,
    updated_at_ts: hlcMax(row.updated_at_ts, hlc) ?? hlc,
  };
};

export const withReincarnation = (row: ReplicaRow, token: string): ReplicaRow => ({
  ...row,
  reincarnation: token,
  deleted_at_ts: null,
  fields_jsonb: {},
});

export const mergeReplica = (local: ReplicaRow, remote: ReplicaRow): ReplicaRow => {
  if (
    local.user_id !== remote.user_id ||
    local.kind !== remote.kind ||
    local.replica_id !== remote.replica_id
  ) {
    throw new Error('mergeReplica: identity mismatch');
  }
  const fields = mergeFields(local.fields_jsonb, remote.fields_jsonb);
  const deleted_at_ts = hlcMax(local.deleted_at_ts, remote.deleted_at_ts);

  const reincarnationCandidates = [
    local.reincarnation ? { token: local.reincarnation, t: local.updated_at_ts } : null,
    remote.reincarnation ? { token: remote.reincarnation, t: remote.updated_at_ts } : null,
  ].filter((c): c is { token: string; t: Hlc } => c !== null);
  const winningReincarnation =
    reincarnationCandidates.length === 0
      ? null
      : reincarnationCandidates.reduce((a, b) => (hlcCompare(a.t, b.t) >= 0 ? a : b));
  const reincarnation =
    winningReincarnation &&
    (!deleted_at_ts || hlcCompare(winningReincarnation.t, deleted_at_ts) > 0)
      ? winningReincarnation.token
      : null;

  const manifest_jsonb =
    remote.manifest_jsonb === null
      ? local.manifest_jsonb
      : local.manifest_jsonb === null
        ? remote.manifest_jsonb
        : hlcCompare(remote.updated_at_ts, local.updated_at_ts) > 0
          ? remote.manifest_jsonb
          : local.manifest_jsonb;

  const schema_version = Math.max(local.schema_version, remote.schema_version);
  const contentUpdatedAt = computeUpdatedAt(fields, deleted_at_ts);
  const rowUpdatedAt = hlcMax(local.updated_at_ts, remote.updated_at_ts);
  const updated_at_ts = hlcMax(contentUpdatedAt, rowUpdatedAt) ?? contentUpdatedAt;

  return {
    user_id: local.user_id,
    kind: local.kind,
    replica_id: local.replica_id,
    fields_jsonb: fields,
    manifest_jsonb,
    deleted_at_ts,
    reincarnation,
    updated_at_ts,
    schema_version,
  };
};
