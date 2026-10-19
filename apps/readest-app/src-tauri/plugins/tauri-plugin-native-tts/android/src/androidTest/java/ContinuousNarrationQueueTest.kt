package com.readest.native_tts

import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ContinuousNarrationQueueTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private lateinit var queue: ContinuousNarrationQueue
    private lateinit var first: File
    private lateinit var second: File

    @Before fun setup() {
        val context = instrumentation.targetContext
        first = File.createTempFile("narration-first", ".wav", context.cacheDir)
        second = File.createTempFile("narration-second", ".wav", context.cacheDir)
        first.writeBytes(wave()); second.writeBytes(wave())
        instrumentation.runOnMainSync {
            queue = ContinuousNarrationQueue(context)
            queue.player.volume = 0f
        }
    }
    @After fun cleanup() {
        instrumentation.runOnMainSync { queue.stop(); queue.player.release() }
        first.delete(); second.delete()
    }

    @Test fun queuedBoundaryAdvancesWithoutAWebViewAndPreservesPauseAndRate() {
        val transitioned = CountDownLatch(1)
        var position = -1.0
        val transitionReason = AtomicInteger(-1)
        instrumentation.runOnMainSync {
            queue.player.addListener(object : Player.Listener {
                override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
                    if (item?.localConfiguration?.uri?.lastPathSegment == second.name)
                        transitionReason.set(reason)
                }
            })
            queue.onTransition = { path, time ->
                assertEquals(second.absolutePath, path)
                position = time
                transitioned.countDown()
            }
            queue.load(first.absolutePath, 0)
            queue.queue(second.absolutePath, 200, 700, 400)
            queue.player.setPlaybackSpeed(1.5f)
        }
        assertFalse("Paused audio advanced", transitioned.await(600, TimeUnit.MILLISECONDS))
        instrumentation.runOnMainSync { queue.player.play() }
        assertTrue("Native queue did not advance", transitioned.await(8, TimeUnit.SECONDS))
        assertTrue("Queued clip lost its original-file position: $position", position >= 200 && position < 600)
        instrumentation.runOnMainSync {
            assertEquals("An earlier clip must still cut before EOF", Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, transitionReason.get())
        }
        instrumentation.runOnMainSync {
            assertEquals(1.5f, queue.player.playbackParameters.speed, 0.001f)
            queue.player.pause()
            queue.seek(50)
            assertEquals(50L, queue.positionMs)
        }
    }

    @Test fun aRoundedFileEndUsesTheNaturalPlaylistTransition() {
        assertNaturalEndTransition(1)
    }

    @Test fun anExactFileEndUsesTheNaturalPlaylistTransition() {
        assertNaturalEndTransition(0)
    }

    @Test fun aFileEndRoundedDownUsesTheNaturalPlaylistTransition() {
        assertNaturalEndTransition(-1)
    }

    private fun assertNaturalEndTransition(roundingMs: Long) {
        val ready = CountDownLatch(1)
        val transitioned = CountDownLatch(1)
        val transitionReason = AtomicInteger(-1)
        instrumentation.runOnMainSync {
            queue.player.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    if (state == Player.STATE_READY) ready.countDown()
                }
                override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
                    if (item?.localConfiguration?.uri?.lastPathSegment == second.name) {
                        transitionReason.set(reason)
                        transitioned.countDown()
                    }
                }
            })
            queue.load(first.absolutePath, 0)
        }
        assertTrue("First recording did not prepare", ready.await(8, TimeUnit.SECONDS))
        instrumentation.runOnMainSync {
            // SMIL and container duration can round in either direction by 1 ms.
            queue.queue(second.absolutePath, 0, 1000, queue.player.duration + roundingMs)
            queue.player.play()
        }
        assertTrue("Native queue did not advance", transitioned.await(8, TimeUnit.SECONDS))
        assertEquals("An EOF seek flushes already-buffered audio", Player.MEDIA_ITEM_TRANSITION_REASON_AUTO, transitionReason.get())
    }

    @Test fun cancellingOrSeekingCannotPlayTheOldQueuedMember() {
        val transitions = AtomicInteger()
        instrumentation.runOnMainSync {
            queue.onTransition = { _, _ -> transitions.incrementAndGet() }
            queue.load(first.absolutePath, 0)
            queue.queue(second.absolutePath, 200, 700, 400)
            queue.seek(100)
            queue.player.play()
        }
        Thread.sleep(1600)
        assertEquals("Seek kept a stale queued file", 0, transitions.get())
        instrumentation.runOnMainSync { assertEquals(first.absolutePath, queue.path) }
    }

    private fun wave(): ByteArray {
        val buffer = ByteBuffer.allocate(32044).order(ByteOrder.LITTLE_ENDIAN)
        buffer.put("RIFF".toByteArray()).putInt(32036).put("WAVEfmt ".toByteArray()).putInt(16)
        buffer.putShort(1).putShort(1).putInt(16000).putInt(32000).putShort(2).putShort(16)
        buffer.put("data".toByteArray()).putInt(32000)
        for (i in 0 until 16000) buffer.putShort((1000 * kotlin.math.sin(i * 440 * Math.PI / 8000)).toInt().toShort())
        return buffer.array()
    }
}
