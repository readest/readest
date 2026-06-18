-- readingstatus.lua — pure bidirectional mapping + reconcile between
-- Readest's reading_status and KOReader's summary.status. No KOReader globals
-- so it unit-tests cleanly under busted.
local M = {}

local READEST_TO_KO = { finished = "complete", reading = "reading", abandoned = "abandoned" }
local KO_TO_READEST = { complete = "finished", reading = "reading", abandoned = "abandoned" }

-- Readest reading_status -> KOReader summary.status (nil = clear / "New").
function M.readest_to_ko(status)
    if status == nil then return nil end
    return READEST_TO_KO[status]  -- 'unread' -> nil (not in the table)
end

-- KOReader summary.status -> Readest reading_status (nil = KO has no opinion).
function M.ko_to_readest(status)
    if status == nil then return nil end
    return KO_TO_READEST[status]
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

-- Decide what (if anything) to write. cloud = { reading_status,
-- reading_status_updated_at(ms) }; ko = { status(ko summary.status), ts(ms) }.
-- Returns { action, readest_status, ko_status, ts }. The caller equalizes both
-- sides to (readest_status, ts) so the next reconcile is a no-op (convergence).
function M.reconcile(cloud, ko)
    cloud = cloud or {}
    ko = ko or {}
    local cloud_status = cloud.reading_status
    local ko_readest = M.ko_to_readest(ko.status)  -- nil if KO has no explicit status

    if cloud_status == ko_readest then
        return { action = "none" }
    end

    -- KO has no opinion (new/nil): push the cloud status down if one exists.
    if ko_readest == nil then
        if cloud_status == nil then return { action = "none" } end
        return {
            action = "apply_to_ko",
            readest_status = cloud_status,
            ko_status = M.readest_to_ko(cloud_status),
            ts = cloud.reading_status_updated_at or 0,
        }
    end

    -- Readest has no status but KO does: capture it.
    if cloud_status == nil then
        return { action = "apply_to_store", readest_status = ko_readest, ts = ko.ts or 0 }
    end

    -- Both have differing explicit statuses: newer timestamp wins (tie -> cloud).
    local cloud_ts = cloud.reading_status_updated_at or 0
    local ko_ts = ko.ts or 0
    if cloud_ts >= ko_ts then
        return {
            action = "apply_to_ko",
            readest_status = cloud_status,
            ko_status = M.readest_to_ko(cloud_status),
            ts = cloud_ts,
        }
    end
    return { action = "apply_to_store", readest_status = ko_readest, ts = ko_ts }
end

return M
