-- main_close_spec.lua
-- Tests for ReadestSync:onCloseDocument + pushOpenBook (issue #5006).
-- Closing a book must persist THIS book's progress/notes/stats and push only
-- the open book's library row. It must NOT trigger a full library pull, whose
-- ~3s blocking round-trip froze the UI on every book close.

require("spec_helper")
local stubs = require("spec.koreader_stubs")

local ReadestSync = require("main")

-- Stand in for library.syncbooks. main.lua require()s it lazily inside the
-- push path, so seeding package.loaded is enough to intercept.
local function fakeSyncbooks(pushes, result)
    return {
        pushBook = function(row, opts, cb)
            table.insert(pushes, { row = row, opts = opts })
            if cb then cb(result.success, result.msg, result.status) end
        end,
    }
end

describe("ReadestSync:onCloseDocument", function()
    before_each(function() stubs.reset() end)

    -- Bare instance: records which sync methods the close path dispatches.
    local function makePlugin(opts)
        local plugin = setmetatable({
            settings = {
                auto_sync = opts.auto_sync,
                access_token = opts.access_token,
                user_id = "u1",
            },
            calls = {},
        }, { __index = ReadestSync })
        for _, method in ipairs({ "pushBookConfig", "pushBookNotes",
                "pushBookStats", "pushOpenBook", "syncBooksLibrary" }) do
            plugin[method] = function(self, arg1)
                table.insert(self.calls, { method = method, arg1 = arg1 })
            end
        end
        return plugin
    end

    local function called(plugin)
        local by = {}
        for _, c in ipairs(plugin.calls) do by[c.method] = c end
        return by
    end

    it("pushes config, notes, stats and the open book row (no library pull)", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok" })
        plugin:onCloseDocument()

        local by = called(plugin)
        assert.truthy(by.pushBookConfig)
        assert.truthy(by.pushBookNotes)
        assert.truthy(by.pushBookStats)
        assert.truthy(by.pushOpenBook)
        assert.is_false(by.pushOpenBook.arg1)  -- non-interactive
        -- The heavy full-library pull ("both") must be gone from the close path.
        assert.is_nil(by.syncBooksLibrary)
    end)

    it("does nothing when auto sync is disabled", function()
        local plugin = makePlugin({ auto_sync = false, access_token = "tok" })
        plugin:onCloseDocument()
        assert.are.equal(0, #plugin.calls)
    end)

    it("does nothing when signed out", function()
        local plugin = makePlugin({ auto_sync = true, access_token = nil })
        plugin:onCloseDocument()
        assert.are.equal(0, #plugin.calls)
    end)
end)

describe("ReadestSync:pushOpenBook", function()
    before_each(function() stubs.reset() end)

    local function makePlugin(opts)
        return setmetatable({
            path = "/plugins/readest.koplugin",
            settings = {
                access_token = opts.access_token,
                user_id = opts.user_id == nil and "u1" or opts.user_id,
            },
        }, { __index = ReadestSync })
    end

    it("pushes only the open book's row via the targeted pushBook (no pull)", function()
        local pushes = {}
        package.loaded["library.syncbooks"] = fakeSyncbooks(pushes, { success = true })
        finally(function() package.loaded["library.syncbooks"] = nil end)

        local plugin = makePlugin({ access_token = "tok" })
        local row = { hash = "h1", title = "T", uploaded_at = 123, updated_at = 456 }
        plugin.touchOpenBook = function() return row end

        plugin:pushOpenBook(false)

        assert.are.equal(1, #pushes)
        assert.are.equal(row, pushes[1].row)
    end)

    it("does nothing when the open book has no library row", function()
        local pushes = {}
        package.loaded["library.syncbooks"] = fakeSyncbooks(pushes, { success = true })
        finally(function() package.loaded["library.syncbooks"] = nil end)

        local plugin = makePlugin({ access_token = "tok" })
        plugin.touchOpenBook = function() return nil end

        plugin:pushOpenBook(false)
        assert.are.equal(0, #pushes)
    end)

    it("does nothing when signed out", function()
        local pushes = {}
        package.loaded["library.syncbooks"] = fakeSyncbooks(pushes, { success = true })
        finally(function() package.loaded["library.syncbooks"] = nil end)

        local plugin = makePlugin({ access_token = nil })
        plugin.touchOpenBook = function() error("should not be reached") end

        plugin:pushOpenBook(false)
        assert.are.equal(0, #pushes)
    end)
end)
