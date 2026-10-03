-- One sequential queue shared by Library views, including while reading.
local UIManager = require("ui/uimanager")
local InfoMessage = require("ui/widget/infomessage")
local ButtonDialog = require("ui/widget/buttondialog")
local syncbooks = require("library.syncbooks")
local _ = require("readest_i18n")
local T = require("ffi/util").template

local M = {}
local active, dialog

local function hide()
    if dialog then
        local old = dialog
        dialog = nil
        UIManager:close(old)
    end
end

local function title()
    local job = active
    local book = job.books[job.index]
    return T(_("Downloading %1 of %2…"), job.index, #job.books)
        .. "\n" .. (book and book.title or "")
        .. "\n" .. T(_("%1 MB downloaded"), string.format("%.1f", job.bytes / 1048576))
end

local function update()
    if dialog then
        local text = title()
        if dialog.title ~= text then dialog:setTitle(text) end
    end
end

function M.isRunning() return active ~= nil end

function M.show()
    if not active then
        UIManager:show(InfoMessage:new{ text = _("No downloads in progress."), timeout = 3 })
        return
    end
    if dialog then update(); return end
    dialog = ButtonDialog:new{
        title = title(),
        tap_close_callback = function() active.on_open = nil; dialog = nil end,
        buttons = {{
            { text = _("Run in background"), callback = function()
                active.on_open = nil
                hide()
            end },
            { text = _("Cancel download"), callback = M.cancel },
        }},
    }
    UIManager:show(dialog)
end

local function finish(job)
    local on_open = job.on_open
    hide()
    active = nil
    local text
    if job.cancelled then
        text = T(_("Download cancelled. %1 of %2 downloaded."), job.done, #job.books)
    elseif job.failed > 0 then
        text = T(_("Downloaded %1 of %2 (skipped %3)."), job.done, #job.books, job.failed)
    else
        text = T(_("Downloaded %1 of %2."), job.done, #job.books)
    end
    if on_open and #job.books == 1 and job.done == 1 and not job.cancelled then
        on_open(job.last_path)
    else
        UIManager:show(InfoMessage:new{ text = text, timeout = 3 })
    end
end

function M.cancel()
    if not active then return end
    active.cancelled = true
    active.on_open = nil
    if active.cancel_transfer then active.cancel_transfer() end
end

local function next_book(job)
    if active ~= job then return end
    -- Authentication belongs to the account that queued these books.
    if job.opts.settings.user_id ~= job.user_id then job.cancelled = true end
    if job.cancelled or job.index > #job.books then finish(job); return end
    local book = job.books[job.index]
    job.bytes = 0
    update()
    job.cancel_transfer = syncbooks.downloadBook(book, {
        sync_auth = job.opts.sync_auth,
        sync_path = job.opts.sync_path,
        settings = job.opts.settings,
        download_dir = job.download_dir,
        on_progress = function(bytes)
            job.bytes = bytes
            update()
        end,
    }, function(success, path)
        job.cancel_transfer = nil
        if success then
            -- Account switching can close the Library's original connection.
            local store = job.opts.store
            local reopened = not store.db
            if reopened then
                store = require("library.librarystore").new{
                    user_id = job.user_id, db_path = store.db_path,
                }
            end
            store:upsertBook{
                hash = book.hash, title = book.title,
                local_present = 1, file_path = path,
            }
            if reopened then store:close() end
            job.done = job.done + 1
            job.last_path = path
            if job.opts.on_book then job.opts.on_book() end
        elseif not job.cancelled then
            job.failed = job.failed + 1
        end
        job.index = job.index + 1
        -- Even immediate authentication failures yield between queued books.
        UIManager:nextTick(function() next_book(job) end)
    end)
end

function M.start(books, opts)
    local download_dir = opts.settings.library_download_dir
        or G_reader_settings:readSetting("home_dir")
    if not download_dir or download_dir == "" then
        UIManager:show(InfoMessage:new{
            text = _("Set Home folder in File Manager first to enable downloads."), timeout = 3,
        })
        return
    end
    if #books == 0 then
        UIManager:show(InfoMessage:new{ text = _("No books to download."), timeout = 3 })
        return
    end
    if active and (active.user_id ~= opts.settings.user_id or active.cancelled) then
        M.cancel()
        return
    end
    local is_new = not active
    if is_new then
        active = {
            opts = opts, user_id = opts.settings.user_id, download_dir = download_dir,
            books = {}, seen = {}, index = 1, done = 0, failed = 0, bytes = 0,
            on_open = opts.on_open,
        }
    else
        active.on_open = nil
    end
    for _, book in ipairs(books) do
        if book.local_present ~= 1 and not active.seen[book.hash] then
            active.seen[book.hash] = true
            active.books[#active.books + 1] = book
        end
    end
    M.show()
    if is_new then
        local job = active
        UIManager:nextTick(function() next_book(job) end)
    end
end

return M
