-- syncannotations_spec.lua
-- Tests for readest_syncannotations.lua. The push/pull entrypoints are
-- glued to KOReader's UI (UIManager, InfoMessage, the document/annotation
-- objects) and aren't unit-testable in isolation. These specs lock down the
-- pure reconciliation logic: removeDeletedAnnotations, which drops local
-- annotations the server has tombstoned so deletions sync across platforms
-- (issue #4119 — deleted highlights reappearing in KOReader).

require("spec_helper")

-- The module pulls a handful of KOReader globals at require-time. Stub the
-- minimum surface here so the require succeeds under busted.
package.preload["ui/event"] = function()
    return { new = function(_, name, data) return { name = name, data = data } end }
end
package.preload["ui/widget/infomessage"] = function()
    return { new = function() return {} end }
end
package.preload["ui/network/manager"] = function() return {} end
package.preload["ui/uimanager"] = function()
    return {
        show = function() end,
        setDirty = function() end,
        nextTick = function(_, fn) fn() end,
    }
end
package.preload["ffi/util"] = function()
    return { template = function(s) return s end }
end
package.preload["readest_i18n"] = function()
    return function(s) return s end
end
-- Deterministic stand-in for KOReader's FFI md5. Real cryptographic
-- strength is irrelevant to the matching logic; we only need a stable,
-- well-distributed hash so generated note IDs collide iff their inputs do.
package.preload["ffi/sha2"] = function()
    return {
        md5 = function(s)
            -- djb2: addition/multiplication only, so it compiles under
            -- LuaJIT (5.1), which rejects the `~` bitwise operator.
            local h = 5381
            for i = 1, #s do
                h = (h * 33 + s:byte(i)) % 4294967296
            end
            return string.format("%08x", h)
        end,
    }
end

describe("readest_syncannotations", function()
    local SyncAnnotations

    before_each(function()
        package.loaded["readest_syncannotations"] = nil
        SyncAnnotations = require("readest_syncannotations")
    end)

    describe("removeDeletedAnnotations", function()
        local BOOK_HASH = "book-hash-1"

        local function mgr(annotations)
            return { annotations = annotations }
        end

        it("removes a local annotation tombstoned by matching id", function()
            local annotation_mgr = mgr({
                { id = "keep1", drawer = "lighten", pos0 = "/a/1", pos1 = "/a/2" },
                { id = "gone1", drawer = "lighten", pos0 = "/b/1", pos1 = "/b/2" },
            })
            local removed = SyncAnnotations:removeDeletedAnnotations(annotation_mgr, {
                { id = "gone1", type = "annotation", xpointer0 = "/b/1", deleted_at = "2026-05-17T00:00:00" },
            }, BOOK_HASH)

            assert.are.equal(1, removed)
            assert.are.equal(1, #annotation_mgr.annotations)
            assert.are.equal("keep1", annotation_mgr.annotations[1].id)
        end)

        it("removes a native annotation (no stored id) via the generated id", function()
            local annotation_mgr = mgr({
                { drawer = "lighten", pos0 = "/x/1", pos1 = "/x/2" },
            })
            -- The note id is what KOReader produced when it first pushed
            -- this highlight: a hash of the book + positions.
            local note_id = SyncAnnotations:generateNoteId(BOOK_HASH, "annotation", "/x/1", "/x/2")
            local removed = SyncAnnotations:removeDeletedAnnotations(annotation_mgr, {
                { id = note_id, type = "annotation", xpointer0 = "/x/1", xpointer1 = "/x/2",
                  deleted_at = "2026-05-17T00:00:00" },
            }, BOOK_HASH)

            assert.are.equal(1, removed)
            assert.are.equal(0, #annotation_mgr.annotations)
        end)

        it("removes an annotation by position when the id is absent on both sides", function()
            local annotation_mgr = mgr({
                { drawer = "underscore", pos0 = "/p/1", pos1 = "/p/9" },
            })
            local removed = SyncAnnotations:removeDeletedAnnotations(annotation_mgr, {
                { type = "annotation", xpointer0 = "/p/1", xpointer1 = "/p/9",
                  deleted_at = "2026-05-17T00:00:00" },
            }, BOOK_HASH)

            assert.are.equal(1, removed)
            assert.are.equal(0, #annotation_mgr.annotations)
        end)

        it("removes a bookmark by page xpointer", function()
            local annotation_mgr = mgr({
                { id = "bm1", page = "/doc/bm" },
                { id = "hl1", drawer = "lighten", pos0 = "/h/1" },
            })
            local removed = SyncAnnotations:removeDeletedAnnotations(annotation_mgr, {
                { id = "bm1", type = "bookmark", xpointer0 = "/doc/bm",
                  deleted_at = "2026-05-17T00:00:00" },
            }, BOOK_HASH)

            assert.are.equal(1, removed)
            assert.are.equal(1, #annotation_mgr.annotations)
            assert.are.equal("hl1", annotation_mgr.annotations[1].id)
        end)

        it("ignores notes without a deleted_at tombstone", function()
            local annotation_mgr = mgr({
                { id = "a1", drawer = "lighten", pos0 = "/a/1" },
            })
            local removed = SyncAnnotations:removeDeletedAnnotations(annotation_mgr, {
                { id = "a1", type = "annotation", xpointer0 = "/a/1" },
            }, BOOK_HASH)

            assert.are.equal(0, removed)
            assert.are.equal(1, #annotation_mgr.annotations)
        end)

        it("leaves annotations untouched when a tombstone has no local match", function()
            local annotation_mgr = mgr({
                { id = "a1", drawer = "lighten", pos0 = "/a/1" },
            })
            local removed = SyncAnnotations:removeDeletedAnnotations(annotation_mgr, {
                { id = "not-here", type = "annotation", xpointer0 = "/z/9",
                  deleted_at = "2026-05-17T00:00:00" },
            }, BOOK_HASH)

            assert.are.equal(0, removed)
            assert.are.equal(1, #annotation_mgr.annotations)
        end)

        it("removes multiple tombstoned annotations without index shift errors", function()
            local annotation_mgr = mgr({
                { id = "a1", drawer = "lighten", pos0 = "/a/1" },
                { id = "a2", drawer = "lighten", pos0 = "/a/2" },
                { id = "a3", drawer = "lighten", pos0 = "/a/3" },
                { id = "a4", drawer = "lighten", pos0 = "/a/4" },
            })
            local removed = SyncAnnotations:removeDeletedAnnotations(annotation_mgr, {
                { id = "a1", type = "annotation", xpointer0 = "/a/1", deleted_at = "2026-05-17T00:00:00" },
                { id = "a3", type = "annotation", xpointer0 = "/a/3", deleted_at = "2026-05-17T00:00:00" },
            }, BOOK_HASH)

            assert.are.equal(2, removed)
            assert.are.equal(2, #annotation_mgr.annotations)
            assert.are.equal("a2", annotation_mgr.annotations[1].id)
            assert.are.equal("a4", annotation_mgr.annotations[2].id)
        end)

        it("returns 0 when the annotation manager has no annotations", function()
            local annotation_mgr = mgr({})
            local removed = SyncAnnotations:removeDeletedAnnotations(annotation_mgr, {
                { id = "a1", type = "annotation", xpointer0 = "/a/1", deleted_at = "2026-05-17T00:00:00" },
            }, BOOK_HASH)

            assert.are.equal(0, removed)
        end)
    end)

    -- A note deleted in KOReader is removed from ui.annotation.annotations, so
    -- the push walk (getAnnotations) can never see it. recordDeletion stashes a
    -- deletedAt-stamped tombstone in the per-book sidecar so the next push tells
    -- the server it's gone (issue #4119, push direction). Without this, the
    -- deletion stays local and a later pull resurrects the highlight.
    local function makeDocSettings(initial)
        local store = initial or {}
        return {
            readSetting = function(_, k) return store[k] end,
            saveSetting = function(_, k, v) store[k] = v end,
        }
    end

    describe("recordDeletion", function()
        it("records a tombstone for a deleted highlight", function()
            local doc_settings = makeDocSettings({
                partial_md5_checksum = "book-hash-1",
                readest_sync = { meta_hash_v1 = "meta-1" },
            })
            SyncAnnotations:recordDeletion(doc_settings, {
                id = "n1", drawer = "lighten", pos0 = "/a/1", pos1 = "/a/2",
                text = "hello", datetime = "2026-05-17 10:00:00",
            })

            local deleted = doc_settings:readSetting("readest_sync").deleted_notes
            assert.are.equal(1, #deleted)
            assert.are.equal("n1", deleted[1].id)
            assert.are.equal("annotation", deleted[1].type)
            assert.are.equal("/a/1", deleted[1].xpointer0)
            assert.are.equal("/a/2", deleted[1].xpointer1)
            assert.is_truthy(deleted[1].deletedAt)
        end)

        it("derives the id for a native highlight (no stored id) from positions", function()
            local doc_settings = makeDocSettings({
                partial_md5_checksum = "book-hash-1",
                readest_sync = { meta_hash_v1 = "meta-1" },
            })
            SyncAnnotations:recordDeletion(doc_settings, {
                drawer = "lighten", pos0 = "/x/1", pos1 = "/x/2",
            })

            local expected = SyncAnnotations:generateNoteId("book-hash-1", "annotation", "/x/1", "/x/2")
            local deleted = doc_settings:readSetting("readest_sync").deleted_notes
            assert.are.equal(expected, deleted[1].id)
        end)

        it("records a tombstone for a deleted bookmark", function()
            local doc_settings = makeDocSettings({
                partial_md5_checksum = "book-hash-1",
                readest_sync = { meta_hash_v1 = "meta-1" },
            })
            SyncAnnotations:recordDeletion(doc_settings, { id = "bm1", page = "/doc/bm" })

            local deleted = doc_settings:readSetting("readest_sync").deleted_notes
            assert.are.equal(1, #deleted)
            assert.are.equal("bm1", deleted[1].id)
            assert.are.equal("bookmark", deleted[1].type)
            assert.are.equal("/doc/bm", deleted[1].xpointer0)
        end)

        it("dedupes by id so re-deleting the same note doesn't pile up", function()
            local doc_settings = makeDocSettings({
                partial_md5_checksum = "book-hash-1",
                readest_sync = { meta_hash_v1 = "meta-1" },
            })
            local item = { id = "n1", drawer = "lighten", pos0 = "/a/1" }
            SyncAnnotations:recordDeletion(doc_settings, item)
            SyncAnnotations:recordDeletion(doc_settings, item)

            local deleted = doc_settings:readSetting("readest_sync").deleted_notes
            assert.are.equal(1, #deleted)
        end)

        it("ignores items that aren't syncable notes", function()
            local doc_settings = makeDocSettings({
                partial_md5_checksum = "book-hash-1",
                readest_sync = { meta_hash_v1 = "meta-1" },
            })
            -- No drawer and a non-string page → neither highlight nor bookmark.
            SyncAnnotations:recordDeletion(doc_settings, { page = 12 })

            local readest_sync = doc_settings:readSetting("readest_sync")
            assert.is_nil(readest_sync.deleted_notes)
        end)
    end)

    describe("push folds tombstones", function()
        local function makeUi(doc_settings, annotations)
            return {
                doc_settings = doc_settings,
                annotation = { annotations = annotations or {} },
            }
        end

        it("includes recorded tombstones in the payload and clears them on success", function()
            local doc_settings = makeDocSettings({
                partial_md5_checksum = "book-hash-1",
                readest_sync = {
                    meta_hash_v1 = "meta-1",
                    deleted_notes = {
                        { id = "gone1", type = "annotation", xpointer0 = "/b/1", deletedAt = 111 },
                    },
                },
            })
            local captured
            local client = {
                pushChanges = function(_, payload, cb)
                    captured = payload
                    cb(true, {})
                end,
            }
            SyncAnnotations:push(makeUi(doc_settings), {}, client, false, false)

            assert.is_truthy(captured)
            assert.are.equal(1, #captured.notes)
            assert.are.equal("gone1", captured.notes[1].id)
            assert.are.equal(111, captured.notes[1].deletedAt)
            assert.are.equal("book-hash-1", captured.notes[1].bookHash)
            assert.are.equal("meta-1", captured.notes[1].metaHash)
            assert.is_nil(doc_settings:readSetting("readest_sync").deleted_notes)
        end)

        it("keeps tombstones when the push fails so a later push retries", function()
            local doc_settings = makeDocSettings({
                partial_md5_checksum = "book-hash-1",
                readest_sync = {
                    meta_hash_v1 = "meta-1",
                    deleted_notes = {
                        { id = "gone1", type = "annotation", xpointer0 = "/b/1", deletedAt = 111 },
                    },
                },
            })
            local client = {
                pushChanges = function(_, _payload, cb) cb(false, nil) end,
            }
            SyncAnnotations:push(makeUi(doc_settings), {}, client, false, false)

            local deleted = doc_settings:readSetting("readest_sync").deleted_notes
            assert.are.equal(1, #deleted)
            assert.are.equal("gone1", deleted[1].id)
        end)
    end)
end)
