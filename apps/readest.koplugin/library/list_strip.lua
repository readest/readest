-- list_strip.lua
-- List-mode group row builder. ListMenu's cover slot is hard-coded to
-- a square dimen.h × dimen.h. To show 4 mini-covers each at that same
-- square size (so each cell matches a single book row's cover slot)
-- we replace the row's widget tree wholesale.
--
-- Mirrors the standard ListMenuItem.update widget shape:
--   UnderlineContainer → VerticalGroup{
--     VerticalSpan,
--     HorizontalGroup{ cover-area, title, count },
--   }
-- but with the cover-area widened from 1× row-height to 4× row-height.

local group_covers = require("library.group_covers")

local M = {}

-- Mutates self._underline_container[1] in place. Called from the
-- patched ListMenuItem:update for entries with _readest_group set.
-- opts: { store, settings, orig_getBookInfo }
function M.build(self, opts)
    local Geom            = require("ui/geometry")
    local Size            = require("ui/size")
    local Font            = require("ui/font")
    local HorizontalGroup = require("ui/widget/horizontalgroup")
    local HorizontalSpan  = require("ui/widget/horizontalspan")
    local VerticalGroup   = require("ui/widget/verticalgroup")
    local VerticalSpan    = require("ui/widget/verticalspan")
    local CenterContainer = require("ui/widget/container/centercontainer")
    local LeftContainer   = require("ui/widget/container/leftcontainer")
    local FrameContainer  = require("ui/widget/container/framecontainer")
    local TextWidget      = require("ui/widget/textwidget")
    local TextBoxWidget   = require("ui/widget/textboxwidget")
    local ImageWidget     = require("ui/widget/imagewidget")
    local BookInfoManager = require("bookinfomanager")

    local entry = self.entry
    local underline_h = self.underline_h or 1
    local dimen_h = self.height - 2 * underline_h
    local dimen_w = self.width

    -- Each mini-cover gets a thin border (no padding) matching the
    -- single-book treatment in ListMenuItem.update (coverbrowser/
    -- listmenu.lua:258-269). cell_h subtracts the border on both sides
    -- so the framed cell fits within the row height.
    local border_size = Size.border.thin
    local cell_h = dimen_h - 2 * border_size
    local cell_w = cell_h
    local n_cells = 4
    local gap = math.floor(Size.padding.small / 2)

    -- Resolve children with the current sort so the strip matches
    -- what the user would see when drilling in.
    local store = opts.store
    local group = entry._readest_group
    local settings = opts.settings or {}
    local books  = (store and group)
        and store:listBooksInGroup(group._group_by, group.name, n_cells, {
            sort_by  = settings.library_sort_by,
            sort_asc = settings.library_sort_ascending == true,
        }) or {}

    -- Slot width fixed per cell so all rows align horizontally; the
    -- framed cover inside is sized to its rendered dimensions
    -- (image_size + border) so the border hugs the cover with no
    -- internal padding.
    local slot_w = cell_w + 2 * border_size
    local slot_h = cell_h + 2 * border_size
    local strip_children = {}
    for i = 1, n_cells do
        if i > 1 then
            strip_children[#strip_children + 1] = HorizontalSpan:new{ width = gap }
        end
        local book = books[i]
        local cell_widget
        if book then
            local cover = group_covers.child_cover_bb(book, opts.orig_getBookInfo, BookInfoManager)
            if cover then
                -- Precompute scale_factor and pass it WITHOUT
                -- width/height so ImageWidget:getSize returns the
                -- actual scaled bb dims. With explicit width+height
                -- it returns those exact dims, which would
                -- re-introduce padding inside the frame.
                local cw, ch = cover:getWidth(), cover:getHeight()
                local _, _, scale_factor = BookInfoManager.getCachedCoverSize(
                    cw, ch, cell_w, cell_h)
                local wimage = ImageWidget:new{
                    image = cover,
                    scale_factor = scale_factor,
                }
                wimage:_render()
                local image_size = wimage:getSize()
                cell_widget = CenterContainer:new{
                    dimen = Geom:new{ w = slot_w, h = slot_h },
                    FrameContainer:new{
                        width  = image_size.w + 2 * border_size,
                        height = image_size.h + 2 * border_size,
                        margin = 0, padding = 0,
                        bordersize = border_size,
                        wimage,
                    },
                }
            end
        end
        if not cell_widget then
            -- Empty slot keeps strip width consistent; no border so
            -- it visually disappears (like a missing book).
            cell_widget = HorizontalSpan:new{ width = slot_w }
        end
        strip_children[#strip_children + 1] = cell_widget
    end

    local strip_widget = HorizontalGroup:new(strip_children)
    local strip_w = slot_w * n_cells + gap * (n_cells - 1)

    local count_widget = TextWidget:new{
        text = entry.mandatory or "",
        face = Font:getFace("infont", 16),
    }
    local count_w = count_widget:getSize().w
    local pad_after_strip = Size.padding.large
    local pad_right = Size.padding.large

    local title_w = math.max(0, dimen_w - strip_w - pad_after_strip - count_w - pad_right)
    local title_widget = TextBoxWidget:new{
        text = entry.text or "",
        face = Font:getFace("smalltfont", 18),
        width = title_w,
        bold = true,
    }

    -- Wrap in LeftContainer with explicit dimen — ListMenuItem:paintTo
    -- reads self[1][1][2].dimen for shortcut/dogear overlay positioning.
    -- A bare HorizontalGroup never sets `dimen` so the access crashes.
    local widget = LeftContainer:new{
        dimen = Geom:new{ w = dimen_w, h = dimen_h },
        HorizontalGroup:new{
            align = "center",
            strip_widget,
            HorizontalSpan:new{ width = pad_after_strip },
            CenterContainer:new{
                dimen = Geom:new{ w = title_w, h = dimen_h },
                title_widget,
            },
            CenterContainer:new{
                dimen = Geom:new{ w = count_w, h = dimen_h },
                count_widget,
            },
            HorizontalSpan:new{ width = pad_right },
        },
    }

    if self._underline_container[1] then
        self._underline_container[1]:free()
    end
    self._underline_container[1] = VerticalGroup:new{
        VerticalSpan:new{ width = underline_h },
        widget,
    }
    -- Tell ListMenu's _updateItemsBuildUI not to queue this item for
    -- BIM background extraction (which would fork a subprocess to
    -- scrape metadata from a file that doesn't actually exist).
    self.bookinfo_found = true
end

return M
