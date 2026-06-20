-- readingstatus.lua — pure bidirectional mapping + reconcile between Readest's
-- reading_status and KOReader's summary.status. No KOReader globals, so it
-- unit-tests cleanly under busted.
--
-- ONLY DELIBERATE statuses sync. KOReader auto-sets summary.status = "reading"
-- the first time a book is opened, so "reading" (and "New"/absent) is treated as
-- NON-DECISIVE and never captured — otherwise opening a finished book on
-- KOReader would downgrade it. Reading *position* syncs via the progress
-- channel, not here.
--
--   Decisive: Readest  unread / finished / abandoned
--             KOReader complete / abandoned
--
-- On the unsynced baseline (a book whose Readest reading_status_updated_at is
-- 0/absent — status predates this feature or was pulled before it) timestamps
-- aren't trustworthy, so conflicts resolve "Readest authoritative". The first
-- reconcile of such a book stamps reading_status_updated_at = now_ms, which
-- exits bootstrap; every later change then resolves by ordinary recency LWW.
local M = {}

-- Readest reading_status -> KOReader summary.status push target.
-- finished->complete, abandoned->abandoned, unread->nil (clear / "New").
-- 'reading'/undefined are non-decisive and never pushed.
local READEST_TO_KO = { finished = "complete", abandoned = "abandoned" }
function M.readest_to_ko(status)
    if status == "unread" then return nil end
    return READEST_TO_KO[status]
end

-- KOReader summary.status -> Readest reading_status, ONLY for decisive KO
-- statuses. "reading" (auto-on-open), "New", nil, unknown -> nil (no opinion).
local KO_TO_READEST = { complete = "finished", abandoned = "abandoned" }
function M.ko_to_readest(status)
    return KO_TO_READEST[status]
end

-- Is a Readest status a deliberate signal worth syncing?
function M.readest_decisive(status)
    return status == "unread" or status == "finished" or status == "abandoned"
end

-- "YYYY-MM-DD" -> unix ms at local midnight; nil if unparseable.
function M.parse_modified_ms(s)
    if type(s) ~= "string" then return nil end
    local y, mo, d = s:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)")
    if not y then return nil end
    local t = os.time({ year = tonumber(y), month = tonumber(mo), day = tonumber(d),
                        hour = 0, min = 0, sec = 0 })
    if not t then return nil end
    return t * 1000
end

-- Decide what to write so both sides converge on the winning decisive status.
--   cloud  = { reading_status, reading_status_updated_at(ms) }  (LibraryStore row)
--   ko     = { status (KO summary.status), ts (ms, from summary.modified) }
--   now_ms = current time in ms (used for the bootstrap stamp)
-- Returns { write_ko, write_store, readest_status, ts, ko_status } where
--   write_ko    => set the sidecar to ko_status (may be nil = clear),
--   write_store => set the LibraryStore row to (readest_status, ts).
-- Both false means "nothing to do".
function M.reconcile(cloud, ko, now_ms)
    cloud = cloud or {}
    ko = ko or {}
    now_ms = now_ms or 0

    local cr = cloud.reading_status
    local cloud_ts = cloud.reading_status_updated_at or 0
    local cr_dec = M.readest_decisive(cr)

    local kr = M.ko_to_readest(ko.status) -- finished | abandoned | nil
    local ko_ts = ko.ts or 0
    local ko_dec = kr ~= nil

    -- Neither side has a decisive status: nothing to sync or baseline.
    if not cr_dec and not ko_dec then
        return { write_ko = false, write_store = false }
    end

    -- Winning Readest status W and its authoritative timestamp W_ts.
    local W, W_ts
    if cr_dec and not ko_dec then
        W, W_ts = cr, (cloud_ts > 0 and cloud_ts or now_ms)
    elseif ko_dec and not cr_dec then
        W, W_ts = kr, (ko_ts > 0 and ko_ts or now_ms)
    elseif cr == kr then -- both decisive, already agree
        W, W_ts = cr, (cloud_ts > 0 and cloud_ts or now_ms)
    elseif cloud_ts == 0 then -- bootstrap conflict: Readest authoritative
        W, W_ts = cr, now_ms
    elseif cloud_ts >= ko_ts then -- steady-state LWW (tie -> Readest)
        W, W_ts = cr, cloud_ts
    else
        W, W_ts = kr, ko_ts
    end

    -- Equalize both sides to W.
    local target_ko = M.readest_to_ko(W) -- complete | abandoned | nil (clear)
    local write_ko = ko.status ~= target_ko
    local write_store = (cr ~= W) or (cloud_ts ~= W_ts)
    return {
        write_ko = write_ko,
        write_store = write_store,
        readest_status = W,
        ts = W_ts,
        ko_status = target_ko,
    }
end

return M
