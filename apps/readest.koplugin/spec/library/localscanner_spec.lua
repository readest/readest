-- localscanner_spec.lua
-- Unit-tests the pure helpers in library/localscanner.lua.
--
-- Out of scope: lightScan() and fullSidecarWalk() require live KOReader
-- modules (ReadHistory, DocSettings, FFIUtil.runInSubProcess); they're
-- exercised manually via the test matrix in docs/library-design.md.

require("spec_helper")
local lfs = require("lfs")

describe("library.localscanner", function()
    local localscanner, datastorage

    before_each(function()
        require("spec_helper").reset()
        package.loaded["library.localscanner"] = nil
        localscanner = require("library.localscanner")
        datastorage = require("datastorage")
    end)

    -- =====================================================================
    -- sidecar_to_book_path: { "/foo/bar.sdr/metadata.epub.lua" → "/foo/bar.epub" }
    -- =====================================================================
    describe("sidecar_to_book_path", function()
        it("strips .sdr/metadata.<ext>.lua and re-appends .ext to the parent", function()
            assert.are.equal("/foo/bar.epub",
                localscanner.sidecar_to_book_path("/foo/bar.sdr/metadata.epub.lua"))
            assert.are.equal("/books/Asimov - Foundation.pdf",
                localscanner.sidecar_to_book_path(
                    "/books/Asimov - Foundation.sdr/metadata.pdf.lua"))
            assert.are.equal("/h/Dune.fb2",
                localscanner.sidecar_to_book_path("/h/Dune.sdr/metadata.fb2.lua"))
        end)

        it("preserves multi-dot book names", function()
            assert.are.equal("/x/Foo. Vol. 1.epub",
                localscanner.sidecar_to_book_path("/x/Foo. Vol. 1.sdr/metadata.epub.lua"))
        end)

        it("returns nil for paths that aren't sidecar metadata", function()
            assert.is_nil(localscanner.sidecar_to_book_path("/foo/bar.epub"))
            assert.is_nil(localscanner.sidecar_to_book_path("/foo/bar.sdr/cover.png"))
            assert.is_nil(localscanner.sidecar_to_book_path("/foo/random.lua"))
            assert.is_nil(localscanner.sidecar_to_book_path(""))
            assert.is_nil(localscanner.sidecar_to_book_path(nil))
        end)
    end)

    -- =====================================================================
    -- parse_sidecar: load a sidecar Lua file, extract partial_md5_checksum
    --                + a few meta fields. Defensive against bad input.
    -- =====================================================================
    describe("parse_sidecar", function()
        local function write(path, text)
            local f = assert(io.open(path, "w"))
            f:write(text)
            f:close()
        end

        it("extracts partial_md5_checksum from a well-formed sidecar", function()
            local sdir = datastorage:getSettingsDir() .. "/Foundation.sdr"
            assert(lfs.mkdir(sdir))
            local spath = sdir .. "/metadata.epub.lua"
            write(spath, [[
                return {
                    ["partial_md5_checksum"] = "abc123def456",
                    ["doc_props"] = {
                        ["title"]   = "Foundation",
                        ["authors"] = "Isaac Asimov",
                    },
                    ["page"] = 42,
                }
            ]])
            local out = localscanner.parse_sidecar(spath)
            assert.are.equal("abc123def456", out.hash)
            assert.are.equal("Foundation", out.title)
            assert.are.equal("Isaac Asimov", out.author)
            -- book_path computed from sidecar location
            assert.are.equal(sdir:gsub("%.sdr$", ".epub"), out.file_path)
        end)

        it("returns nil for a sidecar without partial_md5_checksum", function()
            local sdir = datastorage:getSettingsDir() .. "/Untracked.sdr"
            assert(lfs.mkdir(sdir))
            local spath = sdir .. "/metadata.epub.lua"
            write(spath, "return { doc_props = { title = 'X' }, page = 1 }")
            assert.is_nil(localscanner.parse_sidecar(spath))
        end)

        it("returns nil for a malformed Lua file", function()
            local sdir = datastorage:getSettingsDir() .. "/Bad.sdr"
            assert(lfs.mkdir(sdir))
            local spath = sdir .. "/metadata.epub.lua"
            write(spath, "return {  -- unclosed table")
            assert.is_nil(localscanner.parse_sidecar(spath))
        end)

        it("returns nil when the file does not exist", function()
            assert.is_nil(localscanner.parse_sidecar(
                datastorage:getSettingsDir() .. "/Missing.sdr/metadata.epub.lua"))
        end)

        it("survives a sidecar that returns a non-table", function()
            local sdir = datastorage:getSettingsDir() .. "/Weird.sdr"
            assert(lfs.mkdir(sdir))
            local spath = sdir .. "/metadata.epub.lua"
            write(spath, "return 'string instead of table'")
            assert.is_nil(localscanner.parse_sidecar(spath))
        end)

        it("survives a sidecar that errors at load (e.g. forbidden global)", function()
            local sdir = datastorage:getSettingsDir() .. "/Throws.sdr"
            assert(lfs.mkdir(sdir))
            local spath = sdir .. "/metadata.epub.lua"
            write(spath, "error('boom'); return {}")
            assert.is_nil(localscanner.parse_sidecar(spath))
        end)
    end)

    -- =====================================================================
    -- should_skip_dir: predicate for the recursive walk
    -- =====================================================================
    describe("should_skip_dir", function()
        it("skips system / VCS / IDE dirs", function()
            assert.is_true(localscanner.should_skip_dir(".git"))
            assert.is_true(localscanner.should_skip_dir(".svn"))
            assert.is_true(localscanner.should_skip_dir("node_modules"))
            assert.is_true(localscanner.should_skip_dir(".Trash"))
            assert.is_true(localscanner.should_skip_dir("$RECYCLE.BIN"))
            assert.is_true(localscanner.should_skip_dir(".adobe-digital-editions"))
        end)

        it("skips macOS metadata dirs", function()
            assert.is_true(localscanner.should_skip_dir(".Spotlight-V100"))
            assert.is_true(localscanner.should_skip_dir(".fseventsd"))
        end)

        it("does NOT skip '.' / '..' (caller handles those)", function()
            assert.is_false(localscanner.should_skip_dir("."))
            assert.is_false(localscanner.should_skip_dir(".."))
        end)

        it("does NOT skip ordinary book directories", function()
            assert.is_false(localscanner.should_skip_dir("Books"))
            assert.is_false(localscanner.should_skip_dir("Sci-Fi"))
            assert.is_false(localscanner.should_skip_dir("Foo.sdr"))  -- the walk visits these
        end)
    end)
end)
