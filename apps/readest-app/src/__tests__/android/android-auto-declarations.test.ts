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
 * Withdrawn in #5038 after a Play Auto rejection: the forward/back controls
 * gave no immediate coherent feedback (the silent player seeked to 0 and the
 * metadata lagged a ~1s WebView round trip, so the car saw a pause flicker
 * with no track change). Re-enabled once the skip path was fixed to assert
 * playing at once and hold state through the round trip (ttsMediaBridge
 * #skipping + MediaPlaybackService no longer seeks the silent player on
 * skip), so the car meta-data is present again.
 */

const manifest = readFileSync(
  resolve(process.cwd(), 'src-tauri/gen/android/app/src/main/AndroidManifest.xml'),
  'utf-8',
);

describe('Android Auto declarations (#3919)', () => {
  it('opts in to car projection via the car application meta-data', () => {
    expect(manifest).toContain('com.google.android.gms.car.application');
    expect(manifest).toContain('@xml/automotive_app_desc');
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
