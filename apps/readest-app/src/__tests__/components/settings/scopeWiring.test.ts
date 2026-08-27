/**
 * These tests guard the connections that no behaviour test reaches.
 *
 * `SettingsScopeBanner.test.tsx` tests the banner itself. The e-ink test
 * measures literal classes, and not the component. Neither one reads the line
 * that CONNECTS the banner to the dialog. A removal of that line thus keeps
 * both of them green. These tests guard these lines:
 *
 *   - `SettingsDialog` renders the banner, and sends this book
 *   - the banner, the ⋮ menu and the save path all call the resolver
 *   - `PANEL_SCOPE` stays a full Record, and keeps every panel on its side
 *   - the banner holds the classes that the e-ink test measures
 *
 * A render of `SettingsDialog` would cost much more than one JSX line is worth.
 * These tests thus read the source. They are crude. You must change them when
 * you move these files. That cost is intended. A broken connection that no test
 * reports is worse than that cost.
 *
 * This method has one more result. These tests read with `readFileSync`. The
 * files that they guard thus stay out of the module graph of Vitest. Watch mode
 * does NOT run them again when you edit `SettingsDialog`. Only a full run finds
 * a broken connection.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// This removes the comments first. A person who disables the banner usually
// makes it a comment, and raw text would still match.
const source = (path: string): string =>
  readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('scope wiring', () => {
  it('SettingsDialog renders the banner for every panel, passing this book', () => {
    const src = source('src/components/settings/SettingsDialog.tsx');
    expect(src).toContain('<SettingsScopeBanner');

    // Read the element itself. A character window instead of this once reached
    // the bookKey of the next panel, and a tighter window then went red when a
    // prop moved. The element text does neither.
    const open = src.indexOf('<SettingsScopeBanner');
    const element = src.slice(open, src.indexOf('/>', open) + 2);
    expect(element, 'the banner must receive this book').toContain('bookKey={bookKey}');

    // A condition here would hide the banner for some panels or in the library,
    // where the answer is still global. No render test covers the dialog.
    //
    // Count braces rather than look for a shape. A list of openers cannot work:
    // `source` removes the JSX comment above the element and leaves `{}`, so the
    // text never ends in an operator, and a wrapper element or a variable moves
    // the operator further back.
    //
    // Inside the `header={...}` slot every `{...}` that a JSX child opens is
    // closed again, so an unconditional banner sits at depth one. Any wrapper
    // that hides it opens one more brace that is still unclosed at the element:
    // `cond && (`, a ternary arm, or a variable in an expression container.
    // Strings go first, so a brace in a class name does not count.
    const code = src.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");
    const slot = code.indexOf('header={');
    const at = code.indexOf('<SettingsScopeBanner');
    expect(slot, 'the banner belongs in the header slot').toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(slot);

    let depth = 0;
    for (const ch of code.slice(slot + 'header='.length, at)) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    expect(depth, 'render the banner unconditionally, as a direct child').toBe(1);
  });

  it('all three scope readers call the resolver, and none keeps the old rule', () => {
    // The claim is that the banner, the ⋮ menu and the save path cannot
    // disagree. Only the save path has a behaviour test. A render of the ⋮ menu
    // needs a large mock harness, and the banner tests feed no value that the
    // resolver and `isGlobal ?? true` answer differently. A revert of the banner
    // or the ⋮ menu thus shows only in the source.
    const readers = [
      ['the banner', 'src/components/settings/SettingsScopeBanner.tsx', 'getViewSettings(bookKey)'],
      ['the ⋮ checkmark', 'src/components/settings/DialogMenu.tsx', 'viewSettings'],
      ['the save path', 'src/helpers/settings.ts', 'getViewSettings(bookKey)'],
    ] as const;

    for (const [name, path, argument] of readers) {
      const src = source(path);
      expect(src, `${name} must read the resolver`).toContain(`isSettingsScopeGlobal(${argument})`);
      // The name alone is not enough. A local function of the same name passes
      // the check above and changes the answer.
      const declares = path === 'src/helpers/settings.ts';
      expect(src, `${name} must import the shared resolver`).toMatch(
        declares
          ? /^export const isSettingsScopeGlobal/m
          : /import \{[^}]*isSettingsScopeGlobal[^}]*\}\s*from\s*'@\/helpers\/settings'/,
      );
      expect(src, `${name} must not keep its own copy of the scope rule`).not.toMatch(
        /isGlobal \?\? true/,
      );
    }
  });

  it('the panel map is exhaustive, so a new panel cannot default to wrong', () => {
    const src = source('src/components/settings/SettingsDialog.tsx');
    // The map is a Record with the union as its key, and not an array. The
    // compiler thus refuses a new SettingsPanelType until this file classifies
    // it. Either array mislabels a new panel, and no test finds that error.
    expect(src, 'PANEL_SCOPE must stay a Record for exhaustiveness').toMatch(
      /const PANEL_SCOPE: Record<SettingsPanelType, 'scoped' \| 'always-global'>/,
    );
    expect(src).toMatch(/alwaysGlobal=\{PANEL_SCOPE\[activePanel\] === 'always-global'\}/);

    // The Control tab holds more than ten per-book rows. A mark of
    // 'always-global' would give that tab the "Always Global Settings" banner.
    const map = src.slice(
      src.indexOf('const PANEL_SCOPE'),
      src.indexOf('};', src.indexOf('const PANEL_SCOPE')),
    );
    for (const panel of ['Font', 'Layout', 'Theme', 'Control', 'TTS', 'Language', 'Custom']) {
      expect(map, `${panel} must stay scoped`).toMatch(new RegExp(`${panel}: 'scoped'`));
    }
    for (const panel of ['AI', 'Integrations']) {
      expect(map, `${panel} has no per-book form`).toMatch(new RegExp(`${panel}: 'always-global'`));
    }
  });

  it('the banner builds its class list from the exported strings', () => {
    // `scope-banner-eink.browser.test.tsx` imports these strings and measures
    // them in a browser. That test is only about the banner while the banner
    // really uses them. This test guards that link.
    const src = source('src/components/settings/SettingsScopeBanner.tsx');
    const chassis = src.slice(src.indexOf('SCOPE_BANNER_CHASSIS ='));
    const literal = chassis.slice(chassis.indexOf("'"), chassis.indexOf("';") + 1);
    expect(literal, 'eink-bordered is what flattens the tint on e-ink').toContain('eink-bordered');
    expect(literal, 'the thick inline-start bar the design uses').toContain('border-s-4');
    // The chassis and the tint must reach one element. `eink-bordered` rewrites
    // the background and the border of the element that holds it. Split over two
    // elements, it removes neither on e-ink. This pattern needs both in one call.
    expect(src, 'the chassis and the tint must stay in one clsx call').toMatch(
      /className=\{clsx\(\s*SCOPE_BANNER_CHASSIS,(?:(?!className=)[\s\S]){0,400}?isGlobal \? SCOPE_BANNER_GLOBAL_TINT : SCOPE_BANNER_BOOK_TINT/,
    );
  });
});
