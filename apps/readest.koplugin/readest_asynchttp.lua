-- Shared by auth and sync: do not let a lost Turbo callback strand callers.
local UIManager = require("ui/uimanager")
local logger = require("logger")

return { call = function(args, req)
    if not UIManager.looper then return end
    req:finalize()
    local result, completed
    local timeout
    local function finish(res)
        if completed then return end
        completed = true
        if timeout then UIManager:unschedule(timeout) end
        result = res or { code = 0, headers = { ["content-type"] = "application/json" },
            body = '{"error":"Empty HTTP response"}' }
        result.status = result.code
        if coroutine.status(args.thread) == "suspended" then
            local ok, err = coroutine.resume(args.thread)
            if not ok then logger.err("ReadestSync: HTTP callback failed:", err) end
        end
    end
    timeout = function()
        finish({ code = 0, readest_timeout = true,
            headers = { ["content-type"] = "application/json" },
            body = '{"error":"timeout","msg":"HTTP request timed out"}' })
    end
    UIManager:scheduleIn(args.timeout or 25, timeout)
    local ok, err = pcall(function()
        require("httpclient"):new():request({
            url = req.url,
            method = req.method,
            body = req.env.spore.payload,
            on_headers = function(headers)
                for header, value in pairs(req.headers) do
                    if type(header) == "string" then headers:add(header, value) end
                end
            end,
        }, finish)
    end)
    if not ok then
        if timeout then UIManager:unschedule(timeout) end
        completed = true
        error(err)
    end
    return coroutine.create(function() coroutine.yield(result) end)
end }
