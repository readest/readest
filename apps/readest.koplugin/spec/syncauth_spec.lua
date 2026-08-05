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
