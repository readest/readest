import { describe, expect, it } from 'vitest';
import { WorkerRegistry, parseWorkerTokens, sha256Hex } from '@/libs/readestVoice/workerRegistry';

const setup = () => {
  let now = 1_000;
  const registry = new WorkerRegistry(() => now);
  return { registry, tick: (ms: number) => (now += ms) };
};

const KOKORO = { engines: ['kokoro'], version: '2.3.1' };

describe('WorkerRegistry', () => {
  it('creates a worker whose token hash authenticates it until revoked', () => {
    const { registry } = setup();
    expect(registry.create('gpu-box', 'hash-1')).toEqual({ ok: true });
    expect(registry.authenticate('hash-1')).toBe('gpu-box');
    expect(registry.authenticate('hash-2')).toBeNull();

    expect(registry.remove('gpu-box')).toBe(true);
    expect(registry.authenticate('hash-1')).toBeNull();
    expect(registry.remove('gpu-box')).toBe(false);
  });

  it('refuses taken, reserved and malformed names', () => {
    const { registry } = setup();
    registry.create('gpu-box', 'h1');
    expect(registry.create('gpu-box', 'h2')).toEqual({ ok: false, error: 'NAME_TAKEN' });
    expect(registry.create('runpod', 'h3')).toEqual({ ok: false, error: 'NAME_TAKEN' });
    for (const name of ['', 'Gpu', '-box', 'a b', 'x'.repeat(33), 'a:b', 'a,b']) {
      expect(registry.create(name, 'h4')).toEqual({ ok: false, error: 'INVALID_NAME' });
    }
  });

  it('records workers it only hears from (secret tokens, the bridge)', () => {
    const { registry, tick } = setup();
    registry.seen('home', KOKORO, 'secret');
    tick(5_000);
    registry.touch('runpod');
    const [home, runpod] = registry.list();
    expect(home).toMatchObject({
      name: 'home',
      source: 'secret',
      lastSeen: 1_000,
      engines: ['kokoro'],
      version: '2.3.1',
      rejected: false,
    });
    expect(runpod).toMatchObject({ name: 'runpod', source: 'bridge', lastSeen: 6_000 });
  });

  it('marks a worker turned away for its version until it is accepted again', () => {
    const { registry } = setup();
    registry.rejected('home', { engines: ['kokoro'], version: '2.3.0' }, 'secret');
    expect(registry.list()[0]).toMatchObject({ version: '2.3.0', rejected: true });
    registry.seen('home', KOKORO, 'secret');
    expect(registry.list()[0]).toMatchObject({ version: '2.3.1', rejected: false });
  });

  it('refreshes last seen from a heartbeat, keeping what the worker reported', () => {
    const { registry, tick } = setup();
    registry.seen('home', KOKORO, 'secret');
    tick(30_000);
    registry.touch('home');
    expect(registry.list()[0]).toMatchObject({ lastSeen: 31_000, engines: ['kokoro'] });

    // A bridged RunPod job heartbeats before the bridge was ever heard from.
    registry.touch('runpod');
    expect(registry.list()[1]).toMatchObject({
      name: 'runpod',
      source: 'bridge',
      lastSeen: 31_000,
    });
  });

  it('refuses a dashboard-token worker it no longer knows, without recreating it', () => {
    const { registry } = setup();
    registry.create('gpu-box', 'h1');
    expect(registry.seen('gpu-box', KOKORO, 'dashboard')).toBe(true);
    registry.remove('gpu-box');
    expect(registry.seen('gpu-box', KOKORO, 'dashboard')).toBe(false);
    expect(registry.rejected('gpu-box', KOKORO, 'dashboard')).toBe(false);
    expect(registry.list()).toEqual([]);
  });

  it('refuses a secret-token worker using the name of a dashboard worker', () => {
    const { registry } = setup();
    registry.create('gpu-box', 'h1');
    expect(registry.seen('gpu-box', KOKORO, 'secret')).toBe(false);
    expect(registry.list()[0]).toMatchObject({ source: 'dashboard', lastSeen: null });
  });

  it('never recreates a removed worker from a heartbeat', () => {
    const { registry } = setup();
    registry.create('gpu-box', 'h1');
    registry.remove('gpu-box');
    registry.touch('gpu-box');
    expect(registry.list()).toEqual([]);
  });

  it('counts finished and lost jobs per worker', () => {
    const { registry, tick } = setup();
    registry.create('gpu-box', 'h1');
    registry.jobDone('gpu-box', 120);
    tick(1_000);
    registry.jobDone('gpu-box', 30);
    registry.jobLost('gpu-box');
    expect(registry.list()[0]).toMatchObject({ done: 2, lost: 1, chars: 150, lastJobAt: 2_000 });
  });

  it('pauses only known workers', () => {
    const { registry } = setup();
    registry.create('gpu-box', 'h1');
    expect(registry.setPaused('gpu-box', true)).toBe(true);
    expect(registry.isPaused('gpu-box')).toBe(true);
    expect(registry.setPaused('nobody', true)).toBe(false);
    expect(registry.paused()).toEqual(['gpu-box']);
  });

  it('knows the bridge before it runs, so it can be paused, without marking it seen', () => {
    const { registry } = setup();
    registry.known('runpod');
    registry.known('runpod');
    expect(registry.list()).toEqual([
      expect.objectContaining({ name: 'runpod', source: 'bridge', lastSeen: null }),
    ]);
    expect(registry.setPaused('runpod', true)).toBe(true);
  });

  it('never removes the bridge, nor lets a secret token use its name', () => {
    const { registry } = setup();
    registry.known('runpod');
    expect(registry.seen('runpod', KOKORO, 'secret')).toBe(false);
    expect(registry.remove('runpod')).toBe(false);
  });

  it('reports records to persist, without presence, and restores them', () => {
    const { registry } = setup();
    registry.create('gpu-box', 'h1');
    registry.seen('gpu-box', KOKORO, 'dashboard');
    registry.create('lab', 'h2');
    registry.remove('lab');
    const { put, deleted } = registry.takeChanges();
    expect(put).toEqual([
      expect.objectContaining({ name: 'gpu-box', tokenHash: 'h1', source: 'dashboard' }),
    ]);
    expect(put[0]).not.toHaveProperty('lastSeen');
    expect(deleted).toEqual(['lab']);
    expect(registry.takeChanges()).toEqual({ put: [], deleted: [] });

    const restored = new WorkerRegistry();
    restored.restore(put);
    expect(restored.authenticate('h1')).toBe('gpu-box');
    expect(restored.list()[0]).toMatchObject({ name: 'gpu-box', lastSeen: null });
  });

  it('only rewrites a record for presence when the worker is new', () => {
    const { registry } = setup();
    registry.seen('home', KOKORO, 'secret');
    expect(registry.takeChanges().put).toHaveLength(1);
    registry.seen('home', KOKORO, 'secret');
    expect(registry.takeChanges().put).toHaveLength(0);
  });
});

describe('sha256Hex', () => {
  it('hashes a token to lowercase hex', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('parseWorkerTokens', () => {
  it('reads name:token pairs, skipping malformed entries', () => {
    expect(parseWorkerTokens(' gpu-box:abc , lab:d:ef,:x,nocolon,empty:')).toEqual([
      { name: 'gpu-box', token: 'abc' },
      { name: 'lab', token: 'd:ef' },
    ]);
    expect(parseWorkerTokens(undefined)).toEqual([]);
  });
});
