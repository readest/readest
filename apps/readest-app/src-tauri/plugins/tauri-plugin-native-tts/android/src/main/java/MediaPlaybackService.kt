package com.readest.native_tts

import com.readest.native_tts.R
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.graphics.Bitmap
import android.media.AudioManager
import android.media.AudioManager.OnAudioFocusChangeListener
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
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import app.tauri.plugin.JSObject

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

    private val afChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
        Log.i("MediaPlaybackService", "Audio focus changed: $focusChange, $player.isPlaying")
        when (focusChange) {
            AudioManager.AUDIOFOCUS_GAIN -> {
                player.volume = 1.0f
                if (!player.isPlaying) player.play()
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                player.volume = 0.3f
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                if (player.isPlaying) player.pause()
            }
        }
    }

    companion object {
        private const val CHANNEL_ID = "media2_playback_channel"
        private const val NOTIFICATION_ID = 1002
        private const val MEDIA_ROOT_ID = "media_root_id"
        private const val CURRENT_READING_MEDIA_ID = "readest_current_reading"
        const val ACTION_ACTIVATE_SESSION = "ACTIVATE_SESSION"

        var pluginEventTrigger: ((String, JSObject) -> Unit)? = null

        var currentTitle: String = "Read Aloud"
        var currentArtist: String = "Reading your content"
        var currentArtwork: Bitmap? = null

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

        fun pushPlaybackState(playing: Boolean, position: Long) {
            val service = instance ?: return
            Handler(Looper.getMainLooper()).post { service.applyPlaybackState(playing, position) }
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this

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
        if (!sessionActive) {
            sessionActive = true

            val result = audioManager.requestAudioFocus(
                afChangeListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            )
            if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                Log.d("MediaPlaybackService", "Audio focus granted")
            } else {
                Log.w("MediaPlaybackService", "Failed to gain audio focus")
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
        audioManager.abandonAudioFocus(afChangeListener)

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
            player.pause()
            pluginEventTrigger?.invoke("media-session-pause", JSObject())
            updatePlaybackState()
        }

        override fun onSkipToNext() {
            player.seekTo(0)
            pluginEventTrigger?.invoke("media-session-next", JSObject())
        }

        override fun onSkipToPrevious() {
            player.seekTo(0)
            pluginEventTrigger?.invoke("media-session-previous", JSObject())
        }

        override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) {
            onPlay()
        }

        override fun onPlayFromSearch(query: String?, extras: Bundle?) {
            onPlay()
        }
    }

    private fun updatePlaybackState() {
        if (!sessionActive) return
        val state = if (player.isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        mediaSession?.setPlaybackState(
            stateBuilder.setState(state, player.currentPosition, 1f).build()
        )
        showNotification(state)
    }

    // Push the current statics into the live session + notification. Invoked
    // in-process from Companion.pushMetadata on the main thread.
    private fun applyMetadata() {
        val metadataBuilder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
            .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, currentArtwork)
        mediaSession?.setMetadata(metadataBuilder.build())
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
    // in-process from Companion.pushPlaybackState on the main thread.
    private fun applyPlaybackState(playing: Boolean, position: Long) {
        if (!sessionActive) return
        if (playing && !player.isPlaying) {
            player.play()
        } else if (!playing && player.isPlaying) {
            player.pause()
        }
        player.seekTo(position)
        val state = if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        mediaSession?.setPlaybackState(
            stateBuilder.setState(state, position, 1f).build()
        )
        showNotification(state)
    }

    private fun showNotification(playbackState: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Media Controls", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        startForeground(NOTIFICATION_ID, buildNotification(playbackState))
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
        player.release()
        mediaSession?.release()
    }
}
