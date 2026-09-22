package com.readest.native_tts

import com.readest.native_tts.R
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.content.pm.Signature
import android.os.Process
import java.security.MessageDigest
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.graphics.Bitmap
import android.content.BroadcastReceiver
import android.content.IntentFilter
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
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
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

internal data class AndroidAutoBook(
    val hash: String,
    val title: String,
    val author: String,
    val isAudiobook: Boolean,
    val format: String,
    val sourcePath: String?,
    val configPath: String?,
    val coverHash: String?,
    val artworkReady: Boolean,
)

internal object MediaSessionActivationState {
    @Volatile
    private var desiredActive = false
    @Volatile
    private var desiredSessionId: String? = null

    @Synchronized
    fun requestActivation(sessionId: String? = null): Boolean {
        val changed = !desiredActive || desiredSessionId != sessionId
        desiredActive = true
        desiredSessionId = sessionId
        return changed
    }

    @Synchronized
    fun requestDeactivation(sessionId: String? = null): Boolean {
        // A replaced controller can finish its asynchronous teardown after the
        // new book has activated. Never let that stale stop win.
        if (sessionId != null && desiredSessionId != null && sessionId != desiredSessionId) {
            return false
        }
        desiredActive = false
        // Deliberately keep desiredSessionId. The idle-shutdown timer and
        // destroy() deactivate with no sessionId, and clearing the owner here
        // made acceptsUpdate() reject every later update from the session that
        // is still on screen — a book paused past the idle timeout could never
        // move its scrubber again. The owner is overwritten by the next
        // activation, which is the only thing that should replace it.
        return true
    }

    fun isActivationDesired(): Boolean = desiredActive

    // Reject updates from a session that has been REPLACED by another book.
    // Deactivation alone must not reject them: the session on screen keeps
    // reporting position while the foreground service is torn down.
    @Synchronized
    fun acceptsUpdate(sessionId: String?): Boolean =
        sessionId == null || desiredSessionId == null || sessionId == desiredSessionId

    @Synchronized
    fun resetForTest() {
        desiredActive = false
        desiredSessionId = null
    }
}

class MediaPlaybackService : MediaBrowserServiceCompat() {
    private var mediaSession: MediaSessionCompat? = null
    private lateinit var player: ExoPlayer
    private lateinit var stateBuilder: PlaybackStateCompat.Builder
    private lateinit var audioManager: AudioManager
    private val mainHandler = Handler(Looper.getMainLooper())
    private val coldTextExecutor = Executors.newSingleThreadExecutor()
    private var coldTts: TextToSpeech? = null
    private var coldTtsReady = false
    private var coldTtsActive = false
    private var coldTtsPaused = false
    private var coldTtsGeneration = 0
    private var coldTtsIndex = 0
    private var coldTtsSegments: List<ColdEpubSegment> = emptyList()
    private var coldTtsBookHash: String? = null
    private var coldTtsConfigPath: String? = null
    private var coldTtsSavedCfi: String? = null

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
                    if (coldTtsActive) {
                        resumeColdTts()
                    } else {
                        player.play()
                        pluginEventTrigger?.invoke("media-session-play", JSObject())
                        updatePlaybackState()
                    }
                }
            }
            // Spoken audio pauses for transient loss instead of ducking or
            // talking over it (speech ducked under speech is unintelligible);
            // setWillPauseWhenDucked routes CAN_DUCK here rather than letting
            // the system auto-duck.
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                resumeOnFocusGain = player.isPlaying
                if (coldTtsActive) {
                    pauseColdTts()
                } else if (player.isPlaying) {
                    player.pause()
                    pluginEventTrigger?.invoke("media-session-pause", JSObject())
                    updatePlaybackState()
                }
            }
            // Permanent loss (another media app took over): pause and stay
            // paused; the system never sends a GAIN after this.
            AudioManager.AUDIOFOCUS_LOSS -> {
                resumeOnFocusGain = false
                if (coldTtsActive) {
                    pauseColdTts()
                } else if (player.isPlaying) {
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
            if (coldTtsActive) {
                pauseColdTts()
            } else if (player.isPlaying) {
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
                .setAudioAttributes(SPOKEN_MEDIA_ATTRIBUTES)
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
        private val SPOKEN_MEDIA_ATTRIBUTES: AudioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()

        private const val CHANNEL_ID = "media2_playback_channel"
        private const val NOTIFICATION_ID = 1002
        private const val MEDIA_ROOT_ID = "media_root_id"
        // Shadow mode. False = every caller is still served the real tree and
        // the verdict is only logged; true = unvalidated callers are refused
        // outright. Flip this only after the certificates in
        // MediaBrowserCallerValidator.TRUSTED_CERTIFICATES have been filled in
        // from what real head units actually present (see that file).
        private const val ENFORCE_BROWSE_VALIDATION = false
        private const val LIBRARY_ROOT_ID = "readest_library"
        private const val BOOK_MEDIA_ID_PREFIX = "readest_book:"
        private const val CURRENT_READING_MEDIA_ID = "readest_current_reading"
        private const val RESUME_MEDIA_ID = "readest_resume_last_book"
        const val ACTION_ACTIVATE_SESSION = "ACTIVATE_SESSION"
        private const val ACTION_START_COLD_EPUB = "START_COLD_EPUB"
        private const val EXTRA_BOOK_HASH = "book_hash"
        private const val COLD_TTS_INIT_TIMEOUT_MS = 8_000L

        private const val PREFS_LAST_BOOK = "media_last_book"
        private const val KEY_HASH = "hash"
        private const val KEY_TITLE = "title"
        private const val KEY_AUTHOR = "author"
        private const val PREFS_MEDIA_LIBRARY = "media_library"
        private const val KEY_LIBRARY_JSON = "books_json"
        private const val COVER_THUMBNAIL_CACHE_DIR = "cover-thumbnails/v1"
        // How long a browse selection may stay in STATE_BUFFERING before the
        // car is told it failed. Generous enough to cover a cold WebView plus
        // a cloud download, short enough to beat Android Auto's own timeout.
        private const val SELECTION_TIMEOUT_MS = 20_000L
        // Upper bound on the published browse tree, mirroring
        // MAX_ANDROID_AUTO_BOOKS on the JS side. The exported service is
        // bindable by any app, so the native side enforces its own ceiling
        // rather than trusting whatever the payload happens to contain.
        private const val MAX_LIBRARY_BOOKS = 10
        private val MD5_PATTERN = Regex("^[0-9a-fA-F]{32}$")

        @Volatile
        private var pluginEventTrigger: ((String, JSObject) -> Unit)? = null
        @Volatile
        private var pendingBookHash: String? = null

        fun setPluginEventTrigger(trigger: ((String, JSObject) -> Unit)?) {
            val pending = synchronized(this) {
                pluginEventTrigger = trigger
                if (trigger == null) {
                    null
                } else {
                    pendingBookHash.also { pendingBookHash = null }
                }
            }
            if (pending != null && trigger != null) {
                val service = instance
                val deliver = {
                    trigger("media-session-play-book", JSObject().apply { put("bookHash", pending) })
                }
                if (service == null) {
                    deliver()
                } else {
                    Handler(Looper.getMainLooper()).post {
                        service.handoffColdTtsToWebView(pending)
                        deliver()
                    }
                }
            }
        }

        private fun dispatchOrQueueBookPlayback(hash: String): Boolean {
            val trigger = synchronized(this) {
                pendingBookHash = hash
                pluginEventTrigger?.also { pendingBookHash = null }
            }
            trigger?.invoke("media-session-play-book", JSObject().apply { put("bookHash", hash) })
            return trigger != null
        }

        private fun cancelPendingBookPlayback(): Boolean = synchronized(this) {
            val hadPendingSelection = pendingBookHash != null
            pendingBookHash = null
            hadPendingSelection
        }

        // Whether this service should hold the app's audio focus for the
        // current session. True for audio the app renders itself (the
        // TextToSpeech engine, WebAudio, the narration ExoPlayer above).
        //
        // FALSE for audiobook playback, whose audio comes from a WebView
        // <audio> element: Chromium requests AUDIOFOCUS_GAIN for that element
        // under this same uid, which preempts this service's request and
        // delivers AUDIOFOCUS_LOSS here ~15ms later. The listener below then
        // relayed media-session-pause to the WebView, pausing the audiobook a
        // fraction of a second after it started. Chromium keeps the
        // interruption contract for its own element (it pauses on loss and
        // resumes after a transient one), so the service stays out of the way
        // — the ACTION_AUDIO_BECOMING_NOISY receiver and the lock-screen
        // transport controls below are unaffected either way.
        @Volatile
        var ownsAudioFocus: Boolean = true

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

        @Volatile
        private var libraryBooks: List<AndroidAutoBook> = emptyList()
        @Volatile
        private var currentBookHash: String? = null

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

        internal fun parseLibrary(booksJson: String): List<AndroidAutoBook> {
            val array = JSONArray(booksJson)
            return buildList {
                for (index in 0 until array.length()) {
                    if (size >= MAX_LIBRARY_BOOKS) break
                    val item = array.optJSONObject(index) ?: continue
                    val hash = item.optString("hash").trim()
                    val title = item.optString("title").trim()
                    if (hash.isEmpty() || title.isEmpty()) continue
                    add(
                        AndroidAutoBook(
                            hash = hash,
                            title = title,
                            author = item.optString("author").trim(),
                            isAudiobook = item.optBoolean("isAudiobook", false),
                            format = item.optString("format").trim().uppercase(),
                            sourcePath = item.optString("sourcePath")
                                .trim()
                                .takeIf { it.isNotEmpty() && it != "null" },
                            configPath = item.optString("configPath")
                                .trim()
                                .takeIf { it.isNotEmpty() && it != "null" },
                            coverHash = item.optString("coverHash")
                                .trim()
                                .takeIf { MD5_PATTERN.matches(it) },
                            artworkReady = item.optBoolean("artworkReady", false),
                        )
                    )
                }
            }
        }

        fun saveLibrary(context: Context, booksJson: String) {
            val parsed = parseLibrary(booksJson)
            context.getSharedPreferences(PREFS_MEDIA_LIBRARY, Context.MODE_PRIVATE).edit()
                .putString(KEY_LIBRARY_JSON, booksJson)
                .apply()
            libraryBooks = parsed
            val service = instance ?: return
            Handler(Looper.getMainLooper()).post {
                service.notifyChildrenChanged(MEDIA_ROOT_ID)
                service.notifyChildrenChanged(LIBRARY_ROOT_ID)
            }
        }

        private fun loadLibrary(context: Context) {
            val json = context.getSharedPreferences(PREFS_MEDIA_LIBRARY, Context.MODE_PRIVATE)
                .getString(KEY_LIBRARY_JSON, "[]") ?: "[]"
            libraryBooks = try {
                parseLibrary(json)
            } catch (e: Exception) {
                Log.w("MediaPlaybackService", "Ignoring invalid Android Auto library", e)
                emptyList()
            }
        }

        @Volatile
        private var instance: MediaPlaybackService? = null

        // Deactivate via an in-process call instead of stopService: while a
        // media browser client (Android Auto) keeps the service bound,
        // stopService neither runs onDestroy nor clears the foreground
        // notification, so playback teardown has to happen on the live
        // instance.
        fun requestActivation(sessionId: String?, bookHash: String?) {
            val changed = MediaSessionActivationState.requestActivation(sessionId)
            if (bookHash != null) currentBookHash = bookHash
            if (!changed) return

            // Never carry the previous book's decoded bitmap into the new
            // session. Seed the matching cached library thumbnail immediately;
            // the full artwork can replace it later.
            currentArtwork = null
            currentArtworkUri = null
            currentPositionMs = 0L
            currentDurationMs = 0L
            val service = instance ?: return
            Handler(Looper.getMainLooper()).post {
                // Explicit WebView playback takes ownership even if Pause
                // canceled the pending automatic book-selection handoff.
                service.clearColdTtsPlayback()
                service.resetArtworkForBook(bookHash)
            }
        }

        fun requestDeactivation(sessionId: String? = null) {
            if (!MediaSessionActivationState.requestDeactivation(sessionId)) return
            val service = instance ?: return
            Handler(Looper.getMainLooper()).post {
                if (!MediaSessionActivationState.isActivationDesired()) {
                    service.deactivateSession()
                }
            }
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
        fun pushMetadata(sessionId: String?, title: String, artist: String, artwork: Bitmap?) {
            if (!MediaSessionActivationState.acceptsUpdate(sessionId)) return
            currentTitle = title
            currentArtist = artist
            if (artwork != null) currentArtwork = artwork
            val service = instance ?: return
            Handler(Looper.getMainLooper()).post { service.applyMetadata() }
        }

        // position/duration are null when the update only reports a play/pause
        // flip (that payload omits them); keep the last known values so the
        // scrubber does not snap back to 0 on pause.
        fun pushPlaybackState(
            sessionId: String?,
            playing: Boolean,
            position: Long?,
            duration: Long?,
        ) {
            if (!MediaSessionActivationState.acceptsUpdate(sessionId)) return
            if (position != null) currentPositionMs = position
            if (duration != null) currentDurationMs = duration
            val service = instance ?: return
            Handler(Looper.getMainLooper()).post { service.applyPlaybackState(playing) }
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        // Android Auto binds this service cold (no session); restore the
        // persisted library and last-book fallback before it requests a root.
        loadLastBook(this)
        loadLibrary(this)

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
            setPlaybackState(
                stateBuilder.setState(PlaybackStateCompat.STATE_STOPPED, 0L, 1f).build()
            )
            setCallback(SessionCallback())
            // A browser client can select a book while no TTS session is
            // already playing. Keep the media session command-ready for the
            // lifetime of the bound service; sessionActive separately gates
            // audio focus, foreground state, and the silent route keeper.
            isActive = true
            setSessionToken(sessionToken)
        }
        currentBookHash?.let { resetArtworkForBook(it) }

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
        Log.d("MediaPlaybackService", "activateSession (wasActive=$sessionActive, focus=$ownsAudioFocus)")
        // Whatever the car selected has arrived and is starting; the pending
        // selection no longer needs a failure timer.
        cancelSelectionWatchdog()
        if (!sessionActive) {
            sessionActive = true

            if (ownsAudioFocus) requestFocus()
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
        clearColdTtsPlayback()
        sessionActive = false

        player.playWhenReady = false
        player.stop()
        resumeOnFocusGain = false
        abandonFocus()
        if (noisyReceiverRegistered) {
            noisyReceiverRegistered = false
            unregisterReceiver(becomingNoisyReceiver)
        }

        mediaSession?.setPlaybackState(
            stateBuilder.setState(PlaybackStateCompat.STATE_STOPPED, 0L, 1f).build()
        )
        notifyChildrenChanged(MEDIA_ROOT_ID)

        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private data class ColdTtsConfig(val cfi: String?, val rate: Float)
    private data class ColdEpubPaths(val sourcePath: String, val configPath: String?)

    private fun requestColdEpubPlayback(book: AndroidAutoBook) {
        val intent = Intent(this, MediaPlaybackService::class.java).apply {
            action = ACTION_START_COLD_EPUB
            putExtra(EXTRA_BOOK_HASH, book.hash)
        }
        ContextCompat.startForegroundService(this, intent)
    }

    private fun activateColdEpubPlayback(hash: String) {
        val book = libraryBooks.firstOrNull { it.hash == hash }
        val paths = book?.let(::resolveColdEpubPaths)
        if (book == null || paths == null) {
            publishColdTtsError("This book is not available for cold Read Aloud")
            return
        }

        clearColdTtsPlayback()
        coldTtsGeneration += 1
        val generation = coldTtsGeneration
        coldTtsActive = true
        coldTtsPaused = false
        coldTtsIndex = 0
        coldTtsSegments = emptyList()
        coldTtsBookHash = hash
        coldTtsConfigPath = paths.configPath
        coldTtsSavedCfi = null

        currentBookHash = hash
        currentTitle = book.title
        currentArtist = book.author
        ownsAudioFocus = true
        MediaSessionActivationState.requestActivation("android-auto-cold:$hash")
        activateSession()
        mediaSession?.setPlaybackState(
            stateBuilder.setState(PlaybackStateCompat.STATE_BUFFERING, 0L, 1f).build()
        )
        showNotification(PlaybackStateCompat.STATE_BUFFERING)

        initializeColdTts(generation)
        coldTextExecutor.execute {
            var temporaryFile: File? = null
            try {
                val materialized = materializeColdBook(paths.sourcePath)
                val source = materialized.file
                if (materialized.temporary) temporaryFile = source
                val config = readColdTtsConfig(paths.configPath)
                val speech = ColdEpubText.read(source, config.cfi)
                mainHandler.post {
                    if (!coldTtsActive || generation != coldTtsGeneration) return@post
                    coldTts?.setSpeechRate(config.rate)
                    coldTtsSegments = speech.segments
                    if (coldTtsSegments.isEmpty()) {
                        publishColdTtsError("No readable text was found in this book")
                    } else {
                        maybeSpeakColdTts()
                    }
                }
            } catch (error: Exception) {
                Log.e("MediaPlaybackService", "Cold EPUB preparation failed for $hash", error)
                mainHandler.post {
                    if (generation == coldTtsGeneration) {
                        publishColdTtsError("Read Aloud could not open this book")
                    }
                }
            } finally {
                temporaryFile?.delete()
            }
        }
    }

    private fun resolveColdEpubPaths(book: AndroidAutoBook): ColdEpubPaths? {
        if (book.format == "EPUB" && !book.sourcePath.isNullOrBlank()) {
            return ColdEpubPaths(book.sourcePath, book.configPath)
        }

        // Libraries saved by versions before 0.12.23 do not contain native
        // source/config paths. Managed books live under Tauri's Android
        // AppData root, so upgrade in place without requiring the phone app to
        // be opened once merely to republish library metadata.
        if (!MD5_PATTERN.matches(book.hash)) return null
        val bookDir = File(applicationInfo.dataDir, "Readest/Books/${book.hash}")
        val source = bookDir.listFiles()?.firstOrNull {
            it.isFile && it.extension.equals("epub", ignoreCase = true)
        } ?: return null
        return ColdEpubPaths(source.absolutePath, File(bookDir, "config.json").absolutePath)
    }

    private data class ColdBookFile(val file: File, val temporary: Boolean)

    private fun materializeColdBook(sourcePath: String): ColdBookFile {
        val uri = Uri.parse(sourcePath)
        if (uri.scheme != "content") return ColdBookFile(File(sourcePath), false)
        val output = File.createTempFile("android_auto_book_", ".epub", cacheDir)
        contentResolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "Unable to open $sourcePath" }
            output.outputStream().use(input::copyTo)
        }
        return ColdBookFile(output, true)
    }

    private fun readColdTtsConfig(configPath: String?): ColdTtsConfig {
        if (configPath.isNullOrBlank()) return ColdTtsConfig(null, 1f)
        return try {
            val json = JSONObject(File(configPath).readText())
            val viewSettings = json.optJSONObject("viewSettings")
            val cfi = viewSettings?.optString("ttsLocation")
                ?.takeIf { it.isNotBlank() }
                ?: json.optString("location").takeIf { it.isNotBlank() }
            val rate = viewSettings?.optDouble("ttsRate", 1.0)?.toFloat() ?: 1f
            ColdTtsConfig(cfi, rate.coerceIn(0.25f, 4f))
        } catch (_: Exception) {
            ColdTtsConfig(null, 1f)
        }
    }

    private fun initializeColdTts(generation: Int) {
        lateinit var engine: TextToSpeech
        engine = TextToSpeech(applicationContext) { status ->
            mainHandler.post {
                if (!coldTtsActive || generation != coldTtsGeneration) {
                    engine.shutdown()
                    return@post
                }
                if (status != TextToSpeech.SUCCESS) {
                    publishColdTtsError("Android text-to-speech could not start")
                    return@post
                }
                engine.setAudioAttributes(SPOKEN_MEDIA_ATTRIBUTES)
                engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) = Unit

                    override fun onDone(utteranceId: String?) {
                        mainHandler.post done@{
                            if (!isCurrentColdUtterance(utteranceId) || coldTtsPaused) return@done
                            coldTtsIndex += 1
                            if (coldTtsIndex >= coldTtsSegments.size) {
                                mediaSession?.setPlaybackState(
                                    stateBuilder.setState(
                                        PlaybackStateCompat.STATE_STOPPED,
                                        0L,
                                        1f,
                                    ).build()
                                )
                                deactivateSession()
                            } else {
                                speakCurrentColdTtsSegment()
                            }
                        }
                    }

                    @Deprecated("Deprecated in Android")
                    override fun onError(utteranceId: String?) {
                        mainHandler.post {
                            if (isCurrentColdUtterance(utteranceId) && !coldTtsPaused) {
                                publishColdTtsError("Android text-to-speech stopped unexpectedly")
                            }
                        }
                    }

                    override fun onError(utteranceId: String?, errorCode: Int) = onError(utteranceId)
                })
                coldTts = engine
                coldTtsReady = true
                maybeSpeakColdTts()
            }
        }
        coldTts = engine
        mainHandler.postDelayed({
            if (coldTtsActive && generation == coldTtsGeneration && !coldTtsReady) {
                publishColdTtsError("Android text-to-speech took too long to start")
            }
        }, COLD_TTS_INIT_TIMEOUT_MS)
    }

    private fun maybeSpeakColdTts() {
        if (!coldTtsActive || coldTtsPaused || !coldTtsReady || coldTtsSegments.isEmpty()) return
        speakCurrentColdTtsSegment()
    }

    private fun speakCurrentColdTtsSegment() {
        val engine = coldTts ?: return
        val segment = coldTtsSegments.getOrNull(coldTtsIndex) ?: return
        persistColdTtsLocation(segment.cfi)
        if (ownsAudioFocus) requestFocus()
        player.play()
        mediaSession?.setPlaybackState(
            stateBuilder.setState(PlaybackStateCompat.STATE_PLAYING, 0L, 1f).build()
        )
        showNotification(PlaybackStateCompat.STATE_PLAYING)
        val result = engine.speak(
            segment.text,
            TextToSpeech.QUEUE_FLUSH,
            null,
            "$coldTtsGeneration:$coldTtsIndex",
        )
        if (result == TextToSpeech.ERROR) publishColdTtsError("Android text-to-speech rejected the text")
    }

    private fun isCurrentColdUtterance(utteranceId: String?): Boolean =
        utteranceId == "$coldTtsGeneration:$coldTtsIndex" && coldTtsActive

    private fun persistColdTtsLocation(cfi: String) {
        if (cfi == coldTtsSavedCfi) return
        coldTtsSavedCfi = cfi
        val path = coldTtsConfigPath ?: return
        try {
            val file = File(path)
            if (!file.isFile) return
            val json = JSONObject(file.readText())
            val viewSettings = json.optJSONObject("viewSettings") ?: JSONObject().also {
                json.put("viewSettings", it)
            }
            viewSettings.put("ttsLocation", cfi)
            file.writeText(json.toString())
        } catch (error: Exception) {
            Log.w("MediaPlaybackService", "Cold EPUB location persistence failed", error)
        }
    }

    private fun pauseColdTts() {
        if (!coldTtsActive) return
        coldTtsPaused = true
        coldTts?.stop()
        player.pause()
        mediaSession?.setPlaybackState(
            stateBuilder.setState(PlaybackStateCompat.STATE_PAUSED, 0L, 1f).build()
        )
        showNotification(PlaybackStateCompat.STATE_PAUSED)
    }

    private fun resumeColdTts() {
        if (!coldTtsActive) return
        coldTtsPaused = false
        maybeSpeakColdTts()
    }

    private fun skipColdTts(delta: Int) {
        if (!coldTtsActive || coldTtsSegments.isEmpty()) return
        coldTts?.stop()
        coldTtsIndex = (coldTtsIndex + delta).coerceIn(0, coldTtsSegments.lastIndex)
        coldTtsPaused = false
        speakCurrentColdTtsSegment()
    }

    private fun publishColdTtsError(message: String) {
        Log.e("MediaPlaybackService", message)
        coldTtsActive = false
        coldTtsPaused = false
        coldTtsReady = false
        coldTts?.stop()
        coldTts?.shutdown()
        coldTts = null
        player.pause()
        mediaSession?.setPlaybackState(
            stateBuilder.setErrorMessage(message)
                .setState(PlaybackStateCompat.STATE_ERROR, 0L, 1f)
                .build()
        )
        showNotification(PlaybackStateCompat.STATE_ERROR)
    }

    private fun clearColdTtsPlayback() {
        coldTtsGeneration += 1
        coldTtsActive = false
        coldTtsPaused = false
        coldTtsReady = false
        coldTtsIndex = 0
        coldTtsSegments = emptyList()
        coldTtsBookHash = null
        coldTtsConfigPath = null
        coldTtsSavedCfi = null
        coldTts?.stop()
        coldTts?.shutdown()
        coldTts = null
    }

    private fun handoffColdTtsToWebView(hash: String) {
        if (coldTtsBookHash != hash) return
        clearColdTtsPlayback()
        player.pause()
        mediaSession?.setPlaybackState(
            stateBuilder.setState(PlaybackStateCompat.STATE_BUFFERING, 0L, 1f).build()
        )
        showNotification(PlaybackStateCompat.STATE_BUFFERING)
    }

    private inner class SessionCallback : MediaSessionCompat.Callback() {
        override fun onPlay() {
            // The session stays command-ready for the whole life of the bound
            // service so the car can browse while nothing plays, which means a
            // transport command can arrive with no session behind it: a
            // headset or Bluetooth play button routed here by the framework.
            // Starting the silent keep-alive player then would hold the media
            // button away from whatever the user actually meant to resume, so
            // treat it as a request to resume the last book instead.
            coldTtsBookHash?.let {
                if (coldTtsActive) resumeColdTts() else activateColdEpubPlayback(it)
                return
            }
            if (coldTtsActive) {
                resumeColdTts()
                return
            }
            if (!sessionActive) {
                onPlayFromMediaId(lastBookHash?.let { "$BOOK_MEDIA_ID_PREFIX$it" }, null)
                return
            }
            player.play()
            pluginEventTrigger?.invoke("media-session-play", JSObject())
            updatePlaybackState()
        }

        override fun onPause() {
            if (!sessionActive) return
            // An explicit user pause must stick: cancel any pending
            // resume-after-interruption.
            resumeOnFocusGain = false
            if (coldTtsBookHash != null) {
                cancelPendingBookPlayback()
                if (coldTtsActive) {
                    pauseColdTts()
                } else {
                    player.pause()
                    mediaSession?.setPlaybackState(
                        stateBuilder.setState(PlaybackStateCompat.STATE_PAUSED, 0L, 1f).build()
                    )
                    showNotification(PlaybackStateCompat.STATE_PAUSED)
                }
                return
            }
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
            if (coldTtsActive) {
                skipColdTts(1)
                return
            }
            pluginEventTrigger?.invoke("media-session-next", JSObject())
        }

        override fun onSkipToPrevious() {
            if (coldTtsActive) {
                skipColdTts(-1)
                return
            }
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
            if (sessionActive && mediaId == CURRENT_READING_MEDIA_ID) {
                onPlay()
                return
            }
            val hash = when {
                mediaId?.startsWith(BOOK_MEDIA_ID_PREFIX) == true ->
                    mediaId.removePrefix(BOOK_MEDIA_ID_PREFIX).takeIf { it.isNotEmpty() }
                mediaId?.startsWith("$RESUME_MEDIA_ID:") == true ->
                    mediaId.removePrefix("$RESUME_MEDIA_ID:").takeIf { it.isNotEmpty() }
                else -> lastBookHash
            } ?: return

            // Show the pending book on the session only. The statics
            // (currentTitle/currentArtist/currentPositionMs) describe the
            // session that is actually playing; overwriting them here let any
            // bound client retitle and zero the scrubber of live audio, and
            // left no way back if the selection never landed.
            val selectedBook = libraryBooks.firstOrNull { it.hash == hash }
            if (selectedBook != null) {
                mediaSession?.setMetadata(buildLibraryBookMetadata(selectedBook))
                saveLastBook(this@MediaPlaybackService, hash, selectedBook.title, selectedBook.author)
            }
            // A playable-item request is asynchronous: the WebView still has
            // to open the book and initialize its saved reader/player state.
            // Report that work immediately so Android Auto keeps the selection
            // alive instead of timing out with "Could not load your selection."
            mediaSession?.setPlaybackState(
                stateBuilder.setState(PlaybackStateCompat.STATE_BUFFERING, 0L, 1f).build()
            )
            armSelectionWatchdog(hash)

            // Normal case: the app process is alive in the background. Let the
            // global bridge select the book and start the existing ebook TTS or
            // audiobook player without trying to display phone UI in the car.
            if (dispatchOrQueueBookPlayback(hash)) return

            // A cold Android Auto selection cannot wake Readest's Activity:
            // background services do not receive background-activity-launch
            // privileges merely by sending their own PendingIntent. EPUB Read
            // Aloud therefore starts inside this media service, as Android's
            // car playback contract requires.
            if (selectedBook != null && resolveColdEpubPaths(selectedBook) != null) {
                requestColdEpubPlayback(selectedBook)
                return
            }

            // Cold process fallback: the generic book deep link routes an
            // audiobook to the player after library hydration. Only ebooks
            // carry the autoplay flag consumed by the reader's TTS bridge.
            val deepLink = if (selectedBook?.isAudiobook == true) {
                "readest://book/$hash"
            } else {
                "readest://book/$hash?autoplay=tts"
            }
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(deepLink))
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

    // A selected book has to reach the WebView, wait for library hydration,
    // possibly download its file, and only then start playback. STATE_BUFFERING
    // covers that, but nothing else ever clears it: a selection that silently
    // fails (row deleted since the browse tree was cached, no listener on the
    // current route, WebView gone) left the car spinning until Android Auto
    // gave up with the exact error this feature set out to remove. Hand back a
    // real failure instead.
    private val selectionHandler = Handler(Looper.getMainLooper())
    private var pendingSelection: String? = null
    private val selectionTimeout = Runnable {
        pendingSelection = null
        // A successful handoff cancels this watchdog in activateSession(), so
        // reaching here always means the selection failed. sessionActive can
        // still be true when a DIFFERENT book was already playing: returning
        // early then left that live session stuck in STATE_BUFFERING, so
        // republish its real state instead of reporting an error over it.
        if (sessionActive) {
            updatePlaybackState()
            return@Runnable
        }
        mediaSession?.setPlaybackState(
            stateBuilder
                .setState(PlaybackStateCompat.STATE_ERROR, 0L, 1f)
                .setErrorMessage(
                    PlaybackStateCompat.ERROR_CODE_APP_ERROR,
                    getString(R.string.readest_auto_selection_failed),
                )
                .build()
        )
        // stateBuilder is reused for every later state write, so the error must
        // not stick to it.
        stateBuilder.setErrorMessage(PlaybackStateCompat.ERROR_CODE_UNKNOWN_ERROR, "")
        applyMetadata()
    }

    private fun armSelectionWatchdog(hash: String) {
        pendingSelection = hash
        selectionHandler.removeCallbacks(selectionTimeout)
        selectionHandler.postDelayed(selectionTimeout, SELECTION_TIMEOUT_MS)
    }

    private fun cancelSelectionWatchdog() {
        pendingSelection = null
        selectionHandler.removeCallbacks(selectionTimeout)
    }

    private fun resetArtworkForBook(bookHash: String?) {
        artworkUriSource = null
        artworkUriFile?.delete()
        artworkUriFile = null
        currentArtwork = null
        currentArtworkUri = bookHash
            ?.let { hash -> libraryBooks.firstOrNull { it.hash == hash } }
            ?.let(::libraryArtworkUri)
        appliedDurationMs = -1L
        applyMetadata()
    }

    // Packages that have opened the browse tree (Android Auto's projection, the
    // media system components). The cover URI is cross-UID, so each must be
    // granted read access or its art loader hits a SecurityException and the
    // cover shows blank.
    private val browserClients =
        java.util.Collections.synchronizedSet(mutableSetOf<String>())

    private fun grantArtworkTo(pkg: String, artworkUri: Uri? = currentArtworkUri) {
        val uri = artworkUri ?: return
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

    private fun libraryArtworkUri(book: AndroidAutoBook): Uri? {
        if (!book.artworkReady || !MD5_PATTERN.matches(book.hash)) return null
        val cacheKey = book.coverHash ?: "legacy"
        val file = File(cacheDir, "$COVER_THUMBNAIL_CACHE_DIR/${book.hash}-$cacheKey.jpg")
        if (!file.isFile) return null
        return try {
            FileProvider.getUriForFile(this, "$packageName.fileprovider", file).also { uri ->
                for (pkg in ARTWORK_URI_CLIENTS) grantArtworkTo(pkg, uri)
                for (pkg in browserClients.toList()) grantArtworkTo(pkg, uri)
            }
        } catch (e: Exception) {
            Log.w("MediaPlaybackService", "Failed to publish library artwork for ${book.hash}", e)
            null
        }
    }

    private fun buildLibraryBookMetadata(book: AndroidAutoBook): MediaMetadataCompat {
        val builder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, book.title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, book.author)
        libraryArtworkUri(book)?.let { uri ->
            builder.putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, uri.toString())
            builder.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI, uri.toString())
        }
        return builder.build()
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

    // Verdict per (package, uid). onGetRoot runs on a binder thread and every
    // PackageManager lookup below is an IPC, so it is resolved once per caller.
    private val callerVerdicts = java.util.concurrent.ConcurrentHashMap<String, BrowseAccess>()

    private fun readCallerIdentity(pkg: String, uid: Int): CallerIdentity {
        val certificates = try {
            val signatures: Array<Signature>? =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    val info =
                        packageManager.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES)
                    // Always the CURRENT signer(s). signingCertificateHistory is
                    // the rotation lineage, not the present identity: reading it
                    // reported two certificates for Android Auto (a rotated key
                    // plus today's), and since a caller must match every
                    // certificate it presents, pinning would then have had to
                    // include a retired key and would break on the next
                    // rotation. apkContentsSigners matches what apksigner
                    // reports for the installed APK.
                    info.signingInfo?.apkContentsSigners
                } else {
                    @Suppress("DEPRECATION")
                    packageManager.getPackageInfo(pkg, PackageManager.GET_SIGNATURES).signatures
                }
            signatures.orEmpty().map { signature ->
                MessageDigest.getInstance("SHA-256")
                    .digest(signature.toByteArray())
                    .joinToString("") { byte -> "%02x".format(byte) }
            }.toSet()
        } catch (e: Exception) {
            Log.w("MediaPlaybackService", "Failed to read signatures for $pkg", e)
            emptySet()
        }
        val platformSigned = try {
            packageManager.checkSignatures(uid, Process.SYSTEM_UID) == PackageManager.SIGNATURE_MATCH
        } catch (e: Exception) {
            false
        }
        val holdsMediaContentControl = try {
            packageManager.checkPermission(
                android.Manifest.permission.MEDIA_CONTENT_CONTROL,
                pkg,
            ) == PackageManager.PERMISSION_GRANTED
        } catch (e: Exception) {
            false
        }
        return CallerIdentity(
            packageName = pkg,
            uid = uid,
            signatureSha256 = certificates,
            platformSigned = platformSigned,
            holdsMediaContentControl = holdsMediaContentControl,
        )
    }

    // Verdict for whoever is driving the in-flight browse callback. Resolved
    // from the same cache onGetRoot fills, so it costs nothing on the hot path.
    private fun isCurrentBrowserAllowed(): Boolean {
        val browser = currentBrowserInfo ?: return false
        return resolveCallerVerdict(browser.packageName, browser.uid).allowed
    }

    private fun resolveCallerVerdict(pkg: String, uid: Int): BrowseAccess =
        callerVerdicts.getOrPut("$uid:$pkg") {
            val identity = readCallerIdentity(pkg, uid)
            val decision = MediaBrowserCallerValidator.evaluate(identity, Process.myUid())
            // Shadow-mode record. This is the only way to learn which packages
            // and certificates real head units present before the allowlist is
            // enforced; grep logcat for "browse caller".
            Log.i(
                "MediaPlaybackService",
                "browse caller pkg=$pkg uid=$uid verdict=$decision " +
                    "expected=${pkg in MediaBrowserCallerValidator.EXPECTED_MEDIA_CLIENTS} " +
                    "certs=${identity.signatureSha256.joinToString(",")}",
            )
            decision
        }

    override fun onGetRoot(clientPackageName: String, clientUid: Int, rootHints: Bundle?): BrowserRoot? {
        val verdict = resolveCallerVerdict(clientPackageName, clientUid)

        if (ENFORCE_BROWSE_VALIDATION && !verdict.allowed) {
            // Refuse the connection outright. An empty root still completes it,
            // and a completed connection hands the caller the media-session
            // token — from which it can drive onPlay/onPlayFromMediaId, since
            // the session callbacks authorize nothing. Google's Android for
            // Cars guidance is explicit: return null for an untrusted package.
            return null
        }

        // Grant the cover URI to the connecting browser client (Android Auto,
        // the media system UI) so its art loader can read it across UIDs.
        browserClients.add(clientPackageName)
        grantArtworkTo(clientPackageName)
        return BrowserRoot(MEDIA_ROOT_ID, null)
    }

    override fun onLoadChildren(parentId: String, result: Result<MutableList<MediaBrowserCompat.MediaItem>>) {
        val items = mutableListOf<MediaBrowserCompat.MediaItem>()
        // A browser client picks the parentId it subscribes to, so it can ask
        // for LIBRARY_ROOT_ID directly no matter which root onGetRoot handed
        // back. Authorize here too, or the root check is only advisory.
        if (ENFORCE_BROWSE_VALIDATION && !isCurrentBrowserAllowed()) {
            result.sendResult(items)
            return
        }
        if (parentId == MEDIA_ROOT_ID && sessionActive) {
            refreshArtworkUri()
            val description = MediaDescriptionCompat.Builder()
                .setMediaId(CURRENT_READING_MEDIA_ID)
                .setTitle(currentTitle)
                .setSubtitle(currentArtist)
                .setIconUri(currentArtworkUri)
                .build()
            items.add(MediaBrowserCompat.MediaItem(description, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE))
        }
        if (parentId == MEDIA_ROOT_ID && libraryBooks.isNotEmpty()) {
            val description = MediaDescriptionCompat.Builder()
                .setMediaId(LIBRARY_ROOT_ID)
                .setTitle(getString(R.string.readest_auto_library_root))
                .setSubtitle(
                    resources.getQuantityString(
                        R.plurals.readest_auto_library_count,
                        libraryBooks.size,
                        libraryBooks.size,
                    )
                )
                .build()
            items.add(
                MediaBrowserCompat.MediaItem(
                    description,
                    MediaBrowserCompat.MediaItem.FLAG_BROWSABLE,
                )
            )
        }
        if (parentId == LIBRARY_ROOT_ID) {
            for (book in libraryBooks) {
                val description = MediaDescriptionCompat.Builder()
                    .setMediaId("$BOOK_MEDIA_ID_PREFIX${book.hash}")
                    .setTitle(book.title)
                    .setSubtitle(book.author)
                    .setIconUri(libraryArtworkUri(book))
                    .build()
                items.add(
                    MediaBrowserCompat.MediaItem(
                        description,
                        MediaBrowserCompat.MediaItem.FLAG_PLAYABLE,
                    )
                )
            }
        }
        result.sendResult(items)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START_COLD_EPUB -> {
                val hash = intent.getStringExtra(EXTRA_BOOK_HASH)
                if (hash != null) {
                    activateColdEpubPlayback(hash)
                } else {
                    showNotification(PlaybackStateCompat.STATE_ERROR)
                    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
                    stopSelf(startId)
                }
            }
            ACTION_ACTIVATE_SESSION -> {
                if (MediaSessionActivationState.isActivationDesired()) {
                    activateSession()
                } else {
                    // A stop can overtake the asynchronous service start.
                    // Satisfy the foreground contract without reviving it.
                    showNotification(PlaybackStateCompat.STATE_PAUSED)
                    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
                    stopSelf(startId)
                }
            }
            Intent.ACTION_MEDIA_BUTTON -> {
                if (!sessionActive) {
                    // MediaButtonReceiver cold-starts this service specifically
                    // so the last media session can process Play and resume
                    // without an Activity. Satisfy the foreground contract
                    // before dispatching; onPlay() will select the persisted
                    // last book and start service-owned EPUB speech.
                    showNotification(PlaybackStateCompat.STATE_PAUSED)
                }
                MediaButtonReceiver.handleIntent(mediaSession, intent)
                mainHandler.postDelayed({
                    // Pause/stop delivered to a cold session has no playback
                    // work to keep alive. A Play command will synchronously
                    // enqueue ACTION_START_COLD_EPUB (or wake the Activity),
                    // so give that command time to activate before cleaning
                    // up the receiver-started foreground service.
                    if (!sessionActive && !coldTtsActive) {
                        ServiceCompat.stopForeground(
                            this,
                            ServiceCompat.STOP_FOREGROUND_REMOVE,
                        )
                        stopSelfResult(startId)
                    }
                }, 1_000L)
            }
        }

        return super.onStartCommand(intent, flags, startId)
    }

    override fun onDestroy() {
        instance = null
        cancelSelectionWatchdog()
        clearColdTtsPlayback()
        coldTextExecutor.shutdownNow()
        if (noisyReceiverRegistered) {
            noisyReceiverRegistered = false
            unregisterReceiver(becomingNoisyReceiver)
        }
        abandonFocus()
        player.release()
        mediaSession?.release()
        super.onDestroy()
    }
}
