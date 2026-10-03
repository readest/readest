import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

/**
 * Callers write conditional bullets as `{cond && <li>...</li>}`, which hands
 * Tips a literal `false` whenever the condition is off. `React.Children.map`
 * keeps those slots, so Tips used to wrap each one in an `<li>` with a bullet
 * dot and no text: Nearby BookDrop showed five bullets with the last two
 * blank, and the S3 sub-page showed a stray one off the web platform.
 */

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

import Tips from '@/components/settings/primitives/Tips';

afterEach(() => cleanup());

describe('Tips', () => {
  it('renders one bullet per real child', () => {
    render(
      <Tips>
        <li>First</li>
        <li>Second</li>
      </Tips>,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items.map((li) => li.textContent)).toEqual(['First', 'Second']);
  });

  it('drops bullets whose condition is off instead of rendering them empty', () => {
    const paired = 0;
    const multicastError: string | null = null;
    render(
      <Tips>
        <li>Always shown</li>
        {paired > 0 && <li>Paired devices are accepted automatically.</li>}
        {multicastError && <li>Discovery via multicast is unavailable.</li>}
      </Tips>,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toBe('Always shown');
  });

  it('keeps a conditional bullet once its condition is met', () => {
    render(
      <Tips>
        <li>Always shown</li>
        {true && <li>Paired devices are accepted automatically.</li>}
      </Tips>,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});
