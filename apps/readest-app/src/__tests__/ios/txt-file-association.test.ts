import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression guard: iOS Files preview/share sheet lost Readest for supported
 * document types in 0.11.20 (worked in 0.11.18).
 *
 * The app's plain-text claim used to come from the hand-tuned
 * `CFBundleDocumentTypes` in `src-tauri/Info.plist` (`Text File` /
 * `public.plain-text`), merged into the generated iOS Info.plist at build
 * time. tauri-cli 2.11.0 (bumped in #5085) added mobile file associations:
 * it now generates `CFBundleDocumentTypes` from `bundle.fileAssociations`
 * and inserts the key AFTER the custom-plist merge, replacing the
 * hand-tuned array. The generated entries omitted `LSItemContentTypes` for
 * every format Tauri could not infer from a short built-in mapping, including
 * EPUB, MOBI, AZW, FB2, and CBZ. iOS therefore stopped offering Readest for
 * those files even though their extensions still appeared in the plist.
 *
 * The durable fix is declaring `contentTypes` in `bundle.fileAssociations` so
 * the generated entries carry the exact Uniform Type Identifiers expected by
 * iOS. The hand-tuned array in `src-tauri/Info.plist` is dead on iOS as long
 * as the CLI generates this key, so it must not be relied on for any format.
 */

interface FileAssociation {
  name?: string;
  ext: string[];
  contentTypes?: string[];
  mimeType?: string;
  role?: string;
  rank?: string;
}

const tauriConf = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf-8'),
) as { bundle: { fileAssociations: FileAssociation[] } };

const associations = tauriConf.bundle.fileAssociations;

describe('iOS file associations', () => {
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

  it('declares an iOS content type for every supported format', () => {
    const expectedAssociations = {
      epub: {
        name: 'EPUB Document',
        contentTypes: ['org.idpf.epub-container'],
      },
      mobi: {
        name: 'MOBI Document',
        contentTypes: ['org.mobipocket.mobi'],
      },
      azw: {
        name: 'AZW Document',
        contentTypes: ['com.amazon.azw', 'com.amazon.azw3'],
      },
      azw3: {
        name: 'AZW Document',
        contentTypes: ['com.amazon.azw', 'com.amazon.azw3'],
      },
      fb2: { name: 'FB2 Document', contentTypes: ['com.readest.fb2'] },
      cbz: { name: 'CBZ Archive', contentTypes: ['com.readest.cbz'] },
      pdf: { name: 'PDF Document', contentTypes: ['com.adobe.pdf'] },
      txt: { name: 'Text File', contentTypes: ['public.plain-text'] },
      md: {
        name: 'Markdown Document',
        contentTypes: ['net.daringfireball.markdown'],
      },
    };

    for (const [ext, expected] of Object.entries(expectedAssociations)) {
      const association = associations.find((a) => a.ext.includes(ext));
      expect(association, `missing file association for .${ext}`).toBeDefined();
      expect(association).toMatchObject({
        ...expected,
        role: 'Viewer',
        rank: 'Alternate',
      });
    }
  });
});
