---
name: user-report-skill
description: /user-report skill turns a Reddit/email bug report into a GitHub issue plus archived repro files; Chrome saves downloads to ~/Desktop
metadata:
  type: project
---

`/user-report` (`.agents/skills/user-report/SKILL.md`, gitignored — force-add it if it should ship)
is the workflow for turning a user report into something trackable: read the thread, pull the repro
files, diagnose them, `gh issue create`, then archive under
`/Users/chrox/Documents/books/issues/<issue-number>/` with a README (source URL, handle, md5s, sizes).
First run produced [[duplicate-book-calibre-uuid-5959]].

Gotchas the skill encodes, all hit for real on 2026-08-30:
- `WebFetch` cannot read Reddit ("unable to fetch") or authenticated Gmail — drive the user's
  logged-in Chrome via the claude-in-chrome MCP instead; Gmail needs a second `get_page_text`
  because the first returns "Loading...".
- **Chrome on this Mac saves downloads to `~/Desktop`, not `~/Downloads`** (no
  `download.default_directory` in Preferences, `savefile.default_directory` is Desktop). An empty
  `~/Downloads` is NOT evidence the download failed — read the `downloads` table of
  `~/Library/Application Support/Google/Chrome/Default/History` instead.
- A Gmail attachment URL cannot be `fetch()`ed from the page: it 302s to `googleusercontent.com`
  with no CORS headers. curl can't either (cookie-authenticated).

**Why:** each of these cost a wrong conclusion or a retry loop, and every user report repeats them.

**How to apply:** invoke the skill instead of improvising, and never put the reporter's real name or
email in the public issue — link the public handle and report URL only.
