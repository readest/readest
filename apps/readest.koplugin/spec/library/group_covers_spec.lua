-- group_covers_spec.lua
-- Pure-function tests for library/group_covers.lua. The Blitbuffer-driven
-- compose() pipeline calls into KOReader's FFI graphics stack and isn't
-- unit-testable here, so it's exercised by the manual matrix. These specs
-- lock down:
--   * URI builder/parser round-trip (incl. nested group paths with "/")
--   * child_cover_bb's cover-missing branch — must queue a cloud-cover
--     download for cloud-present children so a subsequent paint can
--     compose the mosaic. Without this hook, a freshly-pulled library
--     renders every group as FakeCover until the user drills into each
--     group individually (see https://github.com/readest/readest/… for
--     the bug report).

require("spec_helper")
local lfs = require("lfs")

-- Minimal real-lfs shim for production code that imports
-- "libs/libkoreader-lfs". The KOReader binding extends LuaFileSystem with
-- a few extras we don't need here.
package.preload["libs/libkoreader-lfs"] = function() return lfs end

-- Stub renderimage so cloud_covers.load_cover_bb can be exercised without
-- pulling in the full KOReader graphics stack. We always return nil
-- (= "couldn't decode") so the trigger-download branch is reachable.
package.preload["ui/renderimage"] = function()
    return {
        renderImageFile = function() return nil end,
    }
end

describe("library.group_covers", function()
    local group_covers, cloud_covers

    before_each(function()
        require("spec_helper").reset()
        package.loaded["library.cloud_covers"] = nil
        package.loaded["library.group_covers"] = nil
        cloud_covers = require("library.cloud_covers")
        group_covers = require("library.group_covers")
    end)

    -- =====================================================================
    -- build_uri / parse_uri round-trip
    -- =====================================================================
    describe("build_uri / parse_uri", function()
        it("round-trips a simple group name", function()
            local uri = group_covers.build_uri("group_name", "Fantasy", "grid")
            local g, v, s = group_covers.parse_uri(uri)
            assert.are.equal("group_name", g)
            assert.are.equal("Fantasy", v)
            assert.are.equal("grid", s)
        end)

        it("preserves slashes inside nested group paths", function()
            local uri = group_covers.build_uri("group_name", "Selected/Very", "grid")
            local g, v, s = group_covers.parse_uri(uri)
            assert.are.equal("group_name", g)
            assert.are.equal("Selected/Very", v)
            assert.are.equal("grid", s)
        end)

        it("defaults to grid shape when none is given", function()
            local uri = group_covers.build_uri("author", "Asimov")
            local _, _, s = group_covers.parse_uri(uri)
            assert.are.equal("grid", s)
        end)

        it("returns nil for non-group URIs", function()
            assert.is_nil(group_covers.parse_uri("/local/path/file.epub"))
            assert.is_nil(group_covers.parse_uri("readest-cloud://abc.epub"))
        end)
    end)

    -- =====================================================================
    -- cells_for: layout cell count
    -- =====================================================================
    describe("cells_for", function()
        it("returns 4 for both grid and list shapes", function()
            assert.are.equal(4, group_covers.cells_for("grid"))
            assert.are.equal(4, group_covers.cells_for("list"))
        end)

        it("falls back to grid (4) for unknown shapes", function()
            assert.are.equal(4, group_covers.cells_for("nonsense"))
        end)
    end)

    -- =====================================================================
    -- child_cover_bb: cloud-cover trigger when cover .png is missing
    -- =====================================================================
    describe("child_cover_bb missing-cover behaviour", function()
        local trigger_calls

        before_each(function()
            -- Auth must be present for trigger_download to even consider
            -- the call; otherwise it bails early (intentional safety net
            -- in production).
            cloud_covers.set_opts({ sync_auth = "fake-token" })

            -- Record trigger calls and short-circuit so we never actually
            -- hit the network or try to dequeue.
            trigger_calls = {}
            cloud_covers.trigger_download = function(hash, opts)
                trigger_calls[#trigger_calls + 1] = { hash = hash, opts = opts }
            end
        end)

        it("queues a cloud-cover download for a cloud-only child whose .png isn't on disk", function()
            local cover = group_covers.child_cover_bb(
                { hash = "abc12345", cloud_present = 1, local_present = 0 },
                nil, nil)
            assert.is_nil(cover)
            assert.are.equal(1, #trigger_calls)
            assert.are.equal("abc12345", trigger_calls[1].hash)
        end)

        it("queues a download for a hybrid (cloud + local) book when its cover isn't extracted yet", function()
            -- BIM hasn't seen this file yet — orig_getBookInfo returns nil.
            local orig_getBookInfo = function() return nil end
            local cover = group_covers.child_cover_bb(
                {
                    hash = "hybrid01",
                    cloud_present = 1,
                    local_present = 1,
                    file_path = "/no/such/file.epub",
                },
                orig_getBookInfo, {})
            assert.is_nil(cover)
            assert.are.equal(1, #trigger_calls)
            assert.are.equal("hybrid01", trigger_calls[1].hash)
        end)

        it("does not queue a download for a local-only child (nothing to fetch)", function()
            local orig_getBookInfo = function() return nil end
            local cover = group_covers.child_cover_bb(
                {
                    hash = "local001",
                    cloud_present = 0,
                    local_present = 1,
                    file_path = "/no/such/file.epub",
                },
                orig_getBookInfo, {})
            assert.is_nil(cover)
            assert.are.equal(0, #trigger_calls)
        end)

        it("does not queue a download when the child has no hash (defensive)", function()
            local cover = group_covers.child_cover_bb(
                { cloud_present = 1, local_present = 0 }, nil, nil)
            assert.is_nil(cover)
            assert.are.equal(0, #trigger_calls)
        end)
    end)
end)

-- =====================================================================
-- libraryitem.set_visible_hashes — group children expansion
-- =====================================================================
-- The patched BIM only triggers child cover downloads when the child's
-- hash is in cloud_covers' visibility set. Without expanding visible
-- groups → first-N children, trigger_download in child_cover_bb is a
-- no-op and the mosaic never composes. These tests pin that contract.
describe("library.libraryitem.set_visible_hashes", function()
    local libraryitem, cloud_covers
    local fake_widget

    before_each(function()
        require("spec_helper").reset()
        package.loaded["library.cloud_covers"] = nil
        package.loaded["library.group_covers"] = nil
        package.loaded["library.bim_patch"]    = nil
        package.loaded["library.cloud_icons"]  = nil
        package.loaded["library.list_strip"]   = nil
        package.loaded["library.libraryitem"]  = nil
        package.loaded["library.librarywidget"] = nil

        -- Fake LibraryWidget so libraryitem can pick up the store.
        -- libraryitem reads package.loaded directly (not require), so a
        -- preload won't suffice — populate the loaded slot itself.
        fake_widget = { _store = nil }
        package.loaded["library.librarywidget"] = fake_widget

        cloud_covers = require("library.cloud_covers")
        libraryitem  = require("library.libraryitem")
    end)

    after_each(function()
        package.loaded["library.librarywidget"] = nil
    end)

    -- Capture whatever set libraryitem hands cloud_covers, regardless of
    -- whether trigger_download itself is exercised.
    local function capture_set()
        local captured
        cloud_covers.set_visible_hashes = function(set) captured = set end
        return function() return captured end
    end

    -- Minimal store stub: returns the books we tell it to, keyed by
    -- (group_by, name). listBooksInGroup is the only method the wrapper
    -- calls.
    local function fake_store(by_group)
        return {
            listBooksInGroup = function(_self, group_by, name, _n, _opts)
                local key = group_by .. ":" .. name
                return by_group[key] or {}
            end,
        }
    end

    it("clears the visibility set when called with nil menu", function()
        local get = capture_set()
        libraryitem.set_visible_hashes(nil)
        assert.is_nil(get())
    end)

    it("includes hashes for cloud-only book entries on the visible page", function()
        local get = capture_set()
        local menu = {
            page = 1, perpage = 3,
            item_table = {
                { [libraryitem.CLOUD_ONLY_FLAG] = true, file = "readest-cloud://aaa.epub" },
                { [libraryitem.CLOUD_ONLY_FLAG] = true, file = "readest-cloud://bbb.epub" },
                -- a local book — should NOT contribute
                { is_file = true, file = "/local/book.epub" },
            },
        }
        libraryitem.set_visible_hashes(menu)
        local set = get()
        assert.is_truthy(set["aaa"])
        assert.is_truthy(set["bbb"])
        local n = 0
        for _ in pairs(set) do n = n + 1 end
        assert.are.equal(2, n)
    end)

    it("expands visible group entries to include their first-N children's hashes", function()
        local get = capture_set()
        fake_widget._store = fake_store({
            ["group_name:Selected/Very"] = {
                { hash = "child01" }, { hash = "child02" },
                { hash = "child03" }, { hash = "child04" },
            },
            ["group_name:Selected/Philosophy"] = {
                { hash = "phil01" }, { hash = "phil02" },
            },
        })
        local menu = {
            page = 1, perpage = 3,
            item_table = {
                {
                    _readest_group = {
                        name = "Selected/Very",
                        _group_by = "group_name",
                    },
                },
                {
                    _readest_group = {
                        name = "Selected/Philosophy",
                        _group_by = "group_name",
                    },
                },
                -- A book entry on the same page
                { [libraryitem.CLOUD_ONLY_FLAG] = true, file = "readest-cloud://book01.epub" },
            },
        }
        libraryitem.set_visible_hashes(menu)
        local set = get()
        -- Group children
        assert.is_truthy(set["child01"])
        assert.is_truthy(set["child04"])
        assert.is_truthy(set["phil01"])
        assert.is_truthy(set["phil02"])
        -- Cloud-only book on the same page
        assert.is_truthy(set["book01"])
    end)

    it("only walks the current page's window, not the full item_table", function()
        local get = capture_set()
        fake_widget._store = fake_store({
            ["group_name:OnPage1"] = { { hash = "child01" } },
            ["group_name:OnPage2"] = { { hash = "child99" } },
        })
        local menu = {
            page = 2, perpage = 1,
            item_table = {
                { _readest_group = { name = "OnPage1", _group_by = "group_name" } },
                { _readest_group = { name = "OnPage2", _group_by = "group_name" } },
            },
        }
        libraryitem.set_visible_hashes(menu)
        local set = get()
        assert.is_nil(set["child01"])
        assert.is_truthy(set["child99"])
    end)
end)
