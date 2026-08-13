-- Opens/closes the INPUT firewall for LocalSend's ports on devices that run
-- iptables with a default-DROP policy. Confirmed on Kindle hardware: the
-- firmware runs `iptables` with `INPUT policy DROP` and only allow-lists
-- ports explicitly (KOReader's own SSH plugin ACCEPTs its port 2222 the
-- same way, on start/stop). LocalSend's TCP 53317-53327 server range and
-- UDP 53317 multicast discovery are not on that allow-list, so peers cannot
-- reach a Kindle's LocalSend server, or find it at all, until these rules
-- are added. Mirrors kaikozlov's localsend_firewall.lua and KOReader's
-- SSHPlugin (`-A INPUT ... -j ACCEPT` on start, `-D` on stop).
--
-- Not gated on Device:isKindle(): gated on iptables actually being present
-- and working, so this also covers any other DROP-policy device and safely
-- no-ops where iptables is absent entirely (macOS emulator, most non-Kindle
-- e-readers). Adding ACCEPT rules on a device whose policy is already
-- ACCEPT is harmless.
--
-- M.rules() is pure (no os/iptables dependency) so it's unit-testable
-- without a real iptables binary.

local logger = require("logger")

local M = {}

-- nil = unprobed, false = "no usable iptables found", string = resolved
-- binary path. Probed once and cached for the process lifetime.
local bin
-- nil = unprobed, true/false once we know whether this iptables supports
-- `-C` (rule-exists check). Legacy iptables exits 2 on `-C`, meaning
-- "flag not understood" rather than "rule absent".
local can_check

local CANDIDATES = { "/usr/sbin/iptables", "/sbin/iptables" }

local function shellEscape(arg)
    return "'" .. tostring(arg):gsub("'", "'\\''") .. "'"
end

-- Normalizes os.execute's return value across Lua/LuaJIT variants (Lua 5.1
-- and KOReader's LuaJIT return the raw wait() status; Lua 5.2+ returns
-- ok, "exit"|"signal", code) into a plain process exit code.
local function execStatus(cmd)
    local a, _kind, code = os.execute(cmd)
    if type(code) == "number" then return code end
    if type(a) == "number" then return math.floor(a / 256) % 256 end
    return a and 0 or 1
end

local function resolve()
    for _, path in ipairs(CANDIDATES) do
        if execStatus("[ -x " .. shellEscape(path) .. " ] >/dev/null 2>&1") == 0 then
            return path
        end
    end
    if execStatus("command -v iptables >/dev/null 2>&1") == 0 then
        return "iptables"
    end
    return false
end

-- Returns the resolved iptables binary (path or bare "iptables"), or nil if
-- none could be found on this device.
function M.available()
    if bin == nil then
        bin = resolve()
    end
    if bin == false then return nil end
    return bin
end

-- Pure: the INPUT rules LocalSend needs. 53317-53327 is the TCP server port
-- range the helper walks looking for a free port; 53317/udp is the
-- multicast discovery port. INPUT only: OUTPUT policy is ACCEPT on Kindle.
function M.rules()
    return {
        { "-p", "tcp", "--dport", "53317:53327", "-m", "conntrack",
          "--ctstate", "NEW,ESTABLISHED", "-j", "ACCEPT" },
        { "-p", "udp", "--dport", "53317", "-j", "ACCEPT" },
    }
end

local function runIptables(iptables, action, rule)
    local parts = { shellEscape(iptables), "-" .. action, "INPUT" }
    for _, arg in ipairs(rule) do
        table.insert(parts, shellEscape(arg))
    end
    table.insert(parts, ">/dev/null 2>&1")
    return execStatus(table.concat(parts, " "))
end

-- Probes once whether this iptables supports `-C` (rule-exists check):
-- exit 0 (rule present) or 1 (rule absent) both mean -C is understood;
-- exit 2 means the flag itself is unsupported (legacy iptables).
local function checkSupported(iptables)
    if can_check == nil then
        local code = runIptables(iptables, "C", { "-j", "ACCEPT" })
        can_check = (code == 0 or code == 1)
    end
    return can_check
end

-- Adds the INPUT ACCEPT rules, skipping any rule `-C` reports as already
-- present so repeated start/stop cycles don't pile up duplicates. When -C
-- isn't supported, always -A (close()'s -D still keeps things tidy on
-- stop). Best-effort: callers should not fail startService() over a false
-- return here, the service may still work fine without it.
function M.open()
    local iptables = M.available()
    if not iptables then return false end
    local checkable = checkSupported(iptables)
    local all_ok = true
    for _, rule in ipairs(M.rules()) do
        local already_present = checkable and runIptables(iptables, "C", rule) == 0
        if not already_present then
            if runIptables(iptables, "A", rule) ~= 0 then
                all_ok = false
                logger.warn("ReadestLocalSend: firewall: iptables -A INPUT failed for "
                    .. table.concat(rule, " "))
            end
        end
    end
    logger.info("ReadestLocalSend: firewall opened via " .. iptables)
    return all_ok
end

-- Deletes the INPUT ACCEPT rules. Best-effort: a rule may already be gone
-- (never added, or a previous close already removed it), so per-rule
-- failures are ignored.
function M.close()
    local iptables = M.available()
    if not iptables then return false end
    for _, rule in ipairs(M.rules()) do
        runIptables(iptables, "D", rule)
    end
    logger.info("ReadestLocalSend: firewall closed via " .. iptables)
    return true
end

return M
