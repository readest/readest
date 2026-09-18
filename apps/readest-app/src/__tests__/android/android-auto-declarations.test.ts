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
 * Readest mirrors locally playable library metadata into the native service.
 * The service exposes that list as a driver-safe browse tree and routes a
 * selection back into the existing ebook TTS or audiobook player.
 */

const manifest = readFileSync(
  resolve(process.cwd(), 'src-tauri/gen/android/app/src/main/AndroidManifest.xml'),
  'utf-8',
);
const mediaPlaybackService = readFileSync(
  resolve(
    process.cwd(),
    'src-tauri/plugins/tauri-plugin-native-tts/android/src/main/java/MediaPlaybackService.kt',
  ),
  'utf-8',
);
const nativeTTSPlugin = readFileSync(
  resolve(
    process.cwd(),
    'src-tauri/plugins/tauri-plugin-native-tts/android/src/main/java/NativeTTSPlugin.kt',
  ),
  'utf-8',
);

describe('Android Auto declarations (#3919)', () => {
  it('opts in to Android Auto media projection', () => {
    expect(manifest).toContain('com.google.android.gms.car.application');
    expect(manifest).toContain('android:resource="@xml/automotive_app_desc"');
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
  it('publishes a browsable library and routes selected books to the app', () => {
    expect(mediaPlaybackService).toContain('LIBRARY_ROOT_ID');
    expect(mediaPlaybackService).toContain('MediaBrowserCompat.MediaItem.FLAG_BROWSABLE');
    expect(mediaPlaybackService).toContain('media-session-play-book');
    expect(mediaPlaybackService).toContain('PlaybackStateCompat.STATE_BUFFERING');
    expect(mediaPlaybackService).toContain('.setIconUri(libraryArtworkUri(book))');
    expect(nativeTTSPlugin).toContain('fun update_media_library');
  });

  it('keeps the browsing media session active while playback is stopped', () => {
    const createBlock = mediaPlaybackService.slice(
      mediaPlaybackService.indexOf('override fun onCreate()'),
      mediaPlaybackService.indexOf('private fun activateSession()'),
    );
    const deactivateBlock = mediaPlaybackService.slice(
      mediaPlaybackService.indexOf('private fun deactivateSession()'),
      mediaPlaybackService.indexOf('private inner class SessionCallback'),
    );
    expect(createBlock).toContain('isActive = true');
    expect(deactivateBlock).not.toContain('isActive = false');

    const idleShutdownBlock = nativeTTSPlugin.slice(
      nativeTTSPlugin.indexOf('private fun shutdownTTSEngine()'),
      nativeTTSPlugin.indexOf('fun destroy()'),
    );
    expect(idleShutdownBlock).not.toContain('pluginEventTrigger = null');
  });
});
