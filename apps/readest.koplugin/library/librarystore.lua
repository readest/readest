-- librarystore.lua
-- SQLite-backed book index for the Library view. Merges Readest cloud books
-- (from /sync) with KOReader local books (from sidecar walks + ReadHistory)
-- via the partial-md5 hash that both sides already use.
--
-- All queries are scoped by user_id (composite PK with hash) so signing into
-- a different Readest account doesn't surface the previous user's books.
--
-- See apps/readest.koplugin/docs/library-design.md for the full schema and
-- contract notes; spec/library/librarystore_spec.lua is the canonical
-- behavioral spec.

local SQ3 = require("lua-ljsqlite3/init")
local json = require("json")

local SCHEMA_VERSION = 1

local SCHEMA_SQL = [[
CREATE TABLE IF NOT EXISTS books (
    user_id          TEXT NOT NULL,
    hash             TEXT NOT NULL,
    meta_hash        TEXT,
    title            TEXT NOT NULL,
    source_title     TEXT,
    author           TEXT,
    format           TEXT,
    metadata_json    TEXT,
    series           TEXT,
    series_index     REAL,
    group_id         TEXT,
    group_name       TEXT,
    cover_path       TEXT,
    file_path        TEXT,
    cloud_present    INTEGER NOT NULL DEFAULT 0,
    local_present    INTEGER NOT NULL DEFAULT 0,
    uploaded_at      INTEGER,
    progress_lib     TEXT,
    reading_status   TEXT,
    last_read_at     INTEGER,
    created_at       INTEGER,
    updated_at       INTEGER,
    deleted_at       INTEGER,
    PRIMARY KEY (user_id, hash)
);
CREATE INDEX IF NOT EXISTS books_user_updated  ON books(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS books_user_lastread ON books(user_id, last_read_at DESC);
CREATE INDEX IF NOT EXISTS books_user_meta     ON books(user_id, meta_hash);
CREATE INDEX IF NOT EXISTS books_user_group    ON books(user_id, group_name);
CREATE INDEX IF NOT EXISTS books_user_author   ON books(user_id, author);

CREATE TABLE IF NOT EXISTS sync_state (
    user_id TEXT NOT NULL,
    key     TEXT NOT NULL,
    value   TEXT,
    PRIMARY KEY (user_id, key)
);
]]

-- All columns we round-trip in the books row, in insert order.
local BOOK_COLS = {
    "user_id", "hash", "meta_hash", "title", "source_title", "author",
    "format", "metadata_json", "series", "series_index", "group_id",
    "group_name", "cover_path", "file_path", "cloud_present",
    "local_present", "uploaded_at", "progress_lib", "reading_status",
    "last_read_at", "created_at", "updated_at", "deleted_at",
}
local BOOK_COL_INDEX = {}
for i, c in ipairs(BOOK_COLS) do BOOK_COL_INDEX[c] = i end

-- Integer/real columns that lua-ljsqlite3 returns as int64_t / double cdata.
-- We tonumber() these on row read so consumers can do arithmetic and
-- string concat without worrying about cdata. Unix-ms timestamps fit
-- well within Lua's 53-bit double mantissa.
local NUMERIC_COLS = {
    series_index = true, cloud_present = true, local_present = true,
    uploaded_at = true, last_read_at = true, created_at = true,
    updated_at = true, deleted_at = true,
}

local function row_to_table(raw)
    local out = {}
    for i, col in ipairs(BOOK_COLS) do
        local v = raw[i]
        if v ~= nil and NUMERIC_COLS[col] then
            v = tonumber(v)
        end
        out[col] = v
    end
    return out
end

-- Allowed sort columns. listBooks accepts only these to keep SQL safe from
-- injection via filters.sort_by.
local SORT_WHITELIST = {
    updated_at    = true,
    last_read_at  = true,
    title         = true,
    author        = true,
    created_at    = true,
    series        = true,
    format        = true,
}

-- Allowed group_by columns. Must match a real column name.
local GROUP_WHITELIST = {
    author       = true,
    series       = true,
    group_name   = true,
}

local M = {}
M.__index = M

-- ---------------------------------------------------------------------------
-- Construction
-- ---------------------------------------------------------------------------
-- opts:
--   user_id  (required, string) — currently-authenticated Readest user.id
--   db_path  (optional, string) — defaults to ":memory:" for tests
function M.new(opts)
    assert(opts and type(opts.user_id) == "string" and opts.user_id ~= "",
        "LibraryStore.new requires opts.user_id")
    local self = setmetatable({}, M)
    self.user_id = opts.user_id
    self.db_path = opts.db_path or ":memory:"
    self.db = SQ3.open(self.db_path)
    self.db:exec(SCHEMA_SQL)
    self.db:exec(string.format("PRAGMA user_version = %d;", SCHEMA_VERSION))
    self._groups_cache = {}
    return self
end

function M:close()
    if self.db then self.db:close(); self.db = nil end
end

function M:getUserVersion()
    local v = self.db:rowexec("PRAGMA user_version;")
    return tonumber(v)
end

-- ---------------------------------------------------------------------------
-- Sync state per (user_id, key)
-- ---------------------------------------------------------------------------
function M:getLastPulledAt()
    local stmt = self.db:prepare(
        "SELECT value FROM sync_state WHERE user_id = ? AND key = ?")
    local row = stmt:reset():bind(self.user_id, "last_books_pulled_at"):step()
    stmt:close()
    if not row then return nil end
    return tonumber(row[1])
end

function M:setLastPulledAt(ts)
    local stmt = self.db:prepare([[
        INSERT INTO sync_state (user_id, key, value) VALUES (?, ?, ?)
        ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
    ]])
    stmt:reset():bind(self.user_id, "last_books_pulled_at", tostring(ts)):step()
    stmt:close()
end

-- ---------------------------------------------------------------------------
-- upsertBook
-- ---------------------------------------------------------------------------
-- Merges a row by (user_id, hash). Flags `cloud_present` and `local_present`
-- are OR-merged with the existing row UNLESS the caller passes the
-- `_force_cloud_present` sentinel, in which case the supplied value is
-- written verbatim (used for cloud-tombstone updates that must clear the
-- flag).
--
-- Sentinels:
--   _force_cloud_present = true → caller's cloud_present overrides OR-merge.
--   _clear_fields = { "deleted_at", ... } → after the preserve-existing pass,
--     these columns are explicitly nulled. Lets a caller un-tombstone a row
--     by passing nil (which would otherwise be indistinguishable from "not
--     provided" since Lua tables drop nil values).
function M:upsertBook(row)
    assert(row and type(row.hash) == "string" and row.hash ~= "",
        "upsertBook requires row.hash")
    assert(row.title, "upsertBook requires row.title")

    local existing = self:_getRowRaw(row.hash)

    local merged = {}
    for k in pairs(BOOK_COL_INDEX) do
        merged[k] = row[k]
    end
    merged.user_id = self.user_id
    merged.hash = row.hash

    if existing then
        -- OR-merge cloud_present unless explicit override
        if not row._force_cloud_present then
            merged.cloud_present = math.max(
                tonumber(existing.cloud_present) or 0,
                tonumber(merged.cloud_present) or 0)
        else
            merged.cloud_present = tonumber(row.cloud_present) or 0
        end
        -- OR-merge local_present always (no use case for force-clearing yet)
        merged.local_present = math.max(
            tonumber(existing.local_present) or 0,
            tonumber(merged.local_present) or 0)
        -- Preserve fields the caller didn't provide
        for k in pairs(BOOK_COL_INDEX) do
            if merged[k] == nil and existing[k] ~= nil then
                merged[k] = existing[k]
            end
        end
        -- Explicit clears: applied after preserve so they win.
        if row._clear_fields then
            for _, col in ipairs(row._clear_fields) do
                merged[col] = nil
            end
        end
    else
        merged.cloud_present = tonumber(merged.cloud_present) or 0
        merged.local_present = tonumber(merged.local_present) or 0
    end

    -- Build INSERT … ON CONFLICT … DO UPDATE … with positional params.
    local placeholders = {}
    local update_setters = {}
    for i, col in ipairs(BOOK_COLS) do
        placeholders[i] = "?"
        if col ~= "user_id" and col ~= "hash" then
            update_setters[#update_setters + 1] = col .. " = excluded." .. col
        end
    end
    local sql = string.format([[
        INSERT INTO books (%s) VALUES (%s)
        ON CONFLICT(user_id, hash) DO UPDATE SET %s
    ]], table.concat(BOOK_COLS, ", "),
        table.concat(placeholders, ", "),
        table.concat(update_setters, ", "))

    local stmt = self.db:prepare(sql)
    stmt:reset()
    for i, col in ipairs(BOOK_COLS) do
        stmt:bind1(i, merged[col])
    end
    stmt:step()
    stmt:close()

    -- Cached groupings stale after any insert/update.
    self._groups_cache = {}
end

-- ---------------------------------------------------------------------------
-- getChangedBooks(since) — returns every row whose updated_at OR deleted_at
-- exceeds the watermark. Mirrors useBooksSync.getNewBooks at
-- apps/readest-app/src/app/library/hooks/useBooksSync.ts:22-35.
-- Used by the auto-sync push path on book close to send deltas.
-- ---------------------------------------------------------------------------
function M:getChangedBooks(since)
    since = tonumber(since) or 0
    local stmt = self.db:prepare(string.format([[
        SELECT %s FROM books
        WHERE user_id = ?
          AND (updated_at > ? OR (deleted_at IS NOT NULL AND deleted_at > ?))
        ORDER BY updated_at ASC
    ]], table.concat(BOOK_COLS, ", ")))
    stmt:reset():bind(self.user_id, since, since)
    local rows = {}
    while true do
        local r = stmt:step()
        if not r then break end
        rows[#rows + 1] = row_to_table(r)
    end
    stmt:close()
    return rows
end

-- ---------------------------------------------------------------------------
-- touchBook(hash, fields) — update updated_at + last_read_at to "now",
-- merge in any other fields the caller passes (commonly progress_lib),
-- return the resulting row (or nil if the book isn't in the index).
--
-- This is the local-write half of "after open/close, sync to server"; the
-- caller composes touchBook + syncbooks.pushBook to mirror what
-- Readest web does in updateBookProgress + the books-table sync push
-- (apps/readest-app/src/store/libraryStore.ts:105-122).
-- ---------------------------------------------------------------------------
function M:touchBook(hash, fields)
    if not hash or hash == "" then return nil end
    local existing = self:_getRowRaw(hash)
    if not existing then return nil end
    local now = os.time() * 1000
    local merge = {
        hash         = hash,
        title        = existing.title,
        updated_at   = now,
        last_read_at = now,
    }
    if fields then for k, v in pairs(fields) do merge[k] = v end end
    self:upsertBook(merge)
    return self:_getRowRaw(hash)
end

-- Internal: fetch a row by hash for the current user, returned as a table
-- keyed by column name. Exposed (with leading underscore) for spec checks.
function M:_getRowRaw(hash)
    local stmt = self.db:prepare(string.format(
        "SELECT %s FROM books WHERE user_id = ? AND hash = ?",
        table.concat(BOOK_COLS, ", ")))
    local row = stmt:reset():bind(self.user_id, hash):step()
    stmt:close()
    if not row then return nil end
    return row_to_table(row)
end

-- ---------------------------------------------------------------------------
-- listBooks
-- ---------------------------------------------------------------------------
-- filters: { search, sort_by, sort_asc, group_by, group_filter }
function M:listBooks(filters)
    filters = filters or {}
    local where = {
        "user_id = ?",
        "deleted_at IS NULL",
        "(cloud_present = 1 OR local_present = 1)",
    }
    local args = { self.user_id }

    if filters.search and filters.search ~= "" then
        where[#where + 1] = "(LOWER(COALESCE(title, '')) LIKE ? OR LOWER(COALESCE(author, '')) LIKE ?)"
        local needle = "%" .. string.lower(filters.search) .. "%"
        args[#args + 1] = needle
        args[#args + 1] = needle
    end

    if filters.group_by and filters.group_filter then
        local col = GROUP_WHITELIST[filters.group_by] and filters.group_by
        if col then
            where[#where + 1] = col .. " = ?"
            args[#args + 1] = filters.group_filter
        end
    end

    -- "Books at this shelf level with no group value" — used by the
    -- bookshelf composer for the root view of group_by=author/series/group_name.
    if filters.ungrouped_col and GROUP_WHITELIST[filters.ungrouped_col] then
        local col = filters.ungrouped_col
        where[#where + 1] = "(" .. col .. " IS NULL OR " .. col .. " = '')"
    end

    local sort_by = SORT_WHITELIST[filters.sort_by] and filters.sort_by or "last_read_at"
    local sort_dir = filters.sort_asc and "ASC" or "DESC"
    -- "Date Read" semantics in this plugin = "any recent activity" (the
    -- web's Updated + Date Read concepts merged earlier). Prefer
    -- updated_at when present so a metadata bump (e.g. "Add to Readest"
    -- dedupe re-stamping updated_at) floats the row to the top even
    -- when last_read_at is older. Falls back to last_read_at for the
    -- rare row that has only the read timestamp (no updated_at).
    local sort_expr = (sort_by == "last_read_at")
        and "COALESCE(updated_at, last_read_at)"
        or sort_by

    local sql = string.format(
        "SELECT %s FROM books WHERE %s ORDER BY %s %s, hash ASC",
        table.concat(BOOK_COLS, ", "),
        table.concat(where, " AND "),
        sort_expr, sort_dir)

    local stmt = self.db:prepare(sql)
    stmt:reset()
    for i, v in ipairs(args) do stmt:bind1(i, v) end

    local rows = {}
    while true do
        local r = stmt:step()
        if not r then break end
        rows[#rows + 1] = row_to_table(r)
    end
    stmt:close()
    return rows
end

-- ---------------------------------------------------------------------------
-- getGroups
-- ---------------------------------------------------------------------------
-- Returns array of { name, count, latest_updated_at, latest_last_read_at,
-- latest_created_at } sorted by name. The per-sort aggregates let the
-- caller interleave groups and books in the merged shelf list using each
-- group's "most recent child" value (parity with Readest's
-- getGroupSortValue at apps/readest-app/src/app/library/utils/libraryUtils.ts:381-387).
-- Memoized per (user_id, group_by); invalidated by upsertBook.
function M:getGroups(group_by)
    if not GROUP_WHITELIST[group_by] then return {} end

    local cached = self._groups_cache[group_by]
    if cached then return cached end

    local sql = string.format([[
        SELECT %s AS name,
               COUNT(*) AS cnt,
               MAX(updated_at) AS latest_updated,
               MAX(COALESCE(updated_at, last_read_at)) AS latest_last_read,
               MAX(created_at) AS latest_created
        FROM books
        WHERE user_id = ? AND deleted_at IS NULL
          AND (cloud_present = 1 OR local_present = 1)
          AND %s IS NOT NULL AND %s != ''
        GROUP BY %s
        ORDER BY name ASC
    ]], group_by, group_by, group_by, group_by)

    local stmt = self.db:prepare(sql)
    stmt:reset():bind1(1, self.user_id)
    local out = {}
    while true do
        local r = stmt:step()
        if not r then break end
        out[#out + 1] = {
            name = r[1],
            count = tonumber(r[2]),
            latest_updated_at   = tonumber(r[3]),
            latest_last_read_at = tonumber(r[4]),
            latest_created_at   = tonumber(r[5]),
        }
    end
    stmt:close()

    self._groups_cache[group_by] = out
    return out
end

-- ---------------------------------------------------------------------------
-- listBookshelfGroups(group_by, parent_path)
-- ---------------------------------------------------------------------------
-- Returns the group entries shown at the current shelf level, mirroring
-- Readest's library nav model:
--   author/series — flat groups; parent_path is ignored (only meaningful
--   at root). Each entry is the existing getGroups output with display_name
--   set to the group name.
--
--   group_name — nested folders. parent_path is the folder we're inside
--   (nil = root). We emit one entry per immediate-child segment, with the
--   `name` field carrying the full slash-delimited path so the caller can
--   pass it back as parent_path for drill-in.
--
-- Each returned entry is { _group=true, name, display_name, count,
-- latest_updated_at }, sorted by display_name ASC.
function M:listBookshelfGroups(group_by, parent_path)
    if not GROUP_WHITELIST[group_by] then return {} end

    if group_by ~= "group_name" then
        if parent_path then return {} end
        local out = {}
        for _i, g in ipairs(self:getGroups(group_by)) do
            out[#out + 1] = {
                _group              = true,
                name                = g.name,
                display_name        = g.name,
                count               = g.count,
                latest_updated_at   = g.latest_updated_at,
                latest_last_read_at = g.latest_last_read_at,
                latest_created_at   = g.latest_created_at,
            }
        end
        return out
    end

    -- group_name: walk distinct group_name values and bucket by immediate
    -- child segment relative to parent_path. SQLite doesn't have great
    -- string-slicing primitives, but the distinct-group_name set is small
    -- (one row per unique path), so a Lua-side bucket is cheap.
    -- Per-sort aggregates mirror getGroups so the merged-shelf sort can
    -- use a folder's "most recent child" timestamp under any sort_by.
    local stmt = self.db:prepare([[
        SELECT group_name,
               COUNT(*) AS cnt,
               MAX(updated_at) AS latest_updated,
               MAX(COALESCE(updated_at, last_read_at)) AS latest_last_read,
               MAX(created_at) AS latest_created
        FROM books
        WHERE user_id = ? AND deleted_at IS NULL
          AND (cloud_present = 1 OR local_present = 1)
          AND group_name IS NOT NULL AND group_name != ''
        GROUP BY group_name
    ]])
    stmt:reset():bind1(1, self.user_id)

    local prefix = parent_path and (parent_path .. "/") or nil
    local prefix_len = prefix and #prefix or 0
    local children = {}  -- segment → aggregate accumulator

    while true do
        local r = stmt:step()
        if not r then break end
        local group_name      = r[1]
        local cnt             = tonumber(r[2]) or 0
        local latest_updated  = tonumber(r[3]) or 0
        local latest_lastread = tonumber(r[4]) or 0
        local latest_created  = tonumber(r[5]) or 0
        local rest
        if parent_path then
            -- "Fantasy" with parent="Fantasy" is a direct-child book, not
            -- a folder; skip from the folder list (caller picks it up via
            -- listBookshelfBooks).
            if group_name ~= parent_path
               and group_name:sub(1, prefix_len) == prefix then
                rest = group_name:sub(prefix_len + 1)
            end
        else
            rest = group_name
        end
        if rest and rest ~= "" then
            -- Match Readest's slashIndex > 0 semantics
            -- (apps/readest-app/src/app/library/components/BookshelfItem.tsx:43-44):
            -- a leading slash keeps the whole rest as the immediate-child name
            -- instead of producing an empty segment.
            local slash_pos = rest:find("/", 1, true)
            local segment
            if slash_pos and slash_pos > 1 then
                segment = rest:sub(1, slash_pos - 1)
            else
                segment = rest
            end
            local entry = children[segment]
            if entry then
                entry.count          = entry.count + cnt
                entry.latest_updated = math.max(entry.latest_updated, latest_updated)
                entry.latest_lastread = math.max(entry.latest_lastread, latest_lastread)
                entry.latest_created = math.max(entry.latest_created, latest_created)
            else
                children[segment] = {
                    count           = cnt,
                    latest_updated  = latest_updated,
                    latest_lastread = latest_lastread,
                    latest_created  = latest_created,
                }
            end
        end
    end
    stmt:close()

    local out = {}
    for segment, data in pairs(children) do
        out[#out + 1] = {
            _group              = true,
            name                = parent_path and (parent_path .. "/" .. segment) or segment,
            display_name        = segment,
            count               = data.count,
            latest_updated_at   = data.latest_updated,
            latest_last_read_at = data.latest_lastread,
            latest_created_at   = data.latest_created,
        }
    end
    table.sort(out, function(a, b) return a.display_name < b.display_name end)
    return out
end

-- ---------------------------------------------------------------------------
-- listBooksInGroup(group_by, group_value, limit, opts)
-- ---------------------------------------------------------------------------
-- Returns up to `limit` books in the group. opts.sort_by + opts.sort_asc
-- mirror M:listBooks, so the cover composer picks the same first-N
-- books the user would see when drilling in. Default sort:
-- COALESCE(updated_at, last_read_at) DESC.
--
-- For group_name, matches the path itself AND any descendant path
-- (so a top-level "Fantasy" preview pulls in books from Fantasy/Tolkien
-- /LOTR even when nothing lives at the root level).
function M:listBooksInGroup(group_by, group_value, limit, opts)
    if not GROUP_WHITELIST[group_by] then return {} end
    opts = opts or {}
    local where_extra, args
    if group_by == "group_name" then
        where_extra = "(group_name = ? OR group_name LIKE ?)"
        args = { self.user_id, group_value, group_value .. "/%", limit }
    else
        where_extra = group_by .. " = ?"
        args = { self.user_id, group_value, limit }
    end
    -- Honor the caller's current sort so the cover-preview composite
    -- picks the same first-N books the user would see when drilling in.
    -- Mirrors the sort_expr logic in M:listBooks above.
    local sort_by = SORT_WHITELIST[opts.sort_by] and opts.sort_by or "last_read_at"
    local sort_dir = opts.sort_asc and "ASC" or "DESC"
    local sort_expr = (sort_by == "last_read_at")
        and "COALESCE(updated_at, last_read_at)"
        or sort_by
    local sql = string.format([[
        SELECT %s FROM books
        WHERE user_id = ? AND deleted_at IS NULL
          AND (cloud_present = 1 OR local_present = 1)
          AND %s
        ORDER BY %s %s, hash ASC
        LIMIT ?
    ]], table.concat(BOOK_COLS, ", "), where_extra, sort_expr, sort_dir)
    local stmt = self.db:prepare(sql)
    stmt:reset()
    for i, v in ipairs(args) do stmt:bind1(i, v) end
    local rows = {}
    while true do
        local r = stmt:step()
        if not r then break end
        rows[#rows + 1] = row_to_table(r)
    end
    stmt:close()
    return rows
end

-- ---------------------------------------------------------------------------
-- listBookshelfBooks(filters, group_by, parent_path)
-- ---------------------------------------------------------------------------
-- Returns the book rows that appear directly at the current shelf level
-- (siblings of the listBookshelfGroups output, NOT recursively).
--   group_by=nil/"none"            — all books matching filters
--   group_by=author/series, root   — books whose author/series is null/empty
--   group_by=author/series, drill  — books with col = parent_path
--   group_by=group_name, root      — books with null/empty group_name
--   group_by=group_name, drill     — books with group_name = parent_path
function M:listBookshelfBooks(filters, group_by, parent_path)
    local sub = {}
    for k, v in pairs(filters or {}) do sub[k] = v end
    if not GROUP_WHITELIST[group_by] then
        sub.group_by = nil
        sub.group_filter = nil
        return self:listBooks(sub)
    end
    if parent_path then
        sub.group_by = group_by
        sub.group_filter = parent_path
        return self:listBooks(sub)
    end
    sub.group_by = nil
    sub.group_filter = nil
    sub.ungrouped_col = group_by
    return self:listBooks(sub)
end

-- ---------------------------------------------------------------------------
-- parseSyncRow (pure helper, no DB access)
-- ---------------------------------------------------------------------------
-- Maps a raw /sync DB row (snake_case, ISO timestamps, JSON-string metadata)
-- to our internal row shape (fields ready for upsertBook). Returns nil for
-- the dummy initial-sync hash.
local DUMMY_HASH = "00000000000000000000000000000000"

-- ISO-8601 → unix ms. Accepts:
--   2026-02-01T00:00:00Z
--   2026-02-01T00:00:00+00:00          (Supabase / Postgres native; the common case)
--   2026-02-01T00:00:00+0000
--   2026-02-01T00:00:00.123456+00:00   (with fractional seconds)
--   2026-02-01 00:00:00+00:00          (Postgres without the T separator)
local function iso_to_ms(s)
    if not s then return nil end
    if type(s) == "number" then return s end
    if type(s) ~= "string" then return nil end

    local y, mo, d, h, mi, sec, frac, tz = s:match(
        "^(%d%d%d%d)%-(%d%d)%-(%d%d)[T ](%d%d):(%d%d):(%d%d)([%.%d]*)(.*)$")
    if not y then return nil end

    local t = os.time({
        year = tonumber(y), month = tonumber(mo), day = tonumber(d),
        hour = tonumber(h), min  = tonumber(mi), sec  = tonumber(sec),
        isdst = false,
    })
    -- os.time interprets the struct as LOCAL time; convert to UTC by
    -- subtracting the local TZ offset.
    local utc_offset = os.difftime(t, os.time(os.date("!*t", t)))
    t = t + utc_offset

    -- Apply the input's own offset (Z = +00:00; "+05:30" subtracts 5.5h to
    -- get UTC). Default to UTC if no offset present (server contract).
    if tz and tz ~= "" and tz ~= "Z" then
        local sign, oh, om = tz:match("^([%+%-])(%d%d):?(%d%d)$")
        if sign then
            local off = (tonumber(oh) * 3600) + (tonumber(om or 0) * 60)
            if sign == "+" then t = t - off else t = t + off end
        end
    end

    local ms = t * 1000
    if frac and frac:sub(1, 1) == "." then
        -- Fractional seconds: take only the first 3 digits (ms precision)
        local f = frac:sub(2, 4)
        if #f > 0 then
            ms = ms + tonumber(f .. string.rep("0", 3 - #f))
        end
    end
    return ms
end

function M.parseSyncRow(dbRow)
    if not dbRow then return nil end
    local hash = dbRow.book_hash or dbRow.hash
    if not hash or hash == DUMMY_HASH then return nil end

    local out = {
        hash         = hash,
        meta_hash    = dbRow.meta_hash,
        title        = dbRow.title or "Untitled",
        source_title = dbRow.source_title,
        author       = dbRow.author,
        format       = dbRow.format,
        group_id     = dbRow.group_id,
        group_name   = dbRow.group_name,
        uploaded_at  = iso_to_ms(dbRow.uploaded_at),
        updated_at   = iso_to_ms(dbRow.updated_at),
        created_at   = iso_to_ms(dbRow.created_at),
        deleted_at   = iso_to_ms(dbRow.deleted_at),
    }

    -- Metadata: parse JSON string OR accept an already-parsed table; extract
    -- series/series_index into denormalized columns; round-trip the raw JSON
    -- so callers can read other fields lazily later.
    if dbRow.metadata ~= nil then
        local meta
        if type(dbRow.metadata) == "string" then
            local ok, parsed = pcall(json.decode, dbRow.metadata)
            if ok and type(parsed) == "table" then meta = parsed end
        elseif type(dbRow.metadata) == "table" then
            meta = dbRow.metadata
        end
        if meta then
            out.series = meta.series
            out.series_index = meta.seriesIndex
            local ok, encoded = pcall(json.encode, meta)
            if ok then out.metadata_json = encoded end
        end
    end

    -- Progress: snake-case web shape is `progress = [cur, total]`.
    if dbRow.progress and type(dbRow.progress) == "table" then
        local ok, encoded = pcall(json.encode, dbRow.progress)
        if ok then out.progress_lib = encoded end
    end

    -- Reading status passthrough (web side has 'unread'/'reading'/'finished')
    out.reading_status = dbRow.readingStatus or dbRow.reading_status

    -- Cloud-presence flag: tombstones from the cloud arrive with deleted_at
    -- set; the row is still useful for tracking that the cloud copy is gone,
    -- but it doesn't count as cloud-present anymore. Force the flag through
    -- upsertBook's OR-merge with the sentinel.
    if out.deleted_at then
        out.cloud_present = 0
        out._force_cloud_present = true
    else
        out.cloud_present = 1
    end

    return out
end

return M
