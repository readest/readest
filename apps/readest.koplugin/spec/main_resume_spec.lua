-- main_resume_spec.lua
-- Tests for ReadestSync:onResume (issue #4924): waking the device with a
-- book already open should pull config/notes/stats like reopening the book
-- does, debounced, and the delayed task must not outlive the widget.

require("spec_helper")

-- Minimal KOReader stubs main.lua pulls at require-time.
local UIManagerStub = {
    _scheduled = {},
    show = function() end,
    nextTick = function(self, fn)
        table.insert(self._scheduled, { delay = 0, fn = fn })
    end,
    scheduleIn = function(self, delay, fn)
        table.insert(self._scheduled, { delay = delay, fn = fn })
    end,
    unschedule = function(self, fn)
        for i = #self._scheduled, 1, -1 do
            if self._scheduled[i].fn == fn then
                table.remove(self._scheduled, i)
            end
        end
    end,
}

package.preload["dispatcher"] = function()
    return { registerAction = function() end }
end
package.preload["ui/event"] = function()
    return { new = function(_, name) return { name = name } end }
end
package.preload["ui/widget/infomessage"] = function()
    return { new = function(_, o) return o or {} end }
end
package.preload["ui/widget/keyvaluepage"] = function()
    return { new = function(_, o) return o or {} end }
end
package.preload["ui/widget/multiinputdialog"] = function()
    return { new = function(_, o) return o or {} end }
end
package.preload["ui/widget/container/widgetcontainer"] = function()
    return {
        new = function(self, o)
            o = o or {}
            setmetatable(o, { __index = self })
            if o.init then o:init() end
            return o
        end,
    }
end
package.preload["ui/network/manager"] = function()
    return {
        willRerunWhenOnline = function() return false end,
        goOnlineToRun = function(_, cb) cb() end,
    }
end
package.preload["ui/uimanager"] = function() return UIManagerStub end
package.preload["ffi/sha2"] = function()
    return { base64_to_bin = function(s) return s end }
end
package.preload["ffi/util"] = function()
    return { template = function(s) return s end }
end
package.preload["util"] = function() return {} end
package.preload["readest_i18n"] = function()
    return function(s) return s end
end

local ReadestSync = require("main")

-- Bare plugin instance: skips init() (menu/dispatcher/meta wiring) and
-- fakes the pull methods so tests observe what onResume triggers.
local function makePlugin(opts)
    local plugin = setmetatable({
        settings = {
            auto_sync = opts.auto_sync,
            access_token = opts.access_token,
        },
        ui = { document = opts.document },
        pull_calls = {},
    }, { __index = ReadestSync })
    for _, method in ipairs({ "pullBookConfig", "pullBookNotes", "pullBookStats" }) do
        plugin[method] = function(self, interactive)
            table.insert(self.pull_calls, { method = method, interactive = interactive })
        end
    end
    return plugin
end

describe("ReadestSync:onResume", function()
    before_each(function()
        UIManagerStub._scheduled = {}
    end)

    it("schedules a delayed pull of config, notes and stats", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })

        plugin:onResume()

        assert.are.equal(1, #UIManagerStub._scheduled)
        -- Delayed, not immediate: Wi-Fi is still coming back up right after wake.
        assert.is_true(UIManagerStub._scheduled[1].delay > 0)

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
        local task = table.remove(UIManagerStub._scheduled, 1)
        task.fn()

        -- Still inside the debounce window: no new pull.
        plugin:onResume()
        assert.are.equal(0, #UIManagerStub._scheduled)

        -- Once the debounce window has passed, resume pulls again.
        plugin.last_resume_sync_timestamp = os.time() - 60
        plugin:onResume()
        assert.are.equal(1, #UIManagerStub._scheduled)
    end)

    it("unschedules the pending pull when the widget closes", function()
        local plugin = makePlugin({ auto_sync = true, access_token = "tok", document = {} })

        plugin:onResume()
        assert.are.equal(1, #UIManagerStub._scheduled)

        plugin:onCloseWidget()
        assert.are.equal(0, #UIManagerStub._scheduled)
    end)
end)
