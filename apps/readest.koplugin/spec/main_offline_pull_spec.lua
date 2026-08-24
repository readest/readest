-- main_offline_pull_spec.lua
-- Background (auto sync) pulls on book open / device wake must never bring
-- Wi-Fi up (issue #5838; the "prompt" shape of the same thing is #4113 and
-- #2137). On devices where KOReader drives the radio (Kobo, Kindle, …)
-- NetworkMgr:willRerunWhenOnline → beforeWifiAction is modal on the UI
-- thread: "prompt" asks on every wake, "turn on" shows an uncancellable
-- "Scanning for networks…" for ~30 s when no known AP is in range. So a
-- background pull that finds the device offline skips silently, remembers
-- that it skipped, and onNetworkConnected reruns it once the device is back
-- online. Interactive pulls (menu taps / gestures) keep going through
-- NetworkMgr:willRerunWhenOnline, like every other interactive KOReader
-- network action, and so do background pulls when KOReader's "Action when
-- Wi-Fi is off" is a silent one ("turn on", "ignore"): only "prompt" would
-- put a dialog up, so only "prompt" is bypassed.

require("spec_helper")
local stubs = require("spec.koreader_stubs")

local UIManagerStub = stubs.UIManager
local NetworkMgrStub = stubs.NetworkMgr
local ReadestSync = require("main")

-- Pull methods faked: observes what a lifecycle event schedules.
local function makePlugin(opts)
    return stubs.makePullPlugin(ReadestSync, opts)
end

-- Real pull methods, stopped at ensureClient: observes whether the network
-- gate let a pull through (the sync modules themselves are out of scope).
local function makeRealPlugin()
    local plugin = setmetatable({
        settings = { auto_sync = true, access_token = "tok", localsend_enabled = false },
        ui = { document = {} },
        ensure_client_calls = 0,
    }, { __index = ReadestSync })
    plugin.getBookIdentifiers = function() return "book-hash", "meta-hash" end
    plugin.ensureClient = function(self)
        self.ensure_client_calls = self.ensure_client_calls + 1
        return nil
    end
    return plugin
end

describe("ReadestSync:willRerunPullWhenOnline", function()
    before_each(function()
        stubs.reset()
        G_reader_settings:saveSetting("wifi_enable_action", nil)  -- KOReader default: prompt
    end)

    -- "turn on" and "ignore" never show a dialog, so a background pull keeps
    -- taking KOReader's path, exactly as before.
    for _, action in ipairs({ "turn_on", "ignore" }) do
        it("takes NetworkMgr's path for a background pull when the Wi-Fi action is " .. action, function()
            local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
            G_reader_settings:saveSetting("wifi_enable_action", action)
            NetworkMgrStub._online = false

            assert.is_false(plugin:willRerunPullWhenOnline(false, function() end))
            assert.are.equal(1, NetworkMgrStub._willRerunWhenOnline_calls)
            assert.is_nil(plugin.pull_pending_offline)
            G_reader_settings:saveSetting("wifi_enable_action", nil)
        end)
    end

    it("skips a background pull when offline with the action set to prompt explicitly", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        G_reader_settings:saveSetting("wifi_enable_action", "prompt")
        NetworkMgrStub._online = false

        assert.is_true(plugin:willRerunPullWhenOnline(false, function() end))
        assert.are.equal(0, NetworkMgrStub._willRerunWhenOnline_calls)
        assert.is_true(plugin.pull_pending_offline)
        G_reader_settings:saveSetting("wifi_enable_action", nil)
    end)

    it("lets a background pull proceed when online, without asking NetworkMgr to bring Wi-Fi up", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        NetworkMgrStub._online = true

        assert.is_false(plugin:willRerunPullWhenOnline(false, function() end))
        assert.are.equal(0, NetworkMgrStub._willRerunWhenOnline_calls)
        assert.is_nil(plugin.pull_pending_offline)
    end)

    it("skips a background pull when offline and never asks NetworkMgr to bring Wi-Fi up", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        NetworkMgrStub._online = false

        assert.is_true(plugin:willRerunPullWhenOnline(false, function() end))
        -- This is the whole point: no beforeWifiAction, so no blocking modal.
        assert.are.equal(0, NetworkMgrStub._willRerunWhenOnline_calls)
        assert.is_true(plugin.pull_pending_offline)
    end)

    it("routes an interactive pull through NetworkMgr:willRerunWhenOnline", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        NetworkMgrStub._online = false

        assert.is_false(plugin:willRerunPullWhenOnline(true, function() end))
        assert.are.equal(1, NetworkMgrStub._willRerunWhenOnline_calls)
        assert.is_nil(plugin.pull_pending_offline)
    end)
end)

describe("ReadestSync background pulls while offline", function()
    before_each(function()
        stubs.reset()
    end)

    -- Real pull methods (not the fakes): each must bail before ensureClient
    -- when offline, and reach it when online.
    for _, method in ipairs({ "pullBookConfig", "pullBookNotes", "pullBookStats" }) do
        it(method .. "(false) bails before ensureClient when offline", function()
            local plugin = makeRealPlugin()

            NetworkMgrStub._online = false
            plugin[method](plugin, false)
            assert.are.equal(0, plugin.ensure_client_calls)
            assert.are.equal(0, NetworkMgrStub._willRerunWhenOnline_calls)
            assert.is_true(plugin.pull_pending_offline)

            NetworkMgrStub._online = true
            plugin[method](plugin, false)
            assert.are.equal(1, plugin.ensure_client_calls)
        end)
    end
end)

describe("ReadestSync interactive pulls while offline", function()
    local original_will_rerun

    before_each(function()
        stubs.reset()
        original_will_rerun = NetworkMgrStub.willRerunWhenOnline
    end)

    after_each(function()
        NetworkMgrStub.willRerunWhenOnline = original_will_rerun
    end)

    -- When NetworkMgr takes over (it will bring Wi-Fi up and rerun), the
    -- pull must stop before ensureClient, must not set the background flag,
    -- and the rerun closure must re-invoke the same method with the same
    -- arguments (interactive, and full_sync for notes).
    for _, case in ipairs({
        { method = "pullBookConfig", args = { true } },
        { method = "pullBookStats", args = { true } },
        { method = "pullBookNotes", args = { true, true } },
    }) do
        it(case.method .. "(true) stops when NetworkMgr will rerun, and the rerun keeps its args", function()
            local plugin = makeRealPlugin()
            local captured
            NetworkMgrStub.willRerunWhenOnline = function(self, cb)
                self._willRerunWhenOnline_calls = self._willRerunWhenOnline_calls + 1
                captured = cb
                return true
            end
            NetworkMgrStub._online = false

            plugin[case.method](plugin, unpack(case.args))
            assert.are.equal(0, plugin.ensure_client_calls)
            assert.are.equal(1, NetworkMgrStub._willRerunWhenOnline_calls)
            assert.is_nil(plugin.pull_pending_offline)
            assert.is_function(captured)

            local rerun
            plugin[case.method] = function(_, a, b) rerun = { a, b } end
            captured()
            assert.are.same(case.args, rerun)
        end)
    end
end)

describe("ReadestSync:scheduleBackgroundPull", function()
    before_each(function()
        stubs.reset()
    end)

    -- One handle for every trigger: a wake or a reconnect while the open
    -- pull is still pending replaces it instead of stacking a second one.
    it("keeps one pending pull when resume follows open", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        plugin:onReaderReady()
        plugin:onResume()
        assert.are.equal(1, #UIManagerStub._scheduled)
    end)

    it("keeps one pending pull when NetworkConnected follows open, and clears the handle after firing", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        plugin:onReaderReady()
        plugin.pull_pending_offline = true
        plugin:onNetworkConnected()
        assert.are.equal(1, #UIManagerStub._scheduled)

        UIManagerStub._scheduled[1].fn()
        assert.are.equal(3, #plugin.pull_calls)
        assert.is_nil(plugin.background_pull_task)
    end)
end)

describe("ReadestSync:onNetworkConnected", function()
    before_each(function()
        stubs.reset()
    end)

    it("reruns the skipped pull once the device is back online", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        plugin.pull_pending_offline = true

        plugin:onNetworkConnected()

        assert.are.equal(1, #UIManagerStub._scheduled)
        -- Deferred, like the open pull: let the event settle first.
        assert.is_true(UIManagerStub._scheduled[1].delay > 0)
        assert.is_nil(plugin.pull_pending_offline)

        UIManagerStub._scheduled[1].fn()
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

    it("does nothing when no pull was skipped", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        plugin:onNetworkConnected()
        assert.are.equal(0, #UIManagerStub._scheduled)
    end)

    it("does nothing without an open document (FileManager context)", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = nil })
        plugin.pull_pending_offline = true
        plugin:onNetworkConnected()
        assert.are.equal(0, #UIManagerStub._scheduled)
    end)

    it("does nothing when auto sync is off or signed out, and keeps the flag for later", function()
        for _, opts in ipairs({
            { auto_sync = false, access_token = "tok", document = {} },
            { auto_sync = true, access_token = nil, document = {} },
        }) do
            local plugin = makePlugin(opts)
            plugin.pull_pending_offline = true
            plugin:onNetworkConnected()
            assert.are.equal(0, #UIManagerStub._scheduled)
            -- The skip still belongs to this document; the gate is re-checked
            -- on the next NetworkConnected.
            assert.is_true(plugin.pull_pending_offline)
        end
    end)

    it("coalesces repeated NetworkConnected events into one pull", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        plugin.pull_pending_offline = true
        plugin:onNetworkConnected()
        plugin.pull_pending_offline = true
        plugin:onNetworkConnected()
        assert.are.equal(1, #UIManagerStub._scheduled)
    end)

    it("drops the pending pull and the flag when the widget closes", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        plugin.pull_pending_offline = true
        plugin:onNetworkConnected()
        assert.are.equal(1, #UIManagerStub._scheduled)

        plugin.pull_pending_offline = true  -- as if another pull skipped meanwhile
        plugin:onCloseWidget()
        assert.are.equal(0, #UIManagerStub._scheduled)
        assert.is_nil(plugin.pull_pending_offline)
    end)

    it("onCloseWidget with nothing pending is a no-op that still clears the flag", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })
        plugin.pull_pending_offline = true
        plugin:onCloseWidget()
        assert.are.equal(0, #UIManagerStub._scheduled)
        assert.is_nil(plugin.pull_pending_offline)
        assert.is_nil(plugin.background_pull_task)
    end)
end)

describe("ReadestSync offline open, then reconnect (end to end)", function()
    before_each(function()
        stubs.reset()
    end)

    -- Real gates and real scheduling, no fakes for the pull methods.
    it("skips on open while offline, then reruns all three pulls once online", function()
        local plugin = makeRealPlugin()
        NetworkMgrStub._online = false

        plugin:onReaderReady()
        assert.are.equal(1, #UIManagerStub._scheduled)
        table.remove(UIManagerStub._scheduled, 1).fn()
        assert.are.equal(0, plugin.ensure_client_calls)
        assert.are.equal(0, NetworkMgrStub._willRerunWhenOnline_calls)
        assert.is_true(plugin.pull_pending_offline)

        NetworkMgrStub._online = true
        plugin:onNetworkConnected()
        assert.are.equal(1, #UIManagerStub._scheduled)
        assert.is_nil(plugin.pull_pending_offline)
        table.remove(UIManagerStub._scheduled, 1).fn()
        assert.are.equal(3, plugin.ensure_client_calls)

        -- A second NetworkConnected has nothing to rerun.
        plugin:onNetworkConnected()
        assert.are.equal(0, #UIManagerStub._scheduled)
    end)

    -- KOReader broadcasts NetworkConnected on link-up (isConnected), while
    -- isOnline is a DNS resolve that can still fail for a moment. The rerun
    -- must then re-arm the flag for the next NetworkConnected: no modal, no
    -- loop.
    it("re-arms the flag when the NetworkConnected rerun still finds the device offline", function()
        local plugin = makeRealPlugin()
        NetworkMgrStub._online = false

        plugin:onReaderReady()
        UIManagerStub:drain()
        assert.is_true(plugin.pull_pending_offline)
        assert.are.equal(0, plugin.ensure_client_calls)

        plugin:onNetworkConnected()
        assert.is_nil(plugin.pull_pending_offline)
        UIManagerStub:drain()
        assert.is_true(plugin.pull_pending_offline)
        assert.are.equal(0, NetworkMgrStub._willRerunWhenOnline_calls)
        assert.are.equal(0, #UIManagerStub._scheduled)

        NetworkMgrStub._online = true
        plugin:onNetworkConnected()
        UIManagerStub:drain()
        assert.are.equal(3, plugin.ensure_client_calls)
    end)

    -- Turning auto sync on pulls the open book's config right away
    -- (onReadestSyncToggleAutoSync); that pull is background too, so offline
    -- it skips silently instead of bringing Wi-Fi up, and reconnect reruns it.
    it("toggling auto sync on while offline skips silently and reruns on reconnect", function()
        local plugin = makeRealPlugin()
        plugin.settings.auto_sync = false
        NetworkMgrStub._online = false

        plugin:onReadestSyncToggleAutoSync(true)
        assert.is_true(plugin.settings.auto_sync)
        assert.are.equal(0, plugin.ensure_client_calls)
        assert.are.equal(0, NetworkMgrStub._willRerunWhenOnline_calls)
        assert.is_true(plugin.pull_pending_offline)

        NetworkMgrStub._online = true
        plugin:onNetworkConnected()
        assert.are.equal(1, #UIManagerStub._scheduled)
    end)
end)
