-- main_open_spec.lua
-- Tests for ReadestSync:onReaderReady (open path, issue #5006). Opening a book
-- pulls its config/notes/stats, but that pull must be DEFERRED and CANCELLABLE:
-- the reader has to paint and become interactive first, and rapidly switching
-- between books must not stack blocking round-trips on the UI thread — a
-- pending open pull is dropped when the book closes before it fires.

require("spec_helper")
local stubs = require("spec.koreader_stubs")

local UIManagerStub = stubs.UIManager
local ReadestSync = require("main")

local function makePlugin(opts)
    local plugin = setmetatable({
        settings = {
            auto_sync = opts.auto_sync,
            access_token = opts.access_token,
        },
        pull_calls = {},
    }, { __index = ReadestSync })
    for _, method in ipairs({ "pullBookConfig", "pullBookNotes", "pullBookStats" }) do
        plugin[method] = function(self, interactive)
            table.insert(self.pull_calls, { method = method, interactive = interactive })
        end
    end
    return plugin
end

describe("ReadestSync:onReaderReady", function()
    before_each(function() stubs.reset() end)

    it("defers the open pull (reader paints first) then pulls config/notes/stats", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok" })

        plugin:onReaderReady()

        assert.are.equal(1, #UIManagerStub._scheduled)
        -- Deferred, not immediate: the reader must be interactive before the
        -- blocking pull runs.
        assert.is_true(UIManagerStub._scheduled[1].delay > 0)
        assert.are.equal(0, #plugin.pull_calls)

        UIManagerStub._scheduled[1].fn()
        assert.are.equal(3, #plugin.pull_calls)
        local pulled = {}
        for _, c in ipairs(plugin.pull_calls) do
            pulled[c.method] = true
            assert.is_false(c.interactive)
        end
        assert.is_true(pulled.pullBookConfig)
        assert.is_true(pulled.pullBookNotes)
        assert.is_true(pulled.pullBookStats)
    end)

    it("cancels a pending open pull when the book closes (rapid switching)", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok" })

        plugin:onReaderReady()
        assert.are.equal(1, #UIManagerStub._scheduled)

        plugin:onCloseWidget()
        assert.are.equal(0, #UIManagerStub._scheduled)
    end)

    it("does not stack duplicate pulls when onReaderReady fires twice", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok" })

        plugin:onReaderReady()
        plugin:onReaderReady()
        assert.are.equal(1, #UIManagerStub._scheduled)
    end)

    it("does nothing when auto sync is disabled", function()
        local plugin = makePlugin({ auto_sync = false, access_token = "tok" })
        plugin:onReaderReady()
        assert.are.equal(0, #UIManagerStub._scheduled)
    end)

    it("does nothing when signed out", function()
        local plugin = makePlugin({ auto_sync = true, access_token = nil })
        plugin:onReaderReady()
        assert.are.equal(0, #UIManagerStub._scheduled)
    end)
end)
