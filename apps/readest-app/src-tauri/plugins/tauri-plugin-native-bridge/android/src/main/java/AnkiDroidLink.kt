package com.readest.native_bridge

import android.content.ContentResolver
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import java.io.IOException

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
    /** Notes per bulkInsert: one Binder transaction carries at most about 1 MB. */
    private const val INSERT_CHUNK = 200
    /** Anki calls a review card mature from a 21-day interval. */
    private const val MATURE_INTERVAL = 21
    private const val CARD_CSS =
        ".card { font-family: sans-serif; font-size: 20px; text-align: center; }"

    data class Deck(val id: Long, val name: String)
    data class Note(val id: Long, val fields: List<String>, val tags: String)
    data class Card(val noteId: Long, val type: Int, val interval: Long)

    fun joinFields(fields: List<String>): String = fields.joinToString(FIELD_SEPARATOR)

    fun splitFields(flds: String): List<String> = flds.split(FIELD_SEPARATOR)

    /** A note's tags column: tags separated by spaces. */
    fun joinTags(tags: List<String>): String = tags.joinToString(" ")

    /** Anki search for these decks by id, so no deck name needs escaping. */
    fun deckSearch(deckIds: List<Long>): String = "did:" + deckIds.joinToString(",")

    /**
     * Only mature cards: AnkiDroid renders every card row it returns. The deck
     * term is grouped: ungrouped, `did:` swallowed the interval and AnkiDroid
     * 2.25.3 returned every card of the decks.
     */
    fun matureCardSearch(deckIds: List<Long>): String =
        "(${deckSearch(deckIds)}) prop:ivl>=$MATURE_INTERVAL"

    /**
     * Insert [rows] [size] at a time. ContentResolver.bulkInsert returns 0 when
     * a transaction is too large, so a short count fails loudly instead.
     */
    fun <T> insertInChunks(rows: List<T>, size: Int, insert: (List<T>) -> Int): Int =
        rows.chunked(size).sumOf { chunk ->
            val added = insert(chunk)
            if (added < chunk.size) throw IOException("AnkiDroid added $added of ${chunk.size} notes")
            added
        }

    // Built on use: android.net.Uri is a stub in host-JVM unit tests.
    private const val AUTHORITY = "$PACKAGE.flashcards"

    private fun uri(path: String): Uri = Uri.parse("content://$AUTHORITY/$path")

    /** The rows of a query; no cursor at all means AnkiDroid's provider is unavailable. */
    internal inline fun <T> Cursor?.rows(read: (Cursor) -> T): List<T> =
        (this ?: throw IOException("AnkiDroid returned no cursor")).use { c ->
            buildList { while (c.moveToNext()) add(read(c)) }
        }

    fun listDecks(cr: ContentResolver): List<Deck> =
        cr.query(uri("decks"), arrayOf("deck_id", "deck_name"), null, null, null).rows {
            Deck(it.getLong(it.getColumnIndexOrThrow("deck_id")), it.getString(it.getColumnIndexOrThrow("deck_name")))
        }

    /**
     * The notes in these decks. Read through a provider client, not the resolver:
     * the resolver answers both a provider that died mid-call and AnkiDroid's own
     * "no notes match" with no cursor, while a client throws on the first.
     */
    fun readNotes(cr: ContentResolver, deckIds: List<Long>): List<Note> {
        val client = cr.acquireUnstableContentProviderClient(AUTHORITY)
            ?: throw IOException("AnkiDroid is not available")
        try {
            // AnkiDroid answers a notes search that matches nothing with no cursor.
            val cursor = client.query(uri("notes"), arrayOf("_id", "flds", "tags"), deckSearch(deckIds), null, null)
                ?: return emptyList()
            return cursor.rows {
                Note(
                    it.getLong(it.getColumnIndexOrThrow("_id")),
                    splitFields(it.getString(it.getColumnIndexOrThrow("flds")) ?: ""),
                    it.getString(it.getColumnIndexOrThrow("tags")) ?: "",
                )
            }
        } finally {
            client.close()
        }
    }

    /** The decks' mature cards in one query; throws IllegalArgumentException before AnkiDroid 2.24. */
    fun readCards(cr: ContentResolver, deckIds: List<Long>): List<Card> =
        cr.query(uri("cards"), arrayOf("note_id", "type", "interval"), matureCardSearch(deckIds), null, null).rows {
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
                put("tags", joinTags(tags))
            }
        }
        val target = uri("notes").buildUpon().appendQueryParameter("deckId", deckId.toString()).build()
        return insertInChunks(rows, INSERT_CHUNK) { cr.bulkInsert(target, it.toTypedArray()) }
    }

    /** Replace the tags of existing notes; resolves with how many AnkiDroid updated. */
    fun updateTags(cr: ContentResolver, notes: List<Pair<Long, List<String>>>): Int =
        notes.sumOf { (id, tags) ->
            cr.update(uri("notes/$id"), ContentValues().apply { put("tags", joinTags(tags)) }, null, null)
        }
}
