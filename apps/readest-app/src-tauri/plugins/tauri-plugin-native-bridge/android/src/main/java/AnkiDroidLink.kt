package com.readest.native_bridge

import android.content.ContentResolver
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri

/**
 * AnkiDroid's content provider (`FlashCardsContract`), read and written
 * directly so Readest needs no AnkiDroid library (#789). The mapping from
 * notes to vocabulary words lives in TypeScript (`services/vocabulary/anki.ts`);
 * this only moves rows.
 */
object AnkiDroidLink {
    const val PACKAGE = "com.ichi2.anki"
    const val PERMISSION = "com.ichi2.anki.permission.READ_WRITE_DATABASE"
    const val NOTE_TYPE_NAME = "Readest Vocabulary"

    private const val FIELD_SEPARATOR = "\u001f"
    private const val CARD_CSS =
        ".card { font-family: sans-serif; font-size: 20px; text-align: center; }"

    data class Deck(val id: Long, val name: String)
    data class Note(val id: Long, val fields: List<String>, val tags: String)
    data class Card(val noteId: Long, val type: Int, val interval: Long)

    fun joinFields(fields: List<String>): String = fields.joinToString(FIELD_SEPARATOR)

    fun splitFields(flds: String): List<String> = flds.split(FIELD_SEPARATOR)

    /** Anki search for one deck by id, so no deck name needs escaping. */
    fun deckSearch(deckId: Long): String = "did:$deckId"

    // Built on use: android.net.Uri is a stub in host-JVM unit tests.
    private fun uri(path: String): Uri = Uri.parse("content://$PACKAGE.flashcards/$path")

    private inline fun <T> Cursor?.rows(read: (Cursor) -> T): List<T> =
        this?.use { c -> buildList { while (c.moveToNext()) add(read(c)) } } ?: emptyList()

    fun listDecks(cr: ContentResolver): List<Deck> =
        cr.query(uri("decks"), arrayOf("deck_id", "deck_name"), null, null, null).rows {
            Deck(it.getLong(it.getColumnIndexOrThrow("deck_id")), it.getString(it.getColumnIndexOrThrow("deck_name")))
        }

    fun readNotes(cr: ContentResolver, deckId: Long): List<Note> =
        cr.query(uri("notes"), arrayOf("_id", "flds", "tags"), deckSearch(deckId), null, null).rows {
            Note(
                it.getLong(it.getColumnIndexOrThrow("_id")),
                splitFields(it.getString(it.getColumnIndexOrThrow("flds")) ?: ""),
                it.getString(it.getColumnIndexOrThrow("tags")) ?: "",
            )
        }

    /** Every card in the deck in one query; throws IllegalArgumentException before AnkiDroid 2.24. */
    fun readCards(cr: ContentResolver, deckId: Long): List<Card> =
        cr.query(uri("cards"), arrayOf("note_id", "type", "interval"), deckSearch(deckId), null, null).rows {
            Card(
                it.getLong(it.getColumnIndexOrThrow("note_id")),
                it.getInt(it.getColumnIndexOrThrow("type")),
                it.getLong(it.getColumnIndexOrThrow("interval")),
            )
        }

    private fun findOrCreateDeck(cr: ContentResolver, name: String): Long =
        listDecks(cr).firstOrNull { it.name == name }?.id
            ?: cr.insert(uri("decks"), ContentValues().apply { put("deck_name", name) })!!
                .lastPathSegment!!.toLong()

    private fun findOrCreateNoteType(cr: ContentResolver): Long {
        cr.query(uri("models"), arrayOf("_id", "name"), null, null, null).rows {
            it.getString(it.getColumnIndexOrThrow("name")) to it.getLong(it.getColumnIndexOrThrow("_id"))
        }.firstOrNull { it.first == NOTE_TYPE_NAME }?.let { return it.second }

        val values = ContentValues().apply {
            put("name", NOTE_TYPE_NAME)
            put("field_names", joinFields(listOf("Front", "Back")))
            put("num_cards", 1)
            put("sort_field_index", 0)
            put("css", CARD_CSS)
        }
        val mid = cr.insert(uri("models"), values)!!.lastPathSegment!!.toLong()
        // AnkiDroid's generated back template carries a literal "\n"; set both sides.
        cr.update(
            uri("models/$mid/templates/0"),
            ContentValues().apply {
                put("question_format", "{{Front}}")
                put("answer_format", "{{FrontSide}}<hr id=answer>{{Back}}")
            },
            null,
            null,
        )
        return mid
    }

    /** Add notes to the named deck, creating the deck and note type as needed. */
    fun addNotes(cr: ContentResolver, deckName: String, notes: List<Pair<List<String>, List<String>>>): Int {
        if (notes.isEmpty()) return 0
        val deckId = findOrCreateDeck(cr, deckName)
        val mid = findOrCreateNoteType(cr)
        val rows = notes.map { (fields, tags) ->
            ContentValues().apply {
                put("mid", mid)
                put("flds", joinFields(fields))
                put("tags", tags.joinToString(" "))
            }
        }.toTypedArray()
        val target = uri("notes").buildUpon().appendQueryParameter("deckId", deckId.toString()).build()
        return cr.bulkInsert(target, rows)
    }
}
