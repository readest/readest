-- Describe a failed sync request. `describe` is technical and meant for logs
-- (e.g. "token refresh: HTTP 500: Internal error"); `reason` is a short,
-- translated explanation for users. Both use only the response body and
-- status, never request data (which carries the access token).
local _ = require("readest_i18n")

local MAX_DETAIL = 200

local SyncError = {}

local function message(body, with_reason)
    local detail
    if type(body) == "table" then
        -- Readable messages before error codes (Supabase sends both).
        detail = body.message or body.msg or body.error_description or body.error
            or (with_reason and body.reason) or nil
        if type(detail) == "table" then detail = detail.message or detail.msg end
    elseif type(body) == "string" then
        detail = body
    end
    if detail == nil then return nil end
    detail = tostring(detail)
    -- Skip HTML error pages; the status says more than their markup.
    if detail:match("^%s*<") then return nil end
    detail = detail:gsub("%s+", " "):match("^%s*(.-)%s*$")
    if #detail > MAX_DETAIL then detail = detail:sub(1, MAX_DETAIL) .. "…" end
    return detail ~= "" and detail or nil
end

function SyncError.describe(body, status)
    local detail = message(body, true)
    local code = type(status) == "number" and status > 0 and ("HTTP " .. status) or nil
    local text = code and detail and (code .. ": " .. detail) or code or detail or "no error details"
    local stage = type(body) == "table" and body.stage
    return stage and (stage .. ": " .. text) or text
end

-- Ordered: the first pattern found in the lowercased message wins.
local KNOWN = {
    { "cancelled", function() return _("Sync was cancelled.") end },
    { "timeout", "timed out", "wantread", "wantwrite",
        function() return _("The connection timed out. Please try again.") end },
    { "unreachable", "no route to host",
        function() return _("The network is unreachable. Please check the internet connection.") end },
    { "host not found", "name or service not known", "name resolution", "nodename nor servname",
        "does not resolve", "no address associated", "service not provided", function() return _("The server could not be found. Please check the internet connection.") end },
    { "connection refused", function() return _("The server refused the connection. Please try again later.") end },
    { "connection reset", "broken pipe",
        function() return _("The connection was interrupted. Please try again.") end },
    { "certificate", "ssl", "tls", "handshake",
        function() return _("A secure connection to the server could not be established.") end },
    { "not authenticated", "authentication required", "session expired", "no valid access token",
        "auth refresh failed", "invalid refresh token", "invalid jwt",
        function() return _("Authentication failed. Please log in again.") end },
    { "session changed", function() return _("The account changed during sync.") end },
    { "quota", function() return _("Storage quota exceeded.") end },
    { "cloud-not-found", "no-cover", function() return _("The file was not found in the cloud.") end },
    { "local file missing", function() return _("The local file is missing.") end },
    { "unsupported format", "unknown book format", function() return _("Unsupported book format.") end },
    { "sync worker", "sync response file", "fork failed", "no auth client", "no store",
        "error:unknown", "missing ", "could not build",
        function() return _("An internal error occurred. Please try again.") end },
}

local function known(detail)
    local lower = detail:lower()
    if lower == "auth" then return _("Authentication failed. Please log in again.") end
    -- LuaSocket's whole message for a reset or dropped connection.
    if lower == "closed" then return _("The connection was interrupted. Please try again.") end
    for _, entry in ipairs(KNOWN) do
        for i = 1, #entry - 1 do
            if lower:find(entry[i], 1, true) then return entry[#entry]() end
        end
    end
end

local function fromStatus(status)
    if status == 401 then return _("Authentication failed. Please log in again.") end
    if status == 403 then return _("Access denied.") end
    if status == 404 then return _("Not found on the server.") end
    if status == 408 then return _("The connection timed out. Please try again.") end
    if status == 413 then return _("The file is too large.") end
    if status == 429 then return _("Too many requests. Please try again later.") end
    if type(status) == "number" and status >= 500 then
        return _("The server is temporarily unavailable. Please try again later.")
    end
end

function SyncError.reason(body, status)
    local detail = message(body)
    if detail then
        -- Drop code locations ("Protocols.lua:85: ") that wrap transport errors.
        local stripped
        repeat
            detail, stripped = detail:gsub("^[^%s:]+%.lua:%d+:%s*", "", 1)
        until stripped == 0
        -- Spore and auth fallbacks that carry only a status.
        local code = detail:match("^HTTP (%d+)$") or detail:match("^(%d+) not expected$")
        if code then
            status = status or tonumber(code)
            detail = nil
        elseif detail == "" then
            detail = nil
        end
    end
    local text = detail and known(detail)
    if text then return text end
    -- 5xx bodies can hold internal server errors; keep them in the log only.
    local server_error = type(status) == "number" and status >= 500
    -- Internal codes ("url-fetch-failed", "push failed") explain nothing.
    if detail and not server_error and not detail:match("^[%l_%-:]+$") and not detail:match("^%l[%l ]* failed$") then
        return detail
    end
    return fromStatus(status) or _("The request failed. Please try again.")
end

-- Append the user-facing reason to a message on its own line.
function SyncError.withDetail(text, body, status)
    return text .. "\n" .. SyncError.reason(body, status)
end

return SyncError
