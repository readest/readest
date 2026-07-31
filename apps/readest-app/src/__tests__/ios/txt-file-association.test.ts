import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression guard: iOS Files preview/share sheet lost Readest for `.txt`
 * in 0.11.20 (worked in 0.11.18), while EPUB/PDF kept working.
 *
 * The app's plain-text claim used to come from the hand-tuned
 * `CFBundleDocumentTypes` in `src-tauri/Info.plist` (`Text File` /
 * `public.plain-text`), merged into the generated iOS Info.plist at build
 * time. tauri-cli 2.11.0 (bumped in #5085) added mobile file associations:
 * it now generates `CFBundleDocumentTypes` from `bundle.fileAssociations`
 * and inserts the key AFTER the custom-plist merge, replacing the
 * hand-tuned array. `fileAssociations` listed every supported format
 * except txt, so the `public.plain-text` claim silently disappeared and
 * iOS stopped offering Readest as a `.txt` handler.
 *
 * The durable fix is declaring txt in `bundle.fileAssociations`:
 * tauri-utils maps `text/plain`/`txt` to the `public.plain-text` UTI, so
 * the generated entry restores the claim. The hand-tuned array in
 * `src-tauri/Info.plist` is dead on iOS as long as the CLI generates this
 * key, so it must not be relied on for any format.
 */

interface FileAssociation {
  name?: string;
  ext: string[];
  mimeType?: string;
}

const tauriConf = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf-8'),
) as { bundle: { fileAssociations: FileAssociation[] } };

const associations = tauriConf.bundle.fileAssociations;

describe('txt file association (iOS share sheet lost Readest for .txt)', () => {
  it('declares txt in bundle.fileAssociations', () => {
    const txt = associations.find((a) => a.ext.includes('txt'));
    expect(txt).toBeDefined();
    // text/plain is what tauri-utils maps to the public.plain-text UTI on
    // iOS; without it the entry is extension-only and the claim is weaker.
    expect(txt?.mimeType).toBe('text/plain');
  });

  it('declares md in bundle.fileAssociations', () => {
    // .md resolves to net.daringfireball.markdown, which conforms to
    // public.plain-text, so markdown rode on the lost plain-text claim too.
    const md = associations.find((a) => a.ext.includes('md'));
    expect(md).toBeDefined();
    expect(md?.mimeType).toBe('text/markdown');
  });

  it('keeps the formats that were never affected', () => {
    for (const ext of ['epub', 'mobi', 'azw', 'azw3', 'fb2', 'cbz', 'pdf']) {
      expect(associations.some((a) => a.ext.includes(ext))).toBe(true);
    }
  });
});
