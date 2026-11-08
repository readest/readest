// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { describe, expect, it } from 'vitest';

/**
 * daisyUI's `stack` and `breadcrumbs` rules (`:is(.stack,.stack.stack-bottom)>:first-child`,
 * `[dir=rtl] :is(.breadcrumbs>ul>li)+:before`) give the style engine no class to rule an
 * element's ancestors out by, so they are tried on every element and leave every parent
 * marked as depending on its first child or its siblings. Readest uses neither component,
 * but Tailwind emits both because the words appear in the source.
 */
describe('globals.css', () => {
  it('leaves out the daisyUI components Readest does not use', async () => {
    const from = path.resolve(__dirname, '../../styles/globals.css');
    const { css } = await postcss([tailwindcss()]).process(fs.readFileSync(from, 'utf8'), {
      from,
    });
    const selectors: string[] = [];
    postcss.parse(css).walkRules((rule) => {
      selectors.push(...rule.selectors);
    });
    expect(selectors.length).toBeGreaterThan(1000);
    expect(selectors.filter((s) => /\.(stack|breadcrumbs)\b/.test(s))).toEqual([]);
  }, 60_000);
});
