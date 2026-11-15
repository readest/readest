import { expect, test, vi } from 'vitest';

// fflate builds its tables as it loads (~0.1 s on a Kindle), and the library imports this module
// through the OPDS stream: it loads with the first deflated comic page instead.
const loaded = vi.hoisted(() => ({ fflate: false }));
vi.mock('fflate', async (importOriginal) => {
  loaded.fflate = true;
  return importOriginal();
});

test('fflate is not loaded with the spread helpers', async () => {
  await import('@/utils/spread');
  expect(loaded.fflate).toBe(false);
});
