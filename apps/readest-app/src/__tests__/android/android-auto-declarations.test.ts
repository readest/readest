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
const carMediaBridge = readFileSync(
  resolve(process.cwd(), 'src/components/CarMediaLibraryBridge.tsx'),
  'utf-8',
);
const appGradle = readFileSync(
  resolve(process.cwd(), 'src-tauri/gen/android/app/build.gradle.kts'),
  'utf-8',
);

describe('Android Auto declarations (#3919)', () => {
  it('opts in to Android Auto media projection through a build-resolved name', () => {
    expect(manifest).toMatch(/android:name="\$\{carAppMetaName\}"/);
    expect(manifest).toContain('android:resource="@xml/automotive_app_desc"');
    // The literal name must not be hardcoded, or the Play build would ship the
    // car opt-in regardless of the flavor.
    expect(manifest).not.toContain('android:name="com.google.android.gms.car.application"');
  });

  /**
   * Play's Auto review rejected version code 11020 ("Audio inconsistently
   * plays on the Android Auto environment") and blocked the whole release
   * (#5038, #5235). Android Auto ships to the FOSS/GitHub builds while the Play
   * build withholds the declaration, so a Play submission is never routed
   * through Auto review until the car audio path is validated on hardware.
   */
  it('withholds the car declaration from the Google Play flavor only', () => {
    const placeholder = appGradle.slice(
      appGradle.indexOf('manifestPlaceholders["carAppMetaName"]'),
      appGradle.indexOf('signingConfigs'),
    );
    expect(placeholder).toContain('storeFlavor == "googleplay"');
    expect(placeholder).toContain('com.google.android.gms.car.application');
    // The googleplay branch must resolve to something Android never reads.
    const googlePlayBranch = placeholder.slice(0, placeholder.indexOf('} else {'));
    expect(googlePlayBranch).not.toContain('com.google.android.gms.car.application');

    const releaseScript = readFileSync(
      resolve(process.cwd(), 'scripts/release-google-play.sh'),
      'utf-8',
    );
    expect(releaseScript).toContain('storeFlavor=googleplay');
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

  it('keeps audiobook identity for cold-start player routing', () => {
    expect(mediaPlaybackService).toContain('isAudiobook = item.optBoolean("isAudiobook", false)');
    expect(mediaPlaybackService).toContain('selectedBook?.isAudiobook == true');
    expect(mediaPlaybackService).toContain('"readest://book/$hash?autoplay=tts"');
  });

  it('starts cold EPUB speech inside the media service without requiring the phone activity', () => {
    expect(mediaPlaybackService).toContain('ACTION_START_COLD_EPUB');
    expect(mediaPlaybackService).toContain('activateColdEpubPlayback(hash)');
    expect(mediaPlaybackService).toContain('ColdEpubText.read(source, config.cfi)');
    expect(mediaPlaybackService).toContain('TextToSpeech(applicationContext)');
    expect(mediaPlaybackService).toContain('handoffColdTtsToWebView(pending)');
    expect(mediaPlaybackService).toContain('File(applicationInfo.dataDir, "Readest/Books/');
    expect(mediaPlaybackService).toContain('persistColdTtsLocation(segment.cfi)');
    expect(mediaPlaybackService).toContain(
      'MediaButtonReceiver.handleIntent(mediaSession, intent)',
    );
    expect(carMediaBridge).toContain('selectionListenerReady');
    expect(carMediaBridge).toContain('playbackSourceState.key !== playbackSourceKey');
    expect(carMediaBridge).toContain('resolveNativeBookFilePath(book)');
    expect(carMediaBridge).toContain('getConfigFilename(book)');
    expect(mediaPlaybackService).toContain('isCurrentColdUtterance(utteranceId) && !coldTtsPaused');
  });

  it('releases cold playback on explicit WebView activation even after pause canceled autoplay', () => {
    const activation = mediaPlaybackService.slice(
      mediaPlaybackService.indexOf('fun requestActivation(sessionId: String?, bookHash: String?)'),
      mediaPlaybackService.lastIndexOf('fun requestDeactivation(sessionId:'),
    );
    // Pause can empty pendingBookHash. Explicit activation must release the
    // native owner independently of setPluginEventTrigger draining that queue.
    expect(activation).toContain('service.clearColdTtsPlayback()');
    expect(activation).not.toContain('pendingBookHash');
  });

  it('keeps book switches from accepting stale playback or artwork updates', () => {
    expect(nativeTTSPlugin).toContain(
      'MediaPlaybackService.requestActivation(args.sessionId, args.bookHash)',
    );
    expect(nativeTTSPlugin).toContain(
      'MediaPlaybackService.pushMetadata(args.sessionId, title, artist, artworkBitmap)',
    );
    expect(mediaPlaybackService).toContain('MediaSessionActivationState.acceptsUpdate(sessionId)');
    expect(mediaPlaybackService).toContain('service.resetArtworkForBook(bookHash)');
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

  // The session is command-ready for the life of the bound service, so a
  // hardware/Bluetooth play button can reach it with nothing playing. It must
  // not start the silent keep-alive player and hold the media button away from
  // whatever the user meant to resume.
  it('ignores transport commands that arrive with no active session', () => {
    const callbackBlock = mediaPlaybackService.slice(
      mediaPlaybackService.indexOf('private inner class SessionCallback'),
      mediaPlaybackService.indexOf('override fun onSkipToNext()'),
    );
    const playBlock = callbackBlock.slice(
      callbackBlock.indexOf('override fun onPlay()'),
      callbackBlock.indexOf('override fun onPause()'),
    );
    const pauseBlock = callbackBlock.slice(callbackBlock.indexOf('override fun onPause()'));
    expect(playBlock).toContain('if (!sessionActive)');
    expect(playBlock.indexOf('if (!sessionActive)')).toBeLessThan(
      playBlock.indexOf('player.play()'),
    );
    expect(pauseBlock).toContain('if (!sessionActive) return');
  });

  // A selection that never lands (row deleted since the browse tree was
  // cached, no listener on the current route) previously left Android Auto
  // pinned on STATE_BUFFERING until it timed out with the exact error this
  // feature exists to remove.
  it('fails a stuck browse selection instead of buffering forever', () => {
    expect(mediaPlaybackService).toContain('armSelectionWatchdog(hash)');
    expect(mediaPlaybackService).toContain('PlaybackStateCompat.STATE_ERROR');
    expect(mediaPlaybackService).toContain('R.string.readest_auto_selection_failed');
    const activateBlock = mediaPlaybackService.slice(
      mediaPlaybackService.indexOf('private fun activateSession()'),
      mediaPlaybackService.indexOf('private fun deactivateSession()'),
    );
    expect(activateBlock).toContain('cancelSelectionWatchdog()');
  });

  // Any bound client can call playFromMediaId. Writing the shared statics
  // there let it retitle and zero the scrubber of audio that is still playing.
  it('does not overwrite the live session while a selection is pending', () => {
    const playFromMediaId = mediaPlaybackService.slice(
      mediaPlaybackService.indexOf('override fun onPlayFromMediaId'),
      mediaPlaybackService.indexOf('armSelectionWatchdog(hash)'),
    );
    expect(playFromMediaId).toContain('mediaSession?.setMetadata(buildLibraryBookMetadata');
    expect(playFromMediaId).not.toContain('currentTitle =');
    expect(playFromMediaId).not.toContain('currentPositionMs = 0L');
  });

  // The browse tree is readable by any app that binds the exported service, so
  // the native side enforces its own ceiling on the published slice.
  it('caps the natively persisted browse tree', () => {
    expect(mediaPlaybackService).toContain('private const val MAX_LIBRARY_BOOKS = 10');
    expect(mediaPlaybackService).toContain('if (size >= MAX_LIBRARY_BOOKS) break');
  });

  it('localizes the browse-tree labels instead of hardcoding English', () => {
    expect(mediaPlaybackService).toContain('R.string.readest_auto_library_root');
    expect(mediaPlaybackService).toContain('R.plurals.readest_auto_library_count');
    expect(mediaPlaybackService).not.toContain('.setTitle("Library")');
    const strings = readFileSync(
      resolve(
        process.cwd(),
        'src-tauri/plugins/tauri-plugin-native-tts/android/src/main/res/values/strings.xml',
      ),
      'utf-8',
    );
    expect(strings).toContain('readest_auto_library_root');
    expect(strings).toContain('readest_auto_library_count');
    expect(strings).toContain('readest_auto_selection_failed');
  });

  /**
   * The service is exported so Android Auto can bind it, which means any
   * installed app can call onGetRoot. Caller validation runs in shadow mode:
   * the verdict is logged but not enforced until the certificate pins have been
   * collected from real head units. The Kotlin decision logic has its own JUnit
   * suite (MediaBrowserCallerValidatorTest); this only guards the wiring.
   */
  it('evaluates and logs every browse caller before serving the tree', () => {
    expect(mediaPlaybackService).toContain('MediaBrowserCallerValidator.evaluate');
    expect(mediaPlaybackService).toContain('browse caller');
    const getRoot = mediaPlaybackService.slice(
      mediaPlaybackService.indexOf('override fun onGetRoot'),
      mediaPlaybackService.indexOf('override fun onLoadChildren'),
    );
    // The artwork grant and the client registry must sit behind the verdict,
    // not in front of it.
    expect(getRoot.indexOf('resolveCallerVerdict')).toBeLessThan(
      getRoot.indexOf('grantArtworkTo(clientPackageName)'),
    );
  });

  /**
   * An empty root still completes the connection, and a completed connection
   * hands the caller the media-session token, which drives onPlay /
   * onPlayFromMediaId — the session callbacks authorize nothing. Google's
   * Android for Cars guidance is to return null for an untrusted package.
   */
  it('refuses the connection outright for a denied caller', () => {
    const getRoot = mediaPlaybackService.slice(
      mediaPlaybackService.indexOf('override fun onGetRoot'),
      mediaPlaybackService.indexOf('override fun onLoadChildren'),
    );
    expect(getRoot).toMatch(
      /ENFORCE_BROWSE_VALIDATION && !verdict\.allowed\)\s*\{[^}]*return null/,
    );
    expect(mediaPlaybackService).not.toContain('EMPTY_ROOT_ID');
  });

  /**
   * A browser client chooses the parentId it subscribes to, so it can request
   * LIBRARY_ROOT_ID directly regardless of which root onGetRoot returned.
   * Without a check here the root decision is only advisory.
   */
  it('authorizes the caller again before serving any browse children', () => {
    const loadChildren = mediaPlaybackService.slice(
      mediaPlaybackService.indexOf('override fun onLoadChildren'),
      mediaPlaybackService.indexOf('override fun onStartCommand'),
    );
    expect(loadChildren).toContain('isCurrentBrowserAllowed()');
    // The guard must precede any item construction, library or now-playing.
    expect(loadChildren.indexOf('isCurrentBrowserAllowed()')).toBeLessThan(
      loadChildren.indexOf('MediaDescriptionCompat.Builder()'),
    );
    expect(loadChildren.indexOf('isCurrentBrowserAllowed()')).toBeLessThan(
      loadChildren.indexOf('.setMediaId(LIBRARY_ROOT_ID)'),
    );
    expect(mediaPlaybackService).toContain('currentBrowserInfo');
  });

  it('ships browse validation in shadow mode until the pins are collected', () => {
    expect(mediaPlaybackService).toContain('private const val ENFORCE_BROWSE_VALIDATION = false');
    const validator = readFileSync(
      resolve(
        process.cwd(),
        'src-tauri/plugins/tauri-plugin-native-tts/android/src/main/java/MediaBrowserCallerValidator.kt',
      ),
      'utf-8',
    );
    expect(validator).toContain('val TRUSTED_CERTIFICATES: Map<String, Set<String>> = emptyMap()');
    expect(validator).toContain('com.google.android.projection.gearhead');
  });
});
