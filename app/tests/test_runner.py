"""The PsychoPy runner has to parse on an older Python than this server runs
on: PsychoPy ships its own (3.11 in the current Mac app) and the bundle's
README promises 3.9. Python 3.12 relaxed f-strings, so a newer interpreter
accepts lines PsychoPy's refuses, and ast.parse's feature_version does not
notice. Those lines are found here from the tokens instead."""
from __future__ import annotations

import ast
import io
import tokenize
import unittest
from pathlib import Path

from app.core.psychopy import RUNNER_DIR

OLDEST_PYTHON = (3, 9)


def f_string_problems(source: str) -> list[str]:
    """Lines an f-string on Python before 3.12 could not hold: the f-string's
    own quote, or a backslash, inside a {} field. Empty on an interpreter that
    does not tokenize f-strings -- which is one that would refuse them itself."""
    start = getattr(tokenize, "FSTRING_START", None)
    end = getattr(tokenize, "FSTRING_END", None)
    if start is None:
        return []
    problems = []
    open_quotes: list[str] = []
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type == end:
            open_quotes.pop()
            continue
        if open_quotes and token.type in (tokenize.STRING, start):
            quote = token.string.lstrip("rRbBuUfF")[0]
            if quote in open_quotes:
                problems.append(f"line {token.start[0]}: {quote} reused inside an f-string")
            if token.type == tokenize.STRING and "\\" in token.string:
                problems.append(f"line {token.start[0]}: backslash inside an f-string field")
        if token.type == start:
            open_quotes.append(token.string.lstrip("rRbBuUfF")[0])
    return problems


class OlderPythonTest(unittest.TestCase):
    def test_the_check_finds_a_reused_quote(self) -> None:
        if not hasattr(tokenize, "FSTRING_START"):
            self.skipTest("this Python refuses such a line itself")
        self.assertTrue(f_string_problems('print(f"{plan["segments"]}")\n'))
        self.assertTrue(f_string_problems("print(f'{plan['segments']}')\n"))
        self.assertTrue(f_string_problems('print(f"{f"{x}"}")\n'))
        self.assertTrue(f_string_problems('print(f"{"\\n".join(x)}")\n'))

    def test_the_check_passes_what_older_pythons_accept(self) -> None:
        self.assertEqual(f_string_problems('print(f"{plan[\'segments\']}")\n'), [])
        self.assertEqual(f_string_problems('print(f"{x!r:>10} and {y}", "z")\n'), [])
        self.assertEqual(f_string_problems('print(f"a", f\'b\', "c")\n'), [])

    def test_every_runner_file_parses_on_the_oldest_python(self) -> None:
        files = sorted((RUNNER_DIR / "fmri_runner").glob("*.py"))
        self.assertTrue(files)
        for path in files:
            with self.subTest(file=Path(path).name):
                source = path.read_text(encoding="utf-8")
                ast.parse(source, feature_version=OLDEST_PYTHON)
                self.assertEqual(f_string_problems(source), [])


if __name__ == "__main__":
    unittest.main()
