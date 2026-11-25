#!/usr/bin/env python3
"""Fail unless a candidate is exactly the clean merge of base and upstream."""

import subprocess
import sys


def git(*args):
    return subprocess.run(
        ["git", *args], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    ).stdout.decode("utf-8").strip()


def expected_tree(base, upstream):
    result = subprocess.run(
        ["git", "merge-tree", "--write-tree", base, upstream],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        raise ValueError("base and upstream do not merge cleanly")
    tree = result.stdout.splitlines()[0] if result.stdout.splitlines() else ""
    if not tree:
        raise ValueError("git merge-tree returned no tree")
    return tree


def validate(base, upstream, candidate):
    parents = git("rev-list", "--parents", "-n", "1", candidate).split()[1:]
    if parents != [base, upstream]:
        raise ValueError("candidate must have exactly base and upstream as ordered parents")

    actual_tree = git("rev-parse", f"{candidate}^{{tree}}")
    if actual_tree != expected_tree(base, upstream):
        raise ValueError("candidate tree differs from the clean base/upstream merge")


def main(argv):
    if len(argv) != 4:
        raise SystemExit("usage: validate-upstream-merge.py BASE UPSTREAM CANDIDATE")
    try:
        validate(*argv[1:])
    except (ValueError, subprocess.CalledProcessError) as error:
        message = error.stderr.decode("utf-8", errors="replace").strip() if isinstance(error, subprocess.CalledProcessError) else str(error)
        print(f"Invalid upstream sync candidate: {message}", file=sys.stderr)
        return 1
    print("Candidate is exactly the clean base/upstream merge.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
