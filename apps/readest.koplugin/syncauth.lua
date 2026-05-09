local Device = require("device")
local InfoMessage = require("ui/widget/infomessage")
local MultiInputDialog = require("ui/widget/multiinputdialog")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local util = require("util")
local T = require("ffi/util").template
local _ = require("i18n")

local SyncAuth = {}

function SyncAuth:needsLogin(settings)
    return not settings.access_token or not settings.expires_at
        or settings.expires_at < os.time() + 60
end

function SyncAuth:tryRefreshToken(settings, path)
    if settings.refresh_token and settings.expires_at
        and settings.expires_at < os.time() + settings.expires_in / 2 then
        local client = self:getSupabaseAuthClient(settings, path)
        client:refresh_token(settings.refresh_token, function(success, response)
            if success then
                settings.access_token = response.access_token
                settings.refresh_token = response.refresh_token
                settings.expires_at = response.expires_at
                settings.expires_in = response.expires_in
                G_reader_settings:saveSetting("readest_sync", settings)
            else
                logger.err("ReadestSync: Token refresh failed:", response or "Unknown error")
            end
        end)
    end
end

-- Block-style wrapper around tryRefreshToken: runs the refresh (if needed)
-- and invokes `callback(ok, err)` after the new token is committed to
-- settings, OR immediately with ok=true if the token is still fresh.
--
-- Codex round 1 finding 14: ensureClient() in main.lua kicks off a refresh
-- and immediately builds a Spore client with whatever token was already in
-- settings — racy. New library API calls (pullBooks, getDownloadUrl) MUST go
-- through this wrapper so the request body never carries a stale Bearer
-- header.
function SyncAuth:withFreshToken(settings, path, callback)
    -- Token still has > 50% TTL remaining: nothing to do.
    if not settings.refresh_token or not settings.expires_at
        or settings.expires_at >= os.time() + (settings.expires_in or 0) / 2 then
        if callback then callback(true) end
        return
    end

    local client = self:getSupabaseAuthClient(settings, path)
    if not client then
        if callback then callback(false, "no auth client") end
        return
    end

    client:refresh_token(settings.refresh_token, function(success, response)
        if success then
            settings.access_token  = response.access_token
            settings.refresh_token = response.refresh_token
            settings.expires_at    = response.expires_at
            settings.expires_in    = response.expires_in
            G_reader_settings:saveSetting("readest_sync", settings)
            if callback then callback(true) end
        else
            logger.err("ReadestSync: Token refresh failed:", response or "Unknown error")
            if callback then callback(false, response and response.msg or "refresh failed") end
        end
    end)
end

function SyncAuth:getSupabaseAuthClient(settings, path)
    if not settings.supabase_url or not settings.supabase_anon_key then
        return nil
    end

    local SupabaseAuthClient = require("supabaseauth")
    return SupabaseAuthClient:new{
        service_spec = path .. "/supabase-auth-api.json",
        custom_url = settings.supabase_url .. "/auth/v1/",
        api_key = settings.supabase_anon_key,
    }
end

function SyncAuth:getReadestSyncClient(settings, path)
    if not settings.access_token or not settings.expires_at or settings.expires_at < os.time() then
        return nil
    end

    local ReadestSyncClient = require("readestsync")
    return ReadestSyncClient:new{
        service_spec = path .. "/readest-sync-api.json",
        access_token = settings.access_token,
    }
end

function SyncAuth:login(settings, path, title, menu)
    if NetworkMgr:willRerunWhenOnline(function() self:login(settings, path, title, menu) end) then
        return
    end

    local dialog
    dialog = MultiInputDialog:new{
        title = title,
        fields = {
            {
                text = settings.user_email,
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
                        self:doLogin(settings, path, email, password, menu)
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function SyncAuth:doLogin(settings, path, email, password, menu)
    local client = self:getSupabaseAuthClient(settings, path)
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
        settings.user_email = email
        settings.user_id = response.user.id
        settings.user_name = response.user.user_metadata.user_name or email
        settings.access_token = response.access_token
        settings.refresh_token = response.refresh_token
        settings.expires_at = response.expires_at
        settings.expires_in = response.expires_in
        G_reader_settings:saveSetting("readest_sync", settings)

        if menu then
            menu:updateItems()
        end

        UIManager:show(InfoMessage:new{
            text = _("Successfully logged in to Readest"),
            timeout = 3,
        })
    else
        UIManager:show(InfoMessage:new{
            text = T(_("Login failed: %1"), response.msg or _("unknown error")),
            timeout = 3,
        })
    end
end

function SyncAuth:logout(settings, path, menu)
    if settings.access_token then
        local client = self:getSupabaseAuthClient(settings, path)
        if client then
            client:sign_out(settings.access_token, function(success, _response)
                logger.dbg("ReadestSync: Sign out result:", success)
            end)
        end
    end

    settings.access_token = nil
    settings.refresh_token = nil
    settings.expires_at = nil
    settings.expires_in = nil
    G_reader_settings:saveSetting("readest_sync", settings)

    if menu then
        menu:updateItems()
    end

    UIManager:show(InfoMessage:new{
        text = _("Logged out from Readest"),
        timeout = 2,
    })
end

return SyncAuth
