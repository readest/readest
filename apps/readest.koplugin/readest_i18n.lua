local logger = require("logger")
local koreader_gettext = require("gettext")

local GetText = {
    translation = {},
    loaded_lang = nil,
}

local function unescapePoString(s)
    s = s:gsub("\\n", "\n")
    s = s:gsub("\\t", "\t")
    s = s:gsub("\\r", "\r")
    s = s:gsub('\\"', '"')
    s = s:gsub("\\\\", "\\")
    return s
end

local function loadPoFile(path)
    local file = io.open(path, "r")
    if not file then
        logger.dbg("Readest i18n: cannot open translation file:", path)
        return false
    end

    local entry = {}
    local current

    local function flush()
        if entry.msgid and entry.msgid ~= "" and entry.msgstr and entry.msgstr ~= "" then
            GetText.translation[entry.msgid] = entry.msgstr
        end
        entry = {}
        current = nil
    end

    for line in file:lines() do
        if line == "" then
            flush()
        elseif not line:match("^#") then
            local key, value = line:match('^%s*(msgid)%s+"(.*)"%s*$')
            if not key then
                key, value = line:match('^%s*(msgstr)%s+"(.*)"%s*$')
            end
            if key then
                current = key
                entry[current] = unescapePoString(value)
            else
                value = line:match('^%s*"(.*)"%s*$')
                if current and value then
                    entry[current] = (entry[current] or "") .. unescapePoString(value)
                end
            end
        end
    end
    flush()
    file:close()

    logger.info("Readest i18n: loaded translation file:", path)
    return true
end

local function getPluginDir()
    local info = debug.getinfo(1, "S")
    local source = info and info.source
    if source and source:sub(1, 1) == "@" then
        source = source:sub(2)
    end
    return source and source:match("(.*/)") or "./"
end

local plugin_dir = getPluginDir()

-- KOReader stores locales with an underscore separator (e.g. zh_CN, pt_BR);
-- our catalog mirrors readest-app's i18next layout which uses hyphens (zh-CN).
local function getLanguage()
    local lang = G_reader_settings and G_reader_settings:readSetting("language")
    if type(lang) == "string" and lang ~= "" and lang ~= "C" then
        return (lang:gsub("%..*", ""):gsub("_", "-"))
    end
    return nil
end

local function initTranslation()
    GetText.translation = {}

    local lang = getLanguage()
    GetText.loaded_lang = lang
    if not lang then return end

    local candidates = { lang }
    local base_lang = lang:match("^(%a+)-")
    if base_lang then
        table.insert(candidates, base_lang)
    end
    if lang:match("^zh") and lang ~= "zh-CN" then
        table.insert(candidates, "zh-CN")
    end

    for _, candidate in ipairs(candidates) do
        local path = plugin_dir .. "locales/" .. candidate .. "/translation.po"
        if loadPoFile(path) then
            return
        end
    end
end

local function translate(msgid)
    local lang = getLanguage()
    if lang ~= GetText.loaded_lang then
        initTranslation()
    end
    return GetText.translation[msgid]
end

setmetatable(GetText, {
    __call = function(_, msgid)
        return translate(msgid) or koreader_gettext(msgid)
    end,
})

function GetText.ngettext(msgid, msgid_plural, n)
    local translated = translate(n == 1 and msgid or msgid_plural)
    if translated then return translated end
    if koreader_gettext.ngettext then
        return koreader_gettext.ngettext(msgid, msgid_plural, n)
    end
    return n == 1 and GetText(msgid) or GetText(msgid_plural)
end

function GetText.pgettext(msgctxt, msgid)
    local translated = translate(msgctxt .. "\004" .. msgid) or translate(msgid)
    if translated then return translated end
    if koreader_gettext.pgettext then
        return koreader_gettext.pgettext(msgctxt, msgid)
    end
    return GetText(msgid)
end

function GetText.npgettext(msgctxt, msgid, msgid_plural, n)
    local selected = n == 1 and msgid or msgid_plural
    local translated = translate(msgctxt .. "\004" .. selected) or translate(selected)
    if translated then return translated end
    if koreader_gettext.npgettext then
        return koreader_gettext.npgettext(msgctxt, msgid, msgid_plural, n)
    end
    return GetText.ngettext(msgid, msgid_plural, n)
end

return GetText
