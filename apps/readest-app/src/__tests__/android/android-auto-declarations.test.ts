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
 */

const manifest = readFileSync(
  resolve(process.cwd(), 'src-tauri/gen/android/app/src/main/AndroidManifest.xml'),
  'utf-8',
);

describe('Android Auto declarations (#3919)', () => {
  it('declares the car application meta-data pointing at the automotive descriptor', () => {
    expect(manifest).toContain('com.google.android.gms.car.application');
    expect(manifest).toContain('@xml/automotive_app_desc');
  });

  it('ships an automotive descriptor with the media capability', () => {
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
