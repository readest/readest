require("spec_helper")
local stubs = require("spec.koreader_stubs")

describe("Async HTTP completion", function()
    local original_ui, original_http, middleware, completion, args, req, replies
    before_each(function()
        stubs.reset()
        original_ui, original_http = package.loaded["ui/uimanager"], package.loaded["httpclient"]
        package.loaded["ui/uimanager"] = setmetatable({ looper = {} }, { __index = stubs.UIManager })
        package.loaded["httpclient"] = { new = function(self) return self end,
            request = function(_, _, cb) completion = cb end }
        package.loaded["readest_asynchttp"] = nil
        middleware = require("readest_asynchttp")
        replies = 0
        req = { finalize = function() end, headers = {}, env = { spore = {} } }
        args = { timeout = 15 }
        args.thread = coroutine.create(function()
            middleware.call(args, req)
            coroutine.yield()
            replies = replies + 1
        end)
    end)
    after_each(function()
        package.loaded["ui/uimanager"], package.loaded["httpclient"] = original_ui, original_http
        package.loaded["readest_asynchttp"] = nil
    end)
    it("resumes a stranded request on timeout and ignores late responses", function()
        assert.is_true(coroutine.resume(args.thread))
        stubs.UIManager:drain()
        assert.are.equal(1, replies)
        completion({ code = 200, body = {} })
        assert.are.equal(1, replies)
    end)
    it("cancels the deadline after a response and completes only once", function()
        coroutine.resume(args.thread)
        completion({ code = 200, body = {} })
        assert.are.equal(1, replies)
        assert.are.equal(0, #stubs.UIManager._scheduled)
        completion({ code = 200, body = {} })
        assert.are.equal(1, replies)
    end)
    it("bounds refreshes by their own hard limit", function()
        args.timeout = 150
        coroutine.resume(args.thread)
        assert.are.equal(1, #stubs.UIManager._scheduled)
        assert.are.equal(150, stubs.UIManager._scheduled[1].delay)
        stubs.UIManager:drain()
        assert.are.equal(1, replies)
        completion({ code = 200, body = { refresh_token = "rotated" } })
        assert.are.equal(1, replies)
    end)
    it("removes the deadline when starting HTTP raises", function()
        package.loaded["httpclient"].request = function() error("cannot start HTTP") end
        assert.is_false(coroutine.resume(args.thread))
        assert.are.equal(0, #stubs.UIManager._scheduled)
    end)
end)
