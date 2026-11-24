// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowConnector } from '@/services/sync/dataFlow/connectors';
import { readFlowState, recordConnectionCheck, recordFlow } from '@/services/sync/dataFlow/log';

const h = vi.hoisted(() => ({ connectors: [] as unknown[], ask: vi.fn() }));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, o?: Record<string, unknown>) =>
    s.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(o?.[k] ?? '')),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { ask: h.ask } }),
}));
vi.mock('@/components/settings/integrations/useFlowConnectors', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/components/settings/integrations/useFlowConnectors')
  >()),
  useFlowConnectors: () => h.connectors,
}));

import DataFlowPage from '@/components/settings/integrations/DataFlowPage';

const kosync = (over: Partial<FlowConnector> = {}): FlowConnector => ({
  id: 'kosync',
  title: 'KOReader',
  sources: ['progress'],
  sinks: ['progress'],
  check: vi.fn(async () => ({ ok: true })),
  ...over,
});

const readwise = (over: Partial<FlowConnector> = {}): FlowConnector => ({
  id: 'readwise',
  title: 'Readwise',
  sources: [],
  sinks: ['notes'],
  check: vi.fn(async () => ({ ok: true })),
  ...over,
});

const column = (name: string) => within(screen.getByRole('list', { name }));

const renderPage = async (onOpenSettings = vi.fn()) => {
  render(<DataFlowPage onBack={vi.fn()} onOpenSettings={onOpenSettings} />);
  await act(async () => {});
};

beforeEach(() => {
  localStorage.clear();
  h.connectors = [];
});

afterEach(() => {
  cleanup();
});

describe('DataFlowPage diagram', () => {
  it('puts sources on one side and sinks on the other', async () => {
    h.connectors = [kosync(), readwise()];
    await renderPage();

    expect(column('Sources').getByText('KOReader')).toBeTruthy();
    expect(column('Sources').queryByText('Readwise')).toBeNull();
    expect(column('Destinations').getByText('KOReader')).toBeTruthy();
    expect(column('Destinations').getByText('Readwise')).toBeTruthy();
  });

  it('shows entries received on the source side and sent on the sink side', async () => {
    h.connectors = [kosync()];
    recordFlow({ connector: 'kosync', direction: 'pull', kind: 'progress', count: 7 });
    recordFlow({ connector: 'kosync', direction: 'push', kind: 'progress', count: 42 });
    await renderPage();

    expect(column('Sources').getByText('7')).toBeTruthy();
    expect(column('Destinations').getByText('42')).toBeTruthy();
  });

  it('says which integrations need attention in words', async () => {
    h.connectors = [kosync(), readwise()];
    recordConnectionCheck('kosync', { ok: true });
    recordConnectionCheck('readwise', { ok: true });
    recordFlow({ connector: 'readwise', direction: 'push', kind: 'notes', error: 'Bad token' });
    await renderPage();

    expect(screen.getByText('Working: 1')).toBeTruthy();
    expect(screen.getByText('Needs attention: 1')).toBeTruthy();
    expect(column('Destinations').getByLabelText('Readwise: Needs attention')).toBeTruthy();
    expect(column('Destinations').getByLabelText('KOReader: Working')).toBeTruthy();
  });

  it('flags only the side of a two-way integration that failed', async () => {
    h.connectors = [kosync()];
    recordConnectionCheck('kosync', { ok: true });
    recordFlow({ connector: 'kosync', direction: 'pull', kind: 'progress', count: 1 });
    recordFlow({ connector: 'kosync', direction: 'push', kind: 'progress', error: 'HTTP 500' });
    await renderPage();

    expect(column('Sources').getByLabelText('KOReader: Working')).toBeTruthy();
    expect(column('Destinations').getByLabelText('KOReader: Needs attention')).toBeTruthy();
    expect(screen.getByText('Working: 0')).toBeTruthy();
    expect(screen.getByText('Needs attention: 1')).toBeTruthy();
  });

  it('explains itself when nothing is set up', async () => {
    await renderPage();

    expect(screen.getByText('No integrations are set up yet')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('DataFlowPage reset', () => {
  const seed = async () => {
    h.connectors = [kosync()];
    recordConnectionCheck('kosync', { ok: true });
    recordFlow({ connector: 'kosync', direction: 'push', kind: 'progress', count: 42 });
    await renderPage();
  };

  it('clears the counts once confirmed', async () => {
    h.ask.mockResolvedValue(true);
    await seed();

    fireEvent.click(screen.getByRole('button', { name: 'Reset Counts' }));

    await waitFor(() => expect(column('Destinations').queryByText('42')).toBeNull());
    expect(readFlowState().entries).toEqual([]);
  });

  it('keeps the counts when the reader says no', async () => {
    h.ask.mockResolvedValue(false);
    await seed();

    fireEvent.click(screen.getByRole('button', { name: 'Reset Counts' }));

    await waitFor(() => expect(h.ask).toHaveBeenCalled());
    expect(column('Destinations').getByText('42')).toBeTruthy();
  });
});

describe('DataFlowPage connection checks', () => {
  it('checks every integration when the page opens', async () => {
    const first = kosync();
    const second = readwise();
    h.connectors = [first, second];
    await renderPage();

    await waitFor(() => expect(readFlowState().checks.readwise?.ok).toBe(true));
    expect(first.check).toHaveBeenCalledTimes(1);
    expect(second.check).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a check made in the last few minutes', async () => {
    const connector = kosync();
    h.connectors = [connector];
    recordConnectionCheck('kosync', { ok: true });
    await renderPage();

    expect(connector.check).not.toHaveBeenCalled();
  });

  it('rechecks on request', async () => {
    const connector = kosync();
    h.connectors = [connector];
    recordConnectionCheck('kosync', { ok: true });
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Check All' }));

    await waitFor(() => expect(connector.check).toHaveBeenCalledTimes(1));
  });
});

describe('DataFlowPage integration details', () => {
  const openReadwise = async () => {
    h.connectors = [readwise()];
    await renderPage();
    fireEvent.click(column('Destinations').getByLabelText(/Readwise/));
  };

  it('shows the connection and the sync history apart', async () => {
    recordConnectionCheck('readwise', { ok: true });
    recordFlow({
      connector: 'readwise',
      direction: 'push',
      kind: 'notes',
      count: 3,
      bookTitle: 'Dune',
    });
    recordFlow({
      connector: 'readwise',
      direction: 'push',
      kind: 'notes',
      bookTitle: 'Emma',
      error: 'Bad token',
    });
    await openReadwise();

    expect(screen.getByText('Connection')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('Sync History')).toBeTruthy();
    expect(screen.getByText('Dune')).toBeTruthy();
    expect(screen.getAllByText(/Bad token/).length).toBeGreaterThan(0);
  });

  it('leaves out other integrations from the history', async () => {
    recordFlow({ connector: 'kosync', direction: 'push', kind: 'progress', bookTitle: 'Emma' });
    await openReadwise();

    expect(screen.queryByText('Emma')).toBeNull();
    expect(screen.getByText('Nothing has synced yet')).toBeTruthy();
  });

  it('opens the settings of the integration', async () => {
    const onOpenSettings = vi.fn();
    h.connectors = [readwise()];
    await renderPage(onOpenSettings);
    fireEvent.click(column('Destinations').getByLabelText(/Readwise/));

    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));

    expect(onOpenSettings).toHaveBeenCalledWith('readwise');
  });
});
