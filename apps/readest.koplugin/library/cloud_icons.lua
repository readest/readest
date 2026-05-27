-- cloud_icons.lua
-- Per-row cloud-up/cloud-down overlay icons painted on top of the
-- standard ListMenuItem widget tree. Loaded once from bundled SVGs
-- and cached as IconWidget instances for reuse across all rows.

local M = {}

-- Resolve apps/readest.koplugin root via debug.getinfo on this file's
-- own source path (same trick as zen_ui's plugin_root.lua). Needed
-- because our bundled icons aren't in any of KOReader's ICONS_DIRS,
-- so we load them by absolute path through ImageWidget instead of
-- IconWidget's name-based lookup.
local _plugin_root = (function()
    local src = debug.getinfo(1, "S").source or ""
    local path = (src:sub(1, 1) == "@")
        and src:sub(2):match("^(.*)/library/[^/]+$") or nil
    if path and path:sub(1, 1) ~= "/" then
        local ok, lfs = pcall(require, "libs/libkoreader-lfs")
        local cwd = ok and lfs and lfs.currentdir()
        if cwd then path = cwd .. "/" .. path end
    end
    return path
end)()

local ICON_FILES = {
    dl = _plugin_root and (_plugin_root .. "/icons/cloud_download.svg"),
    up = _plugin_root and (_plugin_root .. "/icons/cloud_upload.svg"),
}

-- Per-icon cache: {key → {widget, size_loaded}}. IconWidget loads +
-- caches its bb on first render so we only pay the SVG decode once
-- per icon size.
local _cache = {}

function M.has_icon(kind)
    return ICON_FILES[kind] ~= nil
end

local function get_widget(kind, target_size)
    local entry = _cache[kind]
    if entry and entry.size_loaded == target_size then
        return entry.widget
    end
    if entry and entry.widget then
        local prev = entry.widget
        entry.widget = nil
        pcall(function() prev:free() end)
    end
    local file = ICON_FILES[kind]
    if not file then return nil end
    local ok, ImageWidget = pcall(require, "ui/widget/imagewidget")
    if not ok then return nil end
    local widget = ImageWidget:new{
        file = file,
        width = target_size,
        height = target_size,
        scale_factor = 0,  -- aspect-preserving fit
        alpha = true,      -- preserve SVG transparency
        is_icon = true,
    }
    _cache[kind] = { widget = widget, size_loaded = target_size }
    return widget
end

-- Paint the cloud icon at the right edge of the row, in the slot
-- where ListMenuItem normally draws its second line of right-side
-- text (wpageinfo, e.g. "1% of 1424 pages"). For row height dimen.h,
-- the standard wright VerticalGroup is roughly:
--   VerticalSpan(2) + fileinfo(~h*0.28) + pageinfo(~h*0.28)
-- center-aligned, which lands pageinfo at ~y + 0.5*h. Mirroring that
-- keeps the format label and the cloud icon visually stacked at the
-- right edge with consistent padding.
function M.paint(item, bb, x, y, kind)
    local Screen = require("device").screen
    local icon_size = math.floor(item.height * 0.28)
    local icon = get_widget(kind, icon_size)
    if not icon then return end
    -- _render so getSize returns the actual scaled dims, not the
    -- requested width/height.
    icon:_render()
    local s = icon:getSize()
    local pad_right = Screen:scaleBySize(10)
    local icon_x = x + item.width - pad_right - s.w
    local icon_y = y + math.floor(item.height * 0.5)
    icon:paintTo(bb, icon_x, icon_y)
end

return M
