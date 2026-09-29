-- syncauth_spec.lua
-- Regression tests for the login failure path.
--
-- When the HTTP request raises (no network, TLS failure, timeout), the pcall
-- inside SupabaseAuthClient hands back an error *string*, not a response
-- table. Indexing a string with `.body` silently yields nil, so the client
-- used to return `false, nil` and SyncAuth:doLogin then crashed on
-- `response.msg`.

require("spec_helper")
require("spec.koreader_stubs")

-- The Spore client the module builds in init(); each test swaps in its own.
local spore_client

package.preload["Spore"] = function()
    return {
        new_from_spec = function() return spore_client end,
    }
end
package.preload["socketutil"] = function()
    return {
        set_timeout = function() end,
        reset_timeout = function() end,
    }
end

local UIManager = require("ui/uimanager")
local InfoMessage = require("ui/widget/infomessage")
local ffiutil = require("ffi/util")

-- readest_syncauth captures `T = require("ffi/util").template` in an upvalue
-- at load time, so the substituting version has to be installed *before* the
-- require below - patching it later would not reach the captured function.
ffiutil.template = function(str, ...)
    local args = { ... }
    return (str:gsub("%%(%d)", function(i) return tostring(args[tonumber(i)]) end))
end

local SupabaseAuthClient = require("readest_supabaseauth")
local SyncAuth = require("readest_syncauth")

-- A Spore client whose endpoint calls all behave the same way.
local function newAuthClient(endpoint)
    spore_client = {
        reset_middlewares = function() end,
        enable = function() end,
        sign_in_password = endpoint,
        verify_otp = endpoint,
        refresh_token = endpoint,
    }
    return SupabaseAuthClient:new{
        service_spec = "supabase-auth-api.json",
        api_key = "anon-key",
    }
end

describe("SupabaseAuthClient error propagation", function()
    it("returns a message table when sign_in_password raises", function()
        local client = newAuthClient(function()
            error("connection refused", 0)
        end)

        local ok, res = client:sign_in_password("reader@example.com", "hunter2")

        assert.is_false(ok)
        assert.is_table(res)
        assert.is_string(res.msg)
        assert.truthy(res.msg:find("connection refused", 1, true))
    end)

    it("returns a message table when verify_otp raises", function()
        local client = newAuthClient(function()
            error("connection refused", 0)
        end)

        local ok, res = client:verify_otp("reader@example.com", "123456")

        assert.is_false(ok)
        assert.is_table(res)
        assert.truthy(res.msg:find("connection refused", 1, true))
    end)

    it("delivers a message table to the refresh_token callback on failure", function()
        local client = newAuthClient(function()
            error("connection refused", 0)
        end)

        local got_ok, got_res
        client:refresh_token("stale-token", function(ok, res)
            got_ok, got_res = ok, res
        end)

        assert.is_false(got_ok)
        assert.is_table(got_res)
        assert.truthy(got_res.msg:find("connection refused", 1, true))
    end)

    it("passes the HTTP status of a rejected refresh to the callback", function()
        local client = newAuthClient(function()
            return { status = 400, body = { msg = "Invalid Refresh Token: Already Used" } }
        end)

        local got_ok, got_res, got_status
        client:refresh_token("revoked-token", function(ok, res, status)
            got_ok, got_res, got_status = ok, res, status
        end)

        assert.is_false(got_ok)
        assert.are.equal("Invalid Refresh Token: Already Used", got_res.msg)
        assert.are.equal(400, got_status)
    end)

    it("still forwards the parsed body on an HTTP error status", function()
        local client = newAuthClient(function()
            return { status = 400, body = { msg = "Invalid login credentials" } }
        end)

        local ok, res = client:sign_in_password("reader@example.com", "wrong")

        assert.is_false(ok)
        assert.are.equal("Invalid login credentials", res.msg)
    end)
end)

describe("SyncAuth:doLogin failure handling", function()
    local shown
    local sign_in_password
    local orig = {}

    before_each(function()
        shown = {}
        orig.getSupabaseAuthClient = SyncAuth.getSupabaseAuthClient
        orig.show = UIManager.show
        orig.new = InfoMessage.new
        SyncAuth.getSupabaseAuthClient = function()
            return { sign_in_password = function() return sign_in_password() end }
        end
        InfoMessage.new = function(_, o) return o or {} end
        UIManager.show = function(_, widget) table.insert(shown, widget) end
    end)

    after_each(function()
        SyncAuth.getSupabaseAuthClient = orig.getSupabaseAuthClient
        UIManager.show = orig.show
        InfoMessage.new = orig.new
    end)

    local function lastShownText()
        local widget = shown[#shown]
        return widget and widget.text
    end

    it("does not crash when the client reports failure without a response", function()
        sign_in_password = function() return false, nil end

        assert.has_no.errors(function()
            SyncAuth:doLogin({}, "/plugin", "reader@example.com", "hunter2", nil)
        end)
        assert.are.equal("Login failed: unknown error", lastShownText())
    end)

    it("surfaces the message the client reports", function()
        sign_in_password = function() return false, { msg = "Invalid login credentials" } end

        SyncAuth:doLogin({}, "/plugin", "reader@example.com", "wrong", nil)

        assert.are.equal("Login failed: Invalid login credentials", lastShownText())
    end)
end)

describe("SyncAuth:withFreshToken rejected refresh", function()
    local shown
    local refresh_result
    local orig = {}

    local function staleSettings()
        return {
            user_email    = "reader@example.com",
            access_token  = "old-access",
            refresh_token = "revoked-refresh",
            expires_at    = os.time() - 10,
            expires_in    = 3600,
        }
    end

    before_each(function()
        shown = {}
        orig.getSupabaseAuthClient = SyncAuth.getSupabaseAuthClient
        orig.show = UIManager.show
        orig.login = SyncAuth.login
        SyncAuth.getSupabaseAuthClient = function()
            return {
                refresh_token = function(_, _, cb) cb(unpack(refresh_result)) end,
            }
        end
        UIManager.show = function(_, widget) table.insert(shown, widget) end
    end)

    after_each(function()
        SyncAuth.getSupabaseAuthClient = orig.getSupabaseAuthClient
        UIManager.show = orig.show
        SyncAuth.login = orig.login
    end)

    it("clears the session and prompts to log in again when the server rejects the token", function()
        refresh_result = { false, { msg = "Invalid Refresh Token: Refresh Token Not Found" }, 400 }
        local settings = staleSettings()
        local login_called

        SyncAuth.login = function(_, s) login_called = s end
        local got_ok, got_err
        SyncAuth:withFreshToken(settings, "/plugin", function(ok, err) got_ok, got_err = ok, err end)

        assert.is_false(got_ok)
        assert.are.equal("session expired", got_err)
        assert.is_nil(settings.access_token)
        assert.is_nil(settings.refresh_token)
        assert.is_true(SyncAuth:needsLogin(settings))
        assert.are.equal("reader@example.com", settings.user_email)

        local prompt = shown[#shown]
        assert.truthy(prompt.text:find("session has expired", 1, true))
        prompt.ok_callback()
        assert.are.equal(settings, login_called)
    end)

    it("prompts once when refreshes in flight are all rejected", function()
        refresh_result = { false, { msg = "Invalid Refresh Token: Already Used" }, 400 }
        local settings = staleSettings()
        local pending = {}
        SyncAuth.getSupabaseAuthClient = function()
            return { refresh_token = function(_, _, cb) table.insert(pending, cb) end }
        end

        SyncAuth:withFreshToken(settings, "/plugin", function() end)
        SyncAuth:withFreshToken(settings, "/plugin", function() end)
        for _, cb in ipairs(pending) do cb(unpack(refresh_result)) end

        assert.are.equal(1, #shown)
    end)

    it("keeps the session on a transient server error", function()
        refresh_result = { false, { msg = "Too Many Requests" }, 429 }
        local settings = staleSettings()

        local got_ok
        SyncAuth:withFreshToken(settings, "/plugin", function(ok) got_ok = ok end)

        assert.is_false(got_ok)
        assert.are.equal("revoked-refresh", settings.refresh_token)
        assert.are.equal(0, #shown)
    end)

    it("keeps tokens a concurrent refresh saved before a stale rejection lands", function()
        local settings = staleSettings()
        local pending = {}
        SyncAuth.getSupabaseAuthClient = function()
            return { refresh_token = function(_, _, cb) table.insert(pending, cb) end }
        end

        SyncAuth:withFreshToken(settings, "/plugin", function() end)
        SyncAuth:withFreshToken(settings, "/plugin", function() end)
        pending[1](true, {
            access_token = "new-access", refresh_token = "new-refresh",
            expires_at = os.time() + 3600, expires_in = 3600,
        })
        pending[2](false, { msg = "Invalid Refresh Token: Already Used" }, 400)

        assert.are.equal("new-refresh", settings.refresh_token)
        assert.are.equal("new-access", settings.access_token)
        assert.are.equal(0, #shown)
    end)

    it("keeps the session when the refresh fails without a server answer", function()
        refresh_result = { false, { msg = "connection refused" } }
        local settings = staleSettings()

        local got_ok, got_err
        SyncAuth:withFreshToken(settings, "/plugin", function(ok, err) got_ok, got_err = ok, err end)

        assert.is_false(got_ok)
        assert.are.equal("connection refused", got_err)
        assert.are.equal("revoked-refresh", settings.refresh_token)
        assert.are.equal(0, #shown)
    end)
end)
