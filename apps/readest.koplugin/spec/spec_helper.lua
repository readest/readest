-- spec_helper.lua
-- Loaded once by busted before any spec file. Stubs the KOReader globals
-- our library/* modules pull at require-time, then exposes a reset() so
-- each spec's `before_each` can wipe state.
--
-- Production code runs inside KOReader (LuaJIT, lots of globals available).
-- These stubs reproduce ONLY the methods the library/* modules actually
-- call. If a new module needs a new KOReader API, add a stub here.

local M = {}

-- ---------------------------------------------------------------------------
-- Resolve `require("library.foo")` and `require("spec.…")` from the koplugin
-- root, regardless of the cwd busted is invoked from.
-- ---------------------------------------------------------------------------
local lfs = require("lfs")
local script_dir = debug.getinfo(1, "S").source:match("@(.*/)")
local koplugin_root = lfs.currentdir()
if script_dir then
    -- script_dir = "<koplugin_root>/spec/"
    koplugin_root = script_dir:gsub("/spec/?$", "")
end
package.path = koplugin_root .. "/?.lua;"
    .. koplugin_root .. "/?/init.lua;"
    .. package.path

-- ---------------------------------------------------------------------------
-- SQLite shim: production code does `require("lua-ljsqlite3/init")` and
-- gets KOReader's FFI binding to libsqlite3. In tests we wrap lsqlite3complete
-- (a Lua C extension that ships the same SQLite engine) and expose the
-- subset of the lua-ljsqlite3 API the library modules use:
--
--   SQ3.open(path) -> conn
--   conn:exec(sql)
--   conn:rowexec(sql)            -> first cell
--   conn:prepare(sql)            -> stmt
--   conn:close()
--   stmt:bind1(idx, value)
--   stmt:bind(...)               -- positional bind from varargs
--   stmt:step()                  -> { col1, col2, ... } or nil
--   stmt:resultset()             -> rows array or nil
--   stmt:reset()                 -> stmt (chainable)
--   stmt:clearbind()             -> stmt (chainable)
--   stmt:close()
-- ---------------------------------------------------------------------------
local sqlite = require("lsqlite3complete")

local Stmt = {}
Stmt.__index = Stmt

function Stmt:bind1(idx, value)
    if value == nil then
        self._stmt:bind(idx, nil)
    else
        self._stmt:bind(idx, value)
    end
    return self
end

function Stmt:bind(...)
    local args = { ... }
    for i = 1, select("#", ...) do
        self:bind1(i, args[i])
    end
    return self
end

function Stmt:step()
    local rc = self._stmt:step()
    if rc == sqlite.ROW then
        local row = {}
        for i = 1, self._stmt:columns() do
            row[i] = self._stmt:get_value(i - 1)
        end
        self._row = row
        return row
    elseif rc == sqlite.DONE then
        self._row = nil
        return nil
    else
        error("sqlite step failed: " .. tostring(self._stmt:error_message()))
    end
end

function Stmt:resultset()
    local rows = {}
    while true do
        local row = self:step()
        if not row then break end
        rows[#rows + 1] = row
    end
    if #rows == 0 then return nil end
    return rows
end

function Stmt:reset()
    self._stmt:reset()
    return self
end

function Stmt:clearbind()
    self._stmt:clear_bindings()
    return self
end

function Stmt:close()
    self._stmt:finalize()
end

local Conn = {}
Conn.__index = Conn

function Conn:exec(sql)
    local rc = self._db:exec(sql)
    if rc ~= sqlite.OK then
        error("sqlite exec failed: " .. tostring(self._db:errmsg()) .. "\nSQL: " .. sql)
    end
end

function Conn:rowexec(sql)
    for row in self._db:rows(sql) do
        return row[1]
    end
end

function Conn:prepare(sql)
    local raw = self._db:prepare(sql)
    if not raw then
        error("sqlite prepare failed: " .. tostring(self._db:errmsg()) .. "\nSQL: " .. sql)
    end
    return setmetatable({ _stmt = raw }, Stmt)
end

function Conn:close()
    self._db:close()
end

local SQ3 = {}
function SQ3.open(path)
    local db = sqlite.open(path)
    if not db then
        error("sqlite open failed: " .. tostring(path))
    end
    return setmetatable({ _db = db }, Conn)
end

package.preload["lua-ljsqlite3/init"] = function() return SQ3 end

-- ---------------------------------------------------------------------------
-- JSON shim: production code does `require("json")` and gets KOReader's
-- rapidjson-bound JSON module. Tests use dkjson (pure Lua) which exposes the
-- same `encode`/`decode` API.
-- ---------------------------------------------------------------------------
package.preload["json"] = function() return require("dkjson") end

-- ---------------------------------------------------------------------------
-- KOReader stubs: a small registry of fakes that production modules require.
-- Each module is exposed via `package.preload` so the first `require()`
-- returns the fake. `M.reset()` rebuilds the in-memory state.
-- ---------------------------------------------------------------------------
local fakes = {}

local function tmpdir()
    local tpl = "/tmp/readest-koplugin-spec-XXXXXX"
    local p = io.popen("mktemp -d " .. tpl)
    if not p then error("mktemp failed") end
    local dir = p:read("*l")
    p:close()
    return dir
end

local function rmrf(path)
    if not path or path == "" or path == "/" then return end
    os.execute("rm -rf " .. ("'" .. path:gsub("'", "'\\''") .. "'"))
end

-- The fake objects are STABLE table identities: spec_helper.reset() mutates
-- their internals in place rather than reassigning the table reference.
-- This matters because `package.preload[name]` is only consulted on the
-- first `require(name)` call; subsequent requires return the cached table.
-- If reset() reassigned fakes.DataStorage = {…}, modules that captured the
-- earlier require result would still see the previous tmpdir (already
-- rm -rf'd by reset). In-place mutation keeps the captured reference live.
fakes.logger = {
    warn = function() end,
    info = function() end,
    dbg  = function() end,
    err  = function() end,
}
fakes.G_reader_settings = {
    _store = {},
    readSetting = function(self, k) return self._store[k] end,
    saveSetting = function(self, k, v) self._store[k] = v end,
    flush = function() end,
}
fakes.DataStorage = {
    _dir = nil,
    getSettingsDir = function(self) return self._dir end,
    getDataDir     = function(self) return self._dir end,
}
fakes.Device = {
    canUseWAL = function() return true end,
    screen    = { getWidth = function() return 600 end, getHeight = function() return 800 end },
}

function M.reset()
    if fakes.DataStorage._dir then rmrf(fakes.DataStorage._dir) end
    fakes.DataStorage._dir = tmpdir()
    -- Wipe the settings store but keep the table identity stable
    for k in pairs(fakes.G_reader_settings._store) do
        fakes.G_reader_settings._store[k] = nil
    end
    _G.G_reader_settings = fakes.G_reader_settings
end

package.preload["logger"]      = function() return fakes.logger end
package.preload["datastorage"] = function() return fakes.DataStorage end
package.preload["device"]      = function() return fakes.Device end

-- ---------------------------------------------------------------------------
-- Run reset() once at load so the first spec doesn't crash on missing globals.
-- Each spec file is responsible for calling spec_helper.reset() in before_each
-- if it mutates state across tests.
-- ---------------------------------------------------------------------------
M.reset()

-- Make spec_helper itself accessible from spec files via require("spec_helper")
package.preload["spec_helper"] = function() return M end

return M
