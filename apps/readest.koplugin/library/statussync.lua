-- statussync.lua — bridge LibraryStore.reading_status <-> KOReader's per-book
-- summary.status. The decision is delegated to the pure readingstatus.reconcile;
-- this module only walks local-present rows and performs the chosen IO. The IO
-- is injected via `deps` so it unit-tests without DocSettings; production wires
-- a DocSettings-backed deps in librarywidget.
local readingstatus = require("library.readingstatus")

local M = {}

-- deps: { now_ms(), open_summary(file_path) -> {status, modified}|nil,
--         write_status(file_path, ko_status_or_nil) }
function M.reconcileLocalStatuses(store, deps)
    if not store or not deps then return 0 end
    local changed = 0
    local rows = store:listBooks({})
    for _, row in ipairs(rows) do
        if row.local_present == 1 and row.file_path then
            local summary = deps.open_summary(row.file_path) or {}
            local ko_ts = readingstatus.parse_modified_ms(summary.modified) or deps.now_ms()
            local r = readingstatus.reconcile(
                { reading_status = row.reading_status,
                  reading_status_updated_at = row.reading_status_updated_at },
                { status = summary.status, ts = ko_ts })
            if r.action == "apply_to_ko" then
                deps.write_status(row.file_path, r.ko_status)  -- ko_status may be nil (clear)
                changed = changed + 1
            elseif r.action == "apply_to_store" then
                store:touchBook(row.hash, {
                    reading_status = r.readest_status,
                    reading_status_updated_at = r.ts,
                })
                changed = changed + 1
            end
        end
    end
    return changed
end

return M
