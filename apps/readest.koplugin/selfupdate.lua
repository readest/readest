local Device = require("device")
local InfoMessage = require("ui/widget/infomessage")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local T = require("ffi/util").template
local _ = require("gettext")

local SelfUpdate = {}

local UPDATE_URLS = {
    "https://download.readest.com/releases/latest.json",
    "https://github.com/readest/readest/releases/latest/download/latest.json",
}
local DOWNLOAD_URLS = {
    "https://download.readest.com/releases/%s/Readest-%s-1.koplugin.zip",
    "https://github.com/readest/readest/releases/download/%s/Readest-%s-1.koplugin.zip",
}

function SelfUpdate:compareVersions(v1, v2)
    local function parse(v)
        local parts = {}
        for num in tostring(v):gmatch("(%d+)") do
            table.insert(parts, tonumber(num))
        end
        return parts
    end
    local p1, p2 = parse(v1), parse(v2)
    local len = math.max(#p1, #p2)
    for i = 1, len do
        local a, b = p1[i] or 0, p2[i] or 0
        if a < b then return -1 end
        if a > b then return 1 end
    end
    return 0
end

function SelfUpdate:fetchLatestVersion()
    local http = require("socket.http")
    local ltn12 = require("ltn12")
    local socket = require("socket")
    local socketutil = require("socketutil")
    local json = require("json")

    for _, url in ipairs(UPDATE_URLS) do
        local sink = {}
        socketutil:set_timeout(socketutil.LARGE_BLOCK_TIMEOUT, socketutil.LARGE_TOTAL_TIMEOUT)
        local code = socket.skip(1, http.request{
            url = url,
            sink = ltn12.sink.table(sink),
        })
        socketutil:reset_timeout()

        if code == 200 then
            local ok, data = pcall(json.decode, table.concat(sink))
            if ok and data and data.version then
                return data.version
            end
        end
        logger.dbg("ReadestSync: failed to fetch latest.json from", url, "code:", code)
    end
    return nil
end

function SelfUpdate:checkForUpdate(plugin_path, installed_version)
    local ConfirmBox = require("ui/widget/confirmbox")

    if NetworkMgr:willRerunWhenOnline(function() self:checkForUpdate(plugin_path, installed_version) end) then
        return
    end

    UIManager:show(InfoMessage:new{
        text = _("Checking for update…"),
        timeout = 1,
    })

    Device:setIgnoreInput(true)
    local latest_version = self:fetchLatestVersion()
    Device:setIgnoreInput(false)

    if not latest_version then
        UIManager:show(InfoMessage:new{
            text = _("Failed to check for update. Please try again later."),
            timeout = 3,
        })
        return
    end

    if not installed_version or self:compareVersions(installed_version, latest_version) < 0 then
        UIManager:show(ConfirmBox:new{
            text = installed_version
                and T(_("A new version is available: v%1 (current: v%2).\n\nDo you want to update now?"), latest_version, installed_version)
                or T(_("A new version is available: v%1.\n\nDo you want to update now?"), latest_version),
            ok_text = _("Update"),
            ok_callback = function()
                self:downloadAndInstall(plugin_path, latest_version)
            end,
        })
    else
        UIManager:show(InfoMessage:new{
            text = T(_("You are up to date (v%1)."), installed_version),
            timeout = 3,
        })
    end
end

function SelfUpdate:downloadAndInstall(plugin_path, version)
    local ConfirmBox = require("ui/widget/confirmbox")
    local DataStorage = require("datastorage")
    local http = require("socket.http")
    local ltn12 = require("ltn12")
    local socket = require("socket")
    local socketutil = require("socketutil")

    if NetworkMgr:willRerunWhenOnline(function() self:downloadAndInstall(plugin_path, version) end) then
        return
    end

    local tag = "v" .. version
    local zip_name = "Readest-" .. version .. "-1.koplugin.zip"
    local tmp_path = DataStorage:getDataDir() .. "/" .. zip_name

    UIManager:show(InfoMessage:new{
        text = _("Downloading update…"),
        timeout = 1,
    })

    Device:setIgnoreInput(true)

    local download_ok = false
    for _, url_template in ipairs(DOWNLOAD_URLS) do
        local url = string.format(url_template, tag, version)
        logger.dbg("ReadestSync: downloading from", url)

        socketutil:set_timeout(socketutil.FILE_BLOCK_TIMEOUT, socketutil.FILE_TOTAL_TIMEOUT)
        local code = socket.skip(1, http.request{
            url = url,
            sink = ltn12.sink.file(io.open(tmp_path, "w")),
        })
        socketutil:reset_timeout()

        if code == 200 then
            download_ok = true
            break
        end
        logger.dbg("ReadestSync: download failed from", url, "code:", code)
    end

    Device:setIgnoreInput(false)

    if not download_ok then
        os.remove(tmp_path)
        UIManager:show(InfoMessage:new{
            text = _("Failed to download update. Please try again later."),
            timeout = 3,
        })
        return
    end

    local parent_dir = plugin_path:match("(.*/)")

    local ok, err = Device:unpackArchive(tmp_path, parent_dir)
    os.remove(tmp_path)

    if ok then
        UIManager:show(ConfirmBox:new{
            text = T(_("Readest plugin updated to v%1.\n\nPlease restart KOReader to apply the update."), version),
            ok_text = _("Restart now"),
            ok_callback = function()
                UIManager:restartKOReader()
            end,
            cancel_text = _("Later"),
        })
    else
        UIManager:show(InfoMessage:new{
            text = T(_("Failed to install update: %1"), err or _("unknown error")),
            timeout = 5,
        })
    end
end

return SelfUpdate
