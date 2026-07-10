import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Android Auto support (#3919): for Readest to appear in the Android Auto
 * launcher as a media app, the manifest must opt in to car projection via the
 * `com.google.android.gms.car.application` meta-data pointing at an
 * automotive descriptor that declares the `media` capability. Android Auto
 * then connects to the exported MediaBrowserService
 * (com.readest.native_tts.MediaPlaybackService) to drive TTS playback.
 *
 * TEMPORARILY WITHDRAWN: Google Play rejected the release in Android Auto
 * review because the Auto TTS flow still has a bug. The car meta-data is the
 * sole signal Play uses to detect Auto support, so it is removed from the
 * manifest until the bug is fixed. The automotive descriptor and the
 * MediaBrowserService stay: the descriptor makes re-enabling a one-line
 * revert, and the service powers the phone lock-screen and background TTS
 * media session.
 */

const manifest = readFileSync(
  resolve(process.cwd(), 'src-tauri/gen/android/app/src/main/AndroidManifest.xml'),
  'utf-8',
);

describe('Android Auto declarations (#3919)', () => {
  it('withholds the car application meta-data until the Auto TTS bug is fixed', () => {
    expect(manifest).not.toContain('com.google.android.gms.car.application');
    expect(manifest).not.toContain('@xml/automotive_app_desc');
  });

  it('keeps the automotive descriptor with the media capability for re-enabling', () => {
    const desc = readFileSync(
      resolve(process.cwd(), 'src-tauri/gen/android/app/src/main/res/xml/automotive_app_desc.xml'),
      'utf-8',
    );
    expect(desc).toContain('<automotiveApp>');
    expect(desc).toMatch(/<uses\s+name="media"\s*\/>/);
  });

  it('exports the MediaBrowserService Android Auto binds to', () => {
    const serviceBlock = manifest
      .split('<service')
      .find((block) => block.includes('com.readest.native_tts.MediaPlaybackService'));
    expect(serviceBlock).toBeDefined();
    expect(serviceBlock).toContain('android.media.browse.MediaBrowserService');
    expect(serviceBlock).toContain('android:exported="true"');
  });
});
