import { describe, expect, test } from 'vitest';
import { computeDictionaryContentId } from '@/services/dictionaries/contentId';

const makeFile = (content: string, name: string): File =>
  new File([new TextEncoder().encode(content)], name);

describe('computeDictionaryContentId', () => {
  test('returns 32-hex md5', async () => {
    const id = await computeDictionaryContentId(makeFile('hello world', 'a.ifo'), ['a.ifo']);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  test('same primary content + same filename list → same id', async () => {
    const fileA = makeFile('webster contents', 'webster.mdx');
    const fileB = makeFile('webster contents', 'webster.mdx');
    const a = await computeDictionaryContentId(fileA, ['webster.mdx', 'webster.mdd']);
    const b = await computeDictionaryContentId(fileB, ['webster.mdx', 'webster.mdd']);
    expect(a).toBe(b);
  });

  test('different primary content → different id', async () => {
    const a = await computeDictionaryContentId(makeFile('content A', 'x.mdx'), ['x.mdx']);
    const b = await computeDictionaryContentId(makeFile('content B', 'x.mdx'), ['x.mdx']);
    expect(a).not.toBe(b);
  });

  test('filename order does NOT change the id (sorted internally)', async () => {
    const a = await computeDictionaryContentId(makeFile('x', 'd.mdx'), ['a.mdd', 'd.mdx']);
    const b = await computeDictionaryContentId(makeFile('x', 'd.mdx'), ['d.mdx', 'a.mdd']);
    expect(a).toBe(b);
  });

  test('different filename set → different id', async () => {
    const a = await computeDictionaryContentId(makeFile('x', 'd.mdx'), ['d.mdx']);
    const b = await computeDictionaryContentId(makeFile('x', 'd.mdx'), ['d.mdx', 'd.mdd']);
    expect(a).not.toBe(b);
  });

  test('different primary file SIZE → different id (defends against partialMD5 collision)', async () => {
    // Same first-byte content but different total length.
    const a = await computeDictionaryContentId(makeFile('A', 'x.mdx'), ['x.mdx']);
    const b = await computeDictionaryContentId(makeFile('AB', 'x.mdx'), ['x.mdx']);
    expect(a).not.toBe(b);
  });
});
