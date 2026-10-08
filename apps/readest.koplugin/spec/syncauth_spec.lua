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
    it("preserves login rejection messages and status from Spore exceptions", function()
        for _, case in ipairs({
            { 429, { msg = "Too Many Requests" }, "Too Many Requests" },
            { 500, { message = "Auth server unavailable" }, "Auth server unavailable" },
            { 503, {}, "503 not expected" },
        }) do
            local client = newAuthClient(function()
                error({ response = { status = case[1], body = case[2] }, reason = case[1] .. " not expected" })
            end)
            local ok, res, status = client:sign_in_password("reader@example.com", "password")
            assert.is_false(ok)
            assert.are.equal(case[1], status)
            assert.are.equal(case[3], res.msg)
        end
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
        assert.are.equal("Login failed: The request failed. Please try again.", lastShownText())
    end)

    it("surfaces the message the client reports", function()
        sign_in_password = function() return false, { msg = "Invalid login credentials" } end

        SyncAuth:doLogin({}, "/plugin", "reader@example.com", "wrong", nil)

        assert.are.equal("Login failed: Invalid login credentials", lastShownText())
    end)
    it("clears the authentication pause after a successful login", function()
        local settings = { auth_required = true, refresh_token = "saved-refresh" }
        sign_in_password = function() return true, {
            user = { id = "reader", user_metadata = {} },
            access_token = "login-access", refresh_token = "login-refresh", expires_in = 3600,
        } end
        SyncAuth:showLoginPrompt(settings, "/plugin")
        SyncAuth:doLogin(settings, "/plugin", "reader@example.com", "password")
        assert.is_nil(settings.auth_required)
        assert.are.equal("login-access", settings.access_token)
        assert.is_false(SyncAuth:needsLogin(settings))
    end)
    it("tracks login expiry on the device clock", function()
        local settings = {}
        sign_in_password = function() return true, {
            user = { id = "reader", user_metadata = {} },
            access_token = "login-access", refresh_token = "login-refresh",
            expires_at = os.time() - 7200, expires_in = 3600, -- server clock far behind
        } end
        SyncAuth:doLogin(settings, "/plugin", "reader@example.com", "password")
        assert.is_true(math.abs(settings.expires_at - (os.time() + 3600)) <= 1)
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
    it("clears credentials before callbacks and shows the prompt after all their failure messages", function()
        local settings, pending = staleSettings()
        SyncAuth.getSupabaseAuthClient = function()
            return { refresh_token = function(_, _, cb) pending = cb end }
        end
        for i = 1, 2 do
            SyncAuth:withFreshToken(settings, "/plugin", function(ok)
                assert.is_false(ok)
                assert.is_nil(settings.access_token)
                assert.is_nil(settings.refresh_token)
                UIManager:show({ text = "failure " .. i })
            end)
        end
        pending(false, { msg = "revoked" }, 400)
        assert.are.equal("failure 1", shown[1].text)
        assert.are.equal("failure 2", shown[2].text)
        assert.truthy(shown[3].ok_callback)
        assert.are.equal(3, #shown)
    end)
    it("still shows the prompt when a failure callback raises", function()
        refresh_result = { false, { msg = "revoked" }, 400 }
        SyncAuth:withFreshToken(staleSettings(), "/plugin", function() error("callback failure") end)
        assert.are.equal(1, #shown)
        assert.truthy(shown[1].ok_callback)
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

    it("shares a successful refresh instead of rotating its token concurrently", function()
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
        assert.are.equal(1, #pending)

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

describe("SyncAuth refresh coordination", function()
    local original_auth, original_sync, pending, requests, settings
    before_each(function()
        require("spec.koreader_stubs").reset()
        original_auth, original_sync = SyncAuth.getSupabaseAuthClient, SyncAuth.getReadestSyncClient
        pending, requests = {}, {}
        settings = { access_token = "old", refresh_token = "refresh", expires_at = os.time() - 1, expires_in = 3600 }
        SyncAuth.getSupabaseAuthClient = function()
            return { refresh_token = function(_, token, cb) pending[#pending + 1] = cb end }
        end
        SyncAuth.getReadestSyncClient = function(_, s)
            local token = s.access_token
            return { pullChanges = function(_, args, cb)
                requests[#requests + 1] = { token = token, callback = cb }
            end }
        end
    end)
    after_each(function()
        SyncAuth.getSupabaseAuthClient, SyncAuth.getReadestSyncClient = original_auth, original_sync
    end)
    local function refreshed()
        pending[1](true, { access_token = "new", refresh_token = "rotated", expires_at = os.time() + 3600, expires_in = 3600 })
    end
    it("waits for one refresh before dispatching simultaneous reader requests", function()
        local client = SyncAuth:getAuthenticatedClient(settings, "/plugin")
        client:pullChanges({}, function() end)
        client:pullChanges({}, function() end)
        assert.are.equal(1, #pending)
        assert.are.equal(0, #requests)
        refreshed()
        assert.are.equal(2, #requests)
        assert.are.equal("new", requests[1].token)
        assert.are.equal("new", requests[2].token)
    end)
    it("refreshes and retries an unexpectedly rejected fresh access token", function()
        settings.expires_at = os.time() + 3600
        local result
        SyncAuth:getAuthenticatedClient(settings, "/plugin"):pullChanges({}, function(ok) result = ok end)
        requests[1].callback(false, { error = "Not authenticated" }, 403)
        assert.are.equal(1, #pending)
        refreshed()
        requests[2].callback(true, { configs = {} }, 200)
        assert.is_true(result)
        assert.are.equal("new", requests[2].token)
    end)
    it("retries a stale rejection with tokens another request already refreshed", function()
        settings.expires_at = os.time() + 3600
        local client = SyncAuth:getAuthenticatedClient(settings, "/plugin")
        client:pullChanges({}, function() end)
        client:pullChanges({}, function() end)
        requests[1].callback(false, {}, 401)
        refreshed()
        requests[2].callback(false, {}, 401)
        assert.are.equal(1, #pending)
        assert.are.equal(4, #requests)
        assert.are.equal("new", requests[4].token)
    end)
    it("pauses after persistent authentication failure and prompts once for concurrent requests", function()
        settings.expires_at = os.time() + 3600
        local client, replies = SyncAuth:getAuthenticatedClient(settings, "/plugin"), {}
        local function done(ok, body)
            assert.is_false(ok)
            assert.is_true(body.auth_required)
            replies[#replies + 1] = body
        end
        client:pullChanges({}, done)
        client:pullChanges({}, done)
        requests[1].callback(false, { error = "Not authenticated" }, 403)
        requests[2].callback(false, { error = "Not authenticated" }, 403)
        assert.are.equal(1, #pending)
        refreshed()
        requests[3].callback(false, { error = "Not authenticated" }, 403)
        requests[4].callback(false, { error = "Not authenticated" }, 403)
        assert.is_true(settings.auth_required)
        assert.is_nil(settings.access_token)
        assert.are.equal("rotated", settings.refresh_token)
        assert.is_true(G_reader_settings:readSetting("readest_sync").auth_required)
        assert.are.equal(1, #UIManager._shown)
        client:pullChanges({}, done)
        SyncAuth:tryRefreshToken(settings, "/plugin")
        assert.are.equal(3, #replies)
        assert.are.equal(4, #requests)
        assert.are.equal(1, #pending)
        assert.are.equal(1, #UIManager._shown)
    end)
    it("shows the persistent-auth prompt after its callback even when that callback raises", function()
        settings.expires_at = os.time() + 3600
        SyncAuth:getAuthenticatedClient(settings, "/plugin"):pullChanges({}, function()
            assert.is_nil(settings.access_token)
            UIManager:show({ text = "request failed" })
            error("callback failure")
        end)
        requests[1].callback(false, {}, 401)
        refreshed()
        assert.has_error(function() requests[2].callback(false, {}, 401) end)
        assert.are.equal("request failed", UIManager._shown[1].text)
        assert.truthy(UIManager._shown[2].ok_callback)
    end)
    it("does not refresh or pause the session for quota and permission 403s", function()
        settings.expires_at = os.time() + 3600
        local client, replies = SyncAuth:getAuthenticatedClient(settings, "/plugin"), 0
        for _, message in ipairs({ "Quota exceeded", "Permission denied" }) do
            client:pullChanges({}, function(ok, body, status)
                assert.is_false(ok)
                assert.are.equal(403, status)
                assert.are.equal(message, body.error)
                replies = replies + 1
            end)
            requests[#requests].callback(false, { error = message }, 403)
        end
        assert.are.equal(2, replies)
        assert.are.equal(0, #pending)
        assert.is_nil(settings.auth_required)
        assert.are.equal("old", settings.access_token)
        assert.are.equal(0, #UIManager._shown)
    end)
    it("does not pause a new session when an older retry is rejected", function()
        settings.expires_at = os.time() + 3600
        local reply
        SyncAuth:getAuthenticatedClient(settings, "/plugin"):pullChanges({}, function(_, body) reply = body end)
        requests[1].callback(false, {}, 401)
        refreshed()
        settings.access_token, settings.refresh_token = "login-access", "login-refresh"
        requests[2].callback(false, {}, 401)
        assert.are.equal("session changed", reply.error)
        assert.are.equal("login-access", settings.access_token)
        assert.is_nil(settings.auth_required)
        assert.are.equal(0, #UIManager._shown)
    end)
    it("saves an in-flight rotation without resuming a paused session", function()
        SyncAuth:withFreshToken(settings, "/plugin", function() end)
        local show_login = SyncAuth:requireLogin(settings, "/plugin", settings.access_token)
        show_login()
        refreshed()
        assert.are.equal("rotated", settings.refresh_token)
        assert.is_nil(settings.access_token)
        assert.is_true(settings.auth_required)
        assert.is_nil(original_sync(SyncAuth, settings, "/plugin"))
    end)
    it("allows a dismissed login prompt to be reopened without stacking prompts", function()
        SyncAuth:showLoginPrompt(settings, "/plugin")
        SyncAuth:showLoginPrompt(settings, "/plugin")
        assert.are.equal(1, #UIManager._shown)
        UIManager._shown[1].cancel_callback()
        SyncAuth:showLoginPrompt(settings, "/plugin")
        assert.are.equal(2, #UIManager._shown)
    end)
    it("releases waiters on timeout, keeps one refresh in flight, and saves late tokens", function()
        local count = 0
        SyncAuth:withFreshToken(settings, "/plugin", function(ok) assert.is_false(ok); count = count + 1 end)
        SyncAuth:withFreshToken(settings, "/plugin", function(ok) assert.is_false(ok); count = count + 1 end)
        UIManager:drain(20)
        assert.are.equal(2, count)
        SyncAuth:withFreshToken(settings, "/plugin", function(ok, err)
            assert.is_false(ok)
            assert.are.equal("refresh timeout", err)
            count = count + 1
        end)
        assert.are.equal(1, #pending)
        refreshed()
        assert.are.equal("new", settings.access_token)
        assert.are.equal("rotated", settings.refresh_token)
        assert.are.equal("rotated", G_reader_settings:readSetting("readest_sync").refresh_token)
        assert.are.equal(3, count) -- each timed-out waiter completed only once
        SyncAuth:withFreshToken(settings, "/plugin", function(ok) assert.is_true(ok) end)
        assert.are.equal(1, #pending)
    end)
    it("allows a new refresh after a timed-out transport actually finishes", function()
        SyncAuth:withFreshToken(settings, "/plugin", function() end)
        UIManager:drain(20)
        pending[1](false, { msg = "temporary" }, 500)
        SyncAuth:withFreshToken(settings, "/plugin", function() end)
        assert.are.equal(2, #pending)
        pending[2](false, { msg = "temporary" }, 500)
    end)
    it("ignores late refresh tokens after logout", function()
        SyncAuth:withFreshToken(settings, "/plugin", function() end)
        UIManager:drain(20)
        settings.refresh_token, settings.access_token = nil, nil
        refreshed()
        assert.is_nil(settings.access_token)
        assert.is_nil(settings.refresh_token)
    end)
    it("allows a new login to use its own session while an old refresh is pending", function()
        SyncAuth:withFreshToken(settings, "/plugin", function() end)
        UIManager:drain(20)
        settings.refresh_token, settings.access_token = "login-refresh", "login-access"
        settings.expires_at = os.time() + 3600
        SyncAuth:withFreshToken(settings, "/plugin", function(ok) assert.is_true(ok) end)
        refreshed()
        assert.are.equal("login-access", settings.access_token)
        assert.are.equal("login-refresh", settings.refresh_token)
    end)
    it("does not restore a session changed while refresh was in flight", function()
        local result
        SyncAuth:withFreshToken(settings, "/plugin", function(ok) result = ok end)
        settings.refresh_token, settings.access_token = nil, nil
        refreshed()
        assert.is_false(result)
        assert.is_nil(settings.access_token)
    end)
    it("abandons a refresh whose transport never completes so a new one can start", function()
        local results = {}
        SyncAuth:withFreshToken(settings, "/plugin", function(ok, err) results[#results + 1] = err end)
        UIManager:drain(20)
        SyncAuth:withFreshToken(settings, "/plugin", function(ok, err) results[#results + 1] = err end)
        assert.are.equal(1, #pending)
        UIManager:drain()
        assert.same({ "refresh timeout", "refresh timeout" }, results)
        SyncAuth:withFreshToken(settings, "/plugin", function(ok) results[#results + 1] = ok end)
        assert.are.equal(2, #pending)
        pending[1](true, { access_token = "late", refresh_token = "late-refresh", expires_in = 3600 })
        assert.are.equal("refresh", settings.refresh_token)
        pending[2](true, { access_token = "new", refresh_token = "rotated", expires_in = 3600 })
        assert.are.equal("rotated", settings.refresh_token)
        assert.is_true(results[3])
    end)
    it("tracks refreshed expiry on the device clock", function()
        SyncAuth:withFreshToken(settings, "/plugin", function() end)
        pending[1](true, { access_token = "new", refresh_token = "rotated",
            expires_at = os.time() - 7200, expires_in = 3600 }) -- device clock far ahead
        assert.is_true(math.abs(settings.expires_at - (os.time() + 3600)) <= 1)
        assert.is_not_nil(original_sync(SyncAuth, settings, "/plugin"))
    end)
    it("exposes only sync RPCs", function()
        local client = SyncAuth:getAuthenticatedClient(settings, "/plugin")
        assert.is_function(client.pullChanges)
        assert.is_nil(client.access_token)
        assert.is_nil(client._dispatch)
    end)
    it("checks the dispatch guard after the refresh wait and before the retry", function()
        local valid, replies = true, {}
        local client = SyncAuth:getAuthenticatedClient(settings, "/plugin", function() return valid end)
        client:pullChanges({}, function(ok, body) replies[#replies + 1] = body.error end)
        valid = false
        refreshed()
        assert.are.equal(0, #requests)
        assert.same({ "sync cancelled" }, replies)

        valid = true
        client:pullChanges({}, function(ok, body) replies[#replies + 1] = body.error end)
        requests[1].callback(false, {}, 401)
        valid = false
        pending[2](true, { access_token = "newer", refresh_token = "rotated-again", expires_in = 3600 })
        assert.are.equal(1, #requests)
        assert.same({ "sync cancelled", "sync cancelled" }, replies)
        assert.is_nil(settings.auth_required)
    end)
    it("refreshes tokens whose expiry metadata is missing", function()
        settings.expires_at = nil
        SyncAuth:withFreshToken(settings, "/plugin", function() end)
        assert.are.equal(1, #pending)
        refreshed()
    end)
end)

describe("SupabaseAuthClient refresh transport", function()
    it("preserves HTTP rejection details when Spore throws a response table", function()
        local client = newAuthClient(function()
            error({ response = { status = 401, body = { msg = "Refresh token revoked" } }, reason = "401 not expected" })
        end)
        local status, response
        client:refresh_token("old", function(ok, body, code)
            assert.is_false(ok)
            status, response = code, body
        end)
        assert.are.equal(401, status)
        assert.are.equal("Refresh token revoked", response.msg)
    end)
    it("keeps refresh worker responses available after the caller's deadline", function()
        local syncclient = require("readest_syncclient")
        local original_worker, original_spawn = syncclient._dispatchInSubprocess, ffiutil.runInSubProcess
        local result
        ffiutil.runInSubProcess = function() end
        syncclient._dispatchInSubprocess = function(worker, name, args, timeouts, cb, options)
            assert.are.equal("refresh_token", name)
            assert.are.equal("old", args.refresh_token)
            assert.are.same({3, 7}, timeouts)
            assert.are.equal(150, options.deadline)
            cb(true, { status = 200, body = { access_token = "new" } })
        end
        local ok, err = pcall(function()
            newAuthClient(function() error("should run in worker") end):refresh_token("old", function(success, body)
                assert.is_true(success)
                result = body.access_token
            end)
            assert.are.equal("new", result)
        end)
        syncclient._dispatchInSubprocess, ffiutil.runInSubProcess = original_worker, original_spawn
        assert.is_true(ok, err)
    end)
end)
