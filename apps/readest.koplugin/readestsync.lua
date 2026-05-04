local UIManager = require("ui/uimanager")
local logger = require("logger")
local socketutil = require("socketutil")

-- Sync operation timeouts
local SYNC_TIMEOUTS = { 5, 10 }

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
        if self.access_token then
            req.headers["authorization"] = "Bearer " .. self.access_token
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
    self.client:enable("ReadestAuth", {})
end

-- Internal: dispatch a Spore RPC and invoke `callback(success, body, status)`
-- when the async response arrives. The status is forwarded so callers can
-- distinguish 401/403/404 from generic failure (codex round 1 finding 15).
function ReadestSyncClient:_dispatch(name, args, callback)
    self:_prepare()
    socketutil:set_timeout(SYNC_TIMEOUTS[1], SYNC_TIMEOUTS[2])
    local co = coroutine.create(function()
        local ok, res = pcall(function()
            return self.client[name](self.client, args)
        end)
        if ok then
            callback(res.status == 200, res.body, res.status)
        else
            logger.dbg("ReadestSyncClient:" .. name .. " failure:", res)
            callback(false, res and res.body or nil, res and res.status or nil)
        end
    end)
    self.client:enable("AsyncHTTP", {thread = co})
    coroutine.resume(co)
    if UIManager.looper then UIManager:setInputTimeout() end
    socketutil:reset_timeout()
end

function ReadestSyncClient:pullChanges(params, callback)
    self:_dispatch("pullChanges", {
        since     = params.since,
        type      = params.type,
        book      = params.book,
        meta_hash = params.meta_hash,
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