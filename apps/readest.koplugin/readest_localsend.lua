-- LocalSend receive support: this device announces itself on the LAN and
-- accepts files from Readest apps (or any LocalSend sender). Receive-only.
--
-- Module singleton: KOReader instantiates the plugin per context (reader /
-- FileManager) but the helper process + its control socket are process-
-- wide; their state lives here and survives context switches. init() only
-- re-points self.plugin and re-attaches a poll task; onCloseWidget() only
-- unschedules that poll task — neither closes the socket, so a reader<->
-- FileManager switch does not interrupt an in-flight transfer.
--
-- Transport: the localsend-helper static binary (bin/localsend-helper-*)
-- is spawned as a background process and speaks newline-delimited JSON
-- over a local TCP control socket. See library/localsend_helper.lua.

local ConfirmBox = require("ui/widget/confirmbox")
local DataStorage = require("datastorage")
local Device = require("device")
local InfoMessage = require("ui/widget/infomessage")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local T = require("ffi/util").template
local _ = require("readest_i18n")
local Helper = require("library.localsend_helper")
local Firewall = require("library.localsend_firewall")

local POLL_INTERVAL = 0.5

local LocalSend = {
    plugin = nil,           -- current ReadestSync instance
    sock = nil,             -- connected control socket, or nil
    port = nil,             -- control port the helper is listening on
    rx_buffer = "",         -- partial line carried between poll ticks
    binpath = nil,          -- resolved path to the helper binary
    running = false,
    available = false,      -- whether a helper binary exists for this device
    status_cache = {},      -- last {running,alias,port,localIps,multicastError}
    poll_task = nil,
    request_dialogs = {},   -- sessionId -> ConfirmBox, dismissed on abort
}

function LocalSend:init(plugin)
    self.plugin = plugin
    local name = Helper.binaryNameFor({
        is_android = Device:isAndroid(),
        is_emulator = Device:isEmulator(),
        os = jit.os,
        arch = jit.arch,
    })
    if name then
        local path = plugin.path .. "/bin/" .. name
        local lfs = require("libs/libkoreader-lfs")
        if lfs.attributes(path, "mode") == "file" then
            self.available = true
            self.binpath = path
        else
            self.available = false
            logger.info("ReadestLocalSend: unavailable: binary not found: " .. path)
        end
    else
        self.available = false
        logger.info("ReadestLocalSend: unavailable: unsupported device")
    end
    -- Re-attach after a context switch: the service kept running while the
    -- previous plugin instance (and its poll task) went away.
    if self.available and plugin.settings.localsend_enabled and NetworkMgr:isConnected() then
        self:startService()
    end
end

function LocalSend:isAvailable()
    return self.available
end

function LocalSend:downloadDir()
    local dir = self.plugin.settings.library_download_dir
    if dir == "" then dir = nil end
    dir = dir or G_reader_settings:readSetting("home_dir")
    if dir == "" then dir = nil end
    return dir
end

function LocalSend:startService()
    if not self.available then return end
    if self.running and self.sock then
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
    local port = Helper.pickPort()
    if not port then
        UIManager:show(InfoMessage:new{
            text = _("LocalSend error: could not find a free port."),
            timeout = 3,
        })
        return
    end
    -- Best-effort: on a device with a default-DROP firewall (e.g. Kindle)
    -- this is what makes the server/discovery ports reachable from the LAN
    -- at all. Doesn't fail startService if it no-ops (no iptables, or not
    -- needed on this device/network).
    Firewall.open()
    Helper.spawn(self.binpath, port)
    local sock, err = Helper.connect(port, 3)
    if not sock then
        logger.warn("ReadestLocalSend: connect failed: " .. tostring(err))
        os.execute("pkill -f localsend-helper >/dev/null 2>&1")
        Firewall.close()
        UIManager:show(InfoMessage:new{
            text = _("LocalSend failed to start."),
            timeout = 3,
        })
        return
    end
    self.sock = sock
    self.port = port
    self.rx_buffer = ""
    Helper.send(self.sock, {
        cmd = "start",
        alias = self.plugin.settings.localsend_alias or Device.model or "KOReader",
        deviceModel = "KOReader",
        deviceType = "mobile",
        -- Outside the plugin dir so self-update keeps the identity peers pin.
        dataDir = DataStorage:getSettingsDir() .. "/readest-localsend",
        downloadDir = dir,
    })
    self.running = true
    self:schedulePoll()
    UIManager:show(InfoMessage:new{ text = _("Starting LocalSend…"), timeout = 2 })
end

function LocalSend:stopService()
    self:unschedulePoll()
    if self.sock then
        Helper.send(self.sock, { cmd = "stop" })
        self.sock:close()
        self.sock = nil
        os.execute("pkill -f localsend-helper >/dev/null 2>&1")
    end
    Firewall.close()
    self.running = false
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
    -- The poll belongs to the (singleton) service, not to a plugin instance.
    -- Always (re)schedule a fresh task so a context switch that re-attaches
    -- can never leave the service running with no live poll. Unschedule any
    -- prior task first so exactly one is ever pending.
    self:unschedulePoll()
    self.poll_task = function()
        self:pollTick()
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

-- One non-blocking read of the control socket per tick, framed into
-- complete JSON lines and dispatched. If the helper's end of the socket
-- has closed (it crashed, was killed, or exited on its own), stop the
-- service instead of rescheduling — there's nothing left to poll.
function LocalSend:pollTick()
    if not self.sock then return end
    local chunk, closed = Helper.recvChunk(self.sock)
    local events
    events, self.rx_buffer = Helper.parseLines(self.rx_buffer, chunk)
    for _, ev in ipairs(events) do
        self:dispatch(ev)
    end
    if closed then
        logger.warn("ReadestLocalSend: helper connection closed")
        self:stopService()
    end
end

-- Routed per-type so specs can exercise the routing with plain tables.
function LocalSend:dispatch(ev)
    local handler = self.handlers[ev.type]
    if handler then handler(self, ev) end
end

function LocalSend:onReceiveRequest(ev)
    logger.info("ReadestLocalSend: receive_request from "
        .. tostring(ev.sender and ev.sender.alias)
        .. " files=" .. tostring(ev.files and #ev.files))
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
        -- The dialog pops up unprompted from a background poll; without this
        -- a tap already in flight (e.g. a page turn) is replayed onto the
        -- dialog and instantly triggers cancel_callback (declines the file).
        flush_events_on_show = true,
        ok_callback = function()
            self.request_dialogs[ev.sessionId] = nil
            Helper.send(self.sock, { cmd = "accept", sessionId = ev.sessionId })
            UIManager:show(InfoMessage:new{
                text = T(_("Receiving %1 file(s) from %2…"), #files, sender),
                timeout = 2,
            })
        end,
        cancel_callback = function()
            self.request_dialogs[ev.sessionId] = nil
            Helper.send(self.sock, { cmd = "decline", sessionId = ev.sessionId })
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
    -- Refresh the KOReader FileManager so a received book appears in the
    -- current folder without leaving and re-entering it.
    if (ev.received or 0) > 0 then
        local ok_fm, FileManager = pcall(require, "apps/filemanager/filemanager")
        if ok_fm and FileManager.instance and FileManager.instance.file_chooser then
            FileManager.instance.file_chooser:refreshPath()
        end
    end
end

LocalSend.handlers = {
    started = function(self, ev)
        logger.info("ReadestLocalSend: started on port " .. tostring(ev.port))
        self.status_cache.alias = ev.alias
        self.status_cache.port = ev.port
        Helper.send(self.sock, { cmd = "status" })
    end,
    -- Reply to our own {cmd="status"} request; the only source of localIps
    -- and multicastError, since nothing here talks to the helper
    -- synchronously anymore.
    status = function(self, ev)
        self.status_cache = {
            running = ev.running,
            alias = ev.alias,
            port = ev.port,
            localIps = ev.localIps,
            multicastError = ev.multicastError,
        }
    end,
    receive_request = function(self, ev) self:onReceiveRequest(ev) end,
    receive_request_closed = function(self, ev) self:onReceiveRequestClosed(ev) end,
    receive_file_done = function(self, ev) self:onReceiveFileDone(ev) end,
    receive_end = function(self, ev) self:onReceiveEnd(ev) end,
    -- An error event means the helper failed (e.g. a bind error at start);
    -- there's no separate "is it actually still running" status to check
    -- (the FFI-era stale-error guard doesn't apply: this event only arrives
    -- from the one helper process this socket is connected to).
    error = function(_self, ev)
        UIManager:show(InfoMessage:new{
            text = T(_("LocalSend error: %1"), ev.message or "?"),
            timeout = 5,
        })
        _self:stopService()
    end,
}

function LocalSend:statusText()
    if not self.available then
        return _("LocalSend not available on this device")
    end
    local status = self.status_cache
    if not self.running or next(status) == nil then
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
