import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression guard for the Android themed ("Material You" / monochrome) launcher
 * icon (issue #4733).
 *
 * Android 13+ recolors the adaptive icon's `<monochrome>` layer with a
 * wallpaper-derived tint when the user enables themed icons. Support for it was
 * originally added in #2122/#2153 (the `ic_launcher_monochrome.png` assets) and
 * wired into the source adaptive icon, but #2353 ("fixed Android launcher icon
 * size") rewrote the *committed* `gen/` adaptive icon to inset the foreground
 * and silently dropped the `<monochrome>` layer — so themed icons stopped
 * working in shipped builds.
 *
 * The CI/release flow regenerates `gen/android` from scratch
 * (`tauri android init` + `tauri icon`) and then `git checkout .` to restore the
 * *tracked* customizations. `tauri icon` does not emit a monochrome layer, so
 * the themed icon only survives if both the adaptive-icon XML and the
 * monochrome mipmaps are tracked under `gen/`.
 *
 * Invariants:
 *  1. The committed adaptive icon declares a `<monochrome>` layer pointing at
 *     `@mipmap/ic_launcher_monochrome`.
 *  2. A tracked `ic_launcher_monochrome.png` exists for every launcher density
 *     so the resource resolves at build time (these are force-added past the
 *     `gen/` .gitignore, like the other customized resources).
 */

const appRoot = process.cwd();
const resRoot = resolve(appRoot, 'src-tauri/gen/android/app/src/main/res');

const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

describe('Android themed (monochrome) launcher icon', () => {
  it('declares a <monochrome> layer in the adaptive icon', () => {
    const xml = readFileSync(resolve(resRoot, 'mipmap-anydpi-v26/ic_launcher.xml'), 'utf8');
    expect(xml).toMatch(/<monochrome\b/);
    expect(xml).toMatch(/@mipmap\/ic_launcher_monochrome/);
  });

  it('ships a tracked monochrome mipmap for every density', () => {
    const missing = DENSITIES.filter(
      (d) => !existsSync(resolve(resRoot, `mipmap-${d}`, 'ic_launcher_monochrome.png')),
    );
    expect(missing, `missing tracked monochrome mipmaps for: ${missing.join(', ')}`).toEqual([]);
  });
});
