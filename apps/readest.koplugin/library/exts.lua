-- exts.lua
-- Book format → file extension mapping.
--
-- Verbatim port of `apps/readest-app/src/libs/document.ts` `EXTS`. The cloud
-- `fileKey` builder in syncbooks.lua uses this to derive the `.{ext}` suffix
-- from a `/sync` row's `format` column. Keep in sync with the web side.

local EXTS = {
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
}

return EXTS
