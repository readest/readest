---
name: kindle-ssh-deploy-debug-recipe
description: "SSH into the Kindle Voyage (192.168.2.180:2222, blank-password dropbear via SSH_ASKPASS), deploy koplugin zips, and debug the plugin on-device"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 260f7293-8868-4f21-b6e3-62806e7bd8a3
  modified: 2026-08-14T06:16:57.586Z
---

Headless SSH recipe for the user's Kindle Voyage (KOReader v2026.07.2, fw 5.13.6), used 2026-08-14 to deploy `Readest-0.12.1-1.koplugin.zip` and debug a stats-push failure.

**Auth:** `root@192.168.2.180 -p 2222` (KOReader SSH plugin dropbear). The Mac's `id_rsa` is REJECTED — login is blank-password. Non-interactive: write an askpass script that `echo ""`, then
`DISPLAY=none SSH_ASKPASS=<script> SSH_ASKPASS_REQUIRE=force ssh -o PreferredAuthentications=password -o NumberOfPasswordPrompts=1 ...`

**Deploy:** upload via `cat zip | ssh '... cat > /var/local/x.zip'` (NOT scp/sftp; verify md5sum both ends), then `killall localsend-helper-armv7` (never `pgrep -f` — self-kills), `rm -rf` the old `/mnt/us/koreader/plugins/readest.koplugin`, `unzip -oq` into `plugins/` (busybox unzip: NO `-t` option; `-x` glob patterns work), `sync`. Restart KOReader to load it. More gotchas in [[koplugin-localsend-receive]].

**On-device debugging:**
- `crash.log` is USELESS for sync/stats failures: `readest_syncstats.lua` + sync client log at `logger.dbg`, suppressed at KOReader's default INFO level. "Failed to push reading statistics" = pushChanges callback `success=false`, no detail anywhere.
- Plugin state lives in `/mnt/us/koreader/settings.reader.lua` → `["readest_sync"]` table: `access_token`/`expires_at` (check vs `date +%s` for expiry), `stats_push_cursor` (SECONDS), `stats_pull_cursor` (MILLISECONDS).
- Stats backlog: copy `/mnt/us/koreader/settings/statistics.sqlite3` and run collectSince's SQL locally (`page_stat_data p JOIN book b ... WHERE p.start_time > cursor`).
- Network probe from device: `curl -sS -o /dev/null -w "%{http_code}" https://web.readest.com/api/sync` (expect 401 unauth). 2026-08-14 case: DNS resolved but `curl: (7) Couldn't connect` — Kindle WiFi had lost WAN while LAN/SSH still worked; user reconnected WiFi and push succeeded. Check this FIRST before suspecting the plugin.

**Misc:** KOReader 2026.07+ warns `PluginLoader: readest name in _meta.lua, is deprecated and will be ignored` — harmless, plugin still loads. Release zips built from the working dir can swallow stray `Readest-dev-*.koplugin.zip` leftovers sitting in the plugin source dir — exclude on install and clean the source dir.
