#!/usr/bin/env python3
"""Print one line per event on the PRs the triage loop follows.

Run under Claude Code's Monitor tool: each stdout line wakes the loop. The PR
list is re-read every pass from watch.json ([{"repo": "owner/name",
"number": N}]), which the loop updates. What was already reported is kept in
watch-seen.json, so a re-armed watcher neither repeats events nor misses the
ones that happened while it was down. The first time a PR is seen, its current
reviews and comments are recorded without reporting them.

Only PRs opened by the account it runs as are read; any other PR on the list
is skipped unread. A commit by anyone else on a followed PR is reported, and
each review or comment is tagged trusted (CodeRabbit's bot) or untrusted.
"""

import json
import os
import subprocess
import sys
import time

STATE = os.path.join(os.environ.get("XDG_STATE_HOME", os.path.expanduser("~/.local/state")), "readest-loops")
WATCH = os.path.join(STATE, "watch.json")
SEEN = os.path.join(STATE, "watch-seen.json")
INTERVAL = int(os.environ.get("WATCH_INTERVAL", "60"))
RED = {"failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale"}


def gh(path):
    # One page (per_page=100) covers a PR's runs, reviews and comments; gh 2.46 has no --slurp.
    out = subprocess.run(["gh", "api", path], capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        first_line = (out.stderr.strip().splitlines() or ["no output"])[0]
        raise RuntimeError(f"gh api {path}: {first_line[:200]}")
    return json.loads(out.stdout)


def emit(line):
    print(line, flush=True)


def load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def check(repo, n, me, seen):
    key = f"{repo}#{n}"
    s = seen.setdefault(key, {"ids": [], "done": []})
    first = not s.get("init")
    ids, done = set(s["ids"]), set(s["done"])

    pr = gh(f"repos/{repo}/pulls/{n}")
    if pr["user"]["login"] != me:
        if "not-owner" not in done:
            done.add("not-owner")
            emit(f"SKIPPED_NOT_OWNER {key} by {pr['user']['login']}")
        s.update(ids=sorted(ids), done=sorted(done), init=True)
        return False
    head = pr["head"]["sha"]
    for c in gh(f"repos/{repo}/pulls/{n}/commits?per_page=100"):
        author = (c.get("author") or {}).get("login") or c["commit"]["author"]["name"]
        if author != me and f"foreign:{c['sha']}" not in done:
            done.add(f"foreign:{c['sha']}")
            emit(f"FOREIGN_COMMIT {key} {c['sha'][:9]} by {author}")
    if pr["state"] != "open":
        if "closed" not in done:
            done.add("closed")
            emit(f"CLOSED {key} merged={str(pr.get('merged', False)).lower()}")
        s.update(ids=sorted(ids), done=sorted(done), init=True)
        return False

    runs = gh(f"repos/{repo}/commits/{head}/check-runs?per_page=100")["check_runs"]
    if runs and all(r["status"] == "completed" for r in runs) and f"ci:{head}" not in done:
        done.add(f"ci:{head}")
        failing = sorted(r["name"] for r in runs if r["conclusion"] in RED)
        skipped = sorted(r["name"] for r in runs if r["conclusion"] == "skipped")
        result = "red " + ",".join(failing) if failing else "green"
        extra = f" skipped={','.join(skipped)}" if skipped else ""
        if not first:
            emit(f"CI_DONE {key} head={head[:9]} {result}{extra}")

    status = gh(f"repos/{repo}/commits/{head}/status")
    for st in status.get("statuses", []):
        if st["context"] == "CodeRabbit" and st["state"] != "pending" and f"cr:{head}" not in done:
            done.add(f"cr:{head}")
            if not first:
                emit(f"CODERABBIT_DONE {key} head={head[:9]} {st['state']}: {(st.get('description') or '')[:80]}")

    items = [("REVIEW", r) for r in gh(f"repos/{repo}/pulls/{n}/reviews?per_page=100")]
    items += [("REVIEW_COMMENT", c) for c in gh(f"repos/{repo}/pulls/{n}/comments?per_page=100")]
    items += [("COMMENT", c) for c in gh(f"repos/{repo}/issues/{n}/comments?per_page=100")]
    for kind, it in items:
        iid = f"{kind}:{it['id']}"
        if iid in ids:
            continue
        ids.add(iid)
        user = it.get("user") or {}
        who = user.get("login", "?")
        if first or who == me:
            continue
        trust = "trusted" if who == "coderabbitai[bot]" and user.get("type") == "Bot" else "untrusted"
        state = f" {it['state']}" if kind == "REVIEW" else ""
        where = f" {it['path']}" if kind == "REVIEW_COMMENT" else ""
        emit(f"{kind} {key} {trust} by {who}{state}{where}")

    s.update(ids=sorted(ids), done=sorted(done), init=True)
    return True


def main():
    os.makedirs(STATE, exist_ok=True)
    who = subprocess.run(["gh", "api", "user", "--jq", ".login"], capture_output=True, text=True, timeout=60)
    me = who.stdout.strip()
    if who.returncode != 0 or not me:
        # Without the owner's login every PR would look foreign; stop rather than mislabel them.
        emit(f"WATCH_ERROR cannot read the gh login: {(who.stderr.strip().splitlines() or ['no output'])[0][:200]}")
        sys.exit(1)
    once = "--once" in sys.argv
    errors = {}
    while True:
        seen = load(SEEN, {})
        for pr in load(WATCH, []):
            key = f"{pr['repo']}#{pr['number']}"
            try:
                check(pr["repo"], pr["number"], me, seen)
                errors.pop(key, None)
            except Exception as e:  # one failing PR must not stop the watch, but never stay silent
                if time.time() - errors.get(key, 0) > 600:
                    errors[key] = time.time()
                    emit(f"WATCH_ERROR {key} {e}")
        with open(SEEN + ".tmp", "w") as f:
            json.dump(seen, f)
        os.replace(SEEN + ".tmp", SEEN)
        if once:
            return
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
