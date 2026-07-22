import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Android Auto support (#3919): for Readest to appear in the Android Auto
 * launcher as a media app, the manifest opts in to car projection via the
 * `com.google.android.gms.car.application` meta-data pointing at an
 * automotive descriptor that declares the `media` capability. Android Auto
 * then connects to the exported MediaBrowserService
 * (com.readest.native_tts.MediaPlaybackService) to drive TTS playback.
 *
 * The car meta-data is currently WITHDRAWN. It was first withdrawn in #5038
 * after a Play Auto rejection, re-enabled in #5066, then withdrawn again after
 * Play rejected version code 11020 for inconsistent TTS playback in the car.
 * Until the car audio bug is fixed the opt-in stays out, so this test asserts
 * the meta-data is ABSENT; flip it back to `toContain` when re-enabling.
 *
 * The automotive descriptor and the exported MediaBrowserService stay in
 * place (the service also backs the phone lock-screen/background TTS media
 * session), so those declarations are still asserted below.
 */

const manifest = readFileSync(
  resolve(process.cwd(), 'src-tauri/gen/android/app/src/main/AndroidManifest.xml'),
  'utf-8',
);

describe('Android Auto declarations (#3919)', () => {
  it('does not opt in to car projection while Android Auto is withdrawn', () => {
    expect(manifest).not.toContain('com.google.android.gms.car.application');
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
