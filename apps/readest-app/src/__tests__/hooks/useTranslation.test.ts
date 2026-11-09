import { describe, expect, test, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const h = vi.hoisted(() => {
  const makeT = (lang: string) =>
    vi.fn((key: string, options: Record<string, unknown>) =>
      options['count'] === undefined ? `${lang}:${key}` : `${lang}:${key}:${options['count']}`,
    );
  return { makeT, t: makeT('fr') };
});

vi.mock('@/i18n/i18n', () => ({}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: h.t }) }));

import { useTranslation } from '@/hooks/useTranslation';

describe('useTranslation', () => {
  // Components translate the same strings on every render; on an e-ink reader running QuickJS
  // each i18next lookup is slow enough to show in a page turn.
  test('looks a plain string up once per translation function', () => {
    h.t = h.makeT('fr');
    const { result, rerender } = renderHook(() => useTranslation());
    expect(result.current('Close')).toBe('fr:Close');
    rerender();
    expect(result.current('Close')).toBe('fr:Close');
    expect(h.t).toHaveBeenCalledTimes(1);
    expect(h.t).toHaveBeenCalledWith('Close', { defaultValue: 'Close' });
  });

  test('looks strings with options up every time', () => {
    h.t = h.makeT('fr');
    const { result } = renderHook(() => useTranslation());
    expect(result.current('{{count}} pages', { count: 2 })).toBe('fr:{{count}} pages:2');
    expect(result.current('{{count}} pages', { count: 3 })).toBe('fr:{{count}} pages:3');
    expect(h.t).toHaveBeenCalledTimes(2);
  });

  test('a new translation function (another language) looks strings up again', () => {
    h.t = h.makeT('fr');
    const { result, rerender } = renderHook(() => useTranslation());
    expect(result.current('Close')).toBe('fr:Close');
    h.t = h.makeT('de');
    rerender();
    expect(result.current('Close')).toBe('de:Close');
  });
});
