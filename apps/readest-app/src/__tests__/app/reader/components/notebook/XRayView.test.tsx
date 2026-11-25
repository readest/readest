// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  xray: null as unknown,
  available: true,
  openQuote: vi.fn(),
  openMention: vi.fn(),
  updateXRay: vi.fn(),
  stopXRayUpdate: vi.fn(),
  getBookMentions: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
// No layout here: every item is in view.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    totalCount,
    itemContent,
  }: {
    totalCount: number;
    itemContent: (index: number) => React.ReactNode;
  }) =>
    Array.from({ length: totalCount }, (_, index) => <div key={index}>{itemContent(index)}</div>),
}));
vi.mock('@/services/xray/xrayService', async () => {
  const { create } = await import('zustand');
  return {
    useXRayStore: create(() => ({ updates: {}, revision: 0, lookup: null, isDocked: false })),
    getBookXRay: async () => h.xray,
    getBookMentions: h.getBookMentions,
    isXRayAvailable: () => h.available,
    openQuote: h.openQuote,
    openMention: h.openMention,
    updateXRay: h.updateXRay,
    stopXRayUpdate: h.stopXRayUpdate,
    clearBookXRay: vi.fn(),
  };
});

import XRayView from '@/app/reader/components/notebook/XRayView';
import { XRay } from '@/services/xray/snapshot';
import type { XRayData, XRayEntity } from '@/services/xray/types';
import { useXRayStore } from '@/services/xray/xrayService';

const entity = (name: string, patch: Partial<XRayEntity> = {}): XRayEntity => ({
  name,
  type: 'character',
  aliases: [],
  description: `${name} lives here`,
  facts: [],
  quotes: [],
  ...patch,
});
const data: XRayData = {
  entities: [
    entity('Anna', { aliases: ['Mrs. Petrovna'] }),
    entity('Boris'),
    entity('Kazan', { type: 'location' }),
  ],
  relationships: [{ source: 'Anna', target: 'Boris', type: 'married to', quotes: [] }],
  events: [{ summary: 'They met', quotes: [{ text: 'We met', cfi: 'cfi-met' }] }],
};
const renderView = async () => {
  const view = render(<XRayView bookKey='hash-1' />);
  await act(async () => {});
  return view;
};

beforeEach(() => {
  const xray = new XRay();
  xray.add(data);
  h.xray = xray;
  h.available = true;
  vi.clearAllMocks();
  h.getBookMentions.mockResolvedValue({ count: 0, mentions: [] });
  useXRayStore.setState({ updates: {}, revision: 0, lookup: null, isDocked: false });
});
afterEach(cleanup);

describe('XRayView', () => {
  it('takes the X-Ray lookups while it is on screen', async () => {
    const { unmount } = await renderView();
    expect(useXRayStore.getState().isDocked).toBe(true);
    unmount();
    expect(useXRayStore.getState().isDocked).toBe(false);
  });

  it('shows the entry of a pinned lookup, where it was mentioned, and what it links to', async () => {
    const mention = { text: 'Anna came in.', section: 1, offset: 4 };
    h.getBookMentions.mockResolvedValue({ count: 12, mentions: [mention] });
    useXRayStore.setState({ lookup: { word: 'mrs. petrovna', id: 1 } });
    await renderView();
    expect(screen.queryByText('Boris')).toBeNull();
    expect(h.getBookMentions.mock.calls[0]![1]).toEqual(['Anna', 'Mrs. Petrovna']);
    expect(screen.getByText('Mentions · 12')).toBeTruthy();
    fireEvent.click(screen.getByText('“Anna came in.”'));
    expect(h.openMention).toHaveBeenCalledWith('hash-1', mention);

    fireEvent.click(screen.getByRole('button', { name: 'Anna · married to · Boris' }));
    await act(async () => {});
    expect(screen.getByText('Boris lives here')).toBeTruthy();
    expect(screen.queryByText('Anna lives here')).toBeNull();
  });

  it('browses by kind, and the timeline', async () => {
    await renderView();
    expect(screen.queryByText('Kazan')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Places 1' }));
    expect(screen.getByText('Kazan')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Timeline 1' }));
    expect(screen.getByText('They met')).toBeTruthy();
    fireEvent.click(screen.getByText('“We met”'));
    expect(h.openQuote).toHaveBeenCalledWith('hash-1', 'cfi-met');
  });

  it('offers to read the book, then to stop', async () => {
    h.xray = null;
    await renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Update X-Ray' }));
    expect(h.updateXRay).toHaveBeenCalledWith('hash-1');
    act(() => useXRayStore.setState({ updates: { hash: { running: true } } }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(h.stopXRayUpdate).toHaveBeenCalledWith('hash-1');
  });

  it('asks for a translator when there is none', async () => {
    h.xray = null;
    h.available = false;
    await renderView();
    expect(screen.queryByRole('button', { name: 'Update X-Ray' })).toBeNull();
    expect(
      screen.getByText('Add an OpenAI-compatible translator in Custom Translators to use it.'),
    ).toBeTruthy();
  });
});
