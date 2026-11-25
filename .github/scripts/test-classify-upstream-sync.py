#!/usr/bin/env python3
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("classify-upstream-sync.py")
SPEC = importlib.util.spec_from_file_location("classify_upstream_sync", SCRIPT)
CLASSIFIER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(CLASSIFIER)


class ClassifierTests(unittest.TestCase):
    def classify_paths(self, paths):
        output = b"\0".join(path.encode("utf-8") for path in paths) + b"\0"
        result = type("Result", (), {"stdout": output})()
        with patch.object(CLASSIFIER.subprocess, "run", return_value=result):
            return CLASSIFIER.classify("base", "head")

    def test_readme_requires_manual_review(self):
        _, sensitive = self.classify_paths(["README.md"])
        self.assertEqual(sensitive, ["README.md"])

    def test_build_configuration_requires_manual_review(self):
        _, sensitive = self.classify_paths(["apps/readest-app/next.config.ts"])
        self.assertEqual(sensitive, ["apps/readest-app/next.config.ts"])

    def test_unclassified_path_requires_manual_review(self):
        _, sensitive = self.classify_paths(["new-tooling/custom-build-config.toml"])
        self.assertEqual(sensitive, ["new-tooling/custom-build-config.toml"])

    def test_workflow_changes_require_manual_review(self):
        _, sensitive = self.classify_paths([".github/workflows/nightly.yml"])
        self.assertEqual(sensitive, [".github/workflows/nightly.yml"])

    def test_classifier_changes_require_manual_review(self):
        _, sensitive = self.classify_paths([".github/scripts/classify-upstream-sync.py"])
        self.assertEqual(sensitive, [".github/scripts/classify-upstream-sync.py"])

    def test_regular_application_source_remains_automatic(self):
        _, sensitive = self.classify_paths(["apps/readest-app/src/components/Reader.tsx"])
        self.assertEqual(sensitive, [])

    def test_locale_and_documentation_changes_remain_automatic(self):
        paths, sensitive = self.classify_paths(
            ["apps/readest-app/public/locales/en/translation.json", "docs/user-guide.md"]
        )
        self.assertEqual(paths, ["apps/readest-app/public/locales/en/translation.json", "docs/user-guide.md"])
        self.assertEqual(sensitive, [])


if __name__ == "__main__":
    unittest.main()
