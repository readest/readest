local UIManager = require("ui/uimanager")
local logger = require("logger")
local socketutil = require("socketutil")

-- Auth operation timeouts
local AUTH_TIMEOUTS = { 5, 10 }
-- Token refresh timeouts
local REFRESH_TIMEOUTS = { 3, 7 }

local SupabaseAuthClient = {
    service_spec = nil,
    api_key = nil,
}

-- Normalize the outcome of a Spore call so every endpoint hands callers a
-- table they can read `.msg` off unconditionally. When the request raises (no
-- network, TLS failure, timeout, unexpected status) pcall returns an error
-- string, and indexing a string with `.body` silently yields nil rather than
-- erroring - which is how a failed login used to reach the UI as nil.
local function unwrap(name, expected_status, ok, res)
    if not ok then
        logger.dbg("SupabaseAuthClient:" .. name .. " failure:", res)
        return false, { msg = tostring(res) }
    end
    return res.status == expected_status, res.body or {}
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

    package.loaded["Spore.Middleware.AsyncHTTP"] = {}
    require("Spore.Middleware.AsyncHTTP").call = function(args, req)
        -- disable async http if Turbo looper is missing
        if not UIManager.looper then return end
        req:finalize()
        local result
        require("httpclient"):new():request({
            url = req.url,
            method = req.method,
            body = req.env.spore.payload,
            on_headers = function(headers)
                for header, value in pairs(req.headers) do
                    if type(header) == "string" then
                        headers:add(header, value)
                    end
                end
            end,
        }, function(res)
            result = res
            -- Turbo HTTP client uses code instead of status
            -- change to status so that Spore can understand
            result.status = res.code
            coroutine.resume(args.thread)
        end)
        return coroutine.create(function() coroutine.yield(result) end)
    end
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
    self.client:enable("AsyncHTTP", {thread = co})
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
    self.client:enable("AsyncHTTP", {thread = co})
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
    self.client:enable("AsyncHTTP", {thread = co})
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
    self.client:enable("AsyncHTTP", {thread = co})
    coroutine.resume(co)
    if UIManager.looper then UIManager:setInputTimeout() end
    socketutil:reset_timeout()
end

return SupabaseAuthClient