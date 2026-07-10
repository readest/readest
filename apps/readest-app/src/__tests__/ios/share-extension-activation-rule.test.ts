import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression guard: sharing a `.txt` file to Readest on iOS got stuck.
 *
 * The Share Extension (added in #4256 / #4267) is an article-URL clipper — its
 * `ShareViewController` only ever extracts an http(s) URL from the shared item.
 * Its activation rule enabled `NSExtensionActivationSupportsText`, but a `.txt`
 * file is UTI `public.plain-text` (which conforms to `public.text`), so that key
 * made the extension activate for plain-text FILES it cannot handle: the share
 * sheet hung instead of the file taking the main app's CFBundleDocumentTypes
 * "Copy to Readest" open-in-place path (which imports txt fine, exactly like the
 * EPUB/PDF that never matched the extension).
 *
 * Fix: the extension activates only for web URLs, never for text — so `.txt`
 * (and any plain-text file) routes to the working document-open import path.
 *
 * We assert on `project.yml` only. It is the xcodegen source of truth: Tauri's
 * iOS CLI runs `xcodegen` at build time, which regenerates each target's
 * `Info.plist` from this file. The committed `ShareExtension/Info.plist` is a
 * generated artifact (marked `skip-worktree`) and must not be relied on.
 */

// `NSExtensionActivationSupportsText` is legitimately named in a `#` comment
// warning contributors not to re-add it. Strip comments so the check targets
// active config only.
const stripYamlComments = (text: string): string => text.replace(/#.*$/gm, '');

const projectYml = stripYamlComments(
  readFileSync(resolve(process.cwd(), 'src-tauri/gen/apple/project.yml'), 'utf-8'),
);

describe('iOS Share Extension activation rule (txt share stuck)', () => {
  it('does not enable NSExtensionActivationSupportsText (would capture .txt files)', () => {
    expect(projectYml).not.toContain('NSExtensionActivationSupportsText');
  });

  it('still activates for web URLs (article clipping preserved)', () => {
    expect(projectYml).toContain('NSExtensionActivationSupportsWebURLWithMaxCount');
  });
});
