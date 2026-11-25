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
    fun joinTags_separatesWithSpaces() {
        assertEquals("readest readest::learning", AnkiDroidLink.joinTags(listOf("readest", "readest::learning")))
    }

    @Test
    fun deckSearch_matchesEveryGivenDeckById() {
        assertEquals("did:1700000000000,42", AnkiDroidLink.deckSearch(listOf(1700000000000L, 42L)))
    }

    @Test
    fun matureCardSearch_groupsTheDecksSoTheIntervalStillApplies() {
        // Ungrouped, `did:1,2 prop:ivl>=21` returned every card of the decks on AnkiDroid 2.25.3.
        assertEquals("(did:1,2) prop:ivl>=21", AnkiDroidLink.matureCardSearch(listOf(1L, 2L)))
    }

    @Test
    fun rows_failsWhenAnkiDroidGivesNoCursor() {
        // A null cursor means the provider is gone; reading it as "no rows" made
        // Sync treat the deck as missing and send every word again.
        val none: android.database.Cursor? = null
        assertThrows(java.io.IOException::class.java) {
            with(AnkiDroidLink) { none.rows { it.getLong(0) } }
        }
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

    @Test
    fun arrangeFields_keepsANoteTypeWithoutTheNewFieldsWorking() {
        // A note type from before the upgrade still takes Front and Back.
        val values = listOf("front", "back", "word", "en_US", "")
        assertEquals(listOf("front", "back"), AnkiDroidLink.arrangeFields(values, listOf("Front", "Back")))
    }

    @Test
    fun arrangeFields_placesTheNewFieldsByName() {
        val values = listOf("front", "back", "word", "en_US", "entry")
        val names = listOf("Front", "Back", "Extra", "Word", "Language", "Entry")
        assertEquals(
            listOf("front", "back", "", "word", "en_US", "entry"),
            AnkiDroidLink.arrangeFields(values, names),
        )
    }

    @Test
    fun fillFields_setsOnlyEmptyWordAndLanguage() {
        val names = listOf("Front", "Back", "Word", "Language", "Entry")
        assertEquals(
            listOf("f", "b", "haus", "de_DE", ""),
            AnkiDroidLink.fillFields(listOf("f", "b"), names, "haus", "de_DE"),
        )
        // A Word the reader edited in Anki stays.
        assertEquals(
            listOf("f", "b", "mine", "de_DE", "x"),
            AnkiDroidLink.fillFields(listOf("f", "b", "mine", "", "x"), names, "haus", "de_DE"),
        )
    }

    @Test
    fun templates_keepRenamedFrontAndBack() {
        // A reader who renamed Front and Back keeps a card that renders them.
        val (question, answer) = AnkiDroidLink.templates(listOf("Wort", "Hinweis", "Word", "Language", "Entry"))
        assertEquals("{{Wort}}", question)
        assertEquals(
            "{{FrontSide}}<hr id=answer>{{Hinweis}}" +
                "{{#Language}}{{#Word}}<br>[anki:tts lang={{Language}}]{{Word}}[/anki:tts]{{/Word}}{{/Language}}" +
                "{{#Entry}}<hr><div style=\"text-align:start;font-size:0.85em\">{{Entry}}</div>{{/Entry}}",
            answer,
        )
    }

    @Test
    fun outdated_untilTheFieldsAndTheAudioTemplateAreBothThere() {
        val all = AnkiDroidLink.NOTE_FIELDS
        val (_, audio) = AnkiDroidLink.templates(all)
        assertEquals(true, AnkiDroidLink.outdated(listOf("Front", "Back"), "{{FrontSide}}<hr id=answer>{{Back}}"))
        // Fields added but the upgrade stopped before the template: still to finish.
        assertEquals(true, AnkiDroidLink.outdated(all, "{{FrontSide}}<hr id=answer>{{Back}}"))
        assertEquals(false, AnkiDroidLink.outdated(all, audio))
        // The template #7736 wrote has the audio but not the dictionary entry (#7728).
        val audioOnly = "{{FrontSide}}<hr id=answer>{{Back}}" +
            "{{#Language}}{{#Word}}<br>[anki:tts lang={{Language}}]{{Word}}[/anki:tts]{{/Word}}{{/Language}}"
        assertEquals(true, AnkiDroidLink.outdated(all, audioOnly))
        // Renamed Front and Back are not missing fields.
        assertEquals(false, AnkiDroidLink.outdated(listOf("Wort", "Hinweis", "Word", "Language", "Entry"), audio))
    }

    @Test
    fun missingFields_leaveRenamedFrontAndBackAlone() {
        assertEquals(
            listOf("Word", "Language", "Entry"),
            AnkiDroidLink.missingFields(listOf("Wort", "Hinweis")),
        )
        assertEquals(listOf("Entry"), AnkiDroidLink.missingFields(listOf("Front", "Back", "Word", "Language")))
    }

    @Test
    fun withEntry_fillsOnlyAnEmptyEntry() {
        assertEquals(
            listOf("f", "b", "w", "en_US", "<p>def</p>"),
            AnkiDroidLink.withEntry(listOf("f", "b", "w", "en_US", ""), 5, 4, "<p>def</p>"),
        )
        // An entry the reader edited stays, and a field the note type lacks is left alone.
        assertEquals(null, AnkiDroidLink.withEntry(listOf("f", "b", "w", "en_US", "mine"), 5, 4, "<p>def</p>"))
        assertEquals(null, AnkiDroidLink.withEntry(listOf("f", "b"), 2, 4, "<p>def</p>"))
        assertEquals(null, AnkiDroidLink.withEntry(listOf("f", "b"), 2, -1, "<p>def</p>"))
    }

    @Test
    fun withEntry_fillsAProfileNoteTypesEntryField() {
        // A card profile's note type keeps its entry wherever the reader mapped it (#7849).
        assertEquals(
            listOf("Haus", "Das Haus.", "<p>def</p>", ""),
            AnkiDroidLink.withEntry(listOf("Haus", "Das Haus.", "", ""), 4, 2, "<p>def</p>"),
        )
    }

    @Test
    fun withEntry_padsANoteReadBeforeItsFieldsWereAdded() {
        assertEquals(
            listOf("Haus", "house", "", "", "<p>def</p>"),
            AnkiDroidLink.withEntry(listOf("Haus", "house"), 5, 4, "<p>def</p>"),
        )
    }

    @Test
    fun fitFields_givesTheNoteTypeExactlyOneValuePerField() {
        assertEquals(listOf("a", "b", ""), AnkiDroidLink.fitFields(listOf("a", "b"), 3))
        assertEquals(listOf("a", "b"), AnkiDroidLink.fitFields(listOf("a", "b", "c"), 2))
    }

    @Test
    fun insertInChunks_alsoKeepsEachChunkUnderASize() {
        // Notes with dictionary entries are large: 200 of them can pass the Binder limit.
        val sizes = mutableListOf<Int>()
        AnkiDroidLink.insertInChunks(listOf(400, 400, 400, 100), 200, maxSize = 1000, sizeOf = { it }) {
            sizes.add(it.size)
            it.size
        }
        assertEquals(listOf(2, 2), sizes)
    }
}
