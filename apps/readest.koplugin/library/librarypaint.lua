-- librarypaint.lua
-- Partial-page repaint shim for the Library Menu, adapted from
-- /Users/chrox/dev/koreader-plugins/zen_ui.koplugin/modules/filebrowser/patches/partial_page_repaint.lua
--
-- Problem on e-ink: when the visible page has fewer items than `perpage`
-- (typical on the last page of any list), KOReader's normal partial-refresh
-- leaves ghost pixels in the now-empty cells from the previously-shown
-- items. A `setDirty(nil, "full")` waveform refresh clears the entire
-- screen and removes the ghosts.
--
-- We hook our menu's updateItems to schedule a full refresh on the next
-- UI tick when items_on_page < perpage. A `pending` guard prevents a
-- double refresh if updateItems fires twice in the same tick (search
-- debounce + sort change can do this).
--
-- Live-KOReader-only; no unit tests.

local M = {}

function M.install(menu)
    if menu._readest_paint_installed then return end
    menu._readest_paint_installed = true

    local UIManager = require("ui/uimanager")
    local pending = false

    local orig_updateItems = menu.updateItems
    menu.updateItems = function(self, ...)
        local r = orig_updateItems(self, ...)
        local total = #(self.item_table or {})
        local perpage = self.perpage
        if not perpage or perpage <= 0 or total == 0 then return r end
        local page = self.page or 1
        local items_on_page = math.max(0, math.min(perpage, total - (page - 1) * perpage))
        if items_on_page > 0 and items_on_page < perpage and not pending then
            pending = true
            UIManager:nextTick(function()
                pending = false
                UIManager:setDirty(nil, "full")
                UIManager:forceRePaint()
            end)
        end
        return r
    end
end

return M
