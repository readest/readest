/**
 * The dictionary sheet's definitions can be selected (#7731). The sheet renders
 * inside the reader page, which is `select-none`, so its text stays
 * unselectable unless the body turns selection back on. Only the real
 * stylesheet resolves that cascade, so this runs as a browser test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { DictionaryProvider } from '@/services/dictionaries/types';

// Dialog's shell, keeping the classes it puts on its box and its content.
vi.mock('@/components/Dialog', () => ({
  default: ({
    children,
    header,
    className,
    contentClassName,
  }: {
    children: ReactNode;
    header?: ReactNode;
    className?: string;
    contentClassName?: string;
  }) => (
    <dialog open className={className}>
      <div className='modal-box'>
        {header}
        <div className={contentClassName}>{children}</div>
      </div>
    </dialog>
  ),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));
vi.mock('@/services/tts/wordPronouncer', () => ({
  pronounceWord: vi.fn(),
  warmWordAudio: vi.fn(),
  cancelWordPronounce: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: vi.fn() }, appService: {} }),
}));

const answer: DictionaryProvider = {
  id: 'builtin:context',
  kind: 'builtin',
  label: 'Context Dictionary',
  async lookup(word, ctx) {
    const p = document.createElement('p');
    p.textContent = `In this passage, '${word}' refers to the start of the story.`;
    ctx.container.append(p);
    return { ok: true, headword: word, sourceLabel: 'AI' };
  },
};
vi.mock('@/services/dictionaries/registry', () => ({
  getEnabledProviders: () => [answer],
  __resetRegistryForTests: vi.fn(),
  evictProvider: vi.fn(),
}));

const { default: DictionarySheet } = await import(
  '@/app/reader/components/annotator/DictionarySheet'
);
await import('@/styles/globals.css');

afterEach(() => cleanup());

describe('DictionarySheet — text selection (#7731)', () => {
  it('lets the definition be selected inside the select-none reader page', async () => {
    render(
      <div className='reader-page select-none'>
        <DictionarySheet word='beginning' onDismiss={() => {}} />
      </div>,
    );
    const definition = await screen.findByText(/refers to the start of the story/);
    await waitFor(() => expect(getComputedStyle(definition).userSelect).toBe('text'));
  });

  // A real drag selects part of the answer, and the click that ends it doesn't
  // fold the card back.
  it('keeps the card open when a drag selects part of the definition', async () => {
    render(
      <div className='reader-page select-none'>
        <DictionarySheet word='beginning' onDismiss={() => {}} />
      </div>,
    );
    const definition = await screen.findByText(/refers to the start of the story/);
    const card = screen.getByTestId('dict-card');
    await waitFor(() => expect(card.getAttribute('aria-expanded')).toBe('true'));
    const { width, height } = definition.getBoundingClientRect();

    await userEvent.dragAndDrop(definition, definition, {
      sourcePosition: { x: 4, y: height / 2 },
      targetPosition: { x: width / 2, y: height / 2 },
    });

    const selected = document.getSelection()?.toString() ?? '';
    expect(selected.length).toBeGreaterThan(4);
    expect(definition.textContent).toContain(selected);
    expect(card.getAttribute('aria-expanded')).toBe('true');
  });
});
