import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

vi.mock('@/i18n/i18n', () => ({}));

import { useTranslation } from '@/hooks/useTranslation';

describe('useTranslation', () => {
  beforeAll(async () => {
    await i18n.use(initReactI18next).init({
      lng: 'fr',
      resources: {
        fr: { translation: { Close: 'Fermer', '{{count}} pages': '{{count}} pages (fr)' } },
        de: { translation: { Close: 'Schließen' } },
      },
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await act(() => i18n.changeLanguage('fr'));
  });

  // A book open mounts hundreds of components; on an e-ink reader running QuickJS each i18next
  // lookup is slow enough to show, so a string is looked up once, not once per component.
  test('components share a plain string looked up once', () => {
    const t = vi.spyOn(i18n, 't');
    const a = renderHook(() => useTranslation());
    const b = renderHook(() => useTranslation());
    expect(a.result.current('Close')).toBe('Fermer');
    expect(b.result.current('Close')).toBe('Fermer');
    a.rerender();
    expect(a.result.current('Close')).toBe('Fermer');
    expect(t.mock.calls.filter(([key]) => key === 'Close')).toHaveLength(1);
  });

  test('an untranslated string reads as itself', () => {
    const { result } = renderHook(() => useTranslation());
    expect(result.current('Not in the catalog')).toBe('Not in the catalog');
  });

  test('looks strings with options up every time', () => {
    const { result } = renderHook(() => useTranslation());
    expect(result.current('{{count}} pages', { count: 2 })).toBe('2 pages (fr)');
    expect(result.current('{{count}} pages', { count: 3 })).toBe('3 pages (fr)');
  });

  test('a language change re-renders with the new strings', async () => {
    const { result } = renderHook(() => useTranslation());
    const before = result.current;
    expect(before('Close')).toBe('Fermer');
    await act(() => i18n.changeLanguage('de'));
    expect(result.current).not.toBe(before);
    expect(result.current('Close')).toBe('Schließen');
  });
});
