-- Spawns the bundled localsend-helper static binary and talks to it over a
-- local TCP control socket (newline-delimited JSON, one line per command or
-- event). Replaces the old FFI cdylib transport (formerly this file, then
-- library/localsend_ffi.lua): ffi.load() dynamically links a .so/.dylib
-- into KOReader's own process and crashed on old-glibc Kindles. A static-
-- musl binary has no such dependency — it's a standalone process reached
-- over a socket, not code sharing KOReader's address space.
--
-- M.binaryNameFor and M.parseLines are pure (no socket/os dependency) so
-- they're unit-testable without stubbing KOReader's runtime. Everything
-- that touches the network or spawns a process requires "socket" lazily,
-- inside the function body, so loading this module never requires
-- luasocket to be present.

local logger = require("logger")

local M = {}

-- Pure mapping so specs can exercise it. Unlike the old FFI's per-device-
-- class matrix (Kindle soft-float armv7 vs. Kobo/reMarkable hard-float
-- armv7, kept as separate libs because a softfp .so will not dlopen into a
-- hardfloat process and vice versa), the static-musl binary is float-ABI-
-- agnostic: it's a separate process invoked via os.execute, not code
-- dlopen'd into KOReader, so one armv7 binary execs on any 32-bit ARM
-- Linux e-reader (Kindle, Kobo, reMarkable, PocketBook, ...). That
-- collapses the old device-class matrix down to arch/os alone.
--
-- Android is excluded outright regardless of arch: SELinux/noexec on
-- app/external storage blocks executing a plugin-bundled binary there, so
-- it always degrades to "not available" rather than attempting a doomed
-- spawn. (The native Readest Android app is the Android path for
-- LocalSend, not this koplugin transport.)
--
-- dev = { is_android = bool, is_emulator = bool, os = jit.os, arch = jit.arch }
function M.binaryNameFor(dev)
    if dev.is_android then
        return nil
    end
    -- Any 32-bit ARM Linux e-reader.
    if dev.arch == "arm" then
        return "localsend-helper-armv7"
    end
    -- reMarkable Paper Pro and other arm64 Linux e-readers.
    if dev.os == "Linux" and dev.arch == "arm64" then
        return "localsend-helper-arm64"
    end
    -- macOS emulator (developer only).
    if dev.is_emulator and dev.os == "OSX" and dev.arch == "arm64" then
        return "localsend-helper-macos"
    end
    return nil
end

-- Pure line framing for the non-blocking socket reader. `buffer` is
-- previously-buffered partial input (from the last call); `chunk` is
-- newly-read bytes, possibly nil or empty. Splits on "\n" and JSON-decodes
-- each complete line. Returns (events, remaining): `events` is an array of
-- decoded tables, one per complete well-formed line (in order); `remaining`
-- is the trailing partial line, to be passed back in as `buffer` on the
-- next call. A complete line that fails to JSON-decode is logged and
-- skipped rather than treated as fatal.
function M.parseLines(buffer, chunk)
    local data = (buffer or "") .. (chunk or "")
    local events = {}
    local from = 1
    while true do
        local nl = data:find("\n", from, true)
        if not nl then break end
        local line = data:sub(from, nl - 1)
        from = nl + 1
        if line ~= "" then
            local ok, ev = pcall(function() return require("json").decode(line) end)
            if ok and type(ev) == "table" then
                table.insert(events, ev)
            else
                logger.warn("ReadestLocalSend: undecodable event line: " .. line)
            end
        end
    end
    return events, data:sub(from)
end

-- Pure display-label formatter for a device entry from the "devices" event
-- (list_devices reply): { alias, deviceModel, deviceType, fingerprint, host,
-- port, protocol, ipv4Host }. Mirrors the "<name> · #<last octet>" style
-- readest_localsend.lua's statusText() uses for this device's own status, so
-- "which device is this" reads the same on both sides of a transfer. Falls
-- back to deviceModel when alias is empty/nil, and drops the octet tag
-- entirely when there's no ipv4Host to parse one from.
function M.deviceLabel(dev)
    local name = dev.alias
    if not name or name == "" then
        name = dev.deviceModel or "?"
    end
    local parts = { name }
    -- Show the platform/model (e.g. "macOS") as a tag, matching the Readest
    -- app's device picker. Skip it when empty or when it already stood in for
    -- a missing alias above (so it isn't printed twice).
    local model = dev.deviceModel
    if model and model ~= "" and model ~= name then
        parts[#parts + 1] = model
    end
    local octet = dev.ipv4Host and dev.ipv4Host:match("%.(%d+)$")
    if octet then
        parts[#parts + 1] = "#" .. octet
    end
    return table.concat(parts, " · ")
end

-- Picks a free local port by binding an ephemeral port and closing it right
-- away (small TOCTOU race, acceptable here: the helper binds moments
-- later). pcall-guarded; nil on any failure (e.g. luasocket unavailable).
function M.pickPort()
    local ok, socket = pcall(require, "socket")
    if not ok then return nil end
    local ok2, port = pcall(function()
        local s = assert(socket.tcp())
        assert(s:bind("127.0.0.1", 0))
        local _, p = s:getsockname()
        s:close()
        return tonumber(p)
    end)
    if not ok2 then return nil end
    return port
end

-- chmod +x the binary, then spawn it in the background on the given
-- control port. Best-effort: os.execute gives no reliable success signal
-- for a backgrounded command, so M.connect() below is the real check.
function M.spawn(binpath, port)
    os.execute("chmod +x '" .. binpath .. "' >/dev/null 2>&1")
    os.execute("'" .. binpath .. "' --control-port " .. tostring(port) .. " >/dev/null 2>&1 &")
    return true
end

-- Retries connect() until it succeeds or deadline_s elapses (the helper
-- needs a moment to bind after spawn). On success, switches the socket to
-- non-blocking (settimeout(0)) so the poll loop never stalls KOReader's UI
-- thread. Returns sock, or nil + the last connect error.
function M.connect(port, deadline_s)
    local ok, socket = pcall(require, "socket")
    if not ok then return nil, "no socket" end
    local deadline = os.time() + (deadline_s or 3)
    local err
    while true do
        local sock = socket.tcp()
        sock:settimeout(2)
        local ok_conn, e = sock:connect("127.0.0.1", port)
        if ok_conn then
            sock:settimeout(0)
            return sock
        end
        err = e
        sock:close()
        if os.time() >= deadline then break end
        socket.sleep(0.1)
    end
    return nil, err
end

-- Encodes tbl as JSON and writes it as one newline-terminated line.
-- pcall-guarded so a dead/closed socket never throws into a UI callback.
function M.send(sock, tbl)
    if not sock then return false end
    return pcall(function()
        sock:send(require("json").encode(tbl) .. "\n")
    end)
end

-- Non-blocking read of whatever bytes are available right now. luasocket's
-- "*a" pattern under settimeout(0) returns (nil, "timeout", partial) where
-- `partial` is however many bytes were immediately available (possibly
-- ""); on a closed connection it returns the trailing data (or "") with
-- err == "closed". Returns (chunk, closed).
function M.recvChunk(sock)
    sock:settimeout(0)
    local data, err, partial = sock:receive("*a")
    local chunk = partial or data or ""
    return chunk, err == "closed"
end

return M
