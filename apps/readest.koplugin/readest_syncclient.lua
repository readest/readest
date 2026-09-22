local UIManager = require("ui/uimanager")
local logger = require("logger")
local socketutil = require("socketutil")

-- Sync operation timeouts
local SYNC_TIMEOUTS = { 5, 10 }
local RETRY_TIMEOUTS = { 10, 20 }
local READ_METHODS = { pullChanges = true, pullBooks = true, getDownloadUrl = true, listFiles = true }
local response_seq = 0

-- LuaSec reports TLS handshake timeouts as "wantread"/"wantwrite";
-- Spore wraps these strings with a source location. Only retry transport
-- failures on read-only RPCs, never an HTTP error or an ambiguous write.
local function isTransientTransportError(err)
    if type(err) ~= "string" then return false end
    local code = err:match("([^%s:]+)%s*$")
    return code == "wantread" or code == "wantwrite" or code == "timeout"
end

local ReadestSyncClient = {
    service_spec = nil,
    access_token = nil,
}

function ReadestSyncClient:new(o)
    if o == nil then o = {} end
    setmetatable(o, self)
    self.__index = self
    if o.init then o:init() end
    return o
end

function ReadestSyncClient:init()
    local Spore = require("Spore")
    self.client = Spore.new_from_spec(self.service_spec)
    
    -- Readest API headers middleware
    package.loaded["Spore.Middleware.ReadestHeaders"] = {}
    require("Spore.Middleware.ReadestHeaders").call = function(args, req)
        req.headers["content-type"] = "application/json"
        req.headers["accept"] = "application/json"
    end
    
    -- Readest Bearer token auth middleware
    package.loaded["Spore.Middleware.ReadestAuth"] = {}
    require("Spore.Middleware.ReadestAuth").call = function(args, req)
        if args.access_token then
            req.headers["authorization"] = "Bearer " .. args.access_token
        else
            logger.err("ReadestSyncClient:access_token is not set, cannot authenticate")
            return false, "Access token is required for Readest API"
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

-- Internal: prepare the Spore client with our standard middleware stack.
-- Call before each RPC.
function ReadestSyncClient:_prepare()
    self.client:reset_middlewares()
    self.client:enable("Format.JSON")
    self.client:enable("ReadestHeaders", {})
    self.client:enable("ReadestAuth", { access_token = self.access_token })
end

-- Internal: dispatch a Spore RPC and invoke `callback(success, body, status)`
-- when the async response arrives. The status is forwarded so callers can
-- distinguish 401/403/404 from generic failure (codex round 1 finding 15).
-- Without Turbo, Spore performs blocking TLS/HTTP even inside a coroutine.
-- Run only the RPC in a child; callbacks always run in the UI process.
function ReadestSyncClient:_dispatchInSubprocess(name, args, timeouts, receive)
    local FFIUtil = require("ffi/util")
    local json = require("json")
    -- Stats/notes responses can exceed a pipe buffer; a response file
    -- avoids deadlocking a child while the parent waits for its exit.
    -- Not os.tmpname: /tmp is unwritable for the app on Android and a
    -- small, often full tmpfs on Kindle. The settings dir already holds
    -- the access token, so the response is no less private there.
    response_seq = response_seq + 1
    local result_path = string.format("%s/readest_sync_%d_%d.json",
        require("datastorage"):getSettingsDir(), os.time(), response_seq)
    local created = io.open(result_path, "wb")
    if not created then receive(false, "cannot create sync response file"); return end
    created:close()
    local pid = FFIUtil.runInSubProcess(function()
        -- No exceptions may escape, and _exit avoids inherited graphics
        -- driver destructors on Android (same rule as background covers).
        pcall(function()
            local ok, res = pcall(function()
                self:_prepare()
                socketutil:set_timeout(timeouts[1], timeouts[2])
                return self.client[name](self.client, args)
            end)
            -- Do not serialize Spore's request object: it includes auth headers.
            local response = type(res) == "table" and { status = res.status, body = res.body }
                or tostring(res)
            local f = assert(io.open(result_path, "wb"))
            f:write(json.encode({ ok = ok, response = response }))
            f:close()
        end)
        local ffi = require("ffi")
        pcall(ffi.cdef, "void _exit(int status);")
        ffi.C._exit(0)
    end)
    if not pid then
        os.remove(result_path)
        receive(false, "cannot start sync worker")
        return
    end

    -- Bound DNS/connect stalls too: socket timeouts alone are not an
    -- end-to-end deadline. Reap before removing the child's response file.
    local deadline = os.time() + timeouts[2] + 5
    local timed_out = false
    local poll
    poll = function()
        if not FFIUtil.isSubProcessDone(pid) then
            if not timed_out and os.time() >= deadline then
                timed_out = true
                FFIUtil.terminateSubProcess(pid)
            end
            UIManager:scheduleIn(0.1, poll)
            return
        end
        local f = io.open(result_path, "rb")
        local data = f and f:read("*a")
        if f then f:close() end
        os.remove(result_path)
        if timed_out then receive(false, "timeout"); return end
        local ok, result = pcall(json.decode, data or "")
        if ok and type(result) == "table" and type(result.ok) == "boolean" then
            receive(result.ok, result.response)
        else
            receive(false, "sync worker returned no response")
        end
    end
    UIManager:scheduleIn(0.1, poll)
end

function ReadestSyncClient:_dispatch(name, args, callback, retried)
    local timeouts = retried and RETRY_TIMEOUTS or SYNC_TIMEOUTS
    local function receive(ok, res)
        if ok then
            callback(res.status == 200, res.body, res.status)
        elseif not retried and READ_METHODS[name] and isTransientTransportError(res) then
            logger.dbg("ReadestSyncClient:" .. name .. " transient transport timeout; retrying once")
            UIManager:scheduleIn(1, function()
                self:_dispatch(name, args, callback, true)
            end)
        else
            logger.dbg("ReadestSyncClient:" .. name .. " failure:", res)
            local response = type(res) == "table" and res or {}
            callback(false, response.body, response.status)
        end
    end
    if not UIManager.looper then
        self:_dispatchInSubprocess(name, args, timeouts, receive)
        return
    end
    self:_prepare()
    socketutil:set_timeout(timeouts[1], timeouts[2])
    local co = coroutine.create(function()
        receive(pcall(function() return self.client[name](self.client, args) end))
    end)
    self.client:enable("AsyncHTTP", {thread = co})
    coroutine.resume(co)
    UIManager:setInputTimeout()
    socketutil:reset_timeout()
end

function ReadestSyncClient:pullChanges(params, callback)
    self:_dispatch("pullChanges", {
        since     = params.since,
        type      = params.type,
        book      = params.book,
        meta_hash = params.meta_hash,
        limit     = params.limit,
    }, callback)
end

function ReadestSyncClient:pushChanges(changes, callback)
    self:_dispatch("pushChanges", changes or {}, callback)
end

-- pullBooks: incremental fetch of the books table since the watermark.
-- Returns body shape `{ books: [...] }`. Drives Library:open() refresh.
function ReadestSyncClient:pullBooks(params, callback)
    self:_dispatch("pullBooks", { since = params.since }, callback)
end

-- getDownloadUrl: resolve a storage fileKey to a signed URL. The server's
-- processFileKeys fallback at apps/readest-app/src/pages/api/storage/
-- download.ts:99-107 lets us send the simple {hash}/{hash}.{ext} variant
-- and have R2 deployments resolve to the actual stored filename
-- transparently. Body shape on success: { downloadUrl }.
function ReadestSyncClient:getDownloadUrl(params, callback)
    self:_dispatch("getDownloadUrl", { fileKey = params.fileKey }, callback)
end

-- listFiles: enumerate the rows of the `files` table for a given book
-- hash. Used to discover the EXACT fileKeys (book object + cover.png)
-- before deletion — the DELETE endpoint requires a literal match (no
-- extension fallback like /storage/download has). Body shape on success:
-- { files: [ { file_key, file_size, book_hash, ... } ] }.
function ReadestSyncClient:listFiles(params, callback)
    self:_dispatch("listFiles", { bookHash = params.bookHash }, callback)
end

-- deleteFile: remove one storage object plus its `files` row. Caller
-- usually iterates over listFiles output. The `books` row stays put;
-- cleanup of the books table is a separate /sync push (with deletedAt).
function ReadestSyncClient:deleteFile(params, callback)
    self:_dispatch("deleteFile", { fileKey = params.fileKey }, callback)
end

-- getUploadUrl: ask the server to issue a presigned PUT URL for a new
-- storage object. Two-step flow (`apps/readest-app/src/pages/api/storage/
-- upload.ts`): server inserts a row in the `files` table for
-- (user, bookHash, fileKey) BEFORE the actual bytes move. Body shape on
-- success: { uploadUrl, fileKey, usage, quota }. Quota-exceeded → 403.
-- The fileName must be the cloud-relative path (eg
-- "Readest/Books/<hash>/<hash>.epub"); the server prepends "<user.id>/"
-- to form the final fileKey.
function ReadestSyncClient:getUploadUrl(params, callback)
    self:_dispatch("getUploadUrl", {
        fileName = params.fileName,
        fileSize = params.fileSize,
        bookHash = params.bookHash,
    }, callback)
end

return ReadestSyncClient