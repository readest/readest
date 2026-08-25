---
name: tts-offline-shared-sentence-5768
description: "PR #5768 (issue #5767) TTS offline shared-sentence download fix - review findings, six follow-up fixes, Xiaomi device verify results, and the empty-section fingerprint flip finding"
metadata: 
  node_type: memory
  type: project
  originSessionId: ec613902-2f35-4962-8101-e53b8b1733ca
  modified: 2026-08-18T18:22:24.824Z
---

PR #5768 (gfreitash, closes #5767) MERGED 2026-08-19 (merge commit b50ff9374) with my six review fixes included as `61c921542` (cherry-picked onto the REAL head `873038b2f` and fast-forward pushed to gfreitash's fork - the worktree copy was rebased by `worktree:new`, direct push would have been a force push, see [[worktree-new-rebases-pr-force-push]]). Findings + Xiaomi device results posted as PR comment 5332002837. Worktree removed.

**The six fixes in 61c921542** (sqliteCacheStore.ts + BufferedTTSClient.ts + 4 new tests):
1. compact() completable predicate excludes detached rows (`audio IS NULL AND pack_id IS NULL`) - else a healed section churns a full-section audio load + warn every debounce cycle forever
2. warmSentence returns false on aborted signal (synthesizeWithRetry resolves undefined on abort, does NOT throw) - was recording marks and returning true for unsynthesized sentences
3. clearDownloads GC passes cleared keys via `json_each(?)` single param - a full book's keys as individual `?` placeholders can exceed SQLite's 32766 host-parameter cap exactly when the cache is biggest
4. Transfer UPDATE re-validates candidate pack EXISTS inside the tx (candidates+sidecar reads run OUTSIDE it; the old "we hold the write lock" comment was false)
5. #readPackedAudio detaches entries whose pack row vanished (dangling pack_id = permanent unevictable silent miss otherwise)
6. readSidecar map construction filters non-integer offset/length (JSON.stringify drops undefined -> json_extract NULL -> committed NULL pack_offset)

**Xiaomi 13 verify (all PASS)**: Download all -> 4/4 incl. two shared-sentence chapters + empty Notes chapter; offline playback (wifi+data off) of ch2 via pack MP3 podcast timeline AND ch1+ch2 via live per-sentence cache path; Clear all -> 0/4 with zero "Partly downloaded" leftovers; re-download after clear -> 4/4. Purpose-built test EPUB generator: scratchpad make_tts_book.py (3 chapters sharing 5 exact sentences + heading-only ch4); one paragraph per sentence so each `<p>` = one TTS session in console logs (session-per-paragraph is NORMAL).

**OPEN finding for PR thread**: an empty/symbol-only section (Notes, "***") flips Downloaded -> not-downloaded after live TTS visits it. Live speak enumeration registers a DIFFERENT mark list than the downloader's enumerateSection (empty vs non-empty), changing the manifest fingerprint; the PR's fingerprint-gated `packed` then reports the old pack stale. Self-heals on next Download all (re-registers + packs fresh, near-instant). Fix belongs in enumeration consistency, not the fingerprint gate. Pre-PR this was masked because ANY pack counted as packed.

**Also flagged in review (pre-existing, own issues)**: statement-granularity BEGIN/COMMIT on the app-global shared turso connection (op_lock serializes single statements only; two interleaved flows can nest BEGIN and the loser's ROLLBACK destroys the winner's tx - PR widens exposure via transfer tx on get/put hot paths); clearDownloads vs beginDownloadSections race (unconditional `DELETE FROM pinned_sections`); ttsPackSync JSON.parse cast without shape validation flowing into pack filenames; registerSectionMarks keeps a stale key when a mark name changes at the same ordinal (can pack stale audio under a new fingerprint).

**Device-drive recipe**: build `pnpm dev-android` from worktree (copy tauri.settings.gradle/tauri.build.gradle.kts/local.properties from main checkout with sed path rewrite first); CDP via `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>` + python websocket-client with `suppress_origin=True` (403 otherwise); release webview logs do NOT reach logcat - use CDP Runtime.enable to replay the console buffer; app buttons respond to element .click() but TOC items and the mini-player expand do NOT (use adb input tap); Speak resumes from the section's last in-section position, so a book played to its end restarts at the tail and the session stops within seconds - jump via TOC to chapter start first.


## Index status as of 2026-08-24 (moved verbatim from MEMORY.md)
- [#5767/PR #5768 TTS offline shared-sentence fix](tts-offline-shared-sentence-5768.md) MERGED (61c921542); Xiaomi VERIFIED; OPEN: empty-section Downloaded flip, needs follow-up issue
