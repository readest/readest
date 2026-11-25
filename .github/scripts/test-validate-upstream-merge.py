#!/usr/bin/env python3
import importlib.util
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("validate-upstream-merge.py")
SPEC = importlib.util.spec_from_file_location("validate_upstream_merge", SCRIPT)
VALIDATOR = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(VALIDATOR)


class ValidateUpstreamMergeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Sync Test")
        self.git("config", "user.email", "sync-test@example.invalid")
        (self.repo / "base.txt").write_text("base\n", encoding="utf-8")
        self.git("add", "base.txt")
        self.git("commit", "-q", "-m", "base")
        self.base = self.git("rev-parse", "HEAD")

        self.git("switch", "-q", "-c", "upstream")
        (self.repo / "upstream.txt").write_text("upstream\n", encoding="utf-8")
        self.git("add", "upstream.txt")
        self.git("commit", "-q", "-m", "upstream")
        self.upstream = self.git("rev-parse", "HEAD")

        self.git("switch", "-q", "--detach", self.base)
        self.git("merge", "-q", "--no-ff", "-m", "expected merge", self.upstream)
        self.candidate = self.git("rev-parse", "HEAD")
        self.tree = self.git("rev-parse", "HEAD^{tree}")
        self.original_cwd = Path.cwd()
        os.chdir(self.repo)

    def tearDown(self):
        os.chdir(self.original_cwd)
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.run(
            ["git", *args],
            cwd=self.repo,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        ).stdout.strip()

    def test_accepts_exact_clean_merge(self):
        VALIDATOR.validate(self.base, self.upstream, self.candidate)

    def test_rejects_extra_commit_after_merge(self):
        self.git("switch", "-q", "-c", "extra")
        (self.repo / "extra.txt").write_text("extra\n", encoding="utf-8")
        self.git("add", "extra.txt")
        self.git("commit", "-q", "-m", "unexpected extra commit")
        extra = self.git("rev-parse", "HEAD")
        with self.assertRaisesRegex(ValueError, "ordered parents"):
            VALIDATOR.validate(self.base, self.upstream, extra)

    def test_rejects_altered_merge_tree(self):
        self.git("switch", "-q", "--detach", self.base)
        (self.repo / "altered.txt").write_text("unexpected tree\n", encoding="utf-8")
        self.git("add", "altered.txt")
        altered_tree = self.git("write-tree")
        altered = self.git(
            "-c", "user.name=Sync Test", "-c", "user.email=sync-test@example.invalid",
            "commit-tree", altered_tree, "-p", self.base, "-p", self.upstream,
        )
        with self.assertRaisesRegex(ValueError, "tree differs"):
            VALIDATOR.validate(self.base, self.upstream, altered)

    def test_rejects_reversed_merge_parents(self):
        reversed_parents = self.git(
            "-c", "user.name=Sync Test", "-c", "user.email=sync-test@example.invalid",
            "commit-tree", self.tree, "-p", self.upstream, "-p", self.base,
        )
        with self.assertRaisesRegex(ValueError, "ordered parents"):
            VALIDATOR.validate(self.base, self.upstream, reversed_parents)


if __name__ == "__main__":
    unittest.main()
