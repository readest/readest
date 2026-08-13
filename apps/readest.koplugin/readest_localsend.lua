-- LocalSend receive support: this device announces itself on the LAN and
-- accepts files from Readest apps (or any LocalSend sender). Receive-only.
--
-- Module singleton: KOReader instantiates the plugin per context (reader /
-- FileManager) but the native service is process-wide; its state lives here
-- and survives context switches (init just re-attaches the poll loop).

local ConfirmBox = require("ui/widget/confirmbox")
local DataStorage = require("datastorage")
local Device = require("device")
local InfoMessage = require("ui/widget/infomessage")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local T = require("ffi/util").template
local _ = require("readest_i18n")
local LocalSendFFI = require("library.localsend_ffi")

local POLL_INTERVAL = 0.5

local LocalSend = {
    plugin = nil,          -- current ReadestSync instance
    lib = nil,             -- ffi namespace once loaded
    lib_err = nil,         -- why the lib is unavailable (nil = not tried yet)
    running = false,
    poll_task = nil,
    request_dialogs = {},  -- sessionId -> ConfirmBox, dismissed on abort
}

function LocalSend:init(plugin)
    self.plugin = plugin
    if self.lib == nil and self.lib_err == nil then
        local lib, err = LocalSendFFI.load(plugin.path)
        self.lib, self.lib_err = lib, err
        if err then
            logger.info("ReadestLocalSend: unavailable: " .. tostring(err))
        end
    end
    -- Re-attach after a context switch: the service kept running while the
    -- previous plugin instance (and its poll task) went away.
    if self.lib and plugin.settings.localsend_enabled and NetworkMgr:isConnected() then
        self:startService()
    end
end

function LocalSend:isAvailable()
    return self.lib ~= nil
end

function LocalSend:downloadDir()
    local dir = self.plugin.settings.library_download_dir
        or G_reader_settings:readSetting("home_dir")
    if dir == "" then dir = nil end
    return dir
end

function LocalSend:startService()
    if not self.lib then return end
    if self.running then
        self:schedulePoll()
        return
    end
    local dir = self:downloadDir()
    if not dir then
        UIManager:show(InfoMessage:new{
            text = _("Set a Readest download folder or a KOReader home folder first."),
            timeout = 3,
        })
        return
    end
    local config = require("json").encode({
        alias = self.plugin.settings.localsend_alias or Device.model or "KOReader",
        deviceModel = "KOReader",
        deviceType = "mobile",
        -- Outside the plugin dir so self-update keeps the identity peers pin.
        dataDir = DataStorage:getSettingsDir() .. "/readest-localsend",
        downloadDir = dir,
    })
    local rc = self.lib.ls_start(config)
    if rc ~= 0 then
        logger.warn("ReadestLocalSend: ls_start rc=" .. tostring(rc))
        self:drainEvents() -- surfaces the queued error event as an InfoMessage
        return
    end
    self.running = true
    self:schedulePoll()
end

function LocalSend:stopService()
    self:unschedulePoll()
    if self.lib and self.running then
        self.lib.ls_stop()
        self.running = false
    end
end

function LocalSend:toggle()
    local settings = self.plugin.settings
    settings.localsend_enabled = not settings.localsend_enabled
    if settings.localsend_enabled then
        if NetworkMgr:isConnected() then
            self:startService()
        else
            UIManager:show(InfoMessage:new{
                text = _("LocalSend will start when Wi-Fi connects."),
                timeout = 3,
            })
        end
    else
        self:stopService()
    end
end

function LocalSend:schedulePoll()
    if self.poll_task then return end
    self.poll_task = function()
        self:drainEvents()
        if self.running and self.poll_task then
            UIManager:scheduleIn(POLL_INTERVAL, self.poll_task)
        end
    end
    UIManager:scheduleIn(POLL_INTERVAL, self.poll_task)
end

function LocalSend:unschedulePoll()
    if self.poll_task then
        UIManager:unschedule(self.poll_task)
        self.poll_task = nil
    end
end

function LocalSend:drainEvents()
    if not self.lib then return end
    while true do
        local s = LocalSendFFI.takeString(self.lib, self.lib.ls_poll_event())
        if not s then break end
        local ok, ev = pcall(function() return require("json").decode(s) end)
        if ok and type(ev) == "table" and ev.type then
            self:dispatch(ev)
        else
            logger.warn("ReadestLocalSend: undecodable event: " .. tostring(s))
        end
    end
end

-- Routed per-type so specs can exercise the routing with plain tables.
function LocalSend:dispatch(ev)
    local handler = self.handlers[ev.type]
    if handler then handler(self, ev) end
end

function LocalSend:onReceiveRequest(ev)
    local util = require("util")
    local files = ev.files or {}
    local names = {}
    for i, f in ipairs(files) do
        if i > 5 then
            table.insert(names, T(_("… and %1 more"), #files - 5))
            break
        end
        table.insert(names, f.fileName or "?")
    end
    local sender = (ev.sender and ev.sender.alias) or "?"
    local dialog
    dialog = ConfirmBox:new{
        text = T(_("%1 wants to send you %2 file(s) (%3):"),
                sender, #files, util.getFriendlySize(ev.totalSize or 0))
            .. "\n\n" .. table.concat(names, "\n"),
        ok_text = _("Accept"),
        cancel_text = _("Decline"),
        ok_callback = function()
            self.request_dialogs[ev.sessionId] = nil
            self.lib.ls_accept(ev.sessionId)
            UIManager:show(InfoMessage:new{
                text = T(_("Receiving %1 file(s) from %2…"), #files, sender),
                timeout = 2,
            })
        end,
        cancel_callback = function()
            self.request_dialogs[ev.sessionId] = nil
            self.lib.ls_decline(ev.sessionId)
        end,
    }
    self.request_dialogs[ev.sessionId] = dialog
    UIManager:show(dialog)
end

function LocalSend:onReceiveRequestClosed(ev)
    local dialog = self.request_dialogs[ev.sessionId]
    if dialog then
        self.request_dialogs[ev.sessionId] = nil
        UIManager:close(dialog)
    end
end

function LocalSend:onReceiveFileDone(ev)
    if not ev.path then
        logger.warn("ReadestLocalSend: file failed: "
            .. tostring(ev.fileName) .. ": " .. tostring(ev.error))
        return
    end
    -- Best-effort library registration; without a signed-in Readest account
    -- the file still sits in the download folder for FileManager.
    if self.plugin and self.plugin.settings.access_token then
        self.plugin:addToReadest(ev.path, { silent = true })
    end
end

function LocalSend:onReceiveEnd(ev)
    local text
    if (ev.failed or 0) > 0 then
        text = T(_("LocalSend: received %1 file(s), %2 failed."), ev.received or 0, ev.failed)
    elseif ev.reason == "cancelled" then
        text = _("LocalSend transfer cancelled.")
    else
        text = T(_("LocalSend: received %1 file(s)."), ev.received or 0)
    end
    UIManager:show(InfoMessage:new{ text = text, timeout = 4 })
    local LibraryWidget = require("library.librarywidget")
    if LibraryWidget._menu then LibraryWidget.refresh() end
end

LocalSend.handlers = {
    started = function(_, ev)
        logger.info("ReadestLocalSend: started on port " .. tostring(ev.port))
    end,
    receive_request = function(self, ev) self:onReceiveRequest(ev) end,
    receive_request_closed = function(self, ev) self:onReceiveRequestClosed(ev) end,
    receive_file_done = function(self, ev) self:onReceiveFileDone(ev) end,
    receive_end = function(self, ev) self:onReceiveEnd(ev) end,
    error = function(_, ev)
        UIManager:show(InfoMessage:new{
            text = T(_("LocalSend error: %1"), ev.message or "?"),
            timeout = 5,
        })
    end,
}

function LocalSend:statusText()
    if not self.lib then
        return _("LocalSend not available on this device")
    end
    if not self.running then
        return _("LocalSend off")
    end
    local s = LocalSendFFI.takeString(self.lib, self.lib.ls_status())
    local ok, status = pcall(function() return require("json").decode(s or "") end)
    if not ok or type(status) ~= "table" or not status.running then
        return _("LocalSend off")
    end
    local octet
    for __, ip in ipairs(status.localIps or {}) do
        octet = ip:match("%.(%d+)$")
        if octet then break end
    end
    local tag = octet and (" · #" .. octet) or ""
    local text = T(_("Visible as %1"), (status.alias or "?") .. tag)
    if status.multicastError then
        text = text .. " " .. _("(limited discovery)")
    end
    return text
end

return LocalSend
