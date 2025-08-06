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
    if ok then
        return res.status == 200, res.body
    else
        logger.dbg("SupabaseAuthClient:sign_in_password failure:", res)
        return false, res.body
    end
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
        if ok then
            callback(res.status == 200, res.body)
        else
            logger.dbg("SupabaseAuthClient:sign_in_otp failure:", res)
            callback(false, res.body)
        end
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
    if ok then
        return res.status == 200, res.body
    else
        logger.dbg("SupabaseAuthClient:verify_otp failure:", res)
        return false, res.body
    end
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
        if ok then
            callback(res.status == 200, res.body)
        else
            logger.dbg("SupabaseAuthClient:refresh_token failure:", res)
            callback(false, res.body)
        end
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
        if ok then
            callback(res.status == 204, res.body)
        else
            logger.dbg("SupabaseAuthClient:sign_out failure:", res)
            callback(false, res.body)
        end
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
        if ok then
            callback(res.status == 200, res.body)
        else
            logger.dbg("SupabaseAuthClient:get_user failure:", res)
            callback(false, res.body)
        end
    end)
    self.client:enable("AsyncHTTP", {thread = co})
    coroutine.resume(co)
    if UIManager.looper then UIManager:setInputTimeout() end
    socketutil:reset_timeout()
end

return SupabaseAuthClient