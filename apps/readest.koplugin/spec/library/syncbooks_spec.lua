-- syncbooks_spec.lua
-- Pure-function tests for library/syncbooks.lua. The network-touching parts
-- (pullBooks, downloadBook, downloadCover) require Spore + httpclient +
-- NetworkMgr + UIManager.looper at require-time and aren't unit-testable;
-- they're covered by the manual matrix. These specs lock down the bits we
-- CAN exercise in isolation: the cloud fileKey / local-filename builders
-- that the UI tier depends on.

require("spec_helper")

describe("library.syncbooks", function()
    local syncbooks

    before_each(function()
        package.loaded["library.syncbooks"] = nil
        syncbooks = require("library.syncbooks")
    end)

    -- =====================================================================
    -- build_file_key — cloud download fileKey for a book file
    -- =====================================================================
    describe("build_file_key", function()
        it("returns the canonical {user_id}/Readest/Books/{hash}/{hash}.{ext} shape", function()
            local key = syncbooks.build_file_key({
                user_id = "u-alice",
                hash = "abc123",
                format = "EPUB",
            })
            assert.are.equal("u-alice/Readest/Books/abc123/abc123.epub", key)
        end)

        it("derives extension from format via library.exts", function()
            local cases = {
                EPUB = "epub", PDF = "pdf", MOBI = "mobi", AZW3 = "azw3",
                CBZ = "cbz", FB2 = "fb2", TXT = "txt", MD = "md",
            }
            for fmt, ext in pairs(cases) do
                local key = syncbooks.build_file_key({
                    user_id = "u",
                    hash    = "h",
                    format  = fmt,
                })
                assert.are.equal("u/Readest/Books/h/h." .. ext, key,
                    "wrong key for format " .. fmt)
            end
        end)

        it("returns nil for an unknown format (caller decides what to do)", function()
            local key = syncbooks.build_file_key({
                user_id = "u",
                hash    = "h",
                format  = "ROT13",
            })
            assert.is_nil(key)
        end)

        it("returns nil when user_id is missing or empty", function()
            assert.is_nil(syncbooks.build_file_key({ hash = "h", format = "EPUB" }))
            assert.is_nil(syncbooks.build_file_key({ user_id = "", hash = "h", format = "EPUB" }))
        end)

        it("returns nil when hash is missing or empty", function()
            assert.is_nil(syncbooks.build_file_key({ user_id = "u", format = "EPUB" }))
            assert.is_nil(syncbooks.build_file_key({ user_id = "u", hash = "", format = "EPUB" }))
        end)
    end)

    -- =====================================================================
    -- build_cover_key — cloud download fileKey for a cover image
    -- =====================================================================
    describe("build_cover_key", function()
        it("returns {user_id}/Readest/Books/{hash}/cover.png — same on R2 and S3", function()
            local key = syncbooks.build_cover_key({ user_id = "u-bob", hash = "deadbeef" })
            assert.are.equal("u-bob/Readest/Books/deadbeef/cover.png", key)
        end)

        it("returns nil with missing user_id or hash", function()
            assert.is_nil(syncbooks.build_cover_key({ hash = "h" }))
            assert.is_nil(syncbooks.build_cover_key({ user_id = "u" }))
            assert.is_nil(syncbooks.build_cover_key({ user_id = "", hash = "h" }))
            assert.is_nil(syncbooks.build_cover_key({ user_id = "u", hash = "" }))
        end)
    end)

    -- =====================================================================
    -- build_local_filename — what we save the cloud download as on disk
    -- =====================================================================
    -- Per design doc: local layout is FLAT (KOReader users prefer flat
    -- dirs). Filename derived from source_title || title, sanitized for
    -- filesystem-illegal chars. No JS-parity port required.
    describe("build_local_filename", function()
        it("uses source_title when present, else title", function()
            assert.are.equal("Foundation.epub", syncbooks.build_local_filename({
                title = "anything", source_title = "Foundation", format = "EPUB",
            }))
            assert.are.equal("Dune.pdf", syncbooks.build_local_filename({
                title = "Dune", format = "PDF",
            }))
        end)

        it("replaces filesystem-illegal chars with _ (FAT/NTFS-safe)", function()
            assert.are.equal("Sci-Fi_Classics_Foundation.epub", syncbooks.build_local_filename({
                title = "Sci-Fi/Classics/Foundation", format = "EPUB",
            }))
            assert.are.equal("Title_with_pipe_and_quote.epub", syncbooks.build_local_filename({
                title = 'Title|with|pipe"and"quote', format = "EPUB",
            }))
        end)

        it("strips control characters", function()
            assert.are.equal("Foo_Bar.epub", syncbooks.build_local_filename({
                title = "Foo\1Bar", format = "EPUB",
            }))
        end)

        it("clamps long names (no Lua-side surprise on 1KB titles)", function()
            local long = string.rep("a", 500)
            local out = syncbooks.build_local_filename({ title = long, format = "EPUB" })
            -- 200 byte body + ".epub" extension = 205 max
            assert.is_true(#out <= 205, "filename too long: " .. #out)
            assert.is_true(out:match("%.epub$") ~= nil, "extension lost")
        end)

        it("preserves UTF-8 (CJK + emoji) without mangling code points", function()
            local out = syncbooks.build_local_filename({
                title = "三体 — 第一部 📖", format = "EPUB",
            })
            -- Em dash is allowed; CJK + emoji preserved verbatim.
            assert.is_true(out:match("三体") ~= nil)
            assert.is_true(out:match("📖") ~= nil)
            assert.is_true(out:match("%.epub$") ~= nil)
        end)

        it("returns 'book.{ext}' when title is empty/missing", function()
            assert.are.equal("book.epub", syncbooks.build_local_filename({ format = "EPUB" }))
            assert.are.equal("book.epub", syncbooks.build_local_filename({ title = "", format = "EPUB" }))
        end)

        it("returns nil for unknown format (matches build_file_key behavior)", function()
            assert.is_nil(syncbooks.build_local_filename({ title = "X", format = "ROT13" }))
        end)
    end)

    -- =====================================================================
    -- _row_to_wire — converts our snake_case store row to the camelCase
    -- Book the server expects on POST /sync. Locks the field mapping
    -- against drift from transformBookToDB at
    -- apps/readest-app/src/utils/transform.ts:66-105.
    -- =====================================================================
    describe("_row_to_wire", function()
        it("maps snake_case row fields to camelCase wire fields", function()
            local out = syncbooks._row_to_wire({
                hash         = "h1",
                meta_hash    = "m1",
                format       = "EPUB",
                title        = "Foundation",
                source_title = "Foundation (Original)",
                author       = "Asimov",
                group_id     = "gid1",
                group_name   = "Sci-Fi",
                reading_status = "reading",
                created_at   = 1700000000000,
                updated_at   = 1770000000000,
                deleted_at   = nil,
                uploaded_at  = 1750000000000,
            })
            assert.are.equal("h1",         out.bookHash)
            assert.are.equal("h1",         out.hash)
            assert.are.equal("m1",         out.metaHash)
            assert.are.equal("EPUB",       out.format)
            assert.are.equal("Foundation", out.title)
            assert.are.equal("Foundation (Original)", out.sourceTitle)
            assert.are.equal("Asimov",     out.author)
            assert.are.equal("gid1",       out.groupId)
            assert.are.equal("Sci-Fi",     out.groupName)
            assert.are.equal("reading",    out.readingStatus)
            assert.are.equal(1700000000000, out.createdAt)
            assert.are.equal(1770000000000, out.updatedAt)
            assert.is_nil(out.deletedAt)
            assert.are.equal(1750000000000, out.uploadedAt)
        end)

        it("parses metadata_json back to a table for the server", function()
            local out = syncbooks._row_to_wire({
                hash = "h1", title = "T",
                metadata_json = '{"series":"Foundation","seriesIndex":1}',
            })
            assert.is_table(out.metadata)
            assert.are.equal("Foundation", out.metadata.series)
            assert.are.equal(1, out.metadata.seriesIndex)
        end)

        it("parses progress_lib back to a [cur, total] tuple", function()
            local out = syncbooks._row_to_wire({
                hash = "h1", title = "T",
                progress_lib = "[42,250]",
            })
            assert.is_table(out.progress)
            assert.are.equal(42,  out.progress[1])
            assert.are.equal(250, out.progress[2])
        end)

        it("survives missing/malformed metadata + progress without crashing", function()
            local out = syncbooks._row_to_wire({
                hash = "h1", title = "T",
                metadata_json = "{not valid json",
                progress_lib  = "garbage",
            })
            assert.is_nil(out.metadata)
            assert.is_nil(out.progress)
        end)

        it("returns nil for nil input (defensive)", function()
            assert.is_nil(syncbooks._row_to_wire(nil))
        end)
    end)

    -- =====================================================================
    -- resolve_collision — bumps {name}.ext → {name} (1).ext on collision
    -- =====================================================================
    -- Pure helper; takes a list of existing filenames + a candidate, returns
    -- a non-colliding name. Real downloadBook calls lfs.attributes; this
    -- helper takes a "does it exist" predicate so we can test it.
    describe("resolve_collision", function()
        it("returns the input when nothing collides", function()
            local out = syncbooks.resolve_collision("Dune.epub", function() return false end)
            assert.are.equal("Dune.epub", out)
        end)

        it("appends (1) on first collision", function()
            local existing = { ["Dune.epub"] = true }
            local out = syncbooks.resolve_collision("Dune.epub",
                function(name) return existing[name] == true end)
            assert.are.equal("Dune (1).epub", out)
        end)

        it("walks (1)..(N) until a free slot is found", function()
            local existing = {}
            existing["Dune.epub"]     = true
            existing["Dune (1).epub"] = true
            existing["Dune (2).epub"] = true
            local out = syncbooks.resolve_collision("Dune.epub",
                function(name) return existing[name] == true end)
            assert.are.equal("Dune (3).epub", out)
        end)

        it("handles names without an extension", function()
            local out = syncbooks.resolve_collision("README",
                function(name) return name == "README" end)
            assert.are.equal("README (1)", out)
        end)
    end)
end)
