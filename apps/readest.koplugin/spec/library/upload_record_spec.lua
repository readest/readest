-- upload_record_spec.lua
-- Tests for library/syncbooks.uploadAndRecord — the "upload, then record what
-- happened" step shared by the Library widget's long-press "Upload to Cloud"
-- and the plugin menu's "Upload current book to Readest".
--
-- uploadBook itself is network-bound and stays untested (see the note atop
-- syncbooks_spec). What IS testable, and what silently rots when duplicated,
-- is the bookkeeping AFTER the bytes land: marking the row cloud-present,
-- stamping uploaded_at, clearing any tombstone, and pushing the row so peers
-- see the book. Those are the assertions below.

require("spec_helper")

describe("library.syncbooks.uploadAndRecord", function()
    local syncbooks
    local uploads, pushes, upserts

    before_each(function()
        package.loaded["library.syncbooks"] = nil
        syncbooks = require("library.syncbooks")
        uploads, pushes, upserts = {}, {}, {}
    end)

    -- A local-only book that was previously deleted (tombstoned), which is the
    -- case that exercises every field uploadAndRecord touches.
    local function book()
        return {
            hash          = "h1",
            title         = "Dune",
            format        = "EPUB",
            file_path     = "/books/dune.epub",
            cloud_present = 0,
            local_present = 1,
            deleted_at    = 1700000000000,
        }
    end

    local function fakeStore()
        return {
            upsertBook = function(_, row) table.insert(upserts, row) end,
        }
    end

    local function opts()
        return {
            sync_auth  = {},
            sync_path  = "/plugins/readest.koplugin",
            settings   = { access_token = "tok", user_id = "u1" },
            store      = fakeStore(),
            covers_dir = "/settings/readest_covers",
        }
    end

    -- Swap the two network calls for recorders. uploadAndRecord must reach
    -- them through the module table (M.uploadBook / M.pushBook) for this to
    -- work — that indirection is deliberate, it's what makes it testable.
    local function stubNetwork(success, msg, status)
        syncbooks.uploadBook = function(b, o, cb)
            table.insert(uploads, { book = b, opts = o })
            cb(success, msg, status)
        end
        syncbooks.pushBook = function(row, _o, cb)
            table.insert(pushes, row)
            if cb then cb(true) end
        end
    end

    local function clears(row, field)
        for _, f in ipairs(row._clear_fields or {}) do
            if f == field then return true end
        end
        return false
    end

    it("uploads the book, passing the covers dir so the cover ships too", function()
        stubNetwork(true)
        syncbooks.uploadAndRecord(book(), opts(), function() end)

        assert.are.equal(1, #uploads)
        assert.are.equal("h1", uploads[1].book.hash)
        assert.are.equal("/settings/readest_covers", uploads[1].opts.covers_dir)
    end)

    it("marks the row cloud-present and stamps uploaded_at on success", function()
        stubNetwork(true)
        syncbooks.uploadAndRecord(book(), opts(), function() end)

        assert.are.equal(1, #upserts)
        local row = upserts[1]
        assert.are.equal("h1", row.hash)
        assert.are.equal(1, row.cloud_present)
        assert.is_number(row.uploaded_at)
        assert.is_number(row.updated_at)
        assert.is_true(row.uploaded_at > 0)
    end)

    it("un-tombstones a previously deleted book so it comes back", function()
        stubNetwork(true)
        syncbooks.uploadAndRecord(book(), opts(), function() end)

        -- A bare `deleted_at = nil` would be dropped by Lua's table semantics
        -- and then preserved by upsertBook's copy-forward pass, leaving the
        -- book tombstoned despite a successful upload.
        assert.is_true(clears(upserts[1], "deleted_at"))
    end)

    it("pushes the row so other devices learn the book is in the cloud", function()
        stubNetwork(true)
        syncbooks.uploadAndRecord(book(), opts(), function() end)

        assert.are.equal(1, #pushes)
        assert.are.equal("h1", pushes[1].hash)
        assert.are.equal(1, pushes[1].cloud_present)
        assert.is_number(pushes[1].uploaded_at)
        assert.is_nil(pushes[1].deleted_at)
        -- Carries the descriptive fields so peers render the book, not a stub.
        assert.are.equal("Dune", pushes[1].title)
        assert.are.equal("EPUB", pushes[1].format)
    end)

    it("does not mutate the caller's row", function()
        stubNetwork(true)
        -- The Library widget hands us its live entry row; mutating it in place
        -- would desync the on-screen item from the store.
        local caller_row = book()
        syncbooks.uploadAndRecord(caller_row, opts(), function() end)

        assert.are.equal(0, caller_row.cloud_present)
        assert.are.equal(1700000000000, caller_row.deleted_at)
        assert.is_nil(caller_row.uploaded_at)
    end)

    it("reports success to the caller", function()
        stubNetwork(true)
        local result
        syncbooks.uploadAndRecord(book(), opts(), function(ok) result = ok end)
        assert.is_true(result)
    end)

    it("records nothing when the upload fails", function()
        stubNetwork(false, "quota exceeded", 403)
        local ok, msg, status
        syncbooks.uploadAndRecord(book(), opts(), function(a, b, c)
            ok, msg, status = a, b, c
        end)

        -- Claiming cloud_present after a failed upload would strand the book:
        -- the Library would stop offering Upload, and peers would be told to
        -- download bytes that were never stored.
        assert.are.equal(0, #upserts)
        assert.are.equal(0, #pushes)
        assert.is_false(ok)
        assert.are.equal("quota exceeded", msg)
        assert.are.equal(403, status)
    end)
end)
