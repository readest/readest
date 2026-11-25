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

    /**
     * The note type's fields. Sync matches notes on Front and reads hints from
     * Back, so new fields only ever go after them. Word and Language give the
     * card its audio (#7729); Entry is kept for the dictionary entry (#7728),
     * added now because every field added to an existing note type costs the
     * reader a full AnkiWeb sync.
     */
    val NOTE_FIELDS = listOf("Front", "Back", "Word", "Language", "Entry")

    /** Reads the word aloud in its language when both are set. */
    private const val AUDIO =
        "{{#Language}}{{#Word}}<br>[anki:tts lang={{Language}}]{{Word}}[/anki:tts]{{/Word}}{{/Language}}"

    /** The dictionary entry (#7728), below the hint and the audio. */
    private const val ENTRY =
        "{{#Entry}}<hr><div style=\"text-align:start;font-size:0.85em\">{{Entry}}</div>{{/Entry}}"

    /**
     * The question and answer templates for a note type with these field
     * [names]: its own first two fields, so a reader who renamed Front and
     * Back keeps a card that renders them, then the audio and the entry.
     */
    fun templates(names: List<String>): Pair<String, String> =
        "{{${names[0]}}}" to "{{FrontSide}}<hr id=answer>{{${names[1]}}}$AUDIO$ENTRY"

    /**
     * True until the note type has every field and the current template. An
     * upgrade that stopped after adding the fields is still outdated, so the
     * next one finishes it.
     */
    fun outdated(names: List<String>, answerFormat: String): Boolean =
        missingFields(names).isNotEmpty() || AUDIO !in answerFormat || ENTRY !in answerFormat

    /**
     * The fields after Front and Back that a note type lacks. Its first two
     * fields are Front and Back whatever the reader renamed them to.
     */
    fun missingFields(names: List<String>): List<String> = NOTE_FIELDS.drop(2).filter { it !in names }

    private const val FIELD_SEPARATOR = "\u001f"
    /** Notes per bulkInsert: one Binder transaction carries at most about 1 MB. */
    private const val INSERT_CHUNK = 200
    /** Characters per bulkInsert, at two bytes each, so notes with entries stay under 1 MB. */
    private const val INSERT_CHARS = 256 * 1024
    /** Anki calls a review card mature from a 21-day interval. */
    private const val MATURE_INTERVAL = 21
    private const val CARD_CSS =
        ".card { font-family: sans-serif; font-size: 20px; text-align: center; }"

    data class Deck(val id: Long, val name: String)
    data class NoteType(val id: Long, val name: String, val fields: List<String>)
    data class Note(val id: Long, val mid: Long, val fields: List<String>, val tags: String)
    data class Card(val noteId: Long, val type: Int, val interval: Long)

    fun joinFields(fields: List<String>): String = fields.joinToString(FIELD_SEPARATOR)

    fun splitFields(flds: String): List<String> = flds.split(FIELD_SEPARATOR)

    /**
     * [values] (in [NOTE_FIELDS] order) laid out for a note type with these
     * field [names]: Front and Back by position, as Sync has always read them,
     * the new fields by name, and any field the reader added left empty.
     */
    fun arrangeFields(values: List<String>, names: List<String>): List<String> =
        names.mapIndexed { i, name ->
            val k = if (i < 2) i else NOTE_FIELDS.indexOf(name).takeIf { it >= 2 } ?: -1
            values.getOrElse(k) { "" }
        }

    /** A note's [current] fields with an empty Word and Language filled in. */
    fun fillFields(current: List<String>, names: List<String>, word: String, language: String): List<String> =
        names.mapIndexed { i, name ->
            val value = current.getOrElse(i) { "" }
            when {
                value.isNotEmpty() -> value
                name == "Word" -> word
                name == "Language" -> language
                else -> value
            }
        }

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
     * Insert [rows] at most [size] and [maxSize] (by [sizeOf]) at a time.
     * ContentResolver.bulkInsert returns 0 when a transaction is too large, so a
     * short count fails loudly instead.
     */
    fun <T> insertInChunks(
        rows: List<T>,
        size: Int,
        maxSize: Int = Int.MAX_VALUE,
        sizeOf: (T) -> Int = { 0 },
        insert: (List<T>) -> Int,
    ): Int {
        val chunks = mutableListOf<MutableList<T>>()
        var used = 0
        for (row in rows) {
            val rowSize = sizeOf(row)
            val last = chunks.lastOrNull()
            if (last == null || last.size >= size || used + rowSize > maxSize) {
                chunks.add(mutableListOf(row))
                used = rowSize
            } else {
                last.add(row)
                used += rowSize
            }
        }
        return chunks.sumOf { chunk ->
            val added = insert(chunk)
            if (added < chunk.size) throw IOException("AnkiDroid added $added of ${chunk.size} notes")
            added
        }
    }

    /**
     * A note's [current] fields, for a note type of [size] fields, with [entry]
     * in its empty field [field]; null when that field isn't there or isn't empty.
     */
    fun withEntry(current: List<String>, size: Int, field: Int, entry: String): List<String>? {
        if (field !in 0 until size || current.getOrElse(field) { "" }.isNotEmpty()) return null
        return (0 until size).map { if (it == field) entry else current.getOrElse(it) { "" } }
    }

    /** [values] padded or cut to one per field of a note type of [size] fields. */
    fun fitFields(values: List<String>, size: Int): List<String> = List(size) { values.getOrElse(it) { "" } }

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
            val cursor = client.query(uri("notes"), arrayOf("_id", "mid", "flds", "tags"), deckSearch(deckIds), null, null)
                ?: return emptyList()
            return cursor.rows {
                Note(
                    it.getLong(it.getColumnIndexOrThrow("_id")),
                    it.getLong(it.getColumnIndexOrThrow("mid")),
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

    /** Every note type in the collection, with its field names (#7849). */
    fun listNoteTypes(cr: ContentResolver): List<NoteType> =
        cr.query(uri("models"), arrayOf("_id", "name", "field_names"), null, null, null).rows {
            NoteType(
                it.getLong(it.getColumnIndexOrThrow("_id")),
                it.getString(it.getColumnIndexOrThrow("name")),
                splitFields(it.getString(it.getColumnIndexOrThrow("field_names")) ?: ""),
            )
        }

    /** The Readest note type's id and field names, or null before Sync first created it. */
    fun findNoteType(cr: ContentResolver): Pair<Long, List<String>>? =
        listNoteTypes(cr).firstOrNull { it.name == NOTE_TYPE_NAME }?.let { it.id to it.fields }

    /** True when the note type exists and isn't fully upgraded (see [outdated]). */
    fun noteTypeOutdated(cr: ContentResolver): Boolean {
        val (mid, names) = findNoteType(cr) ?: return false
        val answer = cr.query(uri("models/$mid/templates/0"), arrayOf("answer_format"), null, null, null).rows {
            it.getString(it.getColumnIndexOrThrow("answer_format")) ?: ""
        }.firstOrNull() ?: ""
        return outdated(names, answer)
    }

    // AnkiDroid's generated back template carries a literal "\n"; set both sides.
    private fun setTemplate(cr: ContentResolver, mid: Long, names: List<String>) {
        val (question, answer) = templates(names)
        cr.update(
            uri("models/$mid/templates/0"),
            ContentValues().apply {
                put("question_format", question)
                put("answer_format", answer)
            },
            null,
            null,
        )
    }

    private fun findOrCreateNoteType(cr: ContentResolver): Pair<Long, List<String>> {
        findNoteType(cr)?.let { return it }
        val values = ContentValues().apply {
            put("name", NOTE_TYPE_NAME)
            put("field_names", joinFields(NOTE_FIELDS))
            put("num_cards", 1)
            put("sort_field_index", 0)
            put("css", CARD_CSS)
        }
        val mid = cr.insert(uri("models"), values)!!.lastPathSegment!!.toLong()
        setTemplate(cr, mid, NOTE_FIELDS)
        return mid to NOTE_FIELDS
    }

    /**
     * Add the fields a note type from before #7729 lacks, switch its template to
     * the one with audio, and fill Word and Language on the notes Sync added
     * before ([fills]: note id, word, language). Repeatable: fields that exist
     * and values already set are kept. Adding a field changes Anki's schema, so
     * AnkiDroid's next AnkiWeb sync is a full one. Resolves with how many notes
     * were filled.
     */
    fun upgradeNoteType(cr: ContentResolver, fills: List<Triple<Long, String, String>>): Int {
        val (mid, names) = findOrCreateNoteType(cr)
        val missing = missingFields(names)
        missing.forEach { name ->
            cr.insert(uri("models/$mid/fields"), ContentValues().apply { put("field_name", name) })
        }
        val all = names + missing
        val filled = fills.sumOf { (id, word, language) ->
            val note = cr.query(uri("notes/$id"), arrayOf("mid", "flds"), null, null, null).rows {
                it.getLong(it.getColumnIndexOrThrow("mid")) to (it.getString(it.getColumnIndexOrThrow("flds")) ?: "")
            }.firstOrNull()
            // Only Readest's own notes: the deck can hold notes of any type.
            if (note == null || note.first != mid) return@sumOf 0
            val flds = joinFields(fillFields(splitFields(note.second), all, word, language))
            if (flds == note.second) 0
            else cr.update(uri("notes/$id"), ContentValues().apply { put("flds", flds) }, null, null)
        }
        // Last: until the template has the audio, the note type reads as
        // outdated, so an upgrade that stopped early is finished next Sync.
        setTemplate(cr, mid, all)
        return filled
    }

    /**
     * Add notes to the named deck, creating the deck as needed. Without [modelId]
     * they are Readest's notes, its note type created as needed; with it, notes of
     * that note type (a card profile's, #7849) whose fields are given in its order.
     */
    fun addNotes(
        cr: ContentResolver,
        deckName: String,
        modelId: Long?,
        notes: List<Pair<List<String>, List<String>>>,
    ): Int {
        if (notes.isEmpty()) return 0
        val (mid, layout) = if (modelId == null) {
            val (mid, names) = findOrCreateNoteType(cr)
            mid to { fields: List<String> -> arrangeFields(fields, names) }
        } else {
            val size = listNoteTypes(cr).firstOrNull { it.id == modelId }?.fields?.size
                ?: throw IOException("AnkiDroid has no note type $modelId")
            modelId to { fields: List<String> -> fitFields(fields, size) }
        }
        val deckId = findOrCreateDeck(cr, deckName)
        val rows = notes.map { (fields, tags) ->
            ContentValues().apply {
                put("mid", mid)
                put("flds", joinFields(layout(fields)))
                put("tags", joinTags(tags))
            }
        }
        val target = uri("notes").buildUpon().appendQueryParameter("deckId", deckId.toString()).build()
        return insertInChunks(rows, INSERT_CHUNK, INSERT_CHARS, { it.getAsString("flds").length }) {
            cr.bulkInsert(target, it.toTypedArray())
        }
    }

    /**
     * Put dictionary entries (#7728) into the empty entry field of notes
     * ([entries]: note id, the field's index, entry HTML): Readest's Entry, or
     * the field a card profile maps (#7849). An entry the reader wrote is left
     * alone. Resolves with how many were set.
     */
    fun setEntries(cr: ContentResolver, entries: List<Triple<Long, Int, String>>): Int {
        if (entries.isEmpty()) return 0
        val sizes = listNoteTypes(cr).associate { it.id to it.fields.size }
        return entries.sumOf { (id, field, entry) ->
            val note = cr.query(uri("notes/$id"), arrayOf("mid", "flds"), null, null, null).rows {
                it.getLong(it.getColumnIndexOrThrow("mid")) to (it.getString(it.getColumnIndexOrThrow("flds")) ?: "")
            }.firstOrNull() ?: return@sumOf 0
            val size = sizes[note.first] ?: return@sumOf 0
            val fields = withEntry(splitFields(note.second), size, field, entry) ?: return@sumOf 0
            cr.update(uri("notes/$id"), ContentValues().apply { put("flds", joinFields(fields)) }, null, null)
        }
    }

    /** Replace the tags of existing notes; resolves with how many AnkiDroid updated. */
    fun updateTags(cr: ContentResolver, notes: List<Pair<Long, List<String>>>): Int =
        notes.sumOf { (id, tags) ->
            cr.update(uri("notes/$id"), ContentValues().apply { put("tags", joinTags(tags)) }, null, null)
        }
}
