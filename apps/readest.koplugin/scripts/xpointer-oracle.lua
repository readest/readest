-- XPointer oracle: dump crengine's own XPointer for every visible word of an
-- EPUB, FB2 or MOBI, so Readest's CFI <-> XPointer conversion (src/utils/xcfi.ts) can be
-- validated against the real KOReader engine instead of assumptions about it.
--
-- Runs headlessly inside a KOReader emulator build (no window, no sync server):
--
--   cd <koreader-emulator>/koreader
--   KO_HOME=/tmp/ko-oracle ./luajit \
--     /path/to/readest/apps/readest.koplugin/scripts/xpointer-oracle.lua \
--     /path/to/book.epub /path/to/book.crengine.json [every]
--
-- `every` keeps one word in N (default 1) to keep committed fixtures small.
-- KO_HOME keeps the harness settings and cache out of the emulator directory.
--
-- Consume the JSON with apps/readest-app/src/__tests__/utils/xcfi.crengine-oracle.test.ts,
-- either as a committed fixture under src/__tests__/fixtures/crengine/ or ad hoc:
--   XPOINTER_ORACLE=/path/to/book.crengine.json pnpm test src/__tests__/utils/xcfi.crengine-oracle.test.ts
require("setupkoenv")
package.path = "spec/front/unit/?.lua;" .. package.path
require("commonrequire") -- the spec harness: dummy framebuffer, no SDL window
local JSON = require("json")
local InitArray = require("json.util").InitArray -- keep empty lists as [] not {}
local DocumentRegistry = require("document/documentregistry")

local epub, outpath, every = arg[1], arg[2], tonumber(arg[3] or "1")
assert(epub and outpath, "usage: xpointer-oracle.lua <book.epub> <out.json> [every]")

local doc = assert(DocumentRegistry:openDocument(epub), "cannot open " .. epub)
-- A book KOReader has never seen before gets the latest DOM version
-- (ReaderRolling:onReadSettings); match that so XPointers are normalized.
doc:requestDomVersion(doc:getLatestDomVersion())
doc:render()

local result = {
    epub = epub:match("([^/]+)$"),
    dom_version = doc:getLatestDomVersion(),
    every = every,
    fragments = InitArray({}),
}

-- Visible words from `start` while their XPointers keep `prefix`.
local function collect(prefix, start)
    local words, seen = InitArray({}), 0
    local xp = doc:getNextVisibleWordStart(start)
    while xp and xp:sub(1, #prefix) == prefix do
        local xp_end = doc:getNextVisibleWordEnd(xp)
        if xp_end and xp_end:sub(1, #prefix) == prefix then
            if seen % every == 0 then
                table.insert(words, {
                    xp = xp,
                    xp_end = xp_end,
                    text = doc:getTextFromXPointers(xp, xp_end),
                })
            end
            seen = seen + 1
        end
        xp = doc:getNextVisibleWordStart(xp)
    end
    return words, seen
end

if epub:lower():match("%.mobi$") or epub:lower():match("%.prc$") or epub:lower():match("%.azw$") then
    -- crengine reads a MOBI (the old Mobipocket format, not KF8) as one HTML
    -- document: no DocFragments, its XPointers start at /html/body.
    result.mobi = true
    result.words, result.word_count = collect("/html/body", "/html/body")
elseif epub:lower():match("%.fb2$") then
    -- crengine reads FB2 natively: no DocFragments, its XPointers start at
    -- the FictionBook root and keep the FB2 tag names.
    result.fb2 = true
    result.words, result.word_count = collect("/FictionBook/body", "/FictionBook/body")
else
    -- DocFragment[N] is spine item N-1; crengine creates one per <itemref>. With a
    -- single spine item crengine omits the index and writes /body/DocFragment/...
    local single = not doc:isXPointerInDocument("/body/DocFragment[2]")
    local n = 1
    while doc:isXPointerInDocument("/body/DocFragment[" .. n .. "]") do
        local prefix = single and "/body/DocFragment/" or ("/body/DocFragment[" .. n .. "]/")
        local fragment = { index = n - 1, docfragment = n }
        fragment.words, fragment.word_count = collect(prefix, prefix .. "body")
        table.insert(result.fragments, fragment)
        n = n + 1
    end
end
doc:close()

local out = assert(io.open(outpath, "w"))
-- luajson escapes "/" as "\/", which is valid JSON but hard to read in fixtures
out:write((JSON.encode(result):gsub("\\/", "/")))
out:close()
print(string.format("wrote %s: %d fragments, %d words", outpath, #result.fragments,
    result.word_count or 0))
