-- exts_spec.lua
-- The EXTS table is small enough that a direct equality assertion is the
-- right test: it doubles as a regression guard against accidental drift
-- from `apps/readest-app/src/libs/document.ts`.

local EXTS = require("library.exts")

describe("library.exts", function()
    it("matches the web-side EXTS mapping verbatim", function()
        assert.are.same({
            EPUB = "epub",
            PDF  = "pdf",
            MOBI = "mobi",
            AZW  = "azw",
            AZW3 = "azw3",
            CBZ  = "cbz",
            FB2  = "fb2",
            FBZ  = "fbz",
            TXT  = "txt",
            MD   = "md",
        }, EXTS)
    end)

    it("covers every format the cloud `book.format` field can hold", function()
        -- If the web side adds a new format, the syncbooks.lua fileKey builder
        -- will silently produce nil for the extension. This assertion catches
        -- the omission early.
        local required = {
            "EPUB", "PDF", "MOBI", "AZW", "AZW3", "CBZ", "FB2", "FBZ", "TXT", "MD",
        }
        for _, fmt in ipairs(required) do
            assert.is_string(EXTS[fmt], "missing extension for " .. fmt)
        end
    end)
end)
