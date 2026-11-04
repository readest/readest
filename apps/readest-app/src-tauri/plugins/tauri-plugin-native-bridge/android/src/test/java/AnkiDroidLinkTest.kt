package com.readest.native_bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/** Host-JVM tests for the pure parts of [AnkiDroidLink] (#789). */
class AnkiDroidLinkTest {
    @Test
    fun fields_roundTripThroughTheSeparator() {
        val fields = listOf("a", "", "b<br>c")
        assertEquals(fields, AnkiDroidLink.splitFields(AnkiDroidLink.joinFields(fields)))
    }

    @Test
    fun fields_joinWithUnitSeparator() {
        assertEquals("front\u001fback", AnkiDroidLink.joinFields(listOf("front", "back")))
    }

    @Test
    fun deckSearch_matchesEveryGivenDeckById() {
        assertEquals("did:1700000000000,42", AnkiDroidLink.deckSearch(listOf(1700000000000L, 42L)))
    }

    @Test
    fun matureCardSearch_asksOnlyForLongIntervals() {
        assertEquals("did:1,2 prop:ivl>=21", AnkiDroidLink.matureCardSearch(listOf(1L, 2L)))
    }

    @Test
    fun insertInChunks_staysUnderTheBinderLimit() {
        val sizes = mutableListOf<Int>()
        val added = AnkiDroidLink.insertInChunks((1..450).toList(), 200) { sizes.add(it.size); it.size }
        assertEquals(listOf(200, 200, 50), sizes)
        assertEquals(450, added)
    }

    @Test
    fun insertInChunks_failsLoudlyWhenAnkiDroidAddsFewer() {
        assertThrows(java.io.IOException::class.java) {
            AnkiDroidLink.insertInChunks((1..10).toList(), 200) { 0 }
        }
    }
}
