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

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

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

  it('shows Send to Readest only when this device drains the inbox', () => {
    expect(byId(context({ signedIn: true }), 'send')).toMatchObject({ sources: ['books'] });

    localStorage.setItem('readest-send-drain-enabled', 'false');
    expect(byId(context({ signedIn: true }), 'send')).toBeUndefined();
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
