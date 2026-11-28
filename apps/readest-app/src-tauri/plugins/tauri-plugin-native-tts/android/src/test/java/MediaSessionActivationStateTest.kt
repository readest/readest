package com.readest.native_tts

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class MediaSessionActivationStateTest {
    @Before
    fun resetState() {
        MediaSessionActivationState.resetForTest()
    }

    @Test
    fun staleSessionCannotDeactivateOrOverwriteReplacement() {
        MediaSessionActivationState.requestActivation("old-session")
        MediaSessionActivationState.requestActivation("new-session")

        assertFalse(MediaSessionActivationState.requestDeactivation("old-session"))
        assertTrue(MediaSessionActivationState.isActivationDesired())
        assertFalse(MediaSessionActivationState.acceptsUpdate("old-session"))
        assertTrue(MediaSessionActivationState.acceptsUpdate("new-session"))

        assertTrue(MediaSessionActivationState.requestDeactivation("new-session"))
        assertFalse(MediaSessionActivationState.isActivationDesired())
    }

    /**
     * The 30-minute idle-shutdown timer and destroy() deactivate with no
     * session id. That must not disown the session still on screen: gating
     * acceptsUpdate() on the active flag meant a book paused past the idle
     * timeout had every later position/metadata write dropped, freezing the
     * lock-screen and car scrubber for good.
     */
    @Test
    fun idleDeactivationStillAcceptsUpdatesFromTheLiveSession() {
        MediaSessionActivationState.requestActivation("live-session")

        assertTrue(MediaSessionActivationState.requestDeactivation())
        assertFalse(MediaSessionActivationState.isActivationDesired())
        assertTrue(MediaSessionActivationState.acceptsUpdate("live-session"))
        assertTrue(MediaSessionActivationState.acceptsUpdate(null))
    }

    @Test
    fun remembersHighlightCapabilityWithoutAServiceAndResetsForTheNextSession() {
        MediaSessionActivationState.requestActivation("old-session")
        MediaSessionActivationState.updateHighlightCapability("old-session", true)
        assertTrue(MediaSessionActivationState.canHighlightCurrentPassage())

        MediaSessionActivationState.requestActivation("new-session")
        MediaSessionActivationState.updateHighlightCapability("old-session", true)
        assertFalse(MediaSessionActivationState.canHighlightCurrentPassage())

        MediaSessionActivationState.updateHighlightCapability("new-session", true)
        assertTrue(MediaSessionActivationState.canHighlightCurrentPassage())
        MediaSessionActivationState.requestDeactivation("new-session")
        MediaSessionActivationState.updateHighlightCapability("new-session", true)
        assertFalse(MediaSessionActivationState.canHighlightCurrentPassage())
    }

    @Test
    fun replacedSessionStaysRejectedAfterDeactivation() {
        MediaSessionActivationState.requestActivation("old-session")
        MediaSessionActivationState.requestActivation("new-session")
        MediaSessionActivationState.requestDeactivation()

        assertFalse(MediaSessionActivationState.acceptsUpdate("old-session"))
        assertTrue(MediaSessionActivationState.acceptsUpdate("new-session"))
    }
}
