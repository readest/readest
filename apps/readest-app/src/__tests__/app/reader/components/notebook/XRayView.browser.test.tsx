import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import XRayView from '@/app/reader/components/notebook/XRayView';
import '@/styles/globals.css';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/services/xray/xrayService', async () => {
  const { create } = await import('zustand');
  return {
    useXRayStore: create(() => ({ updates: {}, revision: 0, lookup: null, isDocked: false })),
    getBookXRay: async () => null,
    getBookMentions: async () => ({ count: 0, mentions: [] }),
    isXRayAvailable: () => true,
    openQuote: vi.fn(),
    openMention: vi.fn(),
    updateXRay: vi.fn(),
    stopXRayUpdate: vi.fn(),
    clearBookXRay: vi.fn(),
  };
});

afterEach(cleanup);

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
