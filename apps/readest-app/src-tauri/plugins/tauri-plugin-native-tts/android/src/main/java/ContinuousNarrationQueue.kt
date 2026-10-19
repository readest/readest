package com.readest.native_tts

import android.content.Context
import android.net.Uri
import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.PlayerMessage
import java.io.File

// The same bounded current + next segment contract as the browser and Apple
// clocks. ExoPlayer owns advancement; no WebView round trip or page turn is
// involved when the next segment becomes audible.
internal class ContinuousNarrationQueue(context: Context) {
    val player = ExoPlayer.Builder(context).build()
    var onTransition: ((String, Double) -> Unit)? = null
    var path: String? = null
        private set
    private var offsetMs = 0L
    private var next: Segment? = null
    private var boundary: PlayerMessage? = null
    private data class Segment(val path: String, val start: Long)

    init {
        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                val pending = next ?: return
                if (mediaItem?.localConfiguration?.tag !== pending) return
                next = null
                boundary?.cancel()
                boundary = null
                path = pending.path
                offsetMs = pending.start
                // Drop the consumed member, retaining at most one future item.
                if (player.currentMediaItemIndex > 0) player.removeMediaItems(0, player.currentMediaItemIndex)
                onTransition?.invoke(pending.path, positionMs.toDouble())
            }
        })
    }

    val positionMs: Long get() = player.currentPosition + offsetMs

    fun load(path: String, startMs: Long) {
        cancelNext()
        if (this.path == path && player.currentMediaItem != null && startMs >= offsetMs) {
            player.seekTo((startMs - offsetMs).coerceAtLeast(0))
        } else {
            offsetMs = 0
            this.path = path
            player.setMediaItem(MediaItem.fromUri(uri(path)), startMs)
            player.prepare()
        }
    }

    fun queue(path: String, startMs: Long, endMs: Long, afterMs: Long) {
        if (next != null || player.currentMediaItem == null || afterMs <= positionMs) return
        require(startMs >= 0 && endMs > startMs) { "Invalid narration clip" }
        val pending = Segment(path, startMs)
        val item = MediaItem.Builder().setUri(uri(path)).setTag(pending)
            .setClippingConfiguration(MediaItem.ClippingConfiguration.Builder()
                .setStartPositionMs(startMs).build()).build()
        val outgoing = player.currentMediaItem
        next = pending
        player.addMediaItem(item)
        // Physical file ends advance seamlessly through ExoPlayer's playlist.
        // A SMIL clip can end earlier; schedule that cut on the native clock too.
        val cutAtMs = afterMs - offsetMs
        boundary = player.createMessage { _, _ ->
            // SMIL and container durations can round independently by 1 ms.
            // A seek at that rounded EOF flushes already-buffered audio, so
            // leave the natural playlist transition in charge within 1 ms.
            // Read duration here too: it can still be unknown when queued.
            val durationMs = player.duration
            if (player.currentMediaItem === outgoing && next === pending &&
                (durationMs == C.TIME_UNSET || cutAtMs < durationMs - 1)) {
                player.seekToNextMediaItem()
            }
        }.setLooper(Looper.getMainLooper())
            .setPosition(player.currentMediaItemIndex, cutAtMs).send()
    }

    fun cancelNext() {
        boundary?.cancel()
        boundary = null
        next = null
        if (player.mediaItemCount > player.currentMediaItemIndex + 1) {
            player.removeMediaItems(player.currentMediaItemIndex + 1, player.mediaItemCount)
        }
    }

    fun seek(positionMs: Long) {
        if (positionMs < offsetMs) { path?.let { load(it, positionMs) }; return }
        cancelNext()
        player.seekTo((positionMs - offsetMs).coerceAtLeast(0))
    }

    fun stop() {
        cancelNext()
        player.stop()
        player.clearMediaItems()
        path = null
        offsetMs = 0
    }

    private fun uri(path: String): Uri {
        if (path.startsWith("http://") || path.startsWith("https://")) return Uri.parse(path)
        val file = File(path)
        require(file.isFile) { "Narration file not found: $path" }
        return Uri.fromFile(file)
    }
}
