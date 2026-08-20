import { describe, it, expect } from 'vitest';
import { absServerAdapter, computeAbsServerContentId } from '@/services/sync/adapters/absServer';
import type { ABSServer } from '@/types/audiobookshelf';
import type { FieldEnvelope, Hlc, ReplicaRow } from '@/types/replica';

const server: ABSServer = {
  id: 'local1',
  name: 'Home',
  url: 'http://abs.local:13378',
  username: 'u',
  password: 'p',
  accessToken: 'at',
  refreshToken: 'rt',
  libraryIds: ['lib1'],
  addedAt: 123,
};

const HLC = '00000000000-00000000-dev' as Hlc;
const env = <T>(v: T): FieldEnvelope<T> => ({ v, t: HLC, s: 'dev' });

describe('absServerAdapter', () => {
  it('pack/unpack round-trips every synced field', () => {
    const fields = absServerAdapter.pack(server);
    const back = absServerAdapter.unpack(fields);
    expect(back.name).toBe('Home');
    expect(back.url).toBe('http://abs.local:13378');
    expect(back.username).toBe('u');
    expect(back.password).toBe('p');
    expect(back.accessToken).toBe('at');
    expect(back.refreshToken).toBe('rt');
    expect(back.libraryIds).toEqual(['lib1']);
    expect(back.addedAt).toBe(123);
  });

  it('declares tokens and credentials as encrypted fields', () => {
    expect(absServerAdapter.encryptedFields).toEqual([
      'username',
      'password',
      'accessToken',
      'refreshToken',
    ]);
  });

  it('declares no `binary` capability — metadata-only kind', () => {
    expect(absServerAdapter.binary).toBeUndefined();
  });

  it('unpackRow uses replica_id as id and contentId and requires name+url', () => {
    // unwrap() only accepts CRDT field envelopes ({v,t,s}), so a real row
    // wraps every field like this (mirrors opdsCatalog.test.ts's makeRow).
    const row = {
      user_id: 'u',
      kind: 'abs_server',
      replica_id: computeAbsServerContentId(server.url),
      fields_jsonb: {
        name: env(server.name),
        url: env(server.url),
        username: env(server.username),
        password: env(server.password),
        accessToken: env(server.accessToken),
        refreshToken: env(server.refreshToken),
        libraryIds: env(server.libraryIds),
        addedAt: env(server.addedAt),
      },
      manifest_jsonb: null,
      deleted_at_ts: null,
      reincarnation: 'tok',
      updated_at_ts: HLC,
      schema_version: 1,
    } as ReplicaRow;
    const out = absServerAdapter.unpackRow(row, '');
    expect(out?.id).toBe(row.replica_id);
    expect(out?.contentId).toBe(row.replica_id);
    expect(out?.reincarnation).toBe('tok');
    expect(out?.name).toBe('Home');
    expect(out?.url).toBe('http://abs.local:13378');
    expect(out?.username).toBe('u');
    expect(out?.libraryIds).toEqual(['lib1']);

    const bad = { ...row, fields_jsonb: { name: env('x') } } as ReplicaRow;
    expect(absServerAdapter.unpackRow(bad, '')).toBeNull();
  });
});
