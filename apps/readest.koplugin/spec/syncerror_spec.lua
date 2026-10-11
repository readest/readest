require("spec_helper")
local SyncError = require("readest_syncerror")

describe("SyncError.describe", function()
    it("combines the HTTP status with the server's message", function()
        assert.are.equal("HTTP 500: Database unavailable", SyncError.describe({ error = "Database unavailable" }, 500))
        assert.are.equal("HTTP 403: Not authenticated", SyncError.describe({ error = "Not authenticated" }, 403))
        assert.are.equal("HTTP 429: Too many requests", SyncError.describe({ message = "Too many requests" }, 429))
    end)
    it("falls back to Spore's reason, the status alone, or a plain message", function()
        assert.are.equal("HTTP 502: 502 not expected", SyncError.describe({ reason = "502 not expected" }, 502))
        assert.are.equal("HTTP 404", SyncError.describe(nil, 404))
        assert.are.equal("cloud-not-found", SyncError.describe("cloud-not-found"))
        assert.are.equal("no error details", SyncError.describe(nil, nil))
    end)
    it("treats status 0 as a transport failure and skips HTML pages", function()
        assert.are.equal("timeout", SyncError.describe({ error = "timeout" }, 0))
        assert.are.equal("HTTP 503", SyncError.describe("<html><body>Service Unavailable</body></html>", 503))
    end)
    it("keeps details on one bounded line", function()
        local detail = SyncError.describe({ error = "line one\nline two " .. string.rep("x", 500) }, 500)
        assert.is_nil(detail:find("\n", 1, true))
        assert.is_true(#detail < 230)
    end)
end)

describe("SyncError.reason", function()
    local reason = SyncError.reason
    it("removes code locations from transport errors", function()
        assert.are.equal("The network is unreachable. Please check the internet connection.",
            reason({ error = "Protocols.lua:85: Network unreachable" }))
        assert.are.equal("The connection timed out. Please try again.",
            reason("/usr/lib/lua/Spore/Protocols.lua:85: socket.lua:12: timeout"))
        assert.are.equal("The connection was interrupted. Please try again.", reason({ error = "closed" }))
        assert.are.equal("The server could not be found. Please check the internet connection.",
            reason({ error = "Protocols.lua:85: temporary failure in name resolution" }))
    end)
    it("explains HTTP failures without codes or internal server text", function()
        assert.are.equal("The server is temporarily unavailable. Please try again later.",
            reason({ error = "relation \"books\" does not exist", reason = "500 not expected" }, 500))
        assert.are.equal("Too many requests. Please try again later.", reason({ msg = "HTTP 429" }))
        assert.are.equal("Not found on the server.", reason({ msg = "404 not expected" }))
        assert.are.equal("Authentication failed. Please log in again.", reason({ error = "Not authenticated" }, 403))
        assert.are.equal("Access denied.", reason(nil, 403))
    end)
    it("keeps readable server and login messages", function()
        assert.are.equal("Permission denied", reason({ error = "Permission denied" }, 403))
        assert.are.equal("Invalid login credentials",
            reason({ error = "invalid_grant", error_description = "Invalid login credentials" }, 400))
        assert.are.equal("Storage quota exceeded.", reason("Insufficient storage quota", 403))
    end)
    it("replaces internal codes and auth stages with plain reasons", function()
        assert.are.equal("The request failed. Please try again.", reason("url-fetch-failed"))
        assert.are.equal("The request failed. Please try again.", reason("push failed"))
        assert.are.equal("The file was not found in the cloud.", reason("cloud-not-found", 404))
        assert.are.equal("Authentication failed. Please log in again.", reason("auth", 401))
        assert.are.equal("An internal error occurred. Please try again.", reason("cannot start sync worker"))
        local refresh = { error = "Protocols.lua:85: Network unreachable", stage = "token refresh" }
        assert.are.equal("The network is unreachable. Please check the internet connection.", reason(refresh))
        assert.are.equal("token refresh: Protocols.lua:85: Network unreachable", SyncError.describe(refresh))
        assert.are.equal("The request failed. Please try again.", reason(nil, nil))
    end)
end)

describe("ReadestSyncClient failure details", function()
    it("keeps transport errors and Spore's reason in the failure body", function()
        local stubs = require("spec.koreader_stubs")
        stubs.reset()
        package.loaded["readest_syncclient"] = nil
        local Client = require("readest_syncclient")
        local replies = {}
        local function dispatch(err)
            local c = setmetatable({ client = {
                reset_middlewares = function() end, enable = function() end,
                pushChanges = function() error(err) end,
            } }, { __index = Client })
            c._dispatchInSubprocess = function(_, name, args, _, receive)
                receive(pcall(function() return c.client[name](c.client, args) end))
            end
            c:_dispatch("pushChanges", {}, function(ok, body, status)
                replies[#replies + 1] = SyncError.describe(body, status)
            end)
        end
        dispatch("socket.lua:12: connection refused")
        dispatch({ response = { status = 500, body = "<html>oops</html>" }, reason = "500 not expected" })
        assert.truthy(replies[1]:find("connection refused", 1, true))
        assert.are.equal("HTTP 500: 500 not expected", replies[2])
        package.loaded["readest_syncclient"] = nil
    end)
end)
