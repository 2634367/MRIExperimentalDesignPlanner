"""The browser's compile.js, run under Node when it is installed."""
from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

CHECKS = Path(__file__).with_name("compile_checks.js")


@unittest.skipUnless(shutil.which("node"), "needs node")
class CompileTest(unittest.TestCase):
    def test_compile_keeps_its_promises(self) -> None:
        result = subprocess.run(["node", str(CHECKS)], capture_output=True, text=True, timeout=60, check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
