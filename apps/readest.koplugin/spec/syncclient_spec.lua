require("spec_helper")
local stubs = require("spec.koreader_stubs")

describe("ReadestSyncClient transport failures", function()
    local Client, saved_uimanager, saved_socketutil, timeouts, calls, replies, rpc
    before_each(function()
        stubs.reset()
        timeouts, calls, replies = {}, 0, {}
        saved_uimanager = package.loaded["ui/uimanager"]
        package.loaded["ui/uimanager"] = setmetatable({
            looper = {}, setInputTimeout = function() end,
        }, {__index = stubs.UIManager})
        saved_socketutil = package.loaded["socketutil"]
        package.loaded["socketutil"] = {
            set_timeout = function(_, block, total) timeouts[#timeouts + 1] = {block, total} end,
            reset_timeout = function() end,
        }
        package.loaded["readest_syncclient"] = nil
        Client = require("readest_syncclient")
        rpc = function() return {status = 200, body = {statPages = {}}} end
    end)
    after_each(function()
        package.loaded["ui/uimanager"] = saved_uimanager
        package.loaded["socketutil"] = saved_socketutil
        package.loaded["readest_syncclient"] = nil
    end)
    local function client()
        return setmetatable({client = setmetatable({
            reset_middlewares = function() end,
            enable = function() end,
        }, {__index = function() return function()
            calls = calls + 1
            return rpc()
        end end})}, {__index = Client})
    end
    local function callback(ok, body, status)
        replies[#replies + 1] = {ok = ok, body = body, status = status}
    end
    it("retries a transient TLS handshake timeout once after yielding, with more time", function()
        rpc = function()
            if calls == 1 then error("common/Spore/Protocols.lua:85: wantread") end
            return {status = 200, body = {statPages = {}}}
        end
        client():pullChanges({type = "stats"}, callback)
        assert.are.equal(1, calls)
        assert.are.equal(0, #replies)
        assert.are.equal(1, #stubs.UIManager._scheduled)
        assert.is_true(stubs.UIManager._scheduled[1].delay > 0)
        stubs.UIManager:drain()
        assert.are.equal(2, calls)
        assert.are.equal(1, #replies)
        assert.is_true(replies[1].ok)
        assert.is_true(timeouts[2][1] > timeouts[1][1])
    end)
    it("bounds retries and reports final failure exactly once", function()
        rpc = function() error("common/Spore/Protocols.lua:85: timeout") end
        client():pullChanges({type = "stats"}, callback)
        stubs.UIManager:drain()
        assert.are.equal(2, calls)
        assert.are.equal(1, #replies)
        assert.is_false(replies[1].ok)
        assert.are.equal(0, #stubs.UIManager._scheduled)
    end)
    it("does not retry writes after an ambiguous transport failure", function()
        rpc = function() error("wantread") end
        client():pushChanges({}, callback)
        assert.are.equal(1, calls)
        assert.are.equal(1, #replies)
        assert.is_false(replies[1].ok)
        assert.are.equal(0, #stubs.UIManager._scheduled)
    end)
    it("preserves HTTP auth errors for the caller without retrying", function()
        rpc = function() error({status = 401, body = {error = "Unauthorized"}}) end
        client():pullChanges({}, callback)
        assert.are.equal(1, calls)
        assert.are.equal(401, replies[1].status)
        assert.are.equal("Unauthorized", replies[1].body.error)
        assert.are.equal(0, #stubs.UIManager._scheduled)
    end)
    it("does not retry programming errors", function()
        rpc = function() error("attempt to index a nil value") end
        client():pullChanges({}, callback)
        assert.are.equal(1, calls)
        assert.is_false(replies[1].ok)
        assert.are.equal(0, #stubs.UIManager._scheduled)
    end)
end)

describe("ReadestSyncClient without Turbo", function()
    local Client, saved, child, exited, spawn_ok, replies, rpc_calls, result_path, original_open, original_time, now, terminated
    local function swap(name, value)
        saved[name] = package.loaded[name] or false
        package.loaded[name] = value
    end
    before_each(function()
        stubs.reset()
        saved, replies = {}, {}
        child, exited, spawn_ok, rpc_calls, result_path = nil, false, true, 0, nil
        original_time, now, terminated = os.time, 100, 0
        os.time = function() return now end
        original_open = io.open
        io.open = function(path, mode)
            if path:match("/readest_sync_") then result_path = path end
            return original_open(path, mode)
        end
        swap("ui/uimanager", stubs.UIManager)
        swap("datastorage", {getSettingsDir = function() return "/tmp" end})
        swap("socketutil", {set_timeout = function() end, reset_timeout = function() end})
        swap("ffi/util", {
            runInSubProcess = function(fn)
                child = fn
                return spawn_ok and 123 or false
            end,
            isSubProcessDone = function() return exited end,
            terminateSubProcess = function() terminated = terminated + 1 end,
        })
        swap("ffi", {cdef = function() end, C = {_exit = function() end}})
        package.loaded["readest_syncclient"] = nil
        Client = require("readest_syncclient")
    end)
    after_each(function()
        for name, value in pairs(saved) do package.loaded[name] = value or nil end
        package.loaded["readest_syncclient"] = nil
        io.open = original_open
        os.time = original_time
        if result_path then os.remove(result_path) end
    end)
    local function client(rpc)
        return setmetatable({client = {
            reset_middlewares = function() end, enable = function() end,
            pullChanges = function()
                rpc_calls = rpc_calls + 1
                return rpc()
            end,
        }}, {__index = Client})
    end
    local function callback(ok, body, status)
        replies[#replies + 1] = {ok = ok, body = body, status = status}
    end
    it("leaves the UI free until the worker returns, including responses larger than a pipe buffer", function()
        local body = {notes = {{text = string.rep("x", 200000)}}}
        client(function() return {status = 200, body = body} end):pullChanges({}, callback)
        assert.is_function(child)
        assert.are.equal(0, rpc_calls)
        assert.are.equal(0, #replies)
        stubs.UIManager:drain() -- an event-loop turn while networking is pending
        assert.are.equal(0, #replies)
        child(123)
        exited = true
        stubs.UIManager:drain()
        assert.are.equal(1, #replies)
        assert.is_true(replies[1].ok)
        assert.same(body, replies[1].body)
        assert.are.equal(200, replies[1].status)
        assert.is_nil(require("lfs").attributes(result_path))
    end)
    it("preserves structured HTTP errors across the process boundary", function()
        client(function() error({status = 403, body = {error = "Not authenticated"}}) end):pullChanges({}, callback)
        child(123); exited = true; stubs.UIManager:drain()
        assert.are.equal(1, #replies)
        assert.is_false(replies[1].ok)
        assert.are.equal(403, replies[1].status)
        assert.are.equal("Not authenticated", replies[1].body.error)
    end)
    it("fails without running blocking HTTP on the UI thread if fork fails", function()
        spawn_ok = false
        client(function() return {status = 200} end):pullChanges({}, callback)
        assert.are.equal(0, rpc_calls)
        assert.are.equal(1, #replies)
        assert.is_false(replies[1].ok)
    end)
    it("terminates stalled workers once, reaps before cleanup, and bounds retries", function()
        client(function() return {status = 200} end):pullChanges({}, callback)
        now = 116
        stubs.UIManager:drain()
        stubs.UIManager:drain()
        assert.are.equal(1, terminated)
        assert.is_not_nil(require("lfs").attributes(result_path))
        assert.are.equal(0, #replies)
        exited = true
        stubs.UIManager:drain()
        assert.is_nil(require("lfs").attributes(result_path))
        assert.are.equal(0, #replies)
        exited = false
        stubs.UIManager:drain() -- one retry
        now = 142
        stubs.UIManager:drain()
        assert.are.equal(2, terminated)
        exited = true
        stubs.UIManager:drain()
        assert.are.equal(1, #replies)
        assert.is_false(replies[1].ok)
        assert.is_nil(require("lfs").attributes(result_path))
        assert.are.equal(0, #stubs.UIManager._scheduled)
    end)
    it("reports a dead worker instead of leaving a callback pending forever", function()
        client(function() return {status = 200} end):pullChanges({}, callback)
        exited = true
        stubs.UIManager:drain()
        assert.are.equal(1, #replies)
        assert.is_false(replies[1].ok)
    end)
end)
