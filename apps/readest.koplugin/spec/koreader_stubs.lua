-- koreader_stubs.lua
-- KOReader stubs for the specs that load main.lua (the plugin entry point).
--
-- Why this is shared rather than per-spec: busted runs every spec file in ONE
-- Lua state, so `package.preload` is global and `package.loaded` caches the
-- first `require()` winner. Two spec files each declaring their own
-- `package.preload["ui/uimanager"]` would race on file load order — whichever
-- loaded first would win, and the other's assertions would silently observe a
-- stub it never wrote to. Registering the stubs once, here, removes that
-- ordering hazard.
--
-- main.lua captures `local Dispatcher = require("dispatcher")` in a module
-- upvalue at load time, so the Dispatcher table identity must be stable for
-- the whole run — reset() therefore wipes the registry in place rather than
-- reassigning it (same rule spec_helper documents for its own fakes).

local M = {}

-- Records every Dispatcher:registerAction call so specs can assert which
-- gesture actions the plugin exposes.
M.Dispatcher = {
    _registered = {},
    registerAction = function(self, name, opts)
        table.insert(self._registered, { name = name, opts = opts })
    end,
}

-- Look up a captured registration by action name; nil if never registered.
function M.Dispatcher:find(name)
    for _, entry in ipairs(self._registered) do
        if entry.name == name then return entry.opts end
    end
    return nil
end

M.UIManager = {
    _scheduled = {},
    _shown = {},
    _closed = {},
    show = function(self, widget)
        table.insert(self._shown, widget)
    end,
    close = function(self, widget)
        table.insert(self._closed, widget)
    end,
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

-- Drain the scheduled queue, running each task once. Tasks that schedule
-- further work (uploadCurrentBook hashes on nextTick, then continues) are
-- picked up on the next drain pass.
function M.UIManager:drain()
    local pending = self._scheduled
    self._scheduled = {}
    for _, task in ipairs(pending) do
        task.fn()
    end
    return #pending
end

-- `util.partialMD5` is swapped per-spec; default returns a deterministic hash.
M.util = {
    partialMD5 = function(_file) return "stub-md5" end,
}

-- The Library widget is a heavy KOReader UI module (menus, painters, FFI
-- image decoders). main.lua only touches it to refresh an already-open
-- Library, so a stub with the two fields it reads is enough. Safe to preload
-- globally: no other spec requires library.librarywidget.
M.LibraryWidget = {
    _menu = nil,
    _store = nil,
    _current_user = nil,
    refresh = function() end,
    open = function() end,
}

function M.reset()
    for i = #M.Dispatcher._registered, 1, -1 do
        M.Dispatcher._registered[i] = nil
    end
    for _, list in ipairs({ M.UIManager._scheduled, M.UIManager._shown, M.UIManager._closed }) do
        for i = #list, 1, -1 do list[i] = nil end
    end
    M.util.partialMD5 = function(_file) return "stub-md5" end
    M.LibraryWidget._menu = nil
    M.LibraryWidget._store = nil
    M.LibraryWidget._current_user = nil
end

package.preload["dispatcher"] = function() return M.Dispatcher end
package.preload["ui/uimanager"] = function() return M.UIManager end
package.preload["util"] = function() return M.util end
package.preload["library.librarywidget"] = function() return M.LibraryWidget end
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
package.preload["ffi/sha2"] = function()
    return { base64_to_bin = function(s) return s end }
end
package.preload["ffi/util"] = function()
    return { template = function(s) return s end }
end
package.preload["readest_i18n"] = function()
    return function(s) return s end
end

package.preload["spec.koreader_stubs"] = function() return M end

return M
