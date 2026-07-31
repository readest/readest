import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression guard: saving an image to Photos killed the app on iOS (#5397).
 *
 * Readest writes to the photo library through paths it does not own: WebKit's
 * native long-press image callout ("Add to Photos") and the `Save Image`
 * activity of the share sheet the image viewer opens. Both run in-process and
 * hit `PHPhotoLibrary.performChanges`, so TCC terminates the app with
 * `__TCC_CRASHING_DUE_TO_PRIVACY_VIOLATION__` unless the bundle declares an
 * add-only usage description. The same missing key also makes iOS drop
 * `Save Image` from the share sheet, leaving only the out-of-process entries
 * ("Add to Shared Album", "Save to Files").
 *
 * We assert on the tracked seed `src-tauri/Info-ios.plist` (referenced by
 * `tauri.conf.json` `bundle.iOS.infoPlist`). The built
 * `gen/apple/Readest_iOS/Info.plist` is a gitignored artifact Tauri merges this
 * seed into, so edits there do not survive a regeneration.
 */

const infoPlist = readFileSync(resolve(process.cwd(), 'src-tauri/Info-ios.plist'), 'utf-8');

const stringValueFor = (key: string): string | undefined =>
  infoPlist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1];

describe('iOS photo library usage description (#5397)', () => {
  it('declares NSPhotoLibraryAddUsageDescription', () => {
    expect(infoPlist).toContain('<key>NSPhotoLibraryAddUsageDescription</key>');
  });

  it('gives it a non-empty purpose string', () => {
    expect(stringValueFor('NSPhotoLibraryAddUsageDescription')?.trim()).toBeTruthy();
  });
});
