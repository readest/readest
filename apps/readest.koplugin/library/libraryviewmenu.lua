-- libraryviewmenu.lua
-- The Library view-menu — a ButtonDialog with sections for View Mode,
-- Columns, Cover fit, Group by, Sort by, Rescan library, and Download
-- folder. Persists every choice to G_reader_settings.readest_sync.library_*
-- and notifies the caller (LibraryWidget) so it can re-query and re-render.
--
-- Live-KOReader-only; smoke-tested via the manual matrix.

local ButtonDialog = require("ui/widget/buttondialog")
local PathChooser  = require("ui/widget/pathchooser")
local UIManager    = require("ui/uimanager")
local _            = require("i18n")

local M = {}

-- Settings that affect the Menu's dimensions / mixin selection. Changing
-- one requires a full Menu rebuild; M.refresh() (which only re-queries
-- listBooks) wouldn't pick them up because nb_cols_portrait and the
-- _recalculateDimen / _updateItemsBuildUI pointers are baked in at
-- Menu construction time.
local LAYOUT_KEYS = {
    library_view_mode = true,
    library_columns   = true,
    library_rows      = true,
}

-- ---------------------------------------------------------------------------
-- Helper: persist + invoke the right kind of refresh
-- ---------------------------------------------------------------------------
local function set(opts, key, value)
    opts.settings[key] = value
    G_reader_settings:saveSetting("readest_sync", opts.settings)
    if LAYOUT_KEYS[key] and opts.on_layout_change then
        opts.on_layout_change()
    elseif opts.on_change then
        opts.on_change()
    end
end

-- Per-key default values that match what librarywidget assumes when the
-- user hasn't explicitly chosen anything. The view menu's ✓ marker needs
-- to know these so the implicit default still shows as selected.
local DEFAULTS = {
    library_view_mode      = "mosaic",
    library_group_by       = "groups",
    library_sort_by        = "last_read_at",
    library_sort_ascending = false,
}

-- ---------------------------------------------------------------------------
-- Helper: render a single row of mutually-exclusive options. Each option's
-- label gets a "✓ " prefix when its value matches the current setting (or
-- the default, if the setting hasn't been explicitly set).
-- The dialog-close call is added by the back-fill loop in show() so this
-- helper doesn't need to capture the dialog ref.
-- ---------------------------------------------------------------------------
local function row(opts, key, choices)
    local current = opts.settings[key]
    if current == nil then current = DEFAULTS[key] end
    local buttons = {}
    for _i, choice in ipairs(choices) do
        local label = choice.label
        if choice.value == current then label = "✓ " .. label end
        buttons[#buttons + 1] = {
            text = label,
            callback = function() set(opts, key, choice.value) end,
        }
    end
    return buttons
end

-- ---------------------------------------------------------------------------
-- show(opts) — opts: { settings, on_change }
-- ---------------------------------------------------------------------------
function M.show(opts)
    local dialog
    dialog = ButtonDialog:new{
        title = _("Library view"),
        title_align = "center",
        buttons = {
            -- View Mode
            { { text = _("View"), enabled = false } },
            row(opts, "library_view_mode", {
                { label = _("Grid"), value = "mosaic" },
                { label = _("List"), value = "list" },
            }),

            -- Group by — alphabetical order matching Readest's web UI.
            -- Values mirror Readest's LibraryGroupByType ("authors",
            -- "groups", "series"); active_group_by() in librarywidget
            -- maps these to the SQL column names ("author",
            -- "group_name", "series") at the store boundary.
            -- "Books" is the no-grouping mode (flat list).
            { { text = _("Group by"), enabled = false } },
            row(opts, "library_group_by", {
                { label = _("Authors"), value = "authors" },
                { label = _("Books"),   value = "none" },
                { label = _("Groups"),  value = "groups" },
                { label = _("Series"),  value = "series" },
            }),

            -- Sort by
            { { text = _("Sort by"), enabled = false } },
            row(opts, "library_sort_by", {
                { label = _("Date Read"),    value = "last_read_at" },
                { label = _("Date Added"),   value = "created_at" },
                { label = _("Title"),        value = "title" },
                { label = _("Author"),       value = "author" },
            }),
            row(opts, "library_sort_ascending", {
                { label = _("Descending"), value = false },
                { label = _("Ascending"),  value = true },
            }),

            -- Actions
            { { text = _("Actions"), enabled = false } },
            {
                {
                    text = _("Rescan library"),
                    callback = function()
                        local Trapper = require("ui/trapper")
                        local LibraryWidget = require("library.librarywidget")
                        local localscanner = require("library.localscanner")
                        Trapper:wrap(function()
                            localscanner.fullSidecarWalk({
                                store    = LibraryWidget._store,
                                home_dir = G_reader_settings:readSetting("home_dir"),
                            })
                            LibraryWidget.refresh()
                        end)
                    end,
                },
                {
                    text = _("Download folder…"),
                    callback = function()
                        local picker
                        picker = PathChooser:new{
                            title = _("Pick a folder for downloaded books"),
                            path  = opts.settings.library_download_dir
                                    or G_reader_settings:readSetting("home_dir")
                                    or require("datastorage"):getDataDir(),
                            select_directory = true,
                            select_file      = false,
                            onConfirm = function(path)
                                set(opts, "library_download_dir", path)
                            end,
                        }
                        UIManager:show(picker)
                    end,
                },
            },
        },
    }
    -- Wrap every actionable callback with `UIManager:close(dialog)` so each
    -- selection dismisses the dialog before applying its effect. Disabled
    -- header rows have no callback and are skipped.
    for _i, line in ipairs(dialog.buttons) do
        for _j, btn in ipairs(line) do
            if btn.callback then
                local orig = btn.callback
                btn.callback = function()
                    UIManager:close(dialog)
                    return orig()
                end
            end
        end
    end
    UIManager:show(dialog)
end

return M
