/**
 * groupBundlesByStem — MDict companion-MDD attachment.
 *
 * A single MDX often ships its resources across several MDD files named with a
 * shared prefix (`Name.mdd`, `Name-01.mdd`, `Name.1.mdd`, …) — images in one,
 * scripts in another, audio in a third. The importer must attach every MDD
 * whose stem starts with the MDX stem (at a separator boundary) to that MDX
 * bundle; `.css` is pooled by name-independent rule (unchanged).
 */
import { describe, it, expect } from 'vitest';
import { groupBundlesByStem } from '@/services/dictionaries/dictionaryService';
import type { SelectedFile } from '@/hooks/useFileSelector';

const sf = (name: string): SelectedFile => ({ path: `/books/${name}` });

const mdictBundle = (files: string[]) => {
  const { bundles, orphans } = groupBundlesByStem(files.map(sf));
  const mdict = bundles.find((b) => b.kind === 'mdict');
  return {
    mdx: mdict && mdict.kind === 'mdict' ? mdict.mdx.name : null,
    mdds: mdict && mdict.kind === 'mdict' ? mdict.mdd.map((m) => m.name).sort() : [],
    css: mdict && mdict.kind === 'mdict' ? mdict.css.map((c) => c.name).sort() : [],
    bundleCount: bundles.filter((b) => b.kind === 'mdict').length,
    orphans: orphans.map((o) => o.name).sort(),
  };
};

describe('groupBundlesByStem — MDict companion MDDs', () => {
  it('attaches dash-numbered companion MDDs (vocabulary.com layout)', () => {
    const r = mdictBundle([
      'Vocabulary.com Dictionary.mdx',
      'Vocabulary.com Dictionary.mdd',
      'Vocabulary.com Dictionary-01.mdd',
      'Vocabulary.com Dictionary-02.mdd',
      'Vocabulary.com Dictionary-03.mdd',
    ]);
    expect(r.mdx).toBe('Vocabulary.com Dictionary.mdx');
    expect(r.mdds).toEqual([
      'Vocabulary.com Dictionary-01.mdd',
      'Vocabulary.com Dictionary-02.mdd',
      'Vocabulary.com Dictionary-03.mdd',
      'Vocabulary.com Dictionary.mdd',
    ]);
    expect(r.orphans).toEqual([]);
  });

  it('attaches dot-numbered companion MDDs (.1/.2 convention)', () => {
    const r = mdictBundle(['Base.mdx', 'Base.mdd', 'Base.1.mdd', 'Base.2.mdd']);
    expect(r.mdds).toEqual(['Base.1.mdd', 'Base.2.mdd', 'Base.mdd']);
    expect(r.orphans).toEqual([]);
  });

  it('still attaches the single exact-stem MDD (existing behavior)', () => {
    const r = mdictBundle(['Base.mdx', 'Base.mdd']);
    expect(r.mdds).toEqual(['Base.mdd']);
    expect(r.orphans).toEqual([]);
  });

  it('does not merge an unrelated MDD that only shares a word prefix', () => {
    // `dict` is a prefix of `dictionary-words` as a string, but the next char
    // ('i') is not a separator, so it must NOT attach.
    const r = mdictBundle(['dict.mdx', 'dict.mdd', 'dictionary-words.mdd']);
    expect(r.mdds).toEqual(['dict.mdd']);
    expect(r.orphans).toEqual(['dictionary-words.mdd']);
  });

  it('attaches a companion MDD to the longest matching MDX prefix', () => {
    const { bundles } = groupBundlesByStem(
      ['dict.mdx', 'dictionary.mdx', 'dictionary-01.mdd'].map(sf),
    );
    const dictionary = bundles.find((b) => b.kind === 'mdict' && b.mdx.name === 'dictionary.mdx');
    const dict = bundles.find((b) => b.kind === 'mdict' && b.mdx.name === 'dict.mdx');
    expect(
      dictionary && dictionary.kind === 'mdict' ? dictionary.mdd.map((m) => m.name) : null,
    ).toEqual(['dictionary-01.mdd']);
    expect(dict && dict.kind === 'mdict' ? dict.mdd.map((m) => m.name) : null).toEqual([]);
  });

  it('pools .css of any name onto the MDict bundle (unchanged)', () => {
    const r = mdictBundle(['Base.mdx', 'Base-01.mdd', 'arbitrary-name.css']);
    expect(r.mdds).toEqual(['Base-01.mdd']);
    expect(r.css).toEqual(['arbitrary-name.css']);
  });

  it('orphans companion MDDs when no MDX is present', () => {
    const r = mdictBundle(['Base-01.mdd', 'Base-02.mdd']);
    expect(r.bundleCount).toBe(0);
    expect(r.orphans).toEqual(['Base-01.mdd', 'Base-02.mdd']);
  });
});

describe('groupBundlesByStem — Android content-URI display names (#4489)', () => {
  // On some Android devices the SAF picker returns an opaque `content://`
  // document id that carries no filename/extension in the URI string (e.g.
  // `.../document/document%3A1001`). The file selector resolves the real
  // DISPLAY_NAME via the native content resolver into `SelectedFile.name`;
  // bundle grouping must classify by that name, not by parsing the ext-less
  // URI path — otherwise every file is orphaned and the user sees the bogus
  // "Skipped incomplete bundles" error even though the bundle is complete.
  const cu = (name: string, id: number): SelectedFile => ({
    path: `content://com.android.providers.media.documents/document/document%3A${id}`,
    name,
  });

  it('forms a complete StarDict bundle from ext-less content URIs via name', () => {
    const { bundles, orphans } = groupBundlesByStem([
      cu('21cen.ifo', 1001),
      cu('21cen.idx', 1002),
      cu('21cen.dict.dz', 1003),
    ]);
    expect(orphans).toEqual([]);
    expect(bundles).toHaveLength(1);
    const b = bundles[0]!;
    expect(b.kind).toBe('stardict');
    if (b.kind === 'stardict') {
      expect(b.ifo.name).toBe('21cen.ifo');
      expect(b.idx.name).toBe('21cen.idx');
      expect(b.dict.name).toBe('21cen.dict.dz');
      expect(b.dict.isDictZip).toBe(true);
    }
  });
});
