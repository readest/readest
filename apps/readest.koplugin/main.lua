local Device = require("device")
local Event = require("ui/event")
local InfoMessage = require("ui/widget/infomessage")
local MultiInputDialog = require("ui/widget/multiinputdialog")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local logger = require("logger")
local time = require("ui/time")
local util = require("util")
local sha2 = require("ffi/sha2")
local T = require("ffi/util").template
local _ = require("gettext")

local ReadestSync = WidgetContainer:new{
    name = "readest",
    title = _("Readest Sync"),

    settings = nil,
}

local API_CALL_DEBOUNCE_DELAY = time.s(30)
local SUPABAE_ANON_KEY_BASE64 = "ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW5aaWMzbDRablZ6YW1weFpIaHJhbkZzZVhOaklpd2ljbTlzWlNJNkltRnViMjRpTENKcFlYUWlPakUzTXpReE1qTTJOekVzSW1WNGNDSTZNakEwT1RZNU9UWTNNWDAuM1U1VXFhb3VfMVNnclZlMWVvOXJBcGMwdUtqcWhwUWRVWGh2d1VIbVVmZw=="

ReadestSync.default_settings = {
    supabase_url = "https://readest.supabase.co",
    supabase_anon_key = sha2.base64_to_bin(SUPABAE_ANON_KEY_BASE64),
    auto_sync = false,
    user_email = nil,
    user_id = nil,
    access_token = nil,
    refresh_token = nil,
    expires_at = nil,
    expires_in = nil,
    last_sync_at = nil,
}

function ReadestSync:init()
    self.last_sync_timestamp = 0
    self.settings = G_reader_settings:readSetting("readest_sync", self.default_settings)

    self:onDispatcherRegisterActions()
    self.ui.menu:registerToMainMenu(self)
end

function ReadestSync:onDispatcherRegisterActions()
   --
end

function ReadestSync:addToMainMenu(menu_items)
    menu_items.readest_sync = {
        sorting_hint = "tools",
        text = _("Readest Sync"),
        sub_item_table = {
            {
                text_func = function()
                    return self.settings.access_token and (_("Logout"))
                        or _("Login with Readest Account")
                end,
                callback_func = function()
                    if self.settings.access_token then
                        return function(menu)
                            self:logout(menu)
                        end
                    else
                        return function(menu)
                            self:login(menu)
                        end
                    end
                end,
                separator = true,
            },
            {
                text = _("Auto sync book configs"),
                checked_func = function() return self.settings.auto_sync end,
                callback = function()
                    self.settings.auto_sync = not self.settings.auto_sync
                    if self.settings.auto_sync then
                        self:pullBookConfig(false)
                    end
                end,
                separator = true,
            },
            {
                text = _("Push book config now"),
                enabled_func = function()
                    return self.settings.access_token ~= nil
                end,
                callback = function()
                    self:pushBookConfig(true)
                end,
            },
            {
                text = _("Pull book config now"),
                enabled_func = function()
                    return self.settings.access_token ~= nil
                end,
                callback = function()
                    self:pullBookConfig(true)
                end,
            },
        }
    }
end

function ReadestSync:getSupabaseAuthClient()
    if not self.settings.supabase_url or not self.settings.supabase_anon_key then
        return nil
    end

    local SupabaseAuthClient = require("supabaseauth")
    return SupabaseAuthClient:new{
        service_spec = self.path .. "/supabase-auth-api.json",
        custom_url = self.settings.supabase_url .. "/auth/v1/",
        api_key = self.settings.supabase_anon_key,
    }
end

function ReadestSync:getReadestSyncClient()
    if not self.settings.access_token or not self.settings.expires_at or self.settings.expires_at < os.time() then
        return nil
    end

    local ReadestSyncClient = require("readestsync")
    return ReadestSyncClient:new{
        service_spec = self.path .. "/readest-sync-api.json",
        access_token = self.settings.access_token,
    }
end

function ReadestSync:login(menu)
    if NetworkMgr:willRerunWhenOnline(function() self:login(menu) end) then
        return
    end

    local dialog
    dialog = MultiInputDialog:new{
        title = self.title,
        fields = {
            {
                text = self.settings.user_email,
                hint = "email@example.com",
            },
            {
                hint = "password",
                text_type = "password",
            },
        },
        buttons = {
            {
                {
                    text = _("Cancel"),
                    id = "close",
                    callback = function()
                        UIManager:close(dialog)
                    end,
                },
                {
                    text = _("Login"),
                    callback = function()
                        local email, password = unpack(dialog:getFields())
                        email = util.trim(email)
                        if email == "" or password == "" then
                            UIManager:show(InfoMessage:new{
                                text = _("Please enter both email and password"),
                                timeout = 2,
                            })
                            return
                        end
                        UIManager:close(dialog)
                        self:doLogin(email, password, menu)
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function ReadestSync:doLogin(email, password, menu)
    local client = self:getSupabaseAuthClient()
    if not client then
        UIManager:show(InfoMessage:new{
            text = _("Please configure Supabase URL and API key first"),
            timeout = 3,
        })
        return
    end

    UIManager:show(InfoMessage:new{
        text = _("Logging in..."),
        timeout = 1,
    })

    Device:setIgnoreInput(true)
    local success, response = client:sign_in_password(email, password)
    Device:setIgnoreInput(false)

    if success then
        self.settings.user_email = email
        self.settings.user_id = response.user.id
        self.settings.access_token = response.access_token
        self.settings.refresh_token = response.refresh_token
        self.settings.expires_at = response.expires_at
        self.settings.expires_in = response.expires_in
        
        if menu then
            menu:updateItems()
        end
        
        UIManager:show(InfoMessage:new{
            text = _("Successfully logged in to Readest"),
            timeout = 3,
        })
    else
        UIManager:show(InfoMessage:new{
            text = _("Login failed: ") .. (response.message or "Unknown error"),
            timeout = 3,
        })
    end
end

function ReadestSync:logout(menu)
    if self.access_token then
        local client = self:getSupabaseAuthClient()
        if client then
            client:sign_out(self.settings.access_token, function(success, response)
                logger.dbg("ReadestSync: Sign out result:", success)
            end)
        end
    end

    self.settings.access_token = nil
    self.settings.refresh_token = nil
    self.settings.expires_at = nil
    self.settings.expires_in = nil

    if menu then
        menu:updateItems()
    end
    
    UIManager:show(InfoMessage:new{
        text = _("Logged out from Readest Sync"),
        timeout = 2,
    })
end

function ReadestSync:getDocumentIdentifier()
    return self.ui.doc_settings:readSetting("partial_md5_checksum")
end

function ReadestSync:applyBookConfig(config)
    logger.dbg("ReadestSync: Applying book config:", config)
    local location_xp = config.location_xp
    local progress = config.progress
    -- Check if it's the bracket format: [page,total_pages]
    local progress_pattern = "^%[(%d+),(%d+)%]$"
    local page, total_pages = progress:match(progress_pattern)
    if location_xp then
        -- TODO
        return
    end
    if page and total_pages then
        local percentage = tonumber(page) / tonumber(total_pages)
        local current_page = self.ui.document:getCurrentPage()
        local page_count = self.ui.document:getPageCount()
        if page_count > 0 and current_page / page_count < percentage then
            self.ui.link:addCurrentLocationToStack()
            self.ui:handleEvent(Event:new("GotoPercent", percentage * 100))
        end
    end
end

function ReadestSync:pushBookConfig(interactive)
    if not self.settings.access_token or not self.settings.user_id then
        if interactive then
            UIManager:show(InfoMessage:new{
                text = _("Please login first"),
                timeout = 2,
            })
        end
        return
    end

    local now = UIManager:getElapsedTimeSinceBoot()
    if not interactive and now - self.last_sync_timestamp <= API_CALL_DEBOUNCE_DELAY then
        logger.dbg("ReadestSync: Debouncing push request")
        return
    end

    local book_hash = self:getDocumentIdentifier()
    if not book_hash then return end

    local config = self:getCurrentBookConfig()
    if not config then return end

    if NetworkMgr:willRerunWhenOnline(function() self:pushBookConfig(interactive) end) then
        return
    end

    -- Use Supabase REST API to upsert book config
    local url = self.settings.supabase_url .. "/rest/v1/book_configs"
    local payload = {
        user_id = self.user_id,
        hash = document_id,
        config = config,
        updated_at = os.date("!%Y-%m-%dT%H:%M:%SZ")
    }

    local client = self:getReadestSyncClient()
    if not client then
        if interactive then
            UIManager:show(InfoMessage:new{
                text = _("Please configure Supabase settings first"),
                timeout = 3,
            })
        end
        return
    end

    if interactive then
        UIManager:show(InfoMessage:new{
            text = _("Pushing book config..."),
            timeout = 1,
        })
    end

    client:pushChanges(
        config,
        function(success, response)
            logger.dbg("ReadestSync: Push result:", success, response)
            if interactive then
                if success then
                    UIManager:show(InfoMessage:new{
                        text = _("Book config pushed successfully"),
                        timeout = 2,
                    })
                else
                    UIManager:show(InfoMessage:new{
                        text = _("Failed to push book config"),
                        timeout = 2,
                    })
                end
            end
            if success then
                self.last_sync_timestamp = time.now()
            end
        end
    )

end

function ReadestSync:pullBookConfig(interactive)
    if not self.settings.access_token or not self.settings.user_id then
        if interactive then
            UIManager:show(InfoMessage:new{
                text = _("Please login first"),
                timeout = 2,
            })
        end
        return
    end

    local book_hash = self:getDocumentIdentifier()
    if not book_hash then return end

    if NetworkMgr:willRerunWhenOnline(function() self:pullBookConfig(interactive) end) then
        return
    end

    local client = self:getReadestSyncClient()
    if not client then
        if interactive then
            UIManager:show(InfoMessage:new{
                text = _("Please configure Supabase settings first"),
                timeout = 3,
            })
        end
        return
    end

    if interactive then
        UIManager:show(InfoMessage:new{
            text = _("Pulling book config..."),
            timeout = 1,
        })
    end

    client:pullChanges(
        {
            since = 0,
            type = "configs",
            book = book_hash,
        },
        function(success, response)
            logger.dbg("ReadestSync: Pull result:", success, response)
            if not success then
                if interactive then
                    UIManager:show(InfoMessage:new{
                        text = _("Failed to pull book config"),
                        timeout = 2,
                    })
                end
                return
            end

            local data = response.configs
            if data and #data > 0 then
                local config = data[1]
                if config then
                    self:applyBookConfig(config)
                    if interactive then
                        UIManager:show(InfoMessage:new{
                            text = _("Book config synchronized"),
                            timeout = 2,
                        })
                    end
                    return
                end
            end
            
            if interactive then
                UIManager:show(InfoMessage:new{
                    text = _("No saved config found for this book"),
                    timeout = 2,
                })
            end
        end
    )
end

function ReadestSync:onReaderReady()
    if self.settings.auto_sync and self.settings.access_token then
        UIManager:nextTick(function()
            self:pullBookConfig(false)
        end)
    end
end

function ReadestSync:onCloseDocument()
    if self.settings.auto_sync and self.settings.access_token then
        NetworkMgr:goOnlineToRun(function()
            self:pushBookConfig(false)
        end)
    end
end

function ReadestSync:onPageUpdate(page)
    if self.settings.auto_sync and self.settings.access_token and page then
        -- Schedule a delayed push to avoid too frequent updates
        UIManager:unschedule(self.delayed_push_task)
        self.delayed_push_task = function()
            self:pushBookConfig(false)
        end
        UIManager:scheduleIn(5, self.delayed_push_task)
    end
end

function ReadestSync:onCloseWidget()
    if self.delayed_push_task then
        UIManager:unschedule(self.delayed_push_task)
        self.delayed_push_task = nil
    end
end

return ReadestSync