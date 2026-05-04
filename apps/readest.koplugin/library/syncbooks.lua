-- syncbooks.lua
-- Sync layer for the Library view. Pulls book records from /sync, requests
-- signed download URLs from /storage/download, and streams cloud-only book
-- files + cover images to disk.
--
-- The pure helpers (build_file_key, build_cover_key, build_local_filename,
-- resolve_collision) are exported and unit-tested in
-- spec/library/syncbooks_spec.lua. The network-touching methods (pullBooks,
-- downloadBook, downloadCover) require live KOReader services (Spore,
-- httpclient, NetworkMgr, UIManager.looper) and are exercised via the manual
-- test matrix in docs/library-design.md, not unit tests — stubbing that
-- surface would balloon test setup with little additional confidence.

local M = {}

local EXTS = require("library.exts")

-- ---------------------------------------------------------------------------
-- Constants
-- ---------------------------------------------------------------------------
-- Cloud storage layout under each user's bucket prefix. Web side calls this
-- CLOUD_BOOKS_SUBDIR ("Readest/Books") at apps/readest-app/src/services/constants.ts:35.
local CLOUD_BOOKS_SUBDIR = "Readest/Books"

-- The server's /storage/download fallback accepts any 5-part fileKey shaped
-- like {user_id}/Readest/Books/{book_hash}/{anything}.{ext} and resolves it
-- via a (book_hash, file_key endsWith .ext) lookup in the `files` table —
-- see apps/readest-app/src/pages/api/storage/download.ts:99-107. We therefore
-- send the simple S3-style {hash}/{hash}.{ext} variant; on R2 deployments the
-- fallback transparently rewrites to the actual stored filename.

-- ---------------------------------------------------------------------------
-- build_file_key: cloud download fileKey for a book file
-- ---------------------------------------------------------------------------
function M.build_file_key(book)
    if not book then return nil end
    if not book.user_id or book.user_id == "" then return nil end
    if not book.hash    or book.hash    == "" then return nil end
    local ext = EXTS[book.format]
    if not ext then return nil end
    return string.format("%s/%s/%s/%s.%s",
        book.user_id, CLOUD_BOOKS_SUBDIR, book.hash, book.hash, ext)
end

-- ---------------------------------------------------------------------------
-- build_cover_key: cloud download fileKey for a cover image
-- ---------------------------------------------------------------------------
-- The cover filename is `cover.png` regardless of storage type — same on R2
-- and S3 per `apps/readest-app/src/utils/book.ts:32`. No extension switching.
function M.build_cover_key(book)
    if not book then return nil end
    if not book.user_id or book.user_id == "" then return nil end
    if not book.hash    or book.hash    == "" then return nil end
    return string.format("%s/%s/%s/cover.png",
        book.user_id, CLOUD_BOOKS_SUBDIR, book.hash)
end

-- ---------------------------------------------------------------------------
-- build_local_filename: where downloaded book bytes land on disk
-- ---------------------------------------------------------------------------
-- Per design doc: KOReader users prefer flat dirs in their book folder, so
-- downloads land at {library_download_dir}/{safe_title}.{ext} — no nested
-- {hash}/ subdir. The local filename does NOT need to byte-match what Readest
-- writes on the cloud-side filesystem: the only consumer is KOReader's own
-- FileManager, so a simple Lua-native sanitizer is enough (no JS-parity port
-- of makeSafeFilename).
local MAX_BODY_LEN = 200  -- bytes; leaves room for ".extension" suffix

function M.build_local_filename(book)
    if not book then return nil end
    local ext = EXTS[book.format]
    if not ext then return nil end

    local raw = book.source_title or book.title or ""
    if raw == "" then return "book." .. ext end

    -- Replace filesystem-illegal chars + control chars (bytes 0x00-0x1F) with _
    -- Safe set covers Windows + macOS + ext4: < > : " / \ | ? * and 0x00-0x1F
    local safe = raw:gsub('[<>:|"?*\\/%c]', "_")

    -- Byte-clamp; raw byte length is what file systems care about. We may
    -- truncate mid-codepoint here, but downstream display is via FileManager
    -- which renders bytes as "?" rather than crashing. For v1 we accept this
    -- edge — long titles are rare and the user has the cloud copy regardless.
    if #safe > MAX_BODY_LEN then
        safe = safe:sub(1, MAX_BODY_LEN)
    end

    -- A pure-_ result (e.g. title was just "????") would round-trip to a
    -- weird filename — fall back to "book" in that case.
    if safe:match("^_+$") then
        safe = "book"
    end

    return safe .. "." .. ext
end

-- ---------------------------------------------------------------------------
-- resolve_collision: bumps {name}.ext → {name} (1).ext on filename clash
-- ---------------------------------------------------------------------------
-- Takes a candidate filename and a `exists(name) -> bool` predicate; returns
-- a name that doesn't collide. Caller (downloadBook) supplies a predicate
-- that calls lfs.attributes on the destination dir.
function M.resolve_collision(candidate, exists)
    if not exists(candidate) then return candidate end

    -- Split on the LAST dot so multi-dot titles ("Foo. Vol. 1.epub") still
    -- bump correctly: base = "Foo. Vol. 1", ext = "epub".
    local base, ext = candidate:match("^(.+)%.([^.]+)$")
    if not base then
        base = candidate
        ext = nil
    end

    for n = 1, 99 do
        local probe
        if ext then
            probe = string.format("%s (%d).%s", base, n, ext)
        else
            probe = string.format("%s (%d)", base, n)
        end
        if not exists(probe) then return probe end
    end
    -- Should never happen in practice; user has bigger problems if it does.
    return candidate
end

-- ---------------------------------------------------------------------------
-- row_to_wire(row) — convert our internal snake_case row to the
-- camelCase Book shape Readest's server expects on POST /sync (mirrors
-- transformBookToDB at apps/readest-app/src/utils/transform.ts:66-105 —
-- but inverted, reading FROM the local row INTO the camelCase wire
-- format that the server itself converts back to DB shape).
-- ---------------------------------------------------------------------------
local function row_to_wire(row)
    if not row then return nil end
    -- ljsqlite3 returns INTEGER columns as int64_t cdata; dkjson chokes
    -- on cdata and the request fails with status=nil. Re-cast defensively.
    local function num(v) return v and tonumber(v) or v end
    local out = {
        bookHash      = row.hash,
        hash          = row.hash,
        metaHash      = row.meta_hash,
        format        = row.format,
        title         = row.title,
        author        = row.author,
        sourceTitle   = row.source_title,
        groupId       = row.group_id,
        groupName     = row.group_name,
        readingStatus = row.reading_status,
        createdAt     = num(row.created_at),
        updatedAt     = num(row.updated_at),
        deletedAt     = num(row.deleted_at),
        uploadedAt    = num(row.uploaded_at),
    }
    -- metadata: server stringifies what we send, so pass the parsed
    -- table (NOT the metadata_json string, or it'd get double-encoded).
    if row.metadata_json and row.metadata_json ~= "" then
        local json = require("json")
        local ok, parsed = pcall(json.decode, row.metadata_json)
        if ok and type(parsed) == "table" then out.metadata = parsed end
    end
    -- progress: stored locally as JSON tuple [cur, total] in progress_lib;
    -- the wire format expects the actual array.
    if row.progress_lib and row.progress_lib ~= "" then
        local json = require("json")
        local ok, parsed = pcall(json.decode, row.progress_lib)
        if ok and type(parsed) == "table" then out.progress = parsed end
    end
    return out
end
M._row_to_wire = row_to_wire  -- exported for tests

-- ---------------------------------------------------------------------------
-- pushBook(book_row, opts, cb) — POST a single book row to /sync. Used
-- after touchBook bumps updated_at on reader close, mirroring what
-- Readest web does after every reading session.
--
-- opts: { sync_auth, sync_path, settings }
-- cb: function(success, msg, status)
-- ---------------------------------------------------------------------------
function M.pushBook(book_row, opts, cb)
    local logger = require("logger")
    local SyncAuth = opts.sync_auth
    if not book_row or not book_row.hash then
        if cb then cb(false, "missing book row") end
        return
    end
    SyncAuth:withFreshToken(opts.settings, opts.sync_path, function(ok)
        if not ok then
            if cb then cb(false, "auth refresh failed") end
            return
        end
        local client = SyncAuth:getReadestSyncClient(opts.settings, opts.sync_path)
        if not client then
            if cb then cb(false, "no sync client") end
            return
        end
        local payload = {
            books   = { row_to_wire(book_row) },
            notes   = {},
            configs = {},
        }
        logger.info("ReadestLibrary pushBook: hash=" .. book_row.hash)
        client:pushChanges(payload, function(success, body, status)
            logger.info("ReadestLibrary pushBook done: success=" .. tostring(success)
                .. " status=" .. tostring(status))
            if not success then
                if cb then cb(false, body and body.error or "push failed", status) end
                return
            end
            if cb then cb(true) end
        end)
    end)
end

-- ---------------------------------------------------------------------------
-- pushChangedBooks(opts, cb) — push every book row that's changed since the
-- watermark, in one /sync POST (server batches internally). Mirrors
-- useBooksSync's getNewBooks → syncBooks(newBooks, 'push') flow at
-- apps/readest-app/src/app/library/hooks/useBooksSync.ts:88-94.
--
-- After a successful push, advances the watermark to the max
-- updated_at | deleted_at of the rows we sent (so the next sync's
-- getChangedBooks query doesn't re-include them).
-- ---------------------------------------------------------------------------
function M.pushChangedBooks(opts, cb)
    local logger = require("logger")
    local SyncAuth = opts.sync_auth
    local store = opts.store
    if not store then
        if cb then cb(false, "no store") end
        return
    end

    local since = store:getLastPulledAt() or 0
    local changed = store:getChangedBooks(since)
    if #changed == 0 then
        logger.info("ReadestLibrary pushChangedBooks: nothing to push (since=" .. since .. ")")
        if cb then cb(true, 0) end
        return
    end

    SyncAuth:withFreshToken(opts.settings, opts.sync_path, function(ok)
        if not ok then
            if cb then cb(false, "auth refresh failed") end
            return
        end
        local client = SyncAuth:getReadestSyncClient(opts.settings, opts.sync_path)
        if not client then
            if cb then cb(false, "no sync client") end
            return
        end

        local books_wire = {}
        local max_ts = since
        for i, row in ipairs(changed) do
            books_wire[i] = row_to_wire(row)
            if row.updated_at and row.updated_at > max_ts then max_ts = row.updated_at end
            if row.deleted_at and row.deleted_at > max_ts then max_ts = row.deleted_at end
        end

        logger.info("ReadestLibrary pushChangedBooks: pushing " .. #books_wire
            .. " row(s) (since=" .. tostring(since)
            .. " new_watermark=" .. tostring(max_ts) .. ")")
        client:pushChanges({ books = books_wire, notes = {}, configs = {} },
            function(success, body, status)
                logger.info("ReadestLibrary pushChangedBooks done: success=" .. tostring(success)
                    .. " status=" .. tostring(status))
                if not success then
                    if cb then cb(false, body and body.error or "push failed", status) end
                    return
                end
                store:setLastPulledAt(max_ts)
                if cb then cb(true, #books_wire) end
            end)
    end)
end

-- ---------------------------------------------------------------------------
-- syncBooks(opts, mode, cb) — convenience wrapper for the bidirectional
-- sync the web does on auto-sync (useBooksSync.handleAutoSync). Modes:
--   "push" — pushChangedBooks only
--   "pull" — pullBooks only (existing fetch)
--   "both" — push then pull (matches the web's syncBooks(..., 'both') call)
-- cb is invoked once after the LAST step completes; intermediate failures
-- are logged but do not abort (push failure shouldn't prevent pull).
-- ---------------------------------------------------------------------------
function M.syncBooks(opts, mode, cb)
    mode = mode or "both"
    if mode == "push" then
        M.pushChangedBooks(opts, cb)
    elseif mode == "pull" then
        M.pullBooks(opts, cb)
    else  -- "both"
        M.pushChangedBooks(opts, function(push_ok, push_msg)
            M.pullBooks(opts, function(pull_ok, pull_msg, pull_status)
                if cb then
                    cb(push_ok and pull_ok,
                       string.format("push=%s/%s pull=%s/%s",
                           tostring(push_ok), tostring(push_msg),
                           tostring(pull_ok), tostring(pull_msg)),
                       pull_status)
                end
            end)
        end)
    end
end

-- ---------------------------------------------------------------------------
-- Network methods (live KOReader required; not unit-tested)
-- ---------------------------------------------------------------------------
-- See spec for `M.pullBooks`, `M.downloadBook`, `M.downloadCover` in the
-- design doc's Sync flow section. Implementation lives below; structured so
-- the pure helpers stay separately exportable for tests.

-- pullBooks(opts, cb)
-- opts: {
--   sync_auth   = SyncAuth instance (for withFreshToken),
--   sync_path   = path to the koplugin dir (for the spore spec lookup),
--   settings    = current G_reader_settings.readest_sync,
--   store       = LibraryStore instance,
-- }
-- cb: function(success, msg)
function M.pullBooks(opts, cb)
    local logger = require("logger")
    local SyncAuth = opts.sync_auth
    local LibraryStore = require("library.librarystore")

    logger.info("ReadestLibrary syncbooks.pullBooks: starting")

    -- Ensure JWT is fresh before issuing the call (codex round 1: today's
    -- ensureClient() refreshes async-and-races; the new wrapper blocks until
    -- the refresh completes, so the request never fires with a stale token).
    SyncAuth:withFreshToken(opts.settings, opts.sync_path, function(ok, err)
        logger.info("ReadestLibrary withFreshToken result: ok=" .. tostring(ok) .. " err=" .. tostring(err))
        if not ok then
            if cb then cb(false, err or "auth refresh failed") end
            return
        end

        local client = SyncAuth:getReadestSyncClient(opts.settings, opts.sync_path)
        if not client then
            logger.warn("ReadestLibrary getReadestSyncClient returned nil; settings={"
                .. "access_token=" .. tostring(opts.settings.access_token and "<set>" or "<nil>")
                .. ", expires_at=" .. tostring(opts.settings.expires_at)
                .. ", now=" .. tostring(os.time()) .. "}")
            if cb then cb(false, "no sync client (not authenticated?)") end
            return
        end

        local since = opts.store:getLastPulledAt() or 0
        logger.info("ReadestLibrary client:pullBooks dispatching with since=" .. tostring(since))
        client:pullBooks({ since = since }, function(success, body, status)
            logger.info("ReadestLibrary client:pullBooks responded: success=" .. tostring(success)
                .. " status=" .. tostring(status)
                .. " body_type=" .. type(body)
                .. " rows=" .. tostring(body and body.books and #body.books or "n/a"))
            if not success then
                if status == 401 or status == 403
                    or (body and body.error == "Not authenticated") then
                    if cb then cb(false, "auth", status) end
                else
                    if cb then cb(false, body and body.error or "pull failed", status) end
                end
                return
            end

            local rows = body and body.books or {}
            local max_ts = 0
            local upserted = 0
            for _, raw in ipairs(rows) do
                local parsed = LibraryStore.parseSyncRow(raw)
                if parsed then
                    parsed.user_id = opts.settings.user_id
                    opts.store:upsertBook(parsed)
                    upserted = upserted + 1
                    -- Watermark = max of returned updated_at | deleted_at,
                    -- not local now (codex round 1, finding 8).
                    if parsed.updated_at and parsed.updated_at > max_ts then
                        max_ts = parsed.updated_at
                    end
                    if parsed.deleted_at and parsed.deleted_at > max_ts then
                        max_ts = parsed.deleted_at
                    end
                end
            end
            if max_ts > 0 then opts.store:setLastPulledAt(max_ts) end
            logger.info("ReadestLibrary pullBooks complete: rows=" .. #rows
                .. " upserted=" .. upserted .. " new_watermark=" .. max_ts)
            if cb then cb(true, upserted) end
        end)
    end)
end

-- downloadBook(book, opts, cb)
-- opts: {
--   sync_auth, sync_path, settings,
--   download_dir   = absolute path; created if missing,
-- }
-- book: a row from LibraryStore (must include hash, format, title/source_title)
-- cb: function(success, abs_path_or_err, status)
function M.downloadBook(book, opts, cb)
    local logger = require("logger")
    local lfs = require("libs/libkoreader-lfs")
    local SyncAuth = opts.sync_auth

    logger.info("ReadestLibrary downloadBook: hash=" .. tostring(book.hash)
        .. " format=" .. tostring(book.format)
        .. " title=" .. tostring(book.title))

    local file_key = M.build_file_key({
        user_id = opts.settings.user_id,
        hash    = book.hash,
        format  = book.format,
    })
    if not file_key then
        logger.warn("ReadestLibrary downloadBook: build_file_key returned nil"
            .. " (user_id_set=" .. tostring(opts.settings.user_id ~= nil)
            .. " hash_set=" .. tostring(book.hash ~= nil and book.hash ~= "")
            .. " format=" .. tostring(book.format) .. ")")
        if cb then cb(false, "could not build cloud fileKey for book") end
        return
    end
    logger.info("ReadestLibrary downloadBook: file_key=" .. file_key)

    local local_name = M.build_local_filename(book)
    if not local_name then
        logger.warn("ReadestLibrary downloadBook: build_local_filename returned nil")
        if cb then cb(false, "unknown book format") end
        return
    end

    if not lfs.attributes(opts.download_dir, "mode") then
        logger.info("ReadestLibrary downloadBook: creating download_dir " .. tostring(opts.download_dir))
        lfs.mkdir(opts.download_dir)
    end
    local exists = function(name)
        return lfs.attributes(opts.download_dir .. "/" .. name, "mode") ~= nil
    end
    local final_name = M.resolve_collision(local_name, exists)
    local dst = opts.download_dir .. "/" .. final_name
    logger.info("ReadestLibrary downloadBook: dst=" .. dst)

    logger.info("ReadestLibrary downloadBook: requesting fresh token…")
    SyncAuth:withFreshToken(opts.settings, opts.sync_path, function(ok)
        logger.info("ReadestLibrary downloadBook: withFreshToken returned ok=" .. tostring(ok))
        if not ok then
            if cb then cb(false, "auth refresh failed") end
            return
        end
        local client = SyncAuth:getReadestSyncClient(opts.settings, opts.sync_path)
        if not client then
            logger.warn("ReadestLibrary downloadBook: getReadestSyncClient returned nil")
            if cb then cb(false, "no sync client") end
            return
        end
        logger.info("ReadestLibrary downloadBook: dispatching getDownloadUrl…")
        client:getDownloadUrl({ fileKey = file_key }, function(success, body, status)
            logger.info("ReadestLibrary downloadBook: getDownloadUrl responded"
                .. " success=" .. tostring(success)
                .. " status=" .. tostring(status)
                .. " body_type=" .. type(body)
                .. " has_url=" .. tostring(body and body.downloadUrl ~= nil))
            if not success or not body or not body.downloadUrl then
                local err = (status == 404) and "cloud-not-found"
                    or (body and body.error)
                    or "url-fetch-failed"
                if cb then cb(false, err, status) end
                return
            end
            local url = body.downloadUrl
            logger.info("ReadestLibrary downloadBook: streaming GET " .. url:sub(1, 80) .. "…")

            -- Use socket.http synchronously with ltn12 file sink — same
            -- pattern as KOReader's OPDS downloader (opdsbrowser.lua:1036)
            -- and dropboxapi (dropboxapi.lua:39). The async httpclient
            -- path we used before only fires its callback inside an
            -- active Spore coroutine; calling it from a getDownloadUrl
            -- callback doesn't satisfy that, so the response was never
            -- delivered and the "Downloading…" dialog hung forever.
            -- Synchronous blocks the UI for the duration of the
            -- download, which matches OPDS UX (progress dialog stays
            -- visible; users expect the brief freeze).
            local socket     = require("socket")
            local http       = require("socket.http")
            local socketutil = require("socketutil")
            local ltn12      = require("ltn12")

            local f, ferr = io.open(dst, "wb")
            if not f then
                logger.warn("ReadestLibrary downloadBook: io.open failed " .. tostring(ferr))
                if cb then cb(false, "open dst failed: " .. tostring(ferr)) end
                return
            end

            socketutil:set_timeout(socketutil.FILE_BLOCK_TIMEOUT, socketutil.FILE_TOTAL_TIMEOUT)
            local code, headers, http_status = socket.skip(1, http.request{
                url     = url,
                headers = { ["Accept-Encoding"] = "identity" },
                sink    = ltn12.sink.file(f),
            })
            socketutil:reset_timeout()

            logger.info("ReadestLibrary downloadBook: socket.http response"
                .. " code=" .. tostring(code) .. " status=" .. tostring(http_status))

            if code ~= 200 then
                -- sink already closed by ltn12 on error; remove the
                -- partial file so a retry doesn't trip the
                -- collision-resolution suffix.
                os.remove(dst)
                if cb then cb(false, "download failed", code) end
                return
            end
            logger.info("ReadestLibrary downloadBook: wrote " .. dst)
            if cb then cb(true, dst) end
        end)
    end)
end

-- downloadCover(book, opts, cb)
-- opts: {
--   sync_auth, sync_path, settings,
--   covers_dir   = absolute path to readest_covers cache,
-- }
-- cb: function(success, abs_path_or_err, status)
-- A 404 is recorded as a success-with-no-cover so we don't retry forever:
-- callers should set cover_path = "_missing" sentinel when status == 404.
function M.downloadCover(book, opts, cb)
    local lfs = require("libs/libkoreader-lfs")
    local SyncAuth = opts.sync_auth

    local file_key = M.build_cover_key({
        user_id = opts.settings.user_id,
        hash    = book.hash,
    })
    if not file_key then
        if cb then cb(false, "missing user_id or hash") end
        return
    end

    if not lfs.attributes(opts.covers_dir, "mode") then
        lfs.mkdir(opts.covers_dir)
    end
    local dst = opts.covers_dir .. "/" .. book.hash .. ".png"

    SyncAuth:withFreshToken(opts.settings, opts.sync_path, function(ok)
        if not ok then
            if cb then cb(false, "auth refresh failed") end
            return
        end
        local client = SyncAuth:getReadestSyncClient(opts.settings, opts.sync_path)
        if not client then
            if cb then cb(false, "no sync client") end
            return
        end
        client:getDownloadUrl({ fileKey = file_key }, function(success, body, status)
            if status == 404 then
                if cb then cb(false, "no-cover", 404) end
                return
            end
            if not success or not body or not body.downloadUrl then
                if cb then cb(false, "url-fetch-failed", status) end
                return
            end

            -- Background download via fork+poll. The UI stays fully
            -- responsive because the actual blocking IO happens in the
            -- subprocess; the parent just polls every 300ms to see if
            -- it's done. Same pattern KOReader's BookInfoManager uses
            -- for cover extraction (bookinfomanager.lua:721).
            -- httpclient/Turbo would be nicer but isn't available on
            -- platforms KOReader builds without UIManager.looper
            -- (macOS desktop, etc).
            local FFIUtil   = require("ffi/util")
            local UIManager = require("ui/uimanager")
            local url = body.downloadUrl

            local pid, parent_read_fd = FFIUtil.runInSubProcess(
                function(_child_pid, child_write_fd)
                    local socket     = require("socket")
                    local http       = require("socket.http")
                    local socketutil = require("socketutil")
                    local ltn12      = require("ltn12")

                    local result
                    local f, ferr = io.open(dst, "wb")
                    if not f then
                        result = "error:open:" .. tostring(ferr)
                    else
                        socketutil:set_timeout(socketutil.FILE_BLOCK_TIMEOUT, socketutil.FILE_TOTAL_TIMEOUT)
                        local code = socket.skip(1, http.request{
                            url     = url,
                            headers = { ["Accept-Encoding"] = "identity" },
                            sink    = ltn12.sink.file(f),
                        })
                        socketutil:reset_timeout()
                        if code == 200 then
                            result = "ok"
                        elseif code == 404 then
                            result = "404"
                        else
                            result = "error:http:" .. tostring(code)
                        end
                    end
                    FFIUtil.writeToFD(child_write_fd, result, true)
                end,
                true)  -- with_pipe = true

            if not pid then
                if cb then cb(false, "fork failed") end
                return
            end

            local poll_interval = 0.3
            local poll
            poll = function()
                if FFIUtil.isSubProcessDone(pid) then
                    local result = FFIUtil.readAllFromFD(parent_read_fd) or ""
                    if result == "ok" then
                        if cb then cb(true, dst) end
                    elseif result == "404" then
                        os.remove(dst)
                        if cb then cb(false, "no-cover", 404) end
                    else
                        os.remove(dst)
                        if cb then cb(false, result, nil) end
                    end
                else
                    UIManager:scheduleIn(poll_interval, poll)
                end
            end
            UIManager:scheduleIn(poll_interval, poll)
        end)
    end)
end

-- ---------------------------------------------------------------------------
-- uploadBook(book, opts, cb) — push a local book file to Readest cloud.
-- ---------------------------------------------------------------------------
-- Two-step flow mirroring `apps/readest-app/src/libs/storage.ts:42-78`:
--   1. POST /storage/upload {fileName, fileSize, bookHash} → server
--      validates quota, inserts a row in `files`, returns a presigned
--      PUT URL valid for 30 min.
--   2. PUT raw bytes to that URL via socket.http (synchronous, mirrors
--      downloadBook for the same UX trade-off — UI freezes during the
--      upload but the dialog stays visible).
--
-- Cover.png handling is intentionally minimal in v1: if a cover is
-- already cached at <covers_dir>/<hash>.png (from a prior cloud
-- download), upload it too. Books without a cached cover skip the cover
-- step silently — the server tolerates books with no cover row.
--
-- opts: { sync_auth, sync_path, settings, covers_dir = optional }
-- book: row with { hash, format, file_path, title, source_title }
-- cb: function(success, msg, status)
function M.uploadBook(book, opts, cb)
    local logger = require("logger")
    local lfs = require("libs/libkoreader-lfs")
    local SyncAuth = opts.sync_auth

    if not book or not book.hash or not book.format or not book.file_path then
        if cb then cb(false, "missing book info") end
        return
    end
    local ext = EXTS[book.format]
    if not ext then
        if cb then cb(false, "unsupported format") end
        return
    end
    local attr = lfs.attributes(book.file_path)
    if not attr or attr.mode ~= "file" then
        if cb then cb(false, "local file missing") end
        return
    end
    local fileSize = attr.size

    -- Cloud-relative path: matches getRemoteBookFilename for S3 storage
    -- (apps/readest-app/src/utils/book.ts:24). Server prepends "<user.id>/"
    -- to form the final fileKey.
    local bookFileName = string.format("%s/%s/%s.%s",
        CLOUD_BOOKS_SUBDIR, book.hash, book.hash, ext)
    local cover_path = opts.covers_dir
        and (opts.covers_dir .. "/" .. book.hash .. ".png") or nil
    local cover_attr = cover_path and lfs.attributes(cover_path) or nil
    local has_cover = cover_attr and cover_attr.mode == "file"

    -- Synchronous PUT helper. Returns (ok, code, body_or_err) — body
    -- captures the S3/R2 XML error response on failure, so the caller
    -- can log something more useful than just "table: 0x...". Bug
    -- before: I had `local _, code = socket.skip(1, http.request{...})`,
    -- which assigned the headers table (the second value after skip) to
    -- `code`, resulting in log lines like "code=table: 0x01156a2d48".
    -- socket.skip(1, ...) drops the first return value of http.request,
    -- so the first remaining return IS the HTTP status code.
    local function put_bytes(url, src_path, size)
        local socket     = require("socket")
        local http       = require("socket.http")
        local socketutil = require("socketutil")
        local ltn12      = require("ltn12")
        local f, ferr = io.open(src_path, "rb")
        if not f then return false, nil, "open: " .. tostring(ferr) end
        local body_chunks = {}
        socketutil:set_timeout(socketutil.FILE_BLOCK_TIMEOUT, socketutil.FILE_TOTAL_TIMEOUT)
        local code, headers, status_line = socket.skip(1, http.request{
            url     = url,
            method  = "PUT",
            source  = ltn12.source.file(f),
            headers = { ["content-length"] = tostring(size) },
            sink    = ltn12.sink.table(body_chunks),
        })
        socketutil:reset_timeout()
        local ok = (code == 200 or code == 204)
        local body = table.concat(body_chunks)
        if not ok then
            logger.warn("ReadestLibrary uploadBook PUT non-2xx: code="
                .. tostring(code) .. " status=" .. tostring(status_line)
                .. " ctype=" .. tostring(headers and headers["content-type"])
                .. " body_len=" .. #body
                .. " body_head=" .. tostring(body:sub(1, 400)))
        end
        return ok, code, body
    end

    SyncAuth:withFreshToken(opts.settings, opts.sync_path, function(ok)
        if not ok then
            if cb then cb(false, "auth refresh failed") end
            return
        end
        local client = SyncAuth:getReadestSyncClient(opts.settings, opts.sync_path)
        if not client then
            if cb then cb(false, "no sync client") end
            return
        end

        -- Step 1: book file presigned URL
        logger.info("ReadestLibrary uploadBook: requesting URL for "
            .. bookFileName .. " (size=" .. fileSize .. ")")
        client:getUploadUrl({
            fileName = bookFileName,
            fileSize = fileSize,
            bookHash = book.hash,
        }, function(s, body, status)
            if not s or not body or not body.uploadUrl then
                local msg
                if status == 403 and body and body.error then
                    msg = body.error  -- "Insufficient storage quota"
                else
                    msg = "upload-url-failed"
                end
                logger.warn("ReadestLibrary uploadBook: getUploadUrl failed status="
                    .. tostring(status) .. " msg=" .. tostring(msg)
                    .. " body=" .. tostring(body and body.error or "<nil>"))
                if cb then cb(false, msg, status) end
                return
            end
            logger.info("ReadestLibrary uploadBook: presigned URL received"
                .. " (host=" .. tostring(body.uploadUrl:match("^https?://([^/]+)") or "?")
                .. ", quota_usage=" .. tostring(body.usage)
                .. " quota=" .. tostring(body.quota) .. ")")

            -- Step 2: PUT book bytes
            local put_ok, put_code, put_body = put_bytes(body.uploadUrl, book.file_path, fileSize)
            logger.info("ReadestLibrary uploadBook: book PUT code=" .. tostring(put_code)
                .. " ok=" .. tostring(put_ok))
            if not put_ok then
                local err = "book upload failed"
                if put_body and #put_body > 0 then
                    -- S3/R2 returns XML on error; surface the <Code>...</Code> tag
                    -- if present so the caller's toast can show something useful.
                    local s3code = put_body:match("<Code>(.-)</Code>")
                    if s3code then err = err .. " (" .. s3code .. ")" end
                end
                if cb then cb(false, err, put_code) end
                return
            end

            -- Optional cover upload — best-effort.
            if has_cover then
                local coverFileName = string.format("%s/%s/cover.png",
                    CLOUD_BOOKS_SUBDIR, book.hash)
                local cover_size = cover_attr.size
                client:getUploadUrl({
                    fileName = coverFileName,
                    fileSize = cover_size,
                    bookHash = book.hash,
                }, function(s2, b2, status2)
                    if s2 and b2 and b2.uploadUrl then
                        local c_ok, c_code = put_bytes(b2.uploadUrl, cover_path, cover_size)
                        logger.info("ReadestLibrary uploadBook: cover PUT code="
                            .. tostring(c_code) .. " ok=" .. tostring(c_ok))
                    else
                        logger.info("ReadestLibrary uploadBook: cover URL skipped status="
                            .. tostring(status2))
                    end
                    if cb then cb(true) end
                end)
            else
                if cb then cb(true) end
            end
        end)
    end)
end

-- ---------------------------------------------------------------------------
-- deleteCloudFiles(book, opts, cb) — discover the storage objects for a
-- book hash via /storage/list, then DELETE each one. Mirrors Readest's
-- cloudService.deleteBook flow at apps/readest-app/src/services/
-- cloudService.ts:43-54 + libs/storage.ts:180-195.
--
-- The DELETE endpoint requires the literal file_key (no extension
-- fallback like /storage/download has), so we MUST list first to learn
-- the actual filenames — they may differ between R2 ({title}.{ext}) and
-- S3 ({hash}.{ext}) deployments.
--
-- Tolerates per-file failures (matches the web client's try/catch
-- around each delete) and reports overall success when at least one
-- delete succeeded — so a missing cover doesn't fail the book delete.
--
-- opts: { sync_auth, sync_path, settings }
-- cb: function(success, msg, status)
-- ---------------------------------------------------------------------------
function M.deleteCloudFiles(book, opts, cb)
    local logger = require("logger")
    local SyncAuth = opts.sync_auth
    if not book or not book.hash then
        if cb then cb(false, "missing book") end
        return
    end
    SyncAuth:withFreshToken(opts.settings, opts.sync_path, function(ok)
        if not ok then
            if cb then cb(false, "auth refresh failed") end
            return
        end
        local client = SyncAuth:getReadestSyncClient(opts.settings, opts.sync_path)
        if not client then
            if cb then cb(false, "no sync client") end
            return
        end
        logger.info("ReadestLibrary deleteCloudFiles: hash=" .. book.hash)
        client:listFiles({ bookHash = book.hash }, function(success, body, status)
            if not success then
                logger.warn("ReadestLibrary deleteCloudFiles: listFiles failed status="
                    .. tostring(status))
                if cb then cb(false, body and body.error or "list failed", status) end
                return
            end
            local files = body and body.files or {}
            if #files == 0 then
                logger.info("ReadestLibrary deleteCloudFiles: no files for hash "
                    .. book.hash .. " — already gone")
                if cb then cb(true, 0) end
                return
            end
            -- Sequential delete (one at a time): the web client tolerates
            -- per-file failures and we want to mirror that without hiding
            -- partial-success cases. Fire DELETEs one after another via
            -- callback chaining; track per-file outcomes.
            local total = #files
            local done, ok_count = 0, 0
            local last_status
            local function step(i)
                if i > total then
                    logger.info("ReadestLibrary deleteCloudFiles: " .. ok_count
                        .. "/" .. total .. " deleted (last_status="
                        .. tostring(last_status) .. ")")
                    if cb then
                        cb(ok_count > 0, ok_count, last_status)
                    end
                    return
                end
                local fkey = files[i].file_key
                logger.info("ReadestLibrary deleteCloudFiles: deleting " .. tostring(fkey))
                client:deleteFile({ fileKey = fkey }, function(s, _b, st)
                    done = done + 1
                    if s then ok_count = ok_count + 1 end
                    last_status = st
                    if not s then
                        logger.warn("ReadestLibrary deleteCloudFiles: failed to delete "
                            .. tostring(fkey) .. " status=" .. tostring(st))
                    end
                    step(i + 1)
                end)
            end
            step(1)
        end)
    end)
end

return M
