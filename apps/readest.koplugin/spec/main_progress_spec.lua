require("spec_helper")
local stubs = require("spec.koreader_stubs")
local Plugin = require("main")
local Config = require("readest_syncconfig")

describe("Reader progress scheduling", function()
    local original_time, original_push, now, pushes, plugin, result
    before_each(function()
        stubs.reset()
        original_time, original_push = os.time, Config.push
        now, pushes, result = 1000, 0, true
        os.time = function() return now end
        Config.push = function(_, _, _, _, _, stamp, cb)
            pushes = pushes + 1
            cb(result)
            return now
        end
        plugin = setmetatable({
            last_sync_timestamp = 990,
            settings = { auto_sync = true, access_token = "token" },
            ui = { document = {} },
            ensureClient = function() return {} end,
            getBookIdentifiers = function() return "book", "meta" end,
        }, { __index = Plugin })
    end)
    after_each(function() os.time, Config.push = original_time, original_push end)
    it("schedules the final page instead of dropping it during debounce", function()
        plugin:pushBookConfig(false)
        assert.are.equal(0, pushes)
        assert.are.equal(21, stubs.UIManager._scheduled[1].delay)
        now = 1021
        stubs.UIManager:drain()
        assert.are.equal(1, pushes)
    end)
    it("pushes closing progress even inside the debounce window", function()
        plugin:pushBookConfig(false, true)
        assert.are.equal(1, pushes)
    end)
    it("recovers from a clock moving backward", function()
        plugin.last_sync_timestamp = 2000
        plugin:pushBookConfig(false)
        assert.are.equal(1, pushes)
    end)
    it("retries a failed automatic push once without being discarded by debounce", function()
        result = false
        plugin.last_sync_timestamp = 0
        plugin:pushBookConfig(false)
        assert.are.equal(1, pushes)
        assert.are.equal(1, #stubs.UIManager._scheduled)
        now = now + 15
        stubs.UIManager:drain()
        assert.are.equal(2, pushes)
        assert.are.equal(0, #stubs.UIManager._scheduled)
        assert.is_true(plugin.progress_pending)
    end)
    it("retries pending progress when networking reconnects", function()
        plugin.progress_pending = true
        plugin.last_sync_timestamp = 0
        plugin:onNetworkConnected()
        assert.are.equal(1, pushes)
        assert.is_nil(plugin.progress_pending)
    end)
end)
