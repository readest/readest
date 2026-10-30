package com.readest.native_bridge

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.abs
import kotlin.math.max

class PageFlipModelTest {
    private val out = FloatArray(PageFlipModel.FRAME_SIZE)
    private val tick = 1 / 120.0

    /** Projected x of every profile point. */
    private fun xs(model: PageFlipModel, backward: Boolean): FloatArray {
        model.frame(out, backward)
        return FloatArray(PageFlipModel.POINTS) { out[it * 4] }
    }

    private fun maxJump(a: FloatArray, b: FloatArray) = a.indices.maxOf { abs(a[it] - b[it]) }

    @Test fun aRestingSheetLiesOnItsOwnSideOfTheSpine() {
        val model = PageFlipModel()
        assertTrue(model.frame(out, false))
        for (i in 0 until PageFlipModel.POINTS) assertEquals(i / 64f, out[i * 4], 1e-4f)
        // Mirrored, the previous page waits off the page.
        assertFalse(model.frame(out, true))
    }

    @Test fun aTappedTurnLeavesThePageBeforeItsLandingEnds() {
        val model = PageFlipModel()
        model.release(true, 0.0)
        var frames = 0
        var leftAt = -1
        while (model.advance(tick)) {
            frames++
            if (leftAt < 0 && !model.frame(out, false)) leftAt = frames
            assertTrue("a tap must settle", frames < 600)
        }
        assertTrue("the sheet left the page", leftAt > 0)
        // The rest lands over the spine, off the page: the controller stops there.
        assertTrue("left at frame $leftAt of $frames", leftAt < frames * 0.8)
        assertFalse(model.frame(out, false))
    }

    @Test fun aBackwardDragShowsThePreviousSheetFromItsFirstMove() {
        val model = PageFlipModel()
        model.beginDrag(1.0, 0.5, 0.0)
        assertFalse(model.frame(out, true))
        val edge = PageFlipModel.MIN_PRESSED_EDGE_X
        model.moveDrag(edge - (1 + edge) * 0.05, 0.5, 0.016)
        assertTrue(model.frame(out, true))
    }

    @Test fun aBackwardTurnLandsFlatOverThePage() {
        val model = PageFlipModel()
        model.release(true, 0.0)
        var frames = 0
        while (model.advance(tick)) assertTrue(++frames < 600)
        val landed = xs(model, true)
        for (i in landed.indices) assertEquals(i / 64f, landed[i], 0.01f)
    }

    @Test fun cancellingADragPastTheFoldUnwindsWithoutAJump() {
        for (backward in listOf(false, true)) {
            val model = PageFlipModel()
            val edge = PageFlipModel.MIN_PRESSED_EDGE_X
            val start = if (backward) 1.0 else 0.9
            model.beginDrag(start, 0.5, 0.0)
            val held = if (backward) edge - (1 + edge) * 0.4 else start - 0.95
            model.moveDrag(held, 0.5, 0.2)
            var previous = xs(model, backward)
            model.release(false, 0.2)
            var frames = 0
            var largest = 0f
            while (model.advance(tick)) {
                val next = xs(model, backward)
                largest = max(largest, maxJump(previous, next))
                previous = next
                assertTrue(++frames < 600)
            }
            assertTrue("backward=$backward jumped $largest of a page in one frame", largest < 0.12f)
            // Cancelled, the sheet rests flat on its own side again.
            val rest = xs(model, false)
            for (i in rest.indices) assertEquals(i / 64f, rest[i], 1e-3f)
        }
    }
}
