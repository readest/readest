import { describe, expect, test, vi } from 'vitest';

// Every page imports the theme list and shows one theme: the palettes of the other ten (tinycolor
// math, ~0.1 s of an e-ink reader's launch) wait until something reads them.
const calls = vi.hoisted(() => ({ count: 0 }));
vi.mock('tinycolor2', async (importOriginal) => {
  const actual = (await importOriginal<{ default: (c: string) => unknown }>()).default;
  return {
    default: (c: string) => {
      calls.count++;
      return actual(c);
    },
  };
});

import { generateDarkPalette, generateLightPalette, themes } from '@/styles/themes';

describe('theme palettes', () => {
  test('are worked out when a theme is read, one theme at a time', () => {
    expect(calls.count).toBe(0);
    const sepia = themes.find((t) => t.name === 'sepia')!;
    const { light, dark } = sepia.colors;
    const read = calls.count;
    const expected = {
      light: generateLightPalette({ fg: '#5b4636', bg: '#f1e8d0', primary: '#008b8b' }),
      dark: generateDarkPalette({ fg: '#ffd595', bg: '#342e25', primary: '#48d1cc' }),
    };
    // Reading sepia cost what its own two palettes cost, no other theme's.
    expect(calls.count - read).toBe(read);
    expect({ light, dark }).toEqual(expected);
    expect(sepia.colors).toBe(sepia.colors);
    expect(calls.count).toBe(2 * read);
  });
});
