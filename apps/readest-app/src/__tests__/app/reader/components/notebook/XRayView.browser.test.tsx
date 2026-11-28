import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import XRayView from '@/app/reader/components/notebook/XRayView';
import { XRay } from '@/services/xray/snapshot';
import { XRAY_ENTITY_TYPES } from '@/services/xray/types';
import '@/styles/globals.css';

const h = vi.hoisted(() => ({ xray: null as unknown }));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/services/xray/xrayService', async () => {
  const { create } = await import('zustand');
  return {
    useXRayStore: create(() => ({ updates: {}, revision: 0, lookup: null, isDocked: false })),
    getBookXRay: async () => h.xray,
    getBookMentions: async () => ({ count: 0, mentions: [] }),
    isXRayAvailable: () => true,
    openQuote: vi.fn(),
    openMention: vi.fn(),
    updateXRay: vi.fn(),
    stopXRayUpdate: vi.fn(),
    clearBookXRay: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  h.xray = null;
});

it('fits an X-Ray not built yet between the Notebook header and tab bar', async () => {
  await page.viewport(1024, 768);
  // The Notebook's column: header, the tab, tab bar.
  const { container } = render(
    <div className='flex flex-col' style={{ height: 600 }}>
      <header className='h-12 shrink-0'>X-Ray</header>
      <XRayView bookKey='hash-1' />
      <nav className='h-14 shrink-0'>Tabs</nav>
    </div>,
  );
  await act(async () => {});

  const column = container.firstElementChild!.getBoundingClientRect();
  const header = container.querySelector('header')!.getBoundingClientRect();
  const tabs = container.querySelector('nav')!.getBoundingClientRect();
  const message = screen.getByText('X-Ray uses only what you have read.').getBoundingClientRect();
  expect(tabs.bottom).toBeLessThanOrEqual(column.bottom);
  // Centred in what the header and tab bar leave.
  const free = (header.bottom + tabs.top) / 2;
  expect(Math.abs((message.top + message.bottom) / 2 - free)).toBeLessThan(60);
});

it('shows every X-Ray section in a narrow Notebook', async () => {
  await page.viewport(1024, 768);
  const xray = new XRay();
  xray.add({
    entities: XRAY_ENTITY_TYPES.map((type) => ({
      name: type,
      type,
      aliases: [],
      description: '',
      facts: [],
      quotes: [],
    })),
    relationships: [],
    events: [{ summary: 'They met', quotes: [] }],
  });
  h.xray = xray;
  render(
    <div className='flex flex-col' style={{ width: 280, height: 600 }}>
      <XRayView bookKey='hash-1' />
    </div>,
  );

  const row = await screen.findByRole('group', { name: 'X-Ray' });
  const sections = within(row).getAllByRole('button');
  expect(sections).toHaveLength(XRAY_ENTITY_TYPES.length + 1);
  const { left, right } = row.getBoundingClientRect();
  for (const section of sections) {
    const rect = section.getBoundingClientRect();
    expect(rect.left, section.textContent!).toBeGreaterThanOrEqual(left);
    expect(rect.right, section.textContent!).toBeLessThanOrEqual(right);
  }
});
