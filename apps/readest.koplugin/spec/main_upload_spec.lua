-- main_upload_spec.lua
-- Tests for ReadestSync:uploadCurrentBook — the plugin-menu entry that uploads
-- the book you're reading, mirroring the Library widget's long-press "Upload
-- to Cloud".
--
-- The interesting case is a book that was sideloaded and opened but never
-- added to the Readest library: it has no LibraryStore row, and uploadBook
-- needs one (hash / format / file_path). So the entry point has to create the
-- row before it can upload it.

require("spec_helper")
local stubs = require("spec.koreader_stubs")

local ReadestSync = require("main")

local uploads

-- Stand in for library.syncbooks. main.lua require()s it lazily inside the
-- upload path, so seeding package.loaded is enough to intercept.
local function fakeSyncbooks(result)
    return {
        uploadAndRecord = function(book, opts, cb)
            table.insert(uploads, { book = book, opts = opts })
            if cb then cb(result.success, result.msg, result.status) end
        end,
    }
end

local function fakeStore(rows)
    return {
        rows    = rows or {},
        upserts = {},
        _getRowRaw = function(self, hash) return self.rows[hash] end,
        upsertBook = function(self, row)
            table.insert(self.upserts, row)
            local merged = {}
            for k, v in pairs(self.rows[row.hash] or {}) do merged[k] = v end
            for k, v in pairs(row) do
                if k ~= "_clear_fields" then merged[k] = v end
            end
            for _, f in ipairs(row._clear_fields or {}) do merged[f] = nil end
            self.rows[row.hash] = merged
        end,
    }
end

local function makePlugin(o)
    o = o or {}
    local store = o.store or fakeStore()
    local doc_settings = {
        _values = {
            partial_md5_checksum = o.checksum,
            doc_props = o.doc_props or { title = "Dune" },
        },
        readSetting = function(self, k) return self._values[k] end,
    }
    local plugin = setmetatable({
        path = "/plugins/readest.koplugin",
        settings = {
            access_token = o.access_token == nil and "tok" or o.access_token,
            user_id = "u1",
        },
        ui = {
            document = o.file and { file = o.file } or nil,
            doc_settings = doc_settings,
        },
    }, { __index = ReadestSync })
    plugin.getLibraryStore = function() return store end
    plugin.store = store
    return plugin
end

describe("ReadestSync:uploadCurrentBook", function()
    before_each(function()
        stubs.reset()
        uploads = {}
        package.loaded["library.syncbooks"] = fakeSyncbooks({ success = true })
    end)

    after_each(function()
        package.loaded["library.syncbooks"] = nil
    end)

    it("uploads a book that is already in the library", function()
        local store = fakeStore({
            h1 = { hash = "h1", title = "Dune", format = "EPUB",
                   file_path = "/books/dune.epub", local_present = 1 },
        })
        local plugin = makePlugin({
            file = "/books/dune.epub", checksum = "h1", store = store,
        })

        plugin:uploadCurrentBook()

        assert.are.equal(1, #uploads)
        assert.are.equal("h1", uploads[1].book.hash)
        assert.are.equal("EPUB", uploads[1].book.format)
        assert.are.equal("/books/dune.epub", uploads[1].book.file_path)
    end)

    it("creates the library row first for a book that was never added", function()
        local plugin = makePlugin({ file = "/books/dune.epub", checksum = "h1" })

        plugin:uploadCurrentBook()

        -- Without a row carrying format + file_path, uploadBook bails with
        -- "missing book info" and the user gets a failure toast for a book
        -- that is sitting right there on disk.
        assert.are.equal(1, #plugin.store.upserts)
        local row = plugin.store.upserts[1]
        assert.are.equal("h1", row.hash)
        assert.are.equal("EPUB", row.format)
        assert.are.equal("/books/dune.epub", row.file_path)
        assert.are.equal(1, row.local_present)
        assert.are.equal("Dune", row.title)

        assert.are.equal(1, #uploads)
        assert.are.equal("h1", uploads[1].book.hash)
    end)

    it("titles a new row from the open book's metadata, not the filename", function()
        local plugin = makePlugin({
            file = "/books/dune_1965_ocr.epub",
            checksum = "h1",
            doc_props = { title = "Dune" },
        })

        plugin:uploadCurrentBook()

        assert.are.equal("Dune", plugin.store.upserts[1].title)
    end)

    it("falls back to the filename when the book has no title metadata", function()
        local plugin = makePlugin({
            file = "/books/dune.epub", checksum = "h1", doc_props = {},
        })

        plugin:uploadCurrentBook()

        assert.are.equal("dune", plugin.store.upserts[1].title)
    end)

    it("keeps the existing title when the book is already in the library", function()
        local store = fakeStore({
            h1 = { hash = "h1", title = "Dune (annotated)", format = "EPUB",
                   file_path = "/books/dune.epub", local_present = 1 },
        })
        local plugin = makePlugin({
            file = "/books/dune.epub", checksum = "h1",
            store = store, doc_props = { title = "Dune" },
        })

        plugin:uploadCurrentBook()

        assert.are.equal("Dune (annotated)", store.upserts[1].title)
    end)

    it("reuses the checksum KOReader already computed", function()
        local hashed = false
        stubs.util.partialMD5 = function() hashed = true; return "recomputed" end
        local plugin = makePlugin({ file = "/books/dune.epub", checksum = "h1" })

        plugin:uploadCurrentBook()

        assert.is_false(hashed)
        assert.are.equal("h1", uploads[1].book.hash)
    end)

    it("hashes the file when KOReader has no checksum for it yet", function()
        stubs.util.partialMD5 = function(file)
            assert.are.equal("/books/dune.epub", file)
            return "computed-hash"
        end
        local plugin = makePlugin({ file = "/books/dune.epub", checksum = nil })

        plugin:uploadCurrentBook()
        -- Hashing is deferred a tick so the "Hashing book…" message paints.
        stubs.UIManager:drain()

        assert.are.equal(1, #uploads)
        assert.are.equal("computed-hash", uploads[1].book.hash)
    end)

    it("passes the covers dir so the cover uploads alongside the book", function()
        local plugin = makePlugin({ file = "/books/dune.epub", checksum = "h1" })

        plugin:uploadCurrentBook()

        -- Parity with the Library widget's upload (issue #4374): a book that
        -- originated on this device still gets a cover in the cloud.
        assert.is_truthy(uploads[1].opts.covers_dir)
        assert.is_truthy(uploads[1].opts.covers_dir:find("readest_covers", 1, true))
        assert.are.equal(plugin.store, uploads[1].opts.store)
    end)

    it("does nothing when signed out", function()
        local plugin = makePlugin({ file = "/books/dune.epub", checksum = "h1",
                                    access_token = false })

        plugin:uploadCurrentBook()
        stubs.UIManager:drain()

        assert.are.equal(0, #uploads)
    end)

    it("does nothing for a format Readest cannot store", function()
        local plugin = makePlugin({ file = "/books/notes.docx", checksum = "h1" })

        plugin:uploadCurrentBook()
        stubs.UIManager:drain()

        assert.are.equal(0, #uploads)
        assert.are.equal(0, #plugin.store.upserts)
    end)
end)
