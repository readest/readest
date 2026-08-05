-- main_addtoreadest_spec.lua
-- Tests for ReadestSync:addToReadest's meta_hash stamping. "Add to Readest"
-- from FileManager introduces a book to the fleet without opening it, so the
-- only metadata available is a sidecar left by a previous KOReader read. When
-- one exists, the row must carry the same fingerprint Readest's importBook
-- would stamp (metadata hash, PDF-salted with the base filename — #5411);
-- when none exists, meta_hash stays unset and Readest stamps it on first
-- open.

require("spec_helper")
local stubs = require("spec.koreader_stubs")

local ReadestSync = require("main")
local sha2 = require("ffi/sha2")

local function fakeStore()
    return {
        rows    = {},
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

local function makePlugin(store)
    local plugin = setmetatable({
        path = "/plugins/readest.koplugin",
        settings = { access_token = "tok", user_id = "u1" },
        ui = {},
    }, { __index = ReadestSync })
    plugin.getLibraryStore = function() return store end
    return plugin
end

-- A real on-disk file: addToReadest stats it via lfs before hashing.
local function makeTempPdf(name)
    local dir = os.getenv("TMPDIR") or "/tmp"
    local path = dir:gsub("/$", "") .. "/" .. name
    local f = assert(io.open(path, "w"))
    f:write("%PDF-1.4 stub")
    f:close()
    return path
end

local function fakeDocSettings(sidecars)
    return {
        hasSidecarFile = function(_, file) return sidecars[file] ~= nil end,
        open = function(_, file)
            return {
                readSetting = function(_, k)
                    if k == "doc_props" then return sidecars[file] end
                end,
            }
        end,
    }
end

describe("ReadestSync:addToReadest", function()
    local pdf_path

    before_each(function()
        stubs.reset()
        pdf_path = makeTempPdf("lecture-01.pdf")
    end)

    after_each(function()
        package.loaded["docsettings"] = nil
        os.remove(pdf_path)
    end)

    it("stamps meta_hash from the sidecar when the book was read before", function()
        package.loaded["docsettings"] = fakeDocSettings({
            [pdf_path] = { title = "PowerPoint Presentation", authors = "Alice Author" },
        })
        local store = fakeStore()
        local plugin = makePlugin(store)

        plugin:addToReadest(pdf_path)
        stubs.UIManager:drain() -- hashing runs on the next tick

        assert.are.equal(1, #store.upserts)
        assert.are.equal(sha2.md5("PowerPoint Presentation|Alice Author||lecture-01"),
            store.upserts[1].meta_hash)
    end)

    it("leaves meta_hash unset when the book has no sidecar", function()
        package.loaded["docsettings"] = fakeDocSettings({})
        local store = fakeStore()
        local plugin = makePlugin(store)

        plugin:addToReadest(pdf_path)
        stubs.UIManager:drain()

        assert.are.equal(1, #store.upserts)
        assert.is_nil(store.upserts[1].meta_hash)
    end)
end)
