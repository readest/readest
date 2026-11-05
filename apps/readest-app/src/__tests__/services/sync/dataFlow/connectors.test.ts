import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnvConfigType } from '@/services/environment';
import type { ABSServer } from '@/types/audiobookshelf';
import type { OPDSCatalog } from '@/types/opds';
import type { SystemSettings } from '@/types/settings';
import {
  getFlowConnectors,
  runConnectionCheck,
  type ConnectorContext,
} from '@/services/sync/dataFlow/connectors';
import { readFlowState } from '@/services/sync/dataFlow/log';
import { fetchWithAuth } from '@/utils/fetch';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@/utils/fetch', () => ({ fetchWithAuth: vi.fn() }));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => h.tauri,
}));

const h = vi.hoisted(() => ({ tauri: false }));

const context = (overrides: Partial<ConnectorContext> = {}): ConnectorContext => ({
  settings: {} as SystemSettings,
  signedIn: false,
  plan: 'free',
  envConfig: {} as EnvConfigType,
  absServers: [],
  opdsCatalogs: [],
  ...overrides,
});

const settings = (patch: object) => patch as SystemSettings;

const byId = (ctx: ConnectorContext, id: string) =>
  getFlowConnectors(ctx).find((connector) => connector.id === id);

describe('getFlowConnectors', () => {
  beforeEach(() => localStorage.clear());

  it('leaves out everything that is not set up', () => {
    expect(getFlowConnectors(context()).filter((c) => c.id !== 'localsend')).toEqual([]);
  });

  it('shows a two-way integration as both a source and a sink', () => {
    const kosync = byId(
      context({
        settings: settings({ kosync: { enabled: true, username: 'a', strategy: 'prompt' } }),
      }),
      'kosync',
    );
    expect(kosync).toMatchObject({ sources: ['progress'], sinks: ['progress'] });
  });

  it('follows the sync direction the user chose', () => {
    const send = settings({ kosync: { enabled: true, username: 'a', strategy: 'send' } });
    const receive = settings({ kosync: { enabled: true, username: 'a', strategy: 'receive' } });

    expect(byId(context({ settings: send }), 'kosync')).toMatchObject({
      sources: [],
      sinks: ['progress'],
    });
    expect(byId(context({ settings: receive }), 'kosync')).toMatchObject({
      sources: ['progress'],
      sinks: [],
    });
  });

  it('shows Grimmory with what it is set to carry, both ways', () => {
    const grimmory = {
      enabled: true,
      serverUrl: 'https://g',
      username: 'a',
      password: 'p',
      strategy: 'silent',
      syncProgress: true,
      syncNotes: true,
    };

    expect(byId(context({ settings: settings({ grimmory }) }), 'grimmory')).toMatchObject({
      sources: ['progress', 'notes'],
      sinks: ['progress', 'notes'],
    });
    expect(
      byId(
        context({ settings: settings({ grimmory: { ...grimmory, strategy: 'send' } }) }),
        'grimmory',
      ),
    ).toMatchObject({ sources: ['notes'], sinks: ['progress', 'notes'] });
    expect(
      byId(
        context({ settings: settings({ grimmory: { ...grimmory, enabled: false } }) }),
        'grimmory',
      ),
    ).toBeUndefined();
  });

  it('shows exporters only as sinks', () => {
    const ctx = context({
      settings: settings({
        readwise: { enabled: true, accessToken: 't' },
        hardcover: { enabled: true, accessToken: 't' },
        notion: { enabled: true, accessToken: 't', databaseId: 'd' },
      }),
    });

    expect(byId(ctx, 'readwise')).toMatchObject({ sources: [], sinks: ['notes'] });
    expect(byId(ctx, 'hardcover')).toMatchObject({ sources: [], sinks: ['progress', 'notes'] });
    expect(byId(ctx, 'notion')).toMatchObject({ sources: [], sinks: ['notes'] });
  });

  it('shows Obsidian as a place notes go, once it has a folder', () => {
    const obsidian = { enabled: true, folder: '/vault/Readest' };

    expect(byId(context({ settings: settings({ obsidian }) }), 'obsidian')).toMatchObject({
      sources: [],
      sinks: ['notes'],
    });
    expect(
      byId(context({ settings: settings({ obsidian: { ...obsidian, folder: '' } }) }), 'obsidian'),
    ).toBeUndefined();
    expect(
      byId(
        context({ settings: settings({ obsidian: { ...obsidian, enabled: false } }) }),
        'obsidian',
      ),
    ).toBeUndefined();
  });

  it('flags a vault folder this device can no longer open', async () => {
    const isDirectory = vi.fn(async () => false);
    const ctx = context({
      settings: settings({ obsidian: { enabled: true, folder: '/vault/Readest' } }),
      envConfig: { getAppService: async () => ({ isDirectory }) } as unknown as EnvConfigType,
    });

    await runConnectionCheck(byId(ctx, 'obsidian')!);

    expect(isDirectory).toHaveBeenCalledWith('/vault/Readest', 'None');
    expect(readFlowState().checks.obsidian).toMatchObject({
      ok: false,
      message: 'Folder not available',
    });
  });

  it('needs a Notion target as well as a token', () => {
    const ctx = context({ settings: settings({ notion: { enabled: true, accessToken: 't' } }) });
    expect(byId(ctx, 'notion')).toBeUndefined();
  });

  it('drops the data kinds BookOrbit is told not to sync', () => {
    const ctx = context({
      settings: settings({
        bookorbit: { enabled: true, syncProgress: false, syncNotes: true, strategy: 'silent' },
      }),
    });

    expect(byId(ctx, 'bookorbit')).toMatchObject({ sources: ['notes'], sinks: ['notes'] });
  });

  it('shows what a file backend is set to carry', () => {
    const ctx = context({
      plan: 'pro',
      settings: settings({
        webdav: { enabled: true, syncNotes: false, syncBooks: true, strategy: 'send' },
      }),
    });

    expect(byId(ctx, 'webdav')).toMatchObject({ sources: [], sinks: ['progress', 'books'] });
  });

  it('shows Audiobookshelf for a usable server, as a book and progress source', () => {
    const server = { id: '1', name: 'Home', url: 'http://x' } as ABSServer;

    expect(byId(context({ absServers: [server] }), 'audiobookshelf')).toMatchObject({
      sources: ['books', 'progress'],
      sinks: ['progress'],
    });
    expect(
      byId(context({ absServers: [{ ...server, disabled: true }] }), 'audiobookshelf'),
    ).toBeUndefined();
    expect(
      byId(context({ absServers: [{ ...server, deletedAt: 1 }] }), 'audiobookshelf'),
    ).toBeUndefined();
  });

  it('shows OPDS for an active catalog, as a book source', () => {
    const catalog = { id: '1', name: 'Feed', url: 'http://x' } as OPDSCatalog;

    expect(byId(context({ opdsCatalogs: [catalog] }), 'opds')).toMatchObject({
      sources: ['books'],
      sinks: [],
    });
    expect(byId(context({ opdsCatalogs: [{ ...catalog, deletedAt: 1 }] }), 'opds')).toBeUndefined();
  });

  it('shows BookDrop both ways, since it receives and sends book files', () => {
    h.tauri = true;
    const connector = byId(context(), 'localsend');
    h.tauri = false;

    expect(connector).toMatchObject({ sources: ['books'], sinks: ['books'] });
  });

  it('shows Send to Readest only when this device drains the inbox', () => {
    expect(byId(context({ signedIn: true }), 'send')).toMatchObject({ sources: ['books'] });

    localStorage.setItem('readest-send-drain-enabled', 'false');
    expect(byId(context({ signedIn: true }), 'send')).toBeUndefined();
  });
});

describe('Send to Readest connection check', () => {
  const sendConnector = () => byId(context({ signedIn: true }), 'send')!;

  beforeEach(() => localStorage.clear());

  it('reads the inbox and never claims from it', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({ ok: true } as Response);

    expect(await sendConnector().check()).toEqual({ ok: true });

    const [url, init] = vi.mocked(fetchWithAuth).mock.calls.at(-1)!;
    expect(String(url)).toMatch(/\/send\/inbox$/);
    expect(init?.method).toBe('GET');
  });

  it('fails when the inbox refuses', async () => {
    vi.mocked(fetchWithAuth).mockRejectedValue(new Error('Not authenticated'));

    await runConnectionCheck(sendConnector());

    expect(readFlowState().checks.send).toMatchObject({ ok: false, message: 'Not authenticated' });
  });
});

describe('runConnectionCheck', () => {
  beforeEach(() => localStorage.clear());

  const connector = (check: () => Promise<{ ok: boolean; message?: string }>) => ({
    id: 'readwise' as const,
    title: 'Readwise',
    sources: [],
    sinks: [],
    check,
  });

  it('stores what the check found', async () => {
    await runConnectionCheck(connector(async () => ({ ok: true })));

    expect(readFlowState().checks.readwise).toMatchObject({ ok: true });
  });

  it('turns a throwing check into a failed one', async () => {
    await runConnectionCheck(
      connector(async () => {
        throw new Error('Token expired');
      }),
    );

    expect(readFlowState().checks.readwise).toMatchObject({ ok: false, message: 'Token expired' });
  });
});
