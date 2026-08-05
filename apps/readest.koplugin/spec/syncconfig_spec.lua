-- syncconfig_spec.lua
-- Tests for SyncConfig's metadata hash — the cross-device book fingerprint
-- that must stay CONSISTENT with Readest's getMetadataHashInfo in
-- apps/readest-app/src/utils/book.ts. The hash-source fixtures here mirror
-- src/__tests__/utils/metadata-hash-info.test.ts: same inputs must produce
-- the same "title|authors|identifiers[|pdf-filename]" string on both sides,
-- because md5 of that string is the fleet-wide book identity.
--
-- Expected hashes are computed through the same (stubbed) ffi/sha2 module the
-- production code holds, so assertions pin the exact hash INPUT — md5 itself
-- is identical in both languages.

require("spec_helper")
require("spec.koreader_stubs")

local SyncConfig = require("readest_syncconfig")
local sha2 = require("ffi/sha2")

-- Minimal ui fake: doc_settings backed by a plain table, so getMetaHash's
-- cache writes are observable.
local function fakeUI(o)
    o = o or {}
    local values = {
        doc_props = o.doc_props or {},
        doc_path = o.doc_path,
        partial_md5_checksum = o.checksum,
        readest_sync = o.readest_sync,
    }
    return {
        doc_settings = {
            readSetting = function(_, k) return values[k] end,
            saveSetting = function(_, k, v) values[k] = v end,
        },
        _values = values,
    }
end

local function fakeStore(rows)
    return {
        _getRowRaw = function(_, hash) return rows[hash] end,
    }
end

describe("SyncConfig:getMetadataHashInfo", function()
    it("builds the same hash source as Readest for a plain book", function()
        local ui = fakeUI({
            doc_props = {
                title = "The Great Gatsby",
                authors = "F. Scott Fitzgerald",
                identifiers = "9780743273565",
            },
            doc_path = "/books/gatsby.epub",
        })
        local info = SyncConfig:getMetadataHashInfo(ui)
        assert.are.equal("The Great Gatsby|F. Scott Fitzgerald|9780743273565", info.hash_source)
        assert.are.equal(sha2.md5("The Great Gatsby|F. Scott Fitzgerald|9780743273565"),
            info.meta_hash)
    end)

    it("salts PDF hashes with the base filename (issue #5411)", function()
        local props = { title = "PowerPoint Presentation", authors = "Alice Author" }
        local pdf = SyncConfig:getMetadataHashInfo(fakeUI({
            doc_props = props, doc_path = "/books/lecture-01.pdf",
        }))
        assert.are.equal("PowerPoint Presentation|Alice Author||lecture-01", pdf.hash_source)
    end)

    it("does not salt non-PDF formats", function()
        local props = { title = "PowerPoint Presentation", authors = "Alice Author" }
        local epub = SyncConfig:getMetadataHashInfo(fakeUI({
            doc_props = props, doc_path = "/books/lecture-01.epub",
        }))
        assert.are.equal("PowerPoint Presentation|Alice Author|", epub.hash_source)
    end)

    it("gives distinct PDFs with identical metadata distinct hashes", function()
        local props = { title = "PowerPoint Presentation", authors = "Alice Author" }
        local a = SyncConfig:getMetadataHashInfo(fakeUI({
            doc_props = props, doc_path = "/books/lecture-01.pdf",
        }))
        local b = SyncConfig:getMetadataHashInfo(fakeUI({
            doc_props = props, doc_path = "/books/lecture-02.pdf",
        }))
        assert.are_not.equal(a.meta_hash, b.meta_hash)
    end)

    it("keeps the salt when the title already fell back to the filename", function()
        -- Readest hashes "report||" + "|report" for a metadata-less PDF: the
        -- title fallback happens before hashing, then the salt is appended
        -- regardless. Same double appearance here.
        local info = SyncConfig:getMetadataHashInfo(fakeUI({
            doc_props = {}, doc_path = "/books/report.pdf",
        }))
        assert.are.equal("report|||report", info.hash_source)
    end)

    it("prefers uuid over other identifier schemes regardless of order", function()
        -- Readest's getPreferredIdentifier walks schemes in priority order
        -- (uuid > calibre > isbn); the identifier listing order must not
        -- change the winner.
        local first = SyncConfig:getMetadataHashInfo(fakeUI({
            doc_props = { title = "T", identifiers = "urn:uuid:abc\ncalibre:99" },
            doc_path = "/books/t.epub",
        }))
        local second = SyncConfig:getMetadataHashInfo(fakeUI({
            doc_props = { title = "T", identifiers = "calibre:99\nurn:uuid:abc" },
            doc_path = "/books/t.epub",
        }))
        assert.are.same({ "abc" }, first.identifiers)
        assert.are.same({ "abc" }, second.identifiers)
    end)
end)

describe("SyncConfig:getMetaHash", function()
    it("prefers the library store's synced meta_hash over local computation", function()
        -- The value stamped when the book entered the fleet is authoritative
        -- (Readest never recomputes it after import — the PDF filename salt
        -- is unrecoverable). A pulled row must beat anything computed here.
        local ui = fakeUI({
            doc_props = { title = "Dune" },
            doc_path = "/books/dune.pdf",
            checksum = "b1",
        })
        local store = fakeStore({ b1 = { meta_hash = "cloud-stamped" } })
        assert.are.equal("cloud-stamped", SyncConfig:getMetaHash(ui, store))
        -- Cached so annotation flows reading meta_hash_v1 directly agree.
        assert.are.equal("cloud-stamped", ui._values.readest_sync.meta_hash_v1)
    end)

    it("replaces a stale locally-computed cache with the synced value", function()
        local ui = fakeUI({
            doc_props = { title = "Dune" },
            doc_path = "/books/dune.pdf",
            checksum = "b1",
            readest_sync = { meta_hash_v1 = "old-local" },
        })
        local store = fakeStore({ b1 = { meta_hash = "cloud-stamped" } })
        assert.are.equal("cloud-stamped", SyncConfig:getMetaHash(ui, store))
        assert.are.equal("cloud-stamped", ui._values.readest_sync.meta_hash_v1)
    end)

    it("falls back to the cached hash when the store has no row", function()
        local ui = fakeUI({
            doc_props = { title = "Dune" },
            doc_path = "/books/dune.pdf",
            checksum = "b1",
            readest_sync = { meta_hash_v1 = "cached" },
        })
        assert.are.equal("cached", SyncConfig:getMetaHash(ui, fakeStore({})))
    end)

    it("computes and caches when neither store nor cache has a value", function()
        local ui = fakeUI({
            doc_props = { title = "Dune" },
            doc_path = "/books/dune.epub",
            checksum = "b1",
        })
        assert.are.equal(sha2.md5("Dune||"), SyncConfig:getMetaHash(ui, fakeStore({})))
        assert.are.equal(sha2.md5("Dune||"), ui._values.readest_sync.meta_hash_v1)
    end)

    it("ignores an empty meta_hash on the store row", function()
        local ui = fakeUI({
            doc_props = { title = "Dune" },
            doc_path = "/books/dune.epub",
            checksum = "b1",
        })
        local store = fakeStore({ b1 = { meta_hash = "" } })
        assert.are.equal(sha2.md5("Dune||"), SyncConfig:getMetaHash(ui, store))
    end)
end)
