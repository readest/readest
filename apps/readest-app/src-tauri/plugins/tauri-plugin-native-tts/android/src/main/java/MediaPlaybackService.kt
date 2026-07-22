package com.readest.native_tts

import com.readest.native_tts.R
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.graphics.Bitmap
import android.content.BroadcastReceiver
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.media.MediaBrowserServiceCompat
import androidx.media.session.MediaButtonReceiver
import androidx.core.content.FileProvider
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import app.tauri.plugin.JSObject
import java.io.File
import java.io.FileOutputStream

class MediaPlaybackService : MediaBrowserServiceCompat() {
    private var mediaSession: MediaSessionCompat? = null
    private lateinit var player: ExoPlayer
    private lateinit var stateBuilder: PlaybackStateCompat.Builder
    private lateinit var audioManager: AudioManager

    // True only between session activation (TTS playback started) and
    // deactivation. Android Auto can bind this service at any time to browse,
    // so every playback side effect (audio focus, the silent keep-alive
    // player, the foreground notification) must be gated on this flag.
    private var sessionActive = false

    // Resume after a TRANSIENT focus loss only if the loss is what paused us
    // (nav prompt, call); a user pause before the loss must stay a pause.
    private var resumeOnFocusGain = false

    // The real TTS audio renders in the WebView (or TextToSpeech), so pausing
    // the local keep-alive player alone would keep speech talking over the
    // interrupting audio. Focus changes route through the SAME plugin events
    // as lock-screen buttons; the JS TTSController pause/resume pushes state
    // back down and the keep-alive player follows (applyPlaybackState). The
    // local player is also flipped immediately so the lock-screen card does
    // not lag the round trip.
    private val afChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
        Log.i("MediaPlaybackService", "Audio focus changed: $focusChange, playing=${player.isPlaying}")
        when (focusChange) {
            AudioManager.AUDIOFOCUS_GAIN -> {
                if (resumeOnFocusGain) {
                    resumeOnFocusGain = false
                    player.play()
                    pluginEventTrigger?.invoke("media-session-play", JSObject())
                    updatePlaybackState()
                }
            }
            // Spoken audio pauses for transient loss instead of ducking or
            // talking over it (speech ducked under speech is unintelligible);
            // setWillPauseWhenDucked routes CAN_DUCK here rather than letting
            // the system auto-duck.
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                resumeOnFocusGain = player.isPlaying
                if (player.isPlaying) {
                    player.pause()
                    pluginEventTrigger?.invoke("media-session-pause", JSObject())
                    updatePlaybackState()
                }
            }
            // Permanent loss (another media app took over): pause and stay
            // paused; the system never sends a GAIN after this.
            AudioManager.AUDIOFOCUS_LOSS -> {
                resumeOnFocusGain = false
                if (player.isPlaying) {
                    player.pause()
                    pluginEventTrigger?.invoke("media-session-pause", JSObject())
                    updatePlaybackState()
                }
            }
        }
    }

    // Headphones unplugged / Bluetooth dropped: pause, never auto-resume —
    // otherwise spoken audio blasts from the phone speaker.
    private var noisyReceiverRegistered = false
    private val becomingNoisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != AudioManager.ACTION_AUDIO_BECOMING_NOISY) return
            resumeOnFocusGain = false
            if (player.isPlaying) {
                player.pause()
                pluginEventTrigger?.invoke("media-session-pause", JSObject())
                updatePlaybackState()
            }
        }
    }

    // Android O+ default is system auto-duck; declaring speech content and
    // willPauseWhenDucked opts into the audiobook contract (the counterpart of
    // iOS .spokenAudio): nav prompts pause us and GAIN resumes us.
    private var focusRequest: AudioFocusRequest? = null

    private fun requestFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setWillPauseWhenDucked(true)
                .setOnAudioFocusChangeListener(afChangeListener)
                .build()
            focusRequest = request
            if (audioManager.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                Log.w("MediaPlaybackService", "Failed to gain audio focus")
            }
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(
                afChangeListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            )
        }
    }

    private fun abandonFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            focusRequest = null
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(afChangeListener)
        }
    }

    companion object {
        private const val CHANNEL_ID = "media2_playback_channel"
        private const val NOTIFICATION_ID = 1002
        private const val MEDIA_ROOT_ID = "media_root_id"
        private const val CURRENT_READING_MEDIA_ID = "readest_current_reading"
        private const val RESUME_MEDIA_ID = "readest_resume_last_book"
        const val ACTION_ACTIVATE_SESSION = "ACTIVATE_SESSION"

        private const val PREFS_LAST_BOOK = "media_last_book"
        private const val KEY_HASH = "hash"
        private const val KEY_TITLE = "title"
        private const val KEY_AUTHOR = "author"

        var pluginEventTrigger: ((String, JSObject) -> Unit)? = null

        var currentTitle: String = "Read Aloud"
        var currentArtist: String = "Reading your content"
        var currentArtwork: Bitmap? = null

        // Stable content:// URI for the current cover (served via FileProvider).
        // Android Auto/the lock screen cache artwork by URI, so per-sentence
        // metadata updates no longer force a bitmap reload — which flashed the
        // cover. The bitmap is still kept for the notification's large icon.
        @Volatile
        var currentArtworkUri: Uri? = null

        // Media browser clients that render the cover and therefore need read
        // access granted to the FileProvider artwork URI.
        private val ARTWORK_URI_CLIENTS = listOf(
            "com.google.android.projection.gearhead",
            "com.google.android.gms",
            "com.android.systemui",
        )

        // Estimated section timeline (Edge/WebAudio engine only) in milliseconds.
        // Drives the lock-screen scrubber: position is the thumb, duration is
        // the track length. Native TextToSpeech has no timeline and leaves
        // duration at 0, so the scrubber simply does not appear there.
        @Volatile
        var currentPositionMs: Long = 0L
        @Volatile
        var currentDurationMs: Long = 0L

        // Last book read aloud, persisted across process death so the Android
        // Auto browse tree can offer a "Resume last book" entry when opened cold
        // (no active session). Hash addresses a readest://book/{hash} resume.
        @Volatile
        var lastBookHash: String? = null
        @Volatile
        var lastBookTitle: String? = null
        @Volatile
        var lastBookAuthor: String? = null

        fun saveLastBook(context: Context, hash: String, title: String?, author: String?) {
            lastBookHash = hash
            lastBookTitle = title
            lastBookAuthor = author
            context.getSharedPreferences(PREFS_LAST_BOOK, Context.MODE_PRIVATE).edit()
                .putString(KEY_HASH, hash)
                .putString(KEY_TITLE, title)
                .putString(KEY_AUTHOR, author)
                .apply()
        }

        private fun loadLastBook(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_LAST_BOOK, Context.MODE_PRIVATE)
            lastBookHash = prefs.getString(KEY_HASH, null)
            lastBookTitle = prefs.getString(KEY_TITLE, null)
            lastBookAuthor = prefs.getString(KEY_AUTHOR, null)
        }

        @Volatile
        private var instance: MediaPlaybackService? = null

        // Deactivate via an in-process call instead of stopService: while a
        // media browser client (Android Auto) keeps the service bound,
        // stopService neither runs onDestroy nor clears the foreground
        // notification, so playback teardown has to happen on the live
        // instance.
        fun requestDeactivation() {
            val service = instance ?: return
            Handler(Looper.getMainLooper()).post { service.deactivateSession() }
        }

        // Deliver metadata/state updates to the live service in-process rather
        // than via startService(): once the app is backgrounded, startService()
        // is rejected with "app is in background" (the Android 8+ background
        // service-start restriction), which silently dropped every playback
        // update — killing the lock-screen control and the notification refresh
        // that keeps the foreground service alive. A direct call on the running
        // instance is not a service *start*, so it is exempt. The statics are
        // refreshed regardless so a not-yet-created service picks them up when
        // it activates.
        fun pushMetadata(title: String, artist: String, artwork: Bitmap?) {
            currentTitle = title
            currentArtist = artist
            if (artwork != null) currentArtwork = artwork
            val service = instance ?: return
            Handler(Looper.getMainLooper()).post { service.applyMetadata() }
        }

        // position/duration are null when the update only reports a play/pause
        // flip (that payload omits them); keep the last known values so the
        // scrubber does not snap back to 0 on pause.
        fun pushPlaybackState(playing: Boolean, position: Long?, duration: Long?) {
            if (position != null) currentPositionMs = position
            if (duration != null) currentDurationMs = duration
            val service = instance ?: return
            Handler(Looper.getMainLooper()).post { service.applyPlaybackState(playing) }
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        // Android Auto binds this service cold (no session); restore the last
        // book so the browse tree can offer a "Resume last book" entry.
        loadLastBook(this)

        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        player = ExoPlayer.Builder(this).build()

        mediaSession = MediaSessionCompat(baseContext, "ReadestMediaSession").apply {
            stateBuilder = PlaybackStateCompat.Builder().setActions(
                PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_STOP or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_SEEK_TO or
                PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID or
                PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH
            )
            setPlaybackState(stateBuilder.build())
            setCallback(SessionCallback())
            setSessionToken(sessionToken)
        }

        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                updatePlaybackState()
            }
            override fun onPlaybackStateChanged(playbackState: Int) {
                updatePlaybackState()
            }
        })
    }

    private fun activateSession() {
        Log.d("MediaPlaybackService", "activateSession (wasActive=$sessionActive)")
        if (!sessionActive) {
            sessionActive = true

            requestFocus()
            if (!noisyReceiverRegistered) {
                noisyReceiverRegistered = true
                ContextCompat.registerReceiver(
                    this,
                    becomingNoisyReceiver,
                    IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
                    ContextCompat.RECEIVER_NOT_EXPORTED
                )
            }

            // Silent keep-alive track: holds the audio route and drives the
            // session's playing/paused state while the actual TTS audio comes
            // from the WebView or the TextToSpeech engine.
            val mediaItem = MediaItem.fromUri("asset:///silence.mp3")
            player.setMediaItem(mediaItem)
            player.repeatMode = Player.REPEAT_MODE_ONE
            player.prepare()
            player.playWhenReady = true

            mediaSession?.isActive = true
            notifyChildrenChanged(MEDIA_ROOT_ID)
        }
        // Always post the notification: activation arrives through
        // startForegroundService, which requires startForeground promptly.
        showNotification(PlaybackStateCompat.STATE_PLAYING)
    }

    private fun deactivateSession() {
        if (!sessionActive) return
        sessionActive = false

        player.playWhenReady = false
        player.stop()
        resumeOnFocusGain = false
        abandonFocus()
        if (noisyReceiverRegistered) {
            noisyReceiverRegistered = false
            unregisterReceiver(becomingNoisyReceiver)
        }

        mediaSession?.isActive = false
        mediaSession?.setPlaybackState(
            stateBuilder.setState(PlaybackStateCompat.STATE_STOPPED, 0L, 1f).build()
        )
        notifyChildrenChanged(MEDIA_ROOT_ID)

        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private inner class SessionCallback : MediaSessionCompat.Callback() {
        override fun onPlay() {
            player.play()
            pluginEventTrigger?.invoke("media-session-play", JSObject())
            updatePlaybackState()
        }

        override fun onPause() {
            // An explicit user pause must stick: cancel any pending
            // resume-after-interruption.
            resumeOnFocusGain = false
            player.pause()
            pluginEventTrigger?.invoke("media-session-pause", JSObject())
            updatePlaybackState()
        }

        // Next/previous just relay the intent to the WebView, which owns the
        // real paragraph navigation and pushes the new metadata/state back.
        // Seeking the silent keep-alive player here does nothing useful and
        // muddied the transition, so the JS side (ttsMediaBridge) holds an
        // optimistic playing state until the skipped-to segment speaks.
        override fun onSkipToNext() {
            pluginEventTrigger?.invoke("media-session-next", JSObject())
        }

        override fun onSkipToPrevious() {
            pluginEventTrigger?.invoke("media-session-previous", JSObject())
        }

        // Scrubber drag: hand the target back to the JS controller, which owns
        // the real audio timeline (seekToTime), and optimistically move the
        // thumb so the lock screen feels responsive before the seek lands.
        override fun onSeekTo(pos: Long) {
            currentPositionMs = pos
            pluginEventTrigger?.invoke("media-session-seek", JSObject().apply { put("position", pos) })
            val state = if (player.isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
            mediaSession?.setPlaybackState(
                stateBuilder.setState(state, pos, 1f).build()
            )
        }

        override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) {
            if (sessionActive) {
                onPlay()
                return
            }
            // Cold start from the car: launch the reader on the last book with
            // an autoplay flag so it starts TTS once loaded; playback then flows
            // back through this media session. The mediaId carries the hash;
            // fall back to the persisted one.
            val hash = mediaId?.substringAfter("$RESUME_MEDIA_ID:", "")?.takeIf { it.isNotEmpty() }
                ?: lastBookHash ?: return
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("readest://book/$hash?autoplay=tts"))
                .setPackage(packageName)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                startActivity(intent)
            } catch (e: Exception) {
                Log.e("MediaPlaybackService", "Failed to launch reader for resume", e)
            }
        }

        override fun onPlayFromSearch(query: String?, extras: Bundle?) {
            onPlay()
        }
    }

    private fun updatePlaybackState() {
        if (!sessionActive) return
        val state = if (player.isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        // Report the WebView playback position (currentPositionMs), NOT the
        // silent keep-alive player's position. silence.mp3 is a 10s loop, so
        // player.currentPosition saturates at ~10s and would freeze the car /
        // lock-screen scrubber there while the book plays on.
        mediaSession?.setPlaybackState(
            stateBuilder.setState(state, currentPositionMs, 1f).build()
        )
        showNotification(state)
    }

    // Last section duration written to the session metadata; the scrubber only
    // needs a metadata refresh when it actually changes (per section), not on
    // every position tick.
    private var appliedDurationMs: Long = -1L

    // Guards against rewriting the cache file on every (per-sentence) metadata
    // build: the URI is only re-published when the cover bitmap itself changes.
    private var artworkUriSource: Bitmap? = null
    private var artworkUriVersion = 0
    private var artworkUriFile: File? = null

    // Packages that have opened the browse tree (Android Auto's projection, the
    // media system components). The cover URI is cross-UID, so each must be
    // granted read access or its art loader hits a SecurityException and the
    // cover shows blank.
    private val browserClients =
        java.util.Collections.synchronizedSet(mutableSetOf<String>())

    private fun grantArtworkTo(pkg: String) {
        val uri = currentArtworkUri ?: return
        try {
            grantUriPermission(pkg, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (e: Exception) {
            Log.w("MediaPlaybackService", "grant artwork to $pkg failed", e)
        }
    }

    // Materialize currentArtwork as a stable content:// URI (once per cover) so
    // clients cache it instead of reloading the bitmap on every metadata update.
    // A fresh filename per cover keeps the URI stable within a book but changed
    // across books, so a new cover still refreshes. Cheap no-op while unchanged.
    private fun refreshArtworkUri() {
        val art = currentArtwork ?: return
        if (art !== artworkUriSource || currentArtworkUri == null) {
            try {
                val file = File(cacheDir, "tts_cover_${artworkUriVersion++}.png")
                FileOutputStream(file).use { out -> art.compress(Bitmap.CompressFormat.PNG, 100, out) }
                artworkUriFile?.delete()
                artworkUriFile = file
                currentArtworkUri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
                artworkUriSource = art
            } catch (e: Exception) {
                Log.w("MediaPlaybackService", "Failed to publish artwork uri", e)
                return
            }
        }
        // Re-grant every build: a client may connect before or after the cover
        // is set, and the grant is cheap + idempotent.
        for (pkg in ARTWORK_URI_CLIENTS) grantArtworkTo(pkg)
        for (pkg in browserClients.toList()) grantArtworkTo(pkg)
    }

    private fun buildMediaMetadata(): MediaMetadataCompat {
        refreshArtworkUri()
        val builder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
            .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, currentArtwork)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDurationMs)
        currentArtworkUri?.let {
            builder.putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, it.toString())
            builder.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI, it.toString())
        }
        return builder.build()
    }

    // Push the current statics into the live session + notification. Invoked
    // in-process from Companion.pushMetadata on the main thread.
    private fun applyMetadata() {
        appliedDurationMs = currentDurationMs
        mediaSession?.setMetadata(buildMediaMetadata())
        notifyChildrenChanged(MEDIA_ROOT_ID)
        if (sessionActive) {
            showNotification(
                if (player.isPlaying) PlaybackStateCompat.STATE_PLAYING
                else PlaybackStateCompat.STATE_PAUSED
            )
        }
    }

    // Reflect the WebView/TextToSpeech playback state onto the silent
    // keep-alive player, the media session, and the notification. Invoked
    // in-process from Companion.pushPlaybackState on the main thread; reads the
    // preserved position/duration statics.
    private fun applyPlaybackState(playing: Boolean) {
        if (!sessionActive) return
        if (playing && !player.isPlaying) {
            player.play()
        } else if (!playing && player.isPlaying) {
            player.pause()
        }
        // Do NOT seek the silent keep-alive player to currentPositionMs: it is a
        // 10s loop, so seeking past its end clamps (and can trip STATE_ENDED).
        // Its position is never read for the scrubber; only play/pause matters.
        val state = if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        mediaSession?.setPlaybackState(
            stateBuilder.setState(state, currentPositionMs, 1f).build()
        )
        // Refresh the scrubber length when the section duration changes.
        if (currentDurationMs != appliedDurationMs) {
            appliedDurationMs = currentDurationMs
            mediaSession?.setMetadata(buildMediaMetadata())
        }
        showNotification(state)
    }

    private fun showNotification(playbackState: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Media Controls", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        // Promote with an explicit mediaPlayback type (required/robust on
        // targetSdk 34+); ServiceCompat handles the pre-Q signature. A throw
        // here means the service never becomes foreground and the OS reclaims
        // it on idle, so surface it loudly instead of swallowing.
        try {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                buildNotification(playbackState),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
            )
            Log.d("MediaPlaybackService", "startForeground ok (state=$playbackState)")
        } catch (e: Exception) {
            Log.e("MediaPlaybackService", "startForeground failed", e)
        }
    }

    private fun buildNotification(playbackState: Int): Notification {
        val builder = NotificationCompat.Builder(this, CHANNEL_ID).apply {
            setContentTitle(currentTitle)
            setContentText(currentArtist)
            setLargeIcon(currentArtwork)
            setContentIntent(mediaSession!!.controller.sessionActivity)
            setDeleteIntent(MediaButtonReceiver.buildMediaButtonPendingIntent(this@MediaPlaybackService, PlaybackStateCompat.ACTION_STOP))
            setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            setSmallIcon(R.drawable.notification_icon)

            addAction(
                android.R.drawable.ic_media_previous,
                "Previous",
                MediaButtonReceiver.buildMediaButtonPendingIntent(
                    this@MediaPlaybackService,
                    PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                )
            )
            if (playbackState == PlaybackStateCompat.STATE_PLAYING) {
                addAction(
                    android.R.drawable.ic_media_pause,
                    "Pause",
                    MediaButtonReceiver.buildMediaButtonPendingIntent(
                        this@MediaPlaybackService,
                        PlaybackStateCompat.ACTION_PAUSE
                    )
                )
            } else {
                addAction(
                    android.R.drawable.ic_media_play,
                    "Play",
                    MediaButtonReceiver.buildMediaButtonPendingIntent(
                        this@MediaPlaybackService,
                        PlaybackStateCompat.ACTION_PLAY
                    )
                )
            }

            addAction(
                android.R.drawable.ic_media_next,
                "Next",
                MediaButtonReceiver.buildMediaButtonPendingIntent(
                    this@MediaPlaybackService,
                    PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                )
            )

            setStyle(
                androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(mediaSession?.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
        }
        return builder.build()
    }

    override fun onGetRoot(clientPackageName: String, clientUid: Int, rootHints: Bundle?): BrowserRoot? {
        // Grant the cover URI to the connecting browser client (Android Auto,
        // the media system UI) so its art loader can read it across UIDs.
        browserClients.add(clientPackageName)
        grantArtworkTo(clientPackageName)
        return BrowserRoot(MEDIA_ROOT_ID, null)
    }

    override fun onLoadChildren(parentId: String, result: Result<MutableList<MediaBrowserCompat.MediaItem>>) {
        val items = mutableListOf<MediaBrowserCompat.MediaItem>()
        if (parentId == MEDIA_ROOT_ID && sessionActive) {
            // Downscale the cover for the browse item: MediaItems are parceled
            // across binder to the car client, which caps transactions at ~1MB.
            val icon = currentArtwork?.let { art ->
                val maxSide = maxOf(art.width, art.height)
                if (maxSide > 512) {
                    val scale = 512f / maxSide
                    Bitmap.createScaledBitmap(
                        art,
                        (art.width * scale).toInt().coerceAtLeast(1),
                        (art.height * scale).toInt().coerceAtLeast(1),
                        true
                    )
                } else {
                    art
                }
            }
            val description = MediaDescriptionCompat.Builder()
                .setMediaId(CURRENT_READING_MEDIA_ID)
                .setTitle(currentTitle)
                .setSubtitle(currentArtist)
                .setIconBitmap(icon)
                .build()
            items.add(MediaBrowserCompat.MediaItem(description, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE))
        }
        // Idle (no active session): show nothing rather than a "Resume last
        // book" entry. Android Auto blocks launching Readest's WebView activity
        // while projecting, so cold play-from-media-id hangs on "Getting your
        // selection"; only expose the current book while it is actually playing.
        // (The persisted last-book fields + onPlayFromMediaId cold-launch stay
        // dormant for a future cold-start solution.)
        result.sendResult(items)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_ACTIVATE_SESSION -> {
                activateSession()
            }
            Intent.ACTION_MEDIA_BUTTON -> {
                if (sessionActive) {
                    MediaButtonReceiver.handleIntent(mediaSession, intent)
                } else {
                    // MediaButtonReceiver cold-starts this service with
                    // startForegroundService; honor the foreground contract,
                    // then back out — there is no TTS session to control.
                    showNotification(PlaybackStateCompat.STATE_PAUSED)
                    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
                    stopSelf(startId)
                }
            }
        }

        return super.onStartCommand(intent, flags, startId)
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
        if (noisyReceiverRegistered) {
            noisyReceiverRegistered = false
            unregisterReceiver(becomingNoisyReceiver)
        }
        abandonFocus()
        player.release()
        mediaSession?.release()
    }
}
