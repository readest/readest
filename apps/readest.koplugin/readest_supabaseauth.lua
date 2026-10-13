local UIManager = require("ui/uimanager")
local logger = require("logger")
local socketutil = require("socketutil")
local sporeResponse = require("readest_sporeresponse")

-- Auth operation timeouts
local AUTH_TIMEOUTS = { 5, 10 }
-- Token refresh timeouts
local REFRESH_TIMEOUTS = { 3, 7 }
-- Hard limit for a token refresh. UI waiters are released much earlier; this
-- only ends a request that will never finish (e.g. a stalled DNS lookup), so
-- a later refresh can start. A rotation lost past it requires a new login.
local REFRESH_DEADLINE = 150

local SupabaseAuthClient = {
    service_spec = nil,
    api_key = nil,
    REFRESH_DEADLINE = REFRESH_DEADLINE,
}

-- Normalize the outcome of a Spore call so every endpoint hands callers a
-- table with a message, including Spore's wrapped HTTP exceptions.
local function unwrap(name, expected_status, ok, res)
    local response, reason = sporeResponse(res)
    local status = response and response.status
    local body = response and response.body
    if ok and status == expected_status then return true, body or {}, status end
    logger.dbg("SupabaseAuthClient:" .. name .. " failure:", reason or status or tostring(res))
    if type(body) ~= "table" then
        body = { msg = type(body) == "string" and body ~= "" and body
            or reason or (status and ("HTTP " .. status)) or tostring(res) }
    elseif not body.msg then
        body.msg = body.message or body.error_description or body.error
            or reason or (status and ("HTTP " .. status)) or "request failed"
    end
    return false, body, status
end

function SupabaseAuthClient:new(o)
    if o == nil then o = {} end
    setmetatable(o, self)
    self.__index = self
    if o.init then o:init() end
    return o
end

function SupabaseAuthClient:init()
    local Spore = require("Spore")
    self.client = Spore.new_from_spec(self.service_spec)
    
    -- Supabase API headers middleware
    package.loaded["Spore.Middleware.SupabaseHeaders"] = {}
    require("Spore.Middleware.SupabaseHeaders").call = function(args, req)
        req.headers["apikey"] = args.api_key
        req.headers["content-type"] = "application/json"
        req.headers["accept"] = "application/json"
    end
    
    -- Supabase Bearer token auth middleware
    package.loaded["Spore.Middleware.SupabaseAuth"] = {}
    require("Spore.Middleware.SupabaseAuth").call = function(args, req)
        if args.access_token then
            req.headers["authorization"] = "Bearer " .. args.access_token
        end
    end

    package.loaded["Spore.Middleware.AsyncHTTP"] = require("readest_asynchttp")

end

function SupabaseAuthClient:sign_in_password(email, password)
    self.client:reset_middlewares()
    self.client:enable("Format.JSON")
    self.client:enable("SupabaseHeaders", {
        api_key = self.api_key,
    })
    socketutil:set_timeout(AUTH_TIMEOUTS[1], AUTH_TIMEOUTS[2])
    local ok, res = pcall(function()
        return self.client:sign_in_password({
            email = email,
            password = password,
        })
    end)
    socketutil:reset_timeout()
    return unwrap("sign_in_password", 200, ok, res)
end

function SupabaseAuthClient:sign_in_otp(email, callback)
    self.client:reset_middlewares()
    self.client:enable("Format.JSON")
    self.client:enable("SupabaseHeaders", {
        api_key = self.api_key,
    })
    socketutil:set_timeout(AUTH_TIMEOUTS[1], AUTH_TIMEOUTS[2])
    local co = coroutine.create(function()
        local ok, res = pcall(function()
            return self.client:sign_in_otp({
                email = email,
            })
        end)
        callback(unwrap("sign_in_otp", 200, ok, res))
    end)
    self.client:enable("AsyncHTTP", {thread = co, timeout = 15})
    coroutine.resume(co)
    if UIManager.looper then UIManager:setInputTimeout() end
    socketutil:reset_timeout()
end

function SupabaseAuthClient:verify_otp(email, token, type)
    self.client:reset_middlewares()
    self.client:enable("Format.JSON")
    self.client:enable("SupabaseHeaders", {
        api_key = self.api_key,
    })
    socketutil:set_timeout(AUTH_TIMEOUTS[1], AUTH_TIMEOUTS[2])
    local ok, res = pcall(function()
        return self.client:verify_otp({
            email = email,
            token = token,
            type = type or "email",
        })
    end)
    socketutil:reset_timeout()
    return unwrap("verify_otp", 200, ok, res)
end

function SupabaseAuthClient:refresh_token(refresh_token, callback)
    -- DNS stalls must not block reader input. Keep the worker alive past the
    -- caller's wait so a successful rotation can still be persisted.
    if not UIManager.looper and require("ffi/util").runInSubProcess then
        local worker = {
            client = self.client,
            _prepare = function()
                self.client:reset_middlewares()
                self.client:enable("Format.JSON")
                self.client:enable("SupabaseHeaders", { api_key = self.api_key })
            end,
        }
        require("readest_syncclient")._dispatchInSubprocess(worker, "refresh_token",
            { refresh_token = refresh_token }, REFRESH_TIMEOUTS,
            function(ok, res) callback(unwrap("refresh_token", 200, ok, res)) end,
            { deadline = REFRESH_DEADLINE })
        return
    end
    self.client:reset_middlewares()
    self.client:enable("Format.JSON")
    self.client:enable("SupabaseHeaders", {
        api_key = self.api_key,
    })
    socketutil:set_timeout(REFRESH_TIMEOUTS[1], REFRESH_TIMEOUTS[2])
    local co = coroutine.create(function()
        local ok, res = pcall(function()
            return self.client:refresh_token({
                refresh_token = refresh_token,
            })
        end)
        callback(unwrap("refresh_token", 200, ok, res))
    end)
    -- The coordinator's UI wait ends sooner; a late HTTP response must still
    -- resume this coroutine unless the request outlives the hard limit.
    self.client:enable("AsyncHTTP", {thread = co, timeout = REFRESH_DEADLINE})
    coroutine.resume(co)
    if UIManager.looper then UIManager:setInputTimeout() end
    socketutil:reset_timeout()
end

function SupabaseAuthClient:sign_out(access_token, callback)
    self.client:reset_middlewares()
    self.client:enable("Format.JSON")
    self.client:enable("SupabaseHeaders", {
        api_key = self.api_key,
    })
    self.client:enable("SupabaseAuth", {
        access_token = access_token,
    })
    socketutil:set_timeout(AUTH_TIMEOUTS[1], AUTH_TIMEOUTS[2])
    local co = coroutine.create(function()
        local ok, res = pcall(function()
            return self.client:sign_out()
        end)
        callback(unwrap("sign_out", 204, ok, res))
    end)
    self.client:enable("AsyncHTTP", {thread = co, timeout = 15})
    coroutine.resume(co)
    if UIManager.looper then UIManager:setInputTimeout() end
    socketutil:reset_timeout()
end

function SupabaseAuthClient:get_user(access_token, callback)
    self.client:reset_middlewares()
    self.client:enable("Format.JSON")
    self.client:enable("SupabaseHeaders", {
        api_key = self.api_key,
    })
    self.client:enable("SupabaseAuth", {
        access_token = access_token,
    })
    socketutil:set_timeout(AUTH_TIMEOUTS[1], AUTH_TIMEOUTS[2])
    local co = coroutine.create(function()
        local ok, res = pcall(function()
            return self.client:get_user()
        end)
        callback(unwrap("get_user", 200, ok, res))
    end)
    self.client:enable("AsyncHTTP", {thread = co, timeout = 15})
    coroutine.resume(co)
    if UIManager.looper then UIManager:setInputTimeout() end
    socketutil:reset_timeout()
end

return SupabaseAuthClient
