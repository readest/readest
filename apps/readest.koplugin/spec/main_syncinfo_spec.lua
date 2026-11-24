local helper = require("spec_helper")
local stubs = require("spec.koreader_stubs")
local ReadestSync = require("main")

-- KOReader's KOSync "File name" checksum hashes the open document's file
-- name, so Sync Info shows it next to the one Readest hashes (#7864).
describe("Sync Info", function()
    before_each(function()
        helper.reset()
        stubs.reset()
    end)

    local function showSyncInfo(file)
        local doc_settings = {
            doc_props = { title = "Good Omens", authors = "Terry Pratchett\nNeil Gaiman" },
            doc_path = file,
        }
        local plugin = setmetatable({
            ui = {
                document = { file = file },
                doc_settings = {
                    readSetting = function(_, key) return doc_settings[key] end,
                },
            },
        }, { __index = ReadestSync })
        plugin:showSyncInfo()
        return stubs.UIManager._shown[#stubs.UIManager._shown].kv_pairs
    end

    local function value(kv_pairs, key)
        for _, pair in ipairs(kv_pairs) do
            if pair[1] == key then return pair[2] end
        end
        return "<no " .. key .. " row>"
    end

    it("shows the file name KOSync hashes", function()
        local kv_pairs = showSyncInfo("/mnt/us/books/Terry Pratchett, Neil Gaiman - Good Omens.epub")
        assert.are.equal("Terry Pratchett, Neil Gaiman - Good Omens.epub", value(kv_pairs, "File Name"))
    end)
end)
