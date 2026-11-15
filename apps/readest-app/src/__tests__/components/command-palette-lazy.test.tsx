import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

// The provider wraps every page, and its palette is closed nearly always: building the command
// list (~140 ms on a Kindle at launch, again at each language or settings change) waits for an
// open.
const built = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/services/commandRegistry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/commandRegistry')>();
  return {
    ...actual,
    buildCommandRegistry: (...args: Parameters<typeof actual.buildCommandRegistry>) => {
      built.count++;
      return actual.buildCommandRegistry(...args);
    },
  };
});
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));
vi.mock('@/hooks/useShortcuts', () => ({ default: () => {} }));

import {
  CommandPaletteProvider,
  useCommandPalette,
} from '@/components/command-palette/CommandPaletteProvider';

let palette: ReturnType<typeof useCommandPalette>;
const Probe = () => {
  palette = useCommandPalette();
  return null;
};

afterEach(cleanup);

describe('CommandPaletteProvider', () => {
  test('builds the command list when the palette opens, not before', () => {
    render(
      <CommandPaletteProvider>
        <Probe />
      </CommandPaletteProvider>,
    );
    expect(built.count).toBe(0);
    act(() => palette.open());
    expect(built.count).toBe(1);
    expect(palette.commandItems.length).toBeGreaterThan(0);
    act(() => palette.setQuery('theme'));
    expect(palette.results.length).toBeGreaterThan(0);
  });
});
