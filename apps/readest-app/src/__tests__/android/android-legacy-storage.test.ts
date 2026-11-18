import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Folder import, read-in-place and custom library folders read shared storage
 * by path (#7542). On Android 11+ that is granted through All Files Access
 * (MANAGE_EXTERNAL_STORAGE), which Android 10 doesn't have: there the app
 * holds READ/WRITE_EXTERNAL_STORAGE, but scoped storage still hides other
 * apps' files from path reads unless the app opts out with
 * requestLegacyExternalStorage. Without it a folder scan on Android 10 finds
 * nothing. Android 11+ ignores the flag for apps targeting API 30+.
 */
const manifest = readFileSync(
  resolve(process.cwd(), 'src-tauri/gen/android/app/src/main/AndroidManifest.xml'),
  'utf-8',
);

describe('Android shared-storage access on Android 10 (#7542)', () => {
  it('opts the app out of scoped storage on Android 10', () => {
    const application = manifest.match(/<application\b[^>]*>/)?.[0] ?? '';
    expect(application).toContain('android:requestLegacyExternalStorage="true"');
  });
});
