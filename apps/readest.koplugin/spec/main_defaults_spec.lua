local helper = require("spec_helper")
local stubs = require("spec.koreader_stubs")
local ReadestSync = require("main")

describe("Nearby BookDrop default", function()
    local saved, attached, read_setting
    before_each(function()
        helper.reset()
        stubs.reset()
        saved = package.loaded["readest_localsend"]
        attached = nil
        read_setting = G_reader_settings.readSetting
        G_reader_settings.readSetting = function(self, key, default)
            local value = read_setting(self, key)
            if value == nil then return default end
            return value
        end
        package.loaded["readest_localsend"] = {
            init = function(_, plugin) attached = plugin.settings.localsend_enabled end,
        }
    end)
    after_each(function()
        package.loaded["readest_localsend"] = saved
        G_reader_settings.readSetting = read_setting
    end)

    local function init(settings)
        if settings then G_reader_settings:saveSetting("readest_sync", settings) end
        local plugin = setmetatable({
            path = ".",
            ui = { menu = { registerToMainMenu = function() end } },
            registerFileDialogButton = function() end,
        }, { __index = ReadestSync })
        plugin:init()
    end

    it("enables receiving for a new installation", function()
        init()
        assert.is_true(attached)
    end)

    it("enables receiving when existing settings lack the preference", function()
        init({ auto_sync = false })
        assert.is_true(attached)
    end)

    it("preserves an explicit disabled preference", function()
        init({ localsend_enabled = false })
        assert.is_false(attached)
    end)
end)

describe("Readest Cloud URL", function()
    local saved, read_setting
    before_each(function()
        helper.reset()
        stubs.reset()
        saved = package.loaded["readest_localsend"]
        package.loaded["readest_localsend"] = { init = function() end }
        read_setting = G_reader_settings.readSetting
        G_reader_settings.readSetting = function(self, key, default)
            local value = read_setting(self, key)
            if value == nil then return default end
            return value
        end
    end)
    after_each(function()
        package.loaded["readest_localsend"] = saved
        G_reader_settings.readSetting = read_setting
    end)

    local function init(settings)
        if settings then G_reader_settings:saveSetting("readest_sync", settings) end
        local plugin = setmetatable({
            path = ".",
            ui = { menu = { registerToMainMenu = function() end } },
            registerFileDialogButton = function() end,
        }, { __index = ReadestSync })
        plugin:init()
        return plugin.settings.supabase_url
    end

    it("uses the project URL for a new installation", function()
        assert.are.equal("https://vbsyxfusjjqdxkjqlysc.supabase.co", init())
    end)

    it("moves saved settings off the former vanity host", function()
        assert.are.equal("https://vbsyxfusjjqdxkjqlysc.supabase.co",
            init({ supabase_url = "https://readest.supabase.co" }))
    end)

    it("preserves a self-hosted URL", function()
        assert.are.equal("https://supabase.example.com",
            init({ supabase_url = "https://supabase.example.com" }))
    end)
end)
