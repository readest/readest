-- Parse the server clock without interpreting UTC as device-local time.
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

return iso_to_ms
