local ConfirmBox = require("ui/widget/confirmbox")
local Device = require("device")
local InfoMessage = require("ui/widget/infomessage")
local MultiInputDialog = require("ui/widget/multiinputdialog")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local util = require("util")
local T = require("ffi/util").template
local _ = require("readest_i18n")

local SyncAuth = {}
local refreshes = setmetatable({}, { __mode = "k" })

function SyncAuth:needsLogin(settings)
    return not settings.access_token or not settings.expires_at
        or settings.expires_at < os.time() + 60
end

function SyncAuth:tryRefreshToken(settings, path)
    self:withFreshToken(settings, path)
end

-- Block-style token refresh: runs the refresh (if needed)
-- and invokes `callback(ok, err)` after the new token is committed to
-- settings, OR immediately with ok=true if the token is still fresh.
--
-- Codex round 1 finding 14: ensureClient() in main.lua kicks off a refresh
-- and immediately builds a Spore client with whatever token was already in
-- settings — racy. New library API calls (pullBooks, getDownloadUrl) MUST go
-- through this wrapper so the request body never carries a stale Bearer
-- header.
function SyncAuth:withFreshToken(settings, path, callback, force)
    local pending = refreshes[settings]
    if pending then
        if callback then table.insert(pending.callbacks, callback) end
        return
    end
    if not force and settings.access_token and settings.expires_at
            and settings.expires_at >= os.time() + math.max(60, (settings.expires_in or 0) / 2) then
        if callback then callback(true) end
        return
    end
    if not settings.refresh_token then
        if callback then callback(false, "session expired") end
        return
    end
    local client = self:getSupabaseAuthClient(settings, path)
    if not client then
        if callback then callback(false, "no auth client") end
        return
    end

    local refresh_token = settings.refresh_token
    pending = { callbacks = callback and { callback } or {} }
    refreshes[settings] = pending
    local function finish(success, response, status)
        if refreshes[settings] ~= pending then return end
        refreshes[settings] = nil
        UIManager:unschedule(pending.timeout)
        local err
        if settings.refresh_token ~= refresh_token then
            -- Logout/login happened while the request was in flight.
            success = false
            err = "session changed"
        elseif success and type(response) == "table" and response.access_token
                and response.refresh_token and (response.expires_at or response.expires_in) then
            settings.access_token = response.access_token
            settings.refresh_token = response.refresh_token
            settings.expires_in = response.expires_in
            settings.expires_at = response.expires_at or (os.time() + response.expires_in)
            local saved, save_err = pcall(function()
                G_reader_settings:saveSetting("readest_sync", settings)
                G_reader_settings:flush() -- rotating refresh tokens must survive an unclean exit
            end)
            if not saved then logger.err("ReadestSync: could not persist refreshed session:", save_err) end
        else
            success = false
            err = type(response) == "table" and response.msg or "refresh failed"
            logger.err("ReadestSync: Token refresh failed:", status, err)
            if status == 400 or status == 401 or status == 403 then
                err = "session expired"
                self:expireSession(settings, path, refresh_token)
            end
        end
        for _, cb in ipairs(pending.callbacks) do
            local ok, callback_err = pcall(cb, success, err)
            if not ok then logger.err("ReadestSync: refresh callback failed:", callback_err) end
        end
    end
    pending.timeout = function() finish(false, { msg = "refresh timeout" }) end
    UIManager:scheduleIn(20, pending.timeout)
    local ok, err = pcall(function() client:refresh_token(refresh_token, finish) end)
    if not ok then finish(false, { msg = tostring(err) }) end
end

-- Capture RPC payloads immediately (including close-time progress), but send
-- them only after token refresh completes. A rejected access token gets one
-- refresh/retry; only a rejected refresh token expires the whole session.
function SyncAuth:getAuthenticatedClient(settings, path)
    return setmetatable({}, { __index = function(_, method)
        return function(_, args, callback)
            local function dispatch(retried)
                local client = self:getReadestSyncClient(settings, path)
                if not client then callback(false, { error = "No valid access token" }); return end
                local token = settings.access_token
                client[method](client, args, function(ok, body, status)
                    if not ok and not retried and (status == 401 or status == 403) then
                        if settings.access_token and settings.access_token ~= token then dispatch(true); return end
                        self:withFreshToken(settings, path, function(fresh, err)
                            if fresh then dispatch(true)
                            else callback(false, { error = err }) end
                        end, true)
                    else
                        callback(ok, body, status)
                    end
                end)
            end
            self:withFreshToken(settings, path, function(ok, err)
                if ok then dispatch(false)
                else callback(false, { error = err }) end
            end)
        end
    end })
end

function SyncAuth:expireSession(settings, path, rejected_token)
    -- A concurrent refresh may already have saved new tokens, or an earlier
    -- rejection already expired the session: only drop the token that failed.
    if settings.refresh_token ~= rejected_token then return end
    settings.access_token = nil
    settings.refresh_token = nil
    settings.expires_at = nil
    settings.expires_in = nil
    G_reader_settings:saveSetting("readest_sync", settings)

    UIManager:show(ConfirmBox:new{
        text = _("Your Readest session has expired. Please log in again."),
        ok_text = _("Login"),
        ok_callback = function()
            self:login(settings, path, _("Log in Readest Account"))
        end,
    })
end

function SyncAuth:getSupabaseAuthClient(settings, path)
    if not settings.supabase_url or not settings.supabase_anon_key then
        return nil
    end

    local SupabaseAuthClient = require("readest_supabaseauth")
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

    local ReadestSyncClient = require("readest_syncclient")
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
        settings.expires_at = response.expires_at or (response.expires_in and os.time() + response.expires_in)
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
            text = T(_("Login failed: %1"), response and response.msg or _("unknown error")),
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
