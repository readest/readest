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
    local function useRealPush()
        Config.push = original_push
        local state = { meta_hash_v1 = "local-meta" }
        plugin.ui.doc_settings = {
            readSetting = function(_, key)
                if key == "partial_md5_checksum" then return "book" end
                if key == "readest_sync" then return state end
            end,
            saveSetting = function(_, key, value) if key == "readest_sync" then state = value end end,
        }
        plugin.ui.document = { info = { has_pages = true }, getPageCount = function() return 100 end }
        plugin.ui.getCurrentPage = function() return 50 end
        plugin.last_sync_timestamp = 0
        local pending = {}
        plugin.ensureClient = function() return { pushChanges = function(_, payload, cb)
            pending[#pending + 1] = { callback = cb, payload = payload }
        end } end
        return pending
    end
    it("ignores an older failed push after a newer successful push", function()
        local pending = useRealPush()
        plugin:pushBookConfig(false)
        plugin:pushBookConfig(false, true)
        pending[2].callback(true, {})
        pending[1].callback(false, {})
        assert.is_nil(plugin.progress_pending)
        assert.are.equal(0, #stubs.UIManager._scheduled)
    end)
    it("keeps the latest failure pending after an older success arrives", function()
        local pending = useRealPush()
        plugin:pushBookConfig(false)
        plugin:pushBookConfig(false, true)
        pending[2].callback(false, {})
        pending[1].callback(true, {})
        assert.is_true(plugin.progress_pending)
        assert.are.equal(0, #stubs.UIManager._scheduled)
    end)
    it("passes the library store directly into payload construction", function()
        local pending = useRealPush()
        plugin.getBookIdentifiers = function() error("push should resolve its own identifiers") end
        plugin.getLibraryStore = function() return { _getRowRaw = function(_, hash)
            assert.are.equal("book", hash)
            return { meta_hash = "cloud-stamped" }
        end } end
        plugin:pushBookConfig(false)
        assert.are.equal("cloud-stamped", pending[1].payload.configs[1].metaHash)
        pending[1].callback(true, {})
    end)
    it("keeps automatic sync paused and lets manual sync reopen login", function()
        plugin.ensureClient = nil -- use the production gate
        plugin.settings.auth_required = true
        plugin.settings.user_id = "reader"
        plugin.path = "/plugin"
        assert.is_nil(plugin:ensureClient(false))
        assert.are.equal(0, #stubs.UIManager._shown)
        assert.is_nil(plugin:ensureClient(true))
        assert.truthy(stubs.UIManager._shown[1].ok_callback)
        assert.is_nil(plugin:ensureClient(true))
        assert.are.equal(1, #stubs.UIManager._shown)
        stubs.UIManager._shown[1].cancel_callback()
        assert.is_nil(plugin:ensureClient(true))
        assert.are.equal(2, #stubs.UIManager._shown)
    end)
end)
