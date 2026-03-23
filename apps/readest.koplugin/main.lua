local Dispatcher = require("dispatcher")
local InfoMessage = require("ui/widget/infomessage")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local sha2 = require("ffi/sha2")
local T = require("ffi/util").template
local _ = require("gettext")

local SyncAuth = require("syncauth")
local SyncConfig = require("syncconfig")
local SyncAnnotations = require("syncannotations")
local SelfUpdate = require("selfupdate")

local ReadestSync = WidgetContainer:new{
    name = "readest",
    title = _("Readest Sync"),
    settings = nil,
}

local API_CALL_DEBOUNCE_DELAY = 30
local SUPABAE_ANON_KEY_BASE64 = "ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW5aaWMzbDRablZ6YW1weFpIaHJhbkZzZVhOaklpd2ljbTlzWlNJNkltRnViMjRpTENKcFlYUWlPakUzTXpReE1qTTJOekVzSW1WNGNDSTZNakEwT1RZNU9UWTNNWDAuM1U1VXFhb3VfMVNnclZlMWVvOXJBcGMwdUtqcWhwUWRVWGh2d1VIbVVmZw=="

ReadestSync.default_settings = {
    supabase_url = "https://readest.supabase.co",
    supabase_anon_key = sha2.base64_to_bin(SUPABAE_ANON_KEY_BASE64),
    auto_sync = false,
    user_email = nil,
    user_name = nil,
    user_id = nil,
    access_token = nil,
    refresh_token = nil,
    expires_at = nil,
    expires_in = nil,
    last_sync_at = nil,
}

-- ── Lifecycle ──────────────────────────────────────────────────────

function ReadestSync:init()
    self.last_sync_timestamp = 0
    self.settings = G_reader_settings:readSetting("readest_sync", self.default_settings)

    local meta = dofile(self.path .. "/_meta.lua")
    self.installed_version = meta and meta.version and tostring(meta.version)

    self.ui.menu:registerToMainMenu(self)
end

function ReadestSync:onDispatcherRegisterActions()
    Dispatcher:registerAction("readest_sync_set_autosync",
        { category="string", event="ReadestSyncToggleAutoSync", title=_("Set auto progress sync"), reader=true,
        args={true, false}, toggle={_("on"), _("off")},})
    Dispatcher:registerAction("readest_sync_toggle_autosync", { category="none", event="ReadestSyncToggleAutoSync", title=_("Toggle auto readest sync"), reader=true,})
    Dispatcher:registerAction("readest_sync_push_progress", { category="none", event="ReadestSyncPushProgress", title=_("Push readest progress from this device"), reader=true,})
    Dispatcher:registerAction("readest_sync_pull_progress", { category="none", event="ReadestSyncPullProgress", title=_("Pull readest progress from other devices"), reader=true, separator=true,})
    Dispatcher:registerAction("readest_sync_push_annotations", { category="none", event="ReadestSyncPushAnnotations", title=_("Push readest annotations from this device"), reader=true,})
    Dispatcher:registerAction("readest_sync_pull_annotations", { category="none", event="ReadestSyncPullAnnotations", title=_("Pull readest annotations from other devices"), reader=true, separator=true,})
end

function ReadestSync:onReaderReady()
    if self.settings.auto_sync and self.settings.access_token then
        UIManager:nextTick(function()
            self:pullBookConfig(false)
            self:pullBookNotes(false)
        end)
    end
    self:onDispatcherRegisterActions()
end

-- ── Menu ───────────────────────────────────────────────────────────

function ReadestSync:addToMainMenu(menu_items)
    menu_items.readest_sync = {
        sorting_hint = "tools",
        text = _("Readest Sync"),
        sub_item_table = {
            {
                text_func = function()
                    return SyncAuth:needsLogin(self.settings) and _("Log in Readest Account")
                        or _("Log out as ") .. (self.settings.user_name or "")
                end,
                callback_func = function()
                    if SyncAuth:needsLogin(self.settings) then
                        return function(menu)
                            SyncAuth:login(self.settings, self.path, self.title, menu)
                        end
                    else
                        return function(menu)
                            SyncAuth:logout(self.settings, self.path, menu)
                        end
                    end
                end,
                separator = true,
            },
            {
                text = _("Auto sync progress and annotations"),
                checked_func = function() return self.settings.auto_sync end,
                callback = function()
                    self:onReadestSyncToggleAutoSync()
                end,
                separator = true,
            },
            {
                text = _("Push book config now"),
                enabled_func = function()
                    return self.settings.access_token ~= nil and self.ui.document ~= nil
                end,
                callback = function()
                    self:pushBookConfig(true)
                end,
            },
            {
                text = _("Pull book config now"),
                enabled_func = function()
                    return self.settings.access_token ~= nil and self.ui.document ~= nil
                end,
                callback = function()
                    self:pullBookConfig(true)
                end,
                separator = true,
            },
            {
                text = _("Push annotations now"),
                enabled_func = function()
                    return self.settings.access_token ~= nil and self.ui.document ~= nil
                end,
                callback = function()
                    self:pushBookNotes(true)
                end,
            },
            {
                text = _("Pull annotations now"),
                enabled_func = function()
                    return self.settings.access_token ~= nil and self.ui.document ~= nil
                end,
                callback = function()
                    self:pullBookNotes(true)
                end,
                separator = true,
            },
            {
                text_func = function()
                    if self.installed_version then
                        return T(_("Check for update (v%1)"), self.installed_version)
                    end
                    return _("Check for update")
                end,
                callback = function()
                    SelfUpdate:checkForUpdate(self.path, self.installed_version)
                end,
            },
        }
    }
end

-- ── Sync helpers (thin wrappers around modules) ────────────────────

function ReadestSync:ensureClient(interactive)
    if not self.settings.access_token or not self.settings.user_id then
        if interactive then
            UIManager:show(InfoMessage:new{
                text = _("Please login first"),
                timeout = 2,
            })
        end
        return nil
    end

    SyncAuth:tryRefreshToken(self.settings, self.path)

    local client = SyncAuth:getReadestSyncClient(self.settings, self.path)
    if not client then
        if interactive then
            UIManager:show(InfoMessage:new{
                text = _("Please configure Readest settings first"),
                timeout = 3,
            })
        end
        return nil
    end
    return client
end

function ReadestSync:getBookIdentifiers()
    local book_hash = SyncConfig:getDocumentIdentifier(self.ui)
    local meta_hash = SyncConfig:getMetaHash(self.ui)
    return book_hash, meta_hash
end

-- ── Config sync ────────────────────────────────────────────────────

function ReadestSync:pushBookConfig(interactive)
    local now = os.time()
    if not interactive and now - self.last_sync_timestamp <= API_CALL_DEBOUNCE_DELAY then
        return
    end

    if interactive and NetworkMgr:willRerunWhenOnline(function() self:pushBookConfig(interactive) end) then
        return
    end

    local client = self:ensureClient(interactive)
    if not client then return end

    self.last_sync_timestamp = SyncConfig:push(
        self.ui, self.settings, client, interactive, self.last_sync_timestamp
    )
end

function ReadestSync:pullBookConfig(interactive)
    local book_hash, meta_hash = self:getBookIdentifiers()
    if not book_hash or not meta_hash then return end

    if NetworkMgr:willRerunWhenOnline(function() self:pullBookConfig(interactive) end) then
        return
    end

    local client = self:ensureClient(interactive)
    if not client then return end

    SyncConfig:pull(
        self.ui, self.settings, client, book_hash, meta_hash, interactive,
        function() SyncAuth:logout(self.settings, self.path) end
    )
end

-- ── Annotation sync ────────────────────────────────────────────────

function ReadestSync:pushBookNotes(interactive)
    if interactive and NetworkMgr:willRerunWhenOnline(function() self:pushBookNotes(interactive) end) then
        return
    end

    local client = self:ensureClient(interactive)
    if not client then return end

    SyncAnnotations:push(self.ui, self.settings, client, interactive)
end

function ReadestSync:pullBookNotes(interactive)
    local book_hash, meta_hash = self:getBookIdentifiers()
    if not book_hash or not meta_hash then return end

    if NetworkMgr:willRerunWhenOnline(function() self:pullBookNotes(interactive) end) then
        return
    end

    local client = self:ensureClient(interactive)
    if not client then return end

    SyncAnnotations:pull(
        self.ui, self.settings, client, book_hash, meta_hash, self.dialog, interactive
    )
end

-- ── Event handlers ─────────────────────────────────────────────────

function ReadestSync:onReadestSyncToggleAutoSync(toggle)
    if toggle == self.settings.auto_sync then
        return true
    end
    self.settings.auto_sync = not self.settings.auto_sync
    G_reader_settings:saveSetting("readest_sync", self.settings)
    if self.settings.auto_sync and self.ui.document then
        self:pullBookConfig(false)
    end
end

function ReadestSync:onReadestSyncPushProgress()
    self:pushBookConfig(true)
end

function ReadestSync:onReadestSyncPullProgress()
    self:pullBookConfig(true)
end

function ReadestSync:onReadestSyncPushAnnotations()
    self:pushBookNotes(true)
end

function ReadestSync:onReadestSyncPullAnnotations()
    self:pullBookNotes(true)
end

function ReadestSync:onCloseDocument()
    if self.settings.auto_sync and self.settings.access_token then
        NetworkMgr:goOnlineToRun(function()
            self:pushBookConfig(false)
            self:pushBookNotes(false)
        end)
    end
end

function ReadestSync:onPageUpdate(page)
    if self.settings.auto_sync and self.settings.access_token and page then
        if self.delayed_push_task then
            UIManager:unschedule(self.delayed_push_task)
        end
        self.delayed_push_task = function()
            self:pushBookConfig(false)
        end
        UIManager:scheduleIn(5, self.delayed_push_task)
    end
end

function ReadestSync:onAnnotationsModified()
    if self.settings.auto_sync and self.settings.access_token then
        UIManager:nextTick(function()
            self:pushBookNotes(false)
        end)
    end
end

function ReadestSync:onCloseWidget()
    if self.delayed_push_task then
        UIManager:unschedule(self.delayed_push_task)
        self.delayed_push_task = nil
    end
end

return ReadestSync
