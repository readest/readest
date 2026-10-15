import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ env: {} as Record<string, unknown>, onWorkers: true }));
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => {
    if (!m.onWorkers) throw new Error('not on Workers');
    return { env: m.env, ctx: { waitUntil: vi.fn() } };
  },
}));

const load = async () => {
  vi.resetModules();
  return import('@/libs/readestVoice/service');
};

beforeEach(() => {
  m.onWorkers = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('getVoiceService', () => {
  it('returns the bound service once its contract version matches, checking once', async () => {
    const service = { contractVersion: vi.fn().mockResolvedValue(1) };
    m.env = { READEST_VOICE: service };
    const { getVoiceService } = await load();
    expect(await getVoiceService()).toBe(service);
    expect(await getVoiceService()).toBe(service);
    expect(service.contractVersion).toHaveBeenCalledTimes(1);
  });

  it('treats a service speaking another contract version as absent', async () => {
    m.env = { READEST_VOICE: { contractVersion: vi.fn().mockResolvedValue(2) } };
    const { getVoiceService } = await load();
    expect(await getVoiceService()).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it('is null without the binding or off Workers (Node dev, self-hosting)', async () => {
    m.env = {};
    expect(await (await load()).getVoiceService()).toBeNull();
    m.onWorkers = false;
    expect(await (await load()).getVoiceService()).toBeNull();
  });

  it('accepts a plain value, as the next dev platform proxy answers RPC calls', async () => {
    const service = { contractVersion: vi.fn().mockReturnValue(1) };
    m.env = { READEST_VOICE: service };
    expect(await (await load()).getVoiceService()).toBe(service);
  });

  it('checks again after a failed version call', async () => {
    const service = {
      contractVersion: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(1),
    };
    m.env = { READEST_VOICE: service };
    const { getVoiceService } = await load();
    expect(await getVoiceService()).toBeNull();
    expect(await getVoiceService()).toBe(service);
  });
});
