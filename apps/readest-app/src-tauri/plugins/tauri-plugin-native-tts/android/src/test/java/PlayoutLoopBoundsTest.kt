package com.readest.native_tts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayoutLoopBoundsTest {
    @Test
    fun spanInsideTheFileKeepsItsEnd() {
        assertEquals(6000L, PlayoutLoopBounds.effectiveEnd(2000L, 6000L, 10000L))
    }

    @Test
    fun spanEndingWithTheFileJumpsJustBeforeTheFileEnds() {
        assertEquals(9960L, PlayoutLoopBounds.effectiveEnd(4000L, 10000L, 10000L))
    }

    @Test
    fun shortFinalSpanIsNotPulledBeforeItsStart() {
        // Pulling B's end in by the slack would land at 9960, before A: every
        // check would jump back to A before any of the span played.
        val end = PlayoutLoopBounds.effectiveEnd(9980L, 10000L, 10000L)
        assertTrue(end > 9980L)
        assertEquals(10000L, end)
    }

    @Test
    fun unknownDurationKeepsTheEnd() {
        assertEquals(9000L, PlayoutLoopBounds.effectiveEnd(0L, 9000L, -1L))
    }
}
