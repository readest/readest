-- main_resume_spec.lua
-- Tests for ReadestSync:onResume (issue #4924): waking the device with a
-- book already open should pull config/notes/stats like reopening the book
-- does, debounced, and the delayed task must not outlive the widget.

require("spec_helper")
-- KOReader stubs main.lua pulls at require-time. Shared with the other main.*
-- specs — see spec/koreader_stubs.lua for why they can't live in this file.
local stubs = require("spec.koreader_stubs")

local UIManagerStub = stubs.UIManager

local ReadestSync = require("main")

local function makePlugin(opts)
    return stubs.makePullPlugin(ReadestSync, opts)
end

describe("ReadestSync:onResume", function()
    before_each(function()
        stubs.reset()
    end)

    it("schedules a delayed pull of config, notes and stats", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })

        plugin:onResume()

        assert.are.equal(1, #UIManagerStub._scheduled)
        -- Delayed, not immediate: Wi-Fi is still coming back up right after wake.
        assert.is_true(UIManagerStub._scheduled[1].delay > 0)

        UIManagerStub:drain()
        assert.are.equal(3, #plugin.pull_calls)
        local pulled = {}
        for _, call in ipairs(plugin.pull_calls) do
            pulled[call.method] = true
            assert.is_false(call.interactive)
        end
        assert.is_true(pulled.pullBookConfig)
        assert.is_true(pulled.pullBookNotes)
        assert.is_true(pulled.pullBookStats)
    end)

    it("does nothing without an open document (FileManager context)", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = nil })
        plugin:onResume()
        assert.are.equal(0, #UIManagerStub._scheduled)
    end)

    it("does nothing when auto sync is disabled", function()
        local plugin = makePlugin({ auto_sync = false, access_token = "tok", document = {} })
        plugin:onResume()
        assert.are.equal(0, #UIManagerStub._scheduled)
    end)

    it("does nothing when signed out", function()
        local plugin = makePlugin({ auto_sync = true, access_token = nil, document = {} })
        plugin:onResume()
        assert.are.equal(0, #UIManagerStub._scheduled)
    end)

    it("debounces resume events fired in quick succession", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })

        plugin:onResume()
        plugin:onResume()
        assert.are.equal(1, #UIManagerStub._scheduled)

        -- Simulate the pending task firing.
        UIManagerStub:drain()

        -- Still inside the debounce window: no new pull.
        plugin:onResume()
        assert.are.equal(0, #UIManagerStub._scheduled)

        -- Once the debounce window has passed, resume pulls again.
        plugin.last_resume_sync_timestamp = os.time() - 60
        plugin:onResume()
        assert.are.equal(1, #UIManagerStub._scheduled)
    end)

    -- #7159: a Kindle's firmware brings Wi-Fi back a few seconds after wake
    -- and KOReader sends no NetworkConnected, so a pull that runs before
    -- there is a route fails and is never retried. isOnline (a DNS lookup)
    -- can already say yes then, so the wait checks for a route.
    it("waits for a network route before pulling", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        stubs.NetworkMgr._route = false

        plugin:onResume()
        UIManagerStub:drain()
        UIManagerStub:drain()
        assert.are.equal(0, #plugin.pull_calls)
        assert.are.equal(1, #UIManagerStub._scheduled)

        stubs.NetworkMgr._route = true
        UIManagerStub:drain()
        UIManagerStub:drain()
        assert.are.equal(3, #plugin.pull_calls)
        assert.are.equal(0, #UIManagerStub._scheduled)
    end)

    it("waits for an address even when a default route exists", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        stubs.NetworkMgr._online = false

        plugin:onResume()
        UIManagerStub:drain()
        assert.are.equal(0, #plugin.pull_calls)
        assert.are.equal(1, #UIManagerStub._scheduled)

        stubs.NetworkMgr._online = true
        UIManagerStub:drain()
        UIManagerStub:drain()
        assert.are.equal(3, #plugin.pull_calls)
        assert.is_nil(plugin.background_pull_task)
    end)

    it("pulls anyway once the wait for the network gives up", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        stubs.NetworkMgr._route = false

        plugin:onResume()
        local waited = 0
        for _ = 1, 32 do
            if #UIManagerStub._scheduled == 0 then break end
            waited = waited + UIManagerStub._scheduled[1].delay
            UIManagerStub:drain()
        end
        assert.are.equal(3, #plugin.pull_calls)
        assert.are.equal(61, waited)
        assert.are.equal(0, #UIManagerStub._scheduled)
        assert.is_nil(plugin.background_pull_task)
    end)

    it("unschedules the wait for the network when the widget closes", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        stubs.NetworkMgr._route = false

        plugin:onResume()
        UIManagerStub:drain()
        plugin:onCloseWidget()
        assert.are.equal(0, #UIManagerStub._scheduled)
    end)

    it("coalesces a reconnect with the pending wake wait", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        stubs.NetworkMgr._route = false

        plugin:onReaderReady()
        plugin:onResume()
        UIManagerStub:drain()
        assert.are.equal(0, #plugin.pull_calls)
        assert.are.equal(1, #UIManagerStub._scheduled)

        stubs.NetworkMgr._route = true
        plugin.pull_pending_offline = true
        plugin:onNetworkConnected()
        assert.are.equal(1, #UIManagerStub._scheduled)
        UIManagerStub:drain()
        UIManagerStub:drain()
        assert.are.equal(3, #plugin.pull_calls)
        assert.are.equal(0, #UIManagerStub._scheduled)
        assert.is_nil(plugin.background_pull_task)
    end)

    it("stops waiting when auto sync is disabled", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        stubs.NetworkMgr._route = false

        plugin:onResume()
        UIManagerStub:drain()
        plugin:onReadestSyncToggleAutoSync(false)
        UIManagerStub:drain()

        assert.are.equal(0, #plugin.pull_calls)
        assert.are.equal(0, #UIManagerStub._scheduled)
        assert.is_nil(plugin.background_pull_task)
    end)

    it("does not pull when auto sync is disabled before the route returns", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        stubs.NetworkMgr._route = false

        plugin:onResume()
        plugin:onReadestSyncToggleAutoSync(false)
        stubs.NetworkMgr._route = true
        UIManagerStub:drain()
        UIManagerStub:drain()

        assert.are.equal(0, #plugin.pull_calls)
        assert.are.equal(0, #UIManagerStub._scheduled)
        assert.is_nil(plugin.background_pull_task)
    end)

    it("keeps waiting when reconnect fires before the route returns", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        stubs.NetworkMgr._route = false

        plugin:onResume()
        UIManagerStub:drain()
        plugin.pull_pending_offline = true
        plugin:onNetworkConnected()
        UIManagerStub:drain()
        assert.are.equal(0, #plugin.pull_calls)
        assert.are.equal(1, #UIManagerStub._scheduled)

        stubs.NetworkMgr._route = true
        UIManagerStub:drain()
        UIManagerStub:drain()
        assert.are.equal(3, #plugin.pull_calls)
        assert.are.equal(0, #UIManagerStub._scheduled)
        assert.is_nil(plugin.background_pull_task)
    end)

    it("does not restart the bounded wake wait on reconnect", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        stubs.NetworkMgr._route = false

        plugin:onResume()
        local waited = 0
        for check = 1, 32 do
            if #UIManagerStub._scheduled == 0 then break end
            if check == 29 then
                plugin.pull_pending_offline = true
                plugin:onNetworkConnected()
            end
            waited = waited + UIManagerStub._scheduled[1].delay
            UIManagerStub:drain()
        end
        assert.are.equal(3, #plugin.pull_calls)
        assert.are.equal(61, waited)
        assert.are.equal(0, #UIManagerStub._scheduled)
        assert.is_nil(plugin.background_pull_task)
    end)

    it("unschedules the pending pull when the widget closes", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })

        plugin:onResume()
        assert.are.equal(1, #UIManagerStub._scheduled)

        plugin:onCloseWidget()
        assert.are.equal(0, #UIManagerStub._scheduled)
    end)
end)
