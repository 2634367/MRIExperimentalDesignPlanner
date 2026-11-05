"""The PsychoPy runner has to parse on an older Python than this server runs
on: PsychoPy ships its own (3.11 in the current Mac app) and the bundle's
README promises 3.9. Python 3.12 relaxed f-strings, so a newer interpreter
accepts lines PsychoPy's refuses, and ast.parse's feature_version does not
notice. Those lines are found here from the tokens instead."""
from __future__ import annotations

import ast
import io
import sys
import tokenize
import unittest
from pathlib import Path
from unittest import mock

from app.core.psychopy import RUNNER_DIR

sys.path.insert(0, str(RUNNER_DIR))
from fmri_runner import __main__ as runner, plan as plans  # noqa: E402
from fmri_runner.readout import Readout  # noqa: E402

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


def segment(kind: str, onset: float, duration: float, **extra: object) -> dict:
    return {"kind": kind, "label": extra.pop("label", kind), "onset": onset, "duration": duration, "layers": [], **extra}


def sample_plan() -> dict:
    """Instructions, a lead-in, three blocks of one trial with rests, a lead-out."""
    return {
        "_path": "plan.json", "total_seconds": 40.0, "volumes": 22,
        "run": {"label": "run-01", "name": "Run"},
        "keys": {"quit": ["escape"], "advance": ["space"]},
        "scanner": {"tr": 2.0, "dummy_volumes": 2, "trigger_key": "5"},
        "segments": [
            segment("instructions", 0, 0),
            segment("lead_in", 0, 5),
            segment("phase", 5, 5, block=0, trial=0, trial_type="A", item="one", item_label="First", response={"keys": ["1"]}),
            segment("rest", 10, 5, block=0),
            segment("phase", 15, 5, block=1, trial=1, trial_type="B", item="two", item_label="Second"),
            segment("rest", 20, 5, block=1),
            segment("phase", 25, 10, block=2, trial=2, trial_type="A"),
            segment("lead_out", 35, 5),
        ],
    }


class ShortenTest(unittest.TestCase):
    def test_keeps_the_first_blocks_and_moves_the_lead_out_up(self) -> None:
        short = plans.shorten(sample_plan(), 2)
        self.assertEqual([s["kind"] for s in short["segments"]], ["instructions", "lead_in", "phase", "rest", "phase", "lead_out"])
        self.assertEqual(short["segments"][-1]["onset"], 20)
        self.assertEqual(short["total_seconds"], 25)
        self.assertEqual(short["volumes"], 2 + 13)
        self.assertEqual(short["pilot_blocks"], 2)

    def test_the_last_block_kept_has_no_rest_after_it(self) -> None:
        kinds = [s["kind"] for s in plans.shorten(sample_plan(), 1)["segments"]]
        self.assertEqual(kinds, ["instructions", "lead_in", "phase", "lead_out"])

    def test_asking_for_as_many_blocks_as_there_are_changes_nothing(self) -> None:
        whole = sample_plan()
        self.assertIs(plans.shorten(whole, 3), whole)
        self.assertNotIn("pilot_blocks", whole)

    def test_a_plan_without_blocks_is_refused(self) -> None:
        old = sample_plan()
        for item in old["segments"]:
            item.pop("block", None)
        with self.assertRaises(plans.PlanError):
            plans.shorten(old, 1)


class ArgumentsTest(unittest.TestCase):
    def test_pilot_is_a_short_look_with_no_scanner(self) -> None:
        args = runner.arguments(["p.json", "--pilot"])
        self.assertEqual((args.blocks, args.scanner, args.windowed), (runner.PILOT_BLOCKS, "none", True))

    def test_pilot_leaves_what_you_set_yourself(self) -> None:
        args = runner.arguments(["p.json", "--pilot", "--scanner", "simulate", "--blocks", "3"])
        self.assertEqual((args.blocks, args.scanner), (3, "simulate"))

    def test_the_default_still_waits_for_the_scanner(self) -> None:
        self.assertEqual(runner.arguments(["p.json"]).scanner, "wait")

    def test_a_screen_that_is_not_there_is_a_problem(self) -> None:
        attached = [(1920, 1080), (1280, 1024)]
        self.assertIsNone(runner.screen_problem(1, attached))
        self.assertIn("1 = 1280x1024", runner.screen_problem(2, attached))
        self.assertIsNone(runner.screen_problem(5, []))

    def test_the_pause_key_cannot_be_one_the_run_needs(self) -> None:
        plan = sample_plan()
        self.assertIsNone(runner.pause_key_problem(plan, "space"))
        for key, meaning in (("5", "trigger"), ("escape", "quit"), ("1", "response")):
            self.assertIn(meaning, runner.pause_key_problem(plan, key))


class KeyboardTest(unittest.TestCase):
    def fails(self) -> bool:
        return False

    def test_a_mac_that_blocks_the_keyboard_falls_back_and_says_so(self) -> None:
        backend, warning = runner.keyboard_backend(None, "darwin", self.fails)
        self.assertEqual(backend, "event")
        self.assertIn("Input Monitoring", warning)

    def test_a_working_keyboard_is_left_alone(self) -> None:
        self.assertEqual(runner.keyboard_backend(None, "darwin", lambda: True), (None, None))

    def test_asking_for_a_backend_skips_the_check(self) -> None:
        self.assertEqual(runner.keyboard_backend("ptb", "darwin", self.fails), ("ptb", None))

    def test_other_systems_are_not_checked(self) -> None:
        self.assertEqual(runner.keyboard_backend(None, "win32", self.fails), (None, None))

    def test_where_macos_cannot_be_asked_psychopy_goes_ahead(self) -> None:
        with mock.patch.object(runner.ctypes, "CDLL", side_effect=OSError):
            self.assertTrue(runner.keyboard_works())

    def test_only_a_clear_yes_from_macos_counts(self) -> None:
        for answer, expected in ((0, True), (1, False), (2, False)):
            iokit = mock.Mock()
            iokit.IOHIDCheckAccess.return_value = answer
            with mock.patch.object(runner.ctypes, "CDLL", return_value=iokit):
                self.assertEqual(runner.keyboard_works(), expected)


class ReadoutTest(unittest.TestCase):
    def readout(self, quiet: bool = True) -> tuple[Readout, io.StringIO]:
        stream = io.StringIO()
        return Readout(sample_plan(), quiet=quiet, stream=stream), stream

    def test_plain_output_is_one_line_per_trial(self) -> None:
        readout, stream = self.readout()
        for index, item in enumerate(readout.shown):
            readout.segment(index, item["onset"])
        lines = stream.getvalue().splitlines()
        self.assertEqual(len(lines), 7)
        self.assertIn("trial 1/3", lines[1])
        self.assertIn("block 1/3", lines[1])
        self.assertIn("First", lines[1])

    def test_the_live_lines_say_where_it_is_and_what_is_next(self) -> None:
        readout, _ = self.readout()
        readout.index = 1
        run, phase, now, upcoming = readout.lines(7.0, 100)
        self.assertIn("trial 1/3", run)
        self.assertIn("0:07 / 0:40", run)
        self.assertIn("3.0s", phase)
        self.assertIn("First", now)
        self.assertIn("rest", upcoming)

    def test_a_trial_with_several_phases_prints_once(self) -> None:
        plan = sample_plan()
        plan["segments"].insert(3, segment("phase", 10, 0, block=0, trial=0, trial_type="A"))
        stream = io.StringIO()
        readout = Readout(plan, quiet=True, stream=stream)
        readout.segment(1, 5)
        readout.segment(2, 10)
        self.assertEqual(len(stream.getvalue().splitlines()), 1)


if __name__ == "__main__":
    unittest.main()
