-- selfupdate_spec.lua
-- Regression for readest/readest#5645: KOReader v2026.07 dropped
-- Device:unpackArchive (koreader/koreader@751b49784), so tapping "Update"
-- crashed with "attempt to call method 'unpackArchive' (a nil value)".
-- SelfUpdate must extract with ffi/archiver when the Device method is gone,
-- while still delegating to Device:unpackArchive on older KOReader.

require("spec_helper")
require("spec.koreader_stubs")

-- Fake ffi/archiver reproducing the Reader API surface the plugin uses:
-- Reader:new/open/iterate/extractToPath/close, with `err` cleared on every
-- call (close included) exactly like KOReader's base/ffi/archiver.lua — the
-- helper must capture `err` BEFORE close or it reports nil.
local archiver = {
    entries = {},
    extracted = {},
    open_ok = true,
    fail_on = nil,
    opened = nil,
    closed = false,
}

local FakeReader = {}
FakeReader.__index = FakeReader

function FakeReader:new()
    return setmetatable({}, FakeReader)
end

function FakeReader:open(filepath)
    self.err = nil
    archiver.opened = filepath
    if not archiver.open_ok then
        self.err = "open failed"
        return false
    end
    return true
end

function FakeReader:iterate()
    local i = 0
    return function()
        i = i + 1
        return archiver.entries[i]
    end
end

function FakeReader:extractToPath(key, dest_path)
    self.err = nil
    if archiver.fail_on == key then
        self.err = "extract failed"
        return false
    end
    table.insert(archiver.extracted, { src = key, dest = dest_path })
    return true
end

function FakeReader:close()
    self.err = nil
    archiver.closed = true
end

package.preload["ffi/archiver"] = function()
    return { Reader = FakeReader }
end

local Device = require("device")
local SelfUpdate = require("readest_selfupdate")

describe("SelfUpdate:unpackArchive", function()
    before_each(function()
        archiver.entries = {}
        archiver.extracted = {}
        archiver.open_ok = true
        archiver.fail_on = nil
        archiver.opened = nil
        archiver.closed = false
        Device.unpackArchive = nil
    end)

    it("extracts with ffi/archiver when Device:unpackArchive is unavailable", function()
        archiver.entries = {
            { path = "readest.koplugin/main.lua" },
            { path = "readest.koplugin/_meta.lua" },
        }

        local ok, err = SelfUpdate:unpackArchive("/tmp/update.zip", "/plugins/")

        assert.is_true(ok)
        assert.is_nil(err)
        assert.are.equal("/tmp/update.zip", archiver.opened)
        assert.are.equal(2, #archiver.extracted)
        assert.are.equal("/plugins/readest.koplugin/main.lua", archiver.extracted[1].dest)
        assert.are.equal("/plugins/readest.koplugin/_meta.lua", archiver.extracted[2].dest)
        assert.is_true(archiver.closed)
    end)

    it("delegates to Device:unpackArchive when available (older KOReader)", function()
        local called
        Device.unpackArchive = function(_, archive, extract_to)
            called = { archive = archive, extract_to = extract_to }
            return true
        end

        local ok = SelfUpdate:unpackArchive("/tmp/update.zip", "/plugins/")

        assert.is_true(ok)
        assert.are.equal("/tmp/update.zip", called.archive)
        assert.are.equal("/plugins/", called.extract_to)
        assert.is_nil(archiver.opened)
    end)

    it("reports the archiver error when extraction fails", function()
        archiver.entries = {
            { path = "readest.koplugin/main.lua" },
            { path = "readest.koplugin/_meta.lua" },
        }
        archiver.fail_on = "readest.koplugin/main.lua"

        local ok, err = SelfUpdate:unpackArchive("/tmp/update.zip", "/plugins/")

        assert.is_false(ok)
        assert.are.equal("extract failed", err)
        assert.is_true(archiver.closed)
    end)

    it("reports the open error when the archive cannot be read", function()
        archiver.open_ok = false

        local ok, err = SelfUpdate:unpackArchive("/tmp/update.zip", "/plugins/")

        assert.is_false(ok)
        assert.are.equal("open failed", err)
        assert.are.equal(0, #archiver.extracted)
    end)
end)
