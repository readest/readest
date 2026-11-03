// @vitest-environment node
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appRequire = createRequire(path.resolve('package.json'));
const hoistedRequire = createRequire(path.resolve('../../node_modules/.pnpm/anchor.js'));
const scannerRequire = createRequire(appRequire.resolve('i18next-scanner'));
const cpxRequire = createRequire(appRequire.resolve('cpx2'));

type Merge = (
  target: unknown,
  source: unknown,
  options?: { clone?: boolean; arrayMerge?: (target: unknown[], source: unknown[]) => unknown[] },
) => {
  debug?: unknown;
  session?: unknown;
  list?: unknown;
  nested?: unknown;
  date?: unknown;
  regex?: unknown;
  [key: symbol]: unknown;
};

// Both published runtime bundles need the fix, not just the unbundled index.js.
for (const entry of ['dist/cjs.js', 'dist/umd.js']) {
  const merge: Merge = scannerRequire(`deepmerge/${entry}`);
  describe(`GHSA-gcqx-w48m-w2h4: deepmerge/${entry}`, () => {
    const poison = () => JSON.parse('{"__proto__":{"securityRegressionAdmin":true}}');
    const expectSafe = (value: unknown) => {
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
      expect(value).not.toHaveProperty('securityRegressionAdmin');
      expect(Object.hasOwn(value as object, '__proto__')).toBe(false);
      expect(Object.prototype).not.toHaveProperty('securityRegressionAdmin');
    };

    it('rejects source __proto__ even with a null-prototype target', () => {
      const target = Object.assign(Object.create(null), { debug: false });
      const result = merge(target, poison());
      expectSafe(result);
      expect(result.debug).toBe(false);
    });

    it.each([
      null,
      undefined,
      false,
      0,
      'placeholder',
    ])('keeps nested prototypes safe when the target is %s', (session) => {
      const result = merge({ session }, { session: poison() });
      expectSafe(result.session);
    });

    it('rejects __proto__ in the target copy loop', () => {
      const result = merge(poison(), { debug: false });
      expectSafe(result);
      expect(result.debug).toBe(false);
    });

    it('rejects __proto__ when both objects have an own key', () => {
      expectSafe(merge(poison(), poison()));
    });

    it('keeps cloned array elements safe', () => {
      const result = merge({ list: [] }, { list: [poison()] });
      expectSafe((result.list as unknown[])[0]);
    });

    it('preserves normal recursive merge, cloning, symbols and special values', () => {
      const symbol = Symbol('translation');
      const date = new Date('2026-01-01');
      const regex = /translation/;
      const target = {
        nested: { original: true },
        list: [{ a: 1 }],
        [symbol]: 'value',
        date,
        regex,
      };
      const result = merge(target, { nested: { scanned: true }, list: [{ b: 2 }] });
      expect(result.nested).toEqual({ original: true, scanned: true });
      expect(result.list).toEqual([{ a: 1 }, { b: 2 }]);
      expect(result.list).not.toBe(target.list);
      expect((result.list as unknown[])[0]).not.toBe(target.list[0]);
      expect(result[symbol]).toBe('value');
      expect(result.date).toBe(date);
      expect(result.regex).toBe(regex);
      expect(merge({}, target, { clone: false }).nested).toBe(target.nested);
    });

    it('preserves scanner array replacement and ordinary constructor/prototype keys', () => {
      const result = merge(
        { en: { translation: { keep: 'existing', values: ['old'] } } },
        { en: { translation: { added: 'new', values: ['new'] } } },
        { arrayMerge: (_target, source) => source },
      );
      expect(result).toEqual({
        en: { translation: { keep: 'existing', added: 'new', values: ['new'] } },
      });
      const data = JSON.parse('{"constructor":"translation","prototype":"translation"}');
      expect(merge(Object.create(null), data)).toEqual(data);
    });
  });
}

it('preserves i18next-scanner resource merging and removal of unused translations', () => {
  const {
    Parser,
  }: {
    Parser: new (
      options: Record<string, unknown>,
    ) => {
      resStore: Record<string, unknown>;
      resScan: Record<string, unknown>;
      get: () => unknown;
    };
  } = appRequire('i18next-scanner');
  const parser = new Parser({ lngs: [], ns: [], removeUnusedKeys: true });
  parser.resStore = { en: { translation: { keep: 'existing', unused: 'remove', list: ['old'] } } };
  parser.resScan = { en: { translation: { keep: 'existing', added: 'new', list: ['new'] } } };
  expect(parser.get()).toEqual({
    en: { translation: { keep: 'existing', added: 'new', list: ['new'] } },
  });
});

it('preserves the node-resolve defaults cloned by deepmerge', () => {
  const {
    DEFAULTS,
  }: { DEFAULTS: { extensions: string[]; moduleDirectories: string[]; dedupe: string[] } } =
    hoistedRequire('@rollup/plugin-node-resolve');
  expect(DEFAULTS.extensions).toEqual(['.mjs', '.js', '.json', '.node']);
  expect(DEFAULTS.moduleDirectories).toEqual(['node_modules']);
  expect(DEFAULTS.dedupe).toEqual([]);
  expect(Object.isFrozen(DEFAULTS)).toBe(true);
});

interface Matcher {
  set: unknown[];
  match: (file: string) => boolean;
  firstPhasePreProcess: (parts: string[][]) => string[][];
  secondPhasePreProcess: (parts: string[][]) => string[][];
  partsMatch: (...args: unknown[]) => unknown;
}
interface MatcherModule {
  minimatch: { Minimatch: new (pattern: string, options?: Record<string, unknown>) => Matcher };
  Minimatch: new (pattern: string, options?: Record<string, unknown>) => Matcher;
}
const matcher: MatcherModule = cpxRequire('minimatch');

describe('GHSA-g3hv-75wg-m249: minimatch resolved by cpx2', () => {
  it('caps adversarial **/.. pattern amplification at braceExpandMax', () => {
    const pattern = Array(8).fill('**/../a/b').join('/');
    const mm = new matcher.Minimatch(pattern, { optimizationLevel: 2, braceExpandMax: 64 });
    expect(mm.set).toHaveLength(64);
  });

  it('skips quadratic deduplication above 1000 patterns', () => {
    const mm = new matcher.Minimatch('a');
    const parts = Array.from({ length: 1001 }, (_, i) => [`file-${i}`]);
    let comparisons = 0;
    mm.partsMatch = () => {
      comparisons++;
      return false;
    };
    expect(mm.secondPhasePreProcess(parts)).toEqual(parts);
    expect(comparisons).toBe(0);
  });

  it('preserves small-set optimization and matching semantics', () => {
    const mm = new matcher.Minimatch('**/../a/b/**/../c/d', { optimizationLevel: 2 });
    expect(mm.set).toHaveLength(4);
    expect(mm.match('../a/b/../c/d')).toBe(true);
    expect(mm.match('x/a/b/y/c/d')).toBe(true);
    const small = new matcher.Minimatch('{x,*}/{0..9}', { optimizationLevel: 2 });
    expect(small.set).toHaveLength(10);
    expect(small.match('y/9')).toBe(true);
    expect(small.match('.y/9')).toBe(false);
    expect(matcher.minimatch.Minimatch).toBe(matcher.Minimatch);
  });

  it('copies the actual PDF.js worker, WASM and fonts with the vendor script patterns', () => {
    const cpx: { copySync: (source: string, destination: string) => void } = appRequire('cpx2');
    const pdfRoot = path.resolve('../../packages/foliate-js/node_modules/pdfjs-dist');
    const destination = mkdtempSync(path.join(tmpdir(), 'readest-minimatch-vendor-'));
    try {
      const groups = [
        {
          pattern: 'legacy/build/pdf.worker.min.mjs',
          dirs: ['legacy/build'],
          names: ['pdf.worker.min.mjs'],
        },
        { pattern: 'wasm/*', dirs: ['wasm'] },
        { pattern: '{cmaps,standard_fonts}/*', dirs: ['cmaps', 'standard_fonts'] },
      ];
      for (const [index, group] of groups.entries()) {
        const output = path.join(destination, String(index));
        cpx.copySync(path.join(pdfRoot, group.pattern), output);
        for (const dir of group.dirs) {
          for (const name of group.names ?? readdirSync(path.join(pdfRoot, dir))) {
            const relative = group.dirs.length > 1 ? path.join(dir, name) : name;
            expect(
              readFileSync(path.join(output, relative)).equals(
                readFileSync(path.join(pdfRoot, dir, name)),
              ),
            ).toBe(true);
          }
        }
        const expected = group.dirs
          .flatMap((dir) =>
            (group.names ?? readdirSync(path.join(pdfRoot, dir))).map((name) =>
              group.dirs.length > 1 ? path.join(dir, name) : name,
            ),
          )
          .sort();
        const actual = readdirSync(output, { recursive: true, withFileTypes: true })
          .filter((item) => item.isFile())
          .map((item) => path.relative(output, path.join(item.parentPath, item.name)))
          .sort();
        expect(actual).toEqual(expected);
      }
    } finally {
      rmSync(destination, { recursive: true, force: true });
    }
  });
});

for (const consumer of ['recursive-readdir', 'readdir-glob']) {
  const consumerRequire = createRequire(hoistedRequire.resolve(consumer));
  const legacy: ((file: string, pattern: string) => boolean) & {
    Minimatch: new (
      pattern: string,
      options?: Record<string, unknown>,
    ) => { match: (file: string) => boolean };
  } = consumerRequire('minimatch');
  it(`${consumer} retains the callable minimatch API without the vulnerable optimizer`, () => {
    expect(typeof legacy).toBe('function');
    expect(legacy('chapter.epub', '*.epub')).toBe(true);
    expect(legacy('chapter.pdf', '*.epub')).toBe(false);
    const mm = new legacy.Minimatch(Array(30).fill('**/../a/b').join('/'), {
      optimizationLevel: 2,
    });
    expect(mm).not.toHaveProperty('firstPhasePreProcess');
    expect(mm).not.toHaveProperty('secondPhasePreProcess');
    expect(new legacy.Minimatch('**/*.epub').match('books/chapter.epub')).toBe(true);
  });
}
