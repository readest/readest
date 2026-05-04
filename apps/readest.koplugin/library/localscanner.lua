-- localscanner.lua
-- Discover books KOReader has already opened (and therefore has a hash for)
-- and feed them into the LibraryStore.
--
-- We never compute partial-md5 on demand: that's KOReader's job, performed
-- the first time it opens a book file. The scanner only enumerates books
-- whose .sdr/ sidecar already contains `partial_md5_checksum`, which means
-- the local source-of-truth is "anything KOReader has opened at least
-- once." This matches the user's stated v1 constraint and makes the scan
-- bounded and side-effect-free.
--
-- Pure helpers (sidecar_to_book_path, parse_sidecar, should_skip_dir) are
-- exported and unit-tested. The two driver methods (lightScan,
-- fullSidecarWalk) require live KOReader services (ReadHistory,
-- DocSettings, FFIUtil.runInSubProcess) and are exercised manually via the
-- test matrix in docs/library-design.md.

local logger = require("logger")

local M = {}

-- ---------------------------------------------------------------------------
-- sidecar_to_book_path
-- ---------------------------------------------------------------------------
-- Convert "/foo/bar.sdr/metadata.epub.lua" → "/foo/bar.epub".
-- Returns nil for any input that doesn't match the sidecar shape.
function M.sidecar_to_book_path(path)
    if type(path) ~= "string" or path == "" then return nil end
    local parent, ext = path:match("^(.+)%.sdr/metadata%.([^./]+)%.lua$")
    if not parent then return nil end
    return parent .. "." .. ext
end

-- ---------------------------------------------------------------------------
-- parse_sidecar
-- ---------------------------------------------------------------------------
-- Open a sidecar file, evaluate it (it returns a Lua table), and pull out
-- the fields we care about: hash + a few doc_props. Returns:
--
--   { hash = "...", title = "...", author = "...", file_path = "..." }
--
-- ...or nil for any failure mode (file missing, syntax error, runtime
-- error, missing partial_md5_checksum). The Library can't use a row without
-- a hash, so we treat hash-missing as nothing-to-see-here.
function M.parse_sidecar(path)
    local book_path = M.sidecar_to_book_path(path)
    if not book_path then return nil end

    local f = loadfile(path)
    if not f then return nil end

    -- Sidecars are raw `return { ... }` files; loadfile gives us a chunk
    -- that, when called, returns the table. Wrap in pcall in case the
    -- table contains a function or self-referential table that errors.
    local ok, result = pcall(f)
    if not ok or type(result) ~= "table" then return nil end

    local hash = result.partial_md5_checksum
    if type(hash) ~= "string" or hash == "" then return nil end

    local doc_props = result.doc_props or {}
    return {
        hash      = hash,
        title     = doc_props.title,
        author    = doc_props.authors,
        file_path = book_path,
    }
end

-- ---------------------------------------------------------------------------
-- should_skip_dir
-- ---------------------------------------------------------------------------
-- Predicate for the recursive walk. `.` / `..` filtered by the caller (lfs
-- emits them but they're trivial); we handle the noise files KOReader's
-- own FileChooser also skips.
local SKIP_DIRS = {
    [".git"]          = true,
    [".svn"]          = true,
    [".hg"]           = true,
    ["node_modules"]  = true,
    [".Trash"]        = true,
    [".Trashes"]      = true,
    ["$RECYCLE.BIN"]  = true,
    [".adobe-digital-editions"] = true,
    [".Spotlight-V100"] = true,
    [".fseventsd"]    = true,
    [".DocumentRevisions-V100"] = true,
    [".TemporaryItems"] = true,
}

function M.should_skip_dir(name)
    if name == "." or name == ".." then return false end  -- caller's job
    return SKIP_DIRS[name] == true
end

-- ---------------------------------------------------------------------------
-- lightScan(opts) — fast path; runs on every Library open
-- ---------------------------------------------------------------------------
-- opts: { store = LibraryStore, ui = top-level UI? }
--
-- 1. For every existing local row in the store, stat file_path; if missing,
--    set local_present=0.
-- 2. For every ReadHistory entry whose file still exists, look up the
--    sidecar (it's always present after KOReader opened the book) and
--    upsert {hash, file_path, local_present=1, last_read_at=hist.time*1000}.
--
-- Bounded by `O(rows in SQLite + ReadHistory.hist size)` — typically <200
-- entries. Cheap enough for every Library open. Live-KOReader-only.
function M.lightScan(opts)
    local lfs = require("libs/libkoreader-lfs")
    local DocSettings = require("docsettings")
    local ReadHistory = require("readhistory")

    local store = opts.store
    if not store then return 0, 0 end

    -- Step 1: sweep stale file_paths to local_present=0
    local stale = 0
    local rows = store:listBooks({})
    for _, row in ipairs(rows) do
        if row.local_present == 1 and row.file_path then
            if lfs.attributes(row.file_path, "mode") ~= "file" then
                store:upsertBook({
                    hash = row.hash,
                    title = row.title,
                    local_present = 0,
                })
                stale = stale + 1
            end
        end
    end

    -- Step 2: opportunistic upsert from ReadHistory.
    -- Per-iteration pcall so a single bad sidecar (corrupt Lua, file
    -- vanished mid-scan, DocSettings throwing on open) doesn't kill the
    -- whole loop and leave us with a partially-indexed library.
    local added, skipped = 0, 0
    for _, item in ipairs(ReadHistory.hist or {}) do
        local file = item.file
        if file and lfs.attributes(file, "mode") == "file" then
            local ok, err = pcall(function()
                -- DocSettings reads the sidecar for us; we get the same
                -- hash the sidecar walk would produce.
                local doc_settings = DocSettings:open(file)
                local hash = doc_settings:readSetting("partial_md5_checksum")
                if not hash or hash == "" then
                    skipped = skipped + 1
                    return
                end
                local doc_props = doc_settings:readSetting("doc_props") or {}
                store:upsertBook({
                    hash         = hash,
                    title        = doc_props.title
                                       or file:match("([^/]+)%.[^.]+$")
                                       or file,
                    author       = doc_props.authors,
                    format       = (file:match("%.([^.]+)$") or ""):upper(),
                    file_path    = file,
                    local_present = 1,
                    last_read_at = item.time and (item.time * 1000) or nil,
                })
                added = added + 1
            end)
            if not ok then
                skipped = skipped + 1
                logger.warn("ReadestLibrary lightScan: skipped " .. tostring(file)
                    .. " — " .. tostring(err))
            end
        end
    end

    logger.info("ReadestLibrary lightScan: stale=" .. stale
        .. " added/refreshed=" .. added .. " skipped=" .. skipped)
    return stale, added
end

-- ---------------------------------------------------------------------------
-- fullSidecarWalk(opts, on_progress) — slow path; gated to first-run /
-- explicit Rescan / 24h interval
-- ---------------------------------------------------------------------------
-- opts: { store, home_dir, on_cancel? }
-- on_progress: optional function(scanned_dirs, found_books)
--
-- Runs the recursive walk inside a forked subprocess via
-- FFIUtil.runInSubProcess (the same pattern KOReader's filemanagerfilesearcher.lua
-- uses for its dismissable scan, see :130-210). The subprocess returns a
-- list of {file_path, hash, title, author} structs; the parent upserts each
-- one in chunks so the UI stays responsive.
--
-- If `home_dir` is empty/nil we skip with a warning — this is the
-- "user hasn't picked a Books folder yet" path, handled at the UI level
-- by showing a hint to set Home in FileManager.
function M.fullSidecarWalk(opts, on_progress)
    if not opts.home_dir or opts.home_dir == "" then
        logger.info("ReadestLibrary fullSidecarWalk: home_dir unset, skipping")
        return 0
    end

    local lfs = require("libs/libkoreader-lfs")
    local FFIUtil = require("ffi/util")

    -- Fork: walk the tree in the child, return the slim summary table.
    local child_fn = function()
        local results = {}
        local stack = { opts.home_dir }
        while #stack > 0 do
            local dir = table.remove(stack)
            local ok, iter, dir_obj = pcall(lfs.dir, dir)
            if ok then
                for entry in iter, dir_obj do
                    if entry ~= "." and entry ~= ".." and not M.should_skip_dir(entry) then
                        local full = dir .. "/" .. entry
                        local mode = lfs.attributes(full, "mode")
                        if mode == "directory" then
                            -- KOReader sidecars live INSIDE *.sdr/ directories.
                            if entry:match("%.sdr$") then
                                -- Find the metadata.<ext>.lua inside
                                for child in lfs.dir(full) do
                                    if child:match("^metadata%..+%.lua$") then
                                        local parsed = M.parse_sidecar(full .. "/" .. child)
                                        if parsed then
                                            results[#results + 1] = parsed
                                        end
                                    end
                                end
                            else
                                stack[#stack + 1] = full
                            end
                        end
                    end
                end
            end
        end
        return results
    end

    local results = FFIUtil.runInSubProcess(child_fn)
    if type(results) ~= "table" then
        logger.warn("ReadestLibrary fullSidecarWalk: subprocess returned non-table")
        return 0
    end

    local store = opts.store
    local count = 0
    for _, p in ipairs(results) do
        if p.hash then
            store:upsertBook({
                hash          = p.hash,
                title         = p.title or p.file_path:match("([^/]+)%.[^.]+$") or "Untitled",
                author        = p.author,
                file_path     = p.file_path,
                local_present = 1,
            })
            count = count + 1
            if on_progress and count % 50 == 0 then
                on_progress(count)
            end
        end
    end
    if on_progress then on_progress(count) end
    logger.dbg("ReadestLibrary fullSidecarWalk: indexed " .. count .. " books")
    return count
end

return M
