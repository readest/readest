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
local SyncError = require("readest_syncerror")

local SyncAuth = {}
-- Waiters are released after REFRESH_WAIT; the transport ends a refresh at
-- its own hard limit (150s). Past REFRESH_ABANDON the coordinator stops
-- tracking it so a lost callback cannot block every later refresh.
local REFRESH_WAIT = 20
local REFRESH_ABANDON = 180
-- RPCs exposed by getAuthenticatedClient (see readest_syncclient).
local RPC_METHODS = {
    pullChanges = true, pushChanges = true, pullBooks = true, getDownloadUrl = true,
    listFiles = true, deleteFile = true, getUploadUrl = true,
}
local refreshes = setmetatable({}, { __mode = "k" })
local login_prompts = setmetatable({}, { __mode = "k" })

-- `stage` names where an auth failure happened; SyncError.describe logs it.
local function authError(err, stage)
    return {
        error = err,
        stage = stage,
        auth_required = (err == "session expired" or err == "authentication required") or nil,
    }
end

local function missingTokenError(settings)
    if not settings.access_token then return "No valid access token (not logged in)" end
    if not settings.expires_at then return "No valid access token (unknown expiry)" end
    return string.format("No valid access token (expired %ds ago)", os.time() - settings.expires_at)
end

local function notifyCallbacks(pending, success, err)
    local callbacks = pending.callbacks
    pending.callbacks = {}
    for _, cb in ipairs(callbacks) do
        local ok, callback_err = pcall(cb, success, err)
        if not ok then logger.err("ReadestSync: refresh callback failed:", callback_err) end
    end
end

function SyncAuth:needsLogin(settings)
    return settings.auth_required or not settings.access_token or not settings.expires_at
        or settings.expires_at < os.time() + 60
end

function SyncAuth:isAuthenticationError(body, status)
    -- A generic 403 can mean quota or permission denial, not an invalid JWT.
    return status == 401 or (type(body) == "table" and body.error == "Not authenticated")
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
    if settings.auth_required then
        if callback then callback(false, "authentication required") end
        return
    end
    local pending = refreshes[settings]
    if pending and pending.refresh_token ~= settings.refresh_token then
        refreshes[settings] = nil
        UIManager:unschedule(pending.timeout)
        notifyCallbacks(pending, false, "session changed")
        return self:withFreshToken(settings, path, callback, force)
    end
    if pending then
        if callback then
            if pending.timed_out then callback(false, "refresh timeout")
            else table.insert(pending.callbacks, callback) end
        end
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
    pending = { callbacks = callback and { callback } or {}, refresh_token = refresh_token }
    refreshes[settings] = pending
    local function finish(success, response, status)
        if refreshes[settings] ~= pending then return end
        refreshes[settings] = nil
        UIManager:unschedule(pending.timeout)
        UIManager:unschedule(pending.abandon)
        local err, show_login
        if settings.refresh_token ~= refresh_token then
            -- Logout/login happened while the request was in flight.
            success = false
            err = "session changed"
        elseif success and type(response) == "table" and response.access_token
                and response.refresh_token and (response.expires_at or response.expires_in) then
            if not settings.auth_required then settings.access_token = response.access_token end
            settings.refresh_token = response.refresh_token
            settings.expires_in = response.expires_in
            -- Device clocks are often wrong: track expiry on the local clock.
            settings.expires_at = response.expires_in and (os.time() + response.expires_in)
                or response.expires_at
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
                show_login = self:expireSession(settings, path, refresh_token, true)
            end
        end
        notifyCallbacks(pending, success, err)
        if show_login then show_login() end
    end
    pending.timeout = function()
        if refreshes[settings] ~= pending then return end
        -- Stop waiting in the UI without abandoning a token rotation or
        -- starting another request with the same in-flight refresh token.
        pending.timed_out = true
        notifyCallbacks(pending, false, "refresh timeout")
    end
    pending.abandon = function()
        if refreshes[settings] ~= pending then return end
        logger.warn("ReadestSync: abandoning a token refresh that never completed")
        refreshes[settings] = nil
        UIManager:unschedule(pending.timeout)
        notifyCallbacks(pending, false, "refresh timeout")
    end
    UIManager:scheduleIn(REFRESH_WAIT, pending.timeout)
    UIManager:scheduleIn(REFRESH_ABANDON, pending.abandon)
    local ok, err = pcall(function() client:refresh_token(refresh_token, finish) end)
    if not ok then finish(false, { msg = tostring(err) }) end
end

-- Capture RPC payloads immediately (including close-time progress), but send
-- them only after token refresh completes. A rejected access token gets one
-- refresh/retry. Rejected refresh tokens expire the session; persistent JWT
-- rejection pauses syncing until login without revoking the refresh token.
-- `can_dispatch`, when given, is checked before every send (including the
-- retry), since a refresh wait can outlive the caller's sync context.
function SyncAuth:getAuthenticatedClient(settings, path, can_dispatch)
    return setmetatable({}, { __index = function(_, method)
        if not RPC_METHODS[method] then return nil end
        return function(_, args, callback)
            local function complete(ok, body, status, show_login)
                -- Clear credentials before callbacks, but show the prompt last
                -- so failure messages cannot cover it, even if a callback raises.
                local called, err = pcall(callback, ok, body, status)
                if show_login then show_login() end
                if not called then error(err) end
            end
            -- Failures decided here never reach the transport, which logs its own.
            local function fail(body, status, show_login)
                if body.error ~= "sync cancelled" then
                    logger.warn("ReadestSync: " .. method .. " failed:", SyncError.describe(body, status))
                end
                complete(false, body, status, show_login)
            end
            local function dispatch(retried)
                if can_dispatch and not can_dispatch() then fail({ error = "sync cancelled" }); return end
                if settings.auth_required then fail(authError("authentication required")); return end
                local client = self:getReadestSyncClient(settings, path)
                if not client then fail({ error = missingTokenError(settings) }); return end
                local token = settings.access_token
                client[method](client, args, function(ok, body, status)
                    if not ok and settings.auth_required then
                        fail(authError("authentication required"), status)
                    elseif not ok and not settings.refresh_token and not settings.access_token then
                        fail(authError("session expired"), status)
                    elseif not ok and self:isAuthenticationError(body, status) then
                        if retried then
                            if settings.access_token ~= token then fail({ error = "session changed" }, status); return end
                            local show_login = self:requireLogin(settings, path, token)
                            fail(authError("authentication required"), status, show_login)
                            return
                        end
                        if settings.access_token and settings.access_token ~= token then dispatch(true); return end
                        self:withFreshToken(settings, path, function(fresh, err)
                            if fresh then dispatch(true)
                            else fail(authError(err, "token refresh after HTTP " .. tostring(status))) end
                        end, true)
                    else
                        complete(ok, body, status)
                    end
                end)
            end
            self:withFreshToken(settings, path, function(ok, err)
                if ok then dispatch(false)
                else fail(authError(err, "token refresh")) end
            end)
        end
    end })
end

function SyncAuth:showLoginPrompt(settings, path, expired)
    if login_prompts[settings] then return end
    local function dismissed() login_prompts[settings] = nil end
    local prompt = ConfirmBox:new{
        text = expired and _("Your Readest session has expired. Please log in again.")
            or _("Authentication failed, please login again"),
        ok_text = _("Login"),
        ok_callback = function()
            dismissed()
            self:login(settings, path, _("Log in Readest Account"))
        end,
        cancel_callback = dismissed,
    }
    login_prompts[settings] = prompt
    UIManager:show(prompt)
end

function SyncAuth:requireLogin(settings, path, rejected_token)
    if not rejected_token or settings.access_token ~= rejected_token then return end
    settings.auth_required = true
    settings.access_token = nil -- stops automatic sync triggers
    G_reader_settings:saveSetting("readest_sync", settings)
    G_reader_settings:flush()
    return function()
        if settings.auth_required then self:showLoginPrompt(settings, path) end
    end
end

function SyncAuth:expireSession(settings, path, rejected_token, defer_prompt)
    -- A concurrent refresh may already have saved new tokens, or an earlier
    -- rejection already expired the session: only drop the token that failed.
    if not rejected_token or settings.refresh_token ~= rejected_token then return end
    settings.auth_required = nil
    settings.access_token = nil
    settings.refresh_token = nil
    settings.expires_at = nil
    settings.expires_in = nil
    G_reader_settings:saveSetting("readest_sync", settings)
    G_reader_settings:flush()
    local function show_login()
        if not settings.access_token and not settings.refresh_token then self:showLoginPrompt(settings, path, true) end
    end
    if defer_prompt then return show_login end
    show_login()
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
    if settings.auth_required or not settings.access_token or not settings.expires_at or settings.expires_at < os.time() then
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
    local success, response, status = client:sign_in_password(email, password)
    Device:setIgnoreInput(false)

    if success then
        settings.auth_required = nil
        settings.user_email = email
        settings.user_id = response.user.id
        settings.user_name = response.user.user_metadata.user_name or email
        settings.access_token = response.access_token
        settings.refresh_token = response.refresh_token
        settings.expires_at = response.expires_in and (os.time() + response.expires_in) or response.expires_at
        settings.expires_in = response.expires_in
        G_reader_settings:saveSetting("readest_sync", settings)
        if login_prompts[settings] then UIManager:close(login_prompts[settings]); login_prompts[settings] = nil end

        if menu then
            menu:updateItems()
        end

        UIManager:show(InfoMessage:new{
            text = _("Successfully logged in to Readest"),
            timeout = 3,
        })
    else
        UIManager:show(InfoMessage:new{
            text = T(_("Login failed: %1"), SyncError.reason(response, status)),
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

    settings.auth_required = nil
    if login_prompts[settings] then UIManager:close(login_prompts[settings]); login_prompts[settings] = nil end
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
