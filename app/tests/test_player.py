"""The runner's Player, driven without PsychoPy: a fake clock, screen and
keyboard stand in for it, so what a key press does to the schedule can be
checked exactly. Real key handling still needs real PsychoPy."""
from __future__ import annotations

import sys
import types
import unittest
from unittest import mock

from app.core.psychopy import RUNNER_DIR

sys.path.insert(0, str(RUNNER_DIR))
FRAME = 0.1


class Clock:
    now = 100.0


class Key:
    def __init__(self, name: str) -> None:
        self.name = name
        self.tDown = None


class Keyboard:
    """Hands each key over at its time on the fake clock."""

    def __init__(self) -> None:
        self.script: list[tuple[float, str]] = []

    def clearEvents(self) -> None:  # noqa: N802
        pass

    def getKeys(self, names: list[str], waitRelease: bool = False) -> list[Key]:  # noqa: N802,N803
        due = [item for item in self.script if item[0] <= Clock.now and item[1] in names]
        self.script = [item for item in self.script if item not in due]
        return [Key(name) for _, name in due]


class Screen:
    def flip(self) -> float:
        Clock.now += FRAME
        return Clock.now


class Stim:
    def __init__(self, *args: object, **kwargs: object) -> None:
        self.text = ""

    def draw(self) -> None:
        pass


def fake_psychopy() -> dict[str, types.ModuleType]:
    core = types.SimpleNamespace(getTime=lambda: Clock.now)
    visual = types.SimpleNamespace(TextStim=Stim, ImageStim=Stim, Circle=Stim, Rect=Stim, ShapeStim=Stim, Polygon=Stim, Window=Stim)
    hardware = types.ModuleType("psychopy.hardware")
    hardware.keyboard = types.SimpleNamespace(Keyboard=Keyboard)
    root = types.ModuleType("psychopy")
    root.core, root.visual, root.hardware = core, visual, hardware
    return {"psychopy": root, "psychopy.hardware": hardware}


class Quiet:
    def log(self, *args: object, **fields: object) -> None:
        self.__dict__.setdefault("events", []).append(args[0])


class Readout:
    def note(self, text: str) -> None:
        pass

    def tick(self, now: float) -> None:
        pass

    def segment(self, index: int, now: float) -> None:
        pass


def plan() -> dict:
    def phase(onset: float, duration: float, trial: int, item: str) -> dict:
        return {"kind": "phase", "label": "p", "onset": onset, "duration": duration, "layers": [], "trial": trial, "item": item}
    return {
        "scanner": {"tr": 1.0, "dummy_volumes": 1, "trigger_key": "5"}, "keys": {"quit": ["escape"], "advance": ["space"]},
        "display": {}, "media": {}, "_media_paths": {}, "total_seconds": 4.0,
        "segments": [phase(0, 2, 0, "a"), phase(2, 2, 1, "b")],
    }


class PlayerTest(unittest.TestCase):
    def setUp(self) -> None:
        patcher = mock.patch.dict(sys.modules, fake_psychopy())
        patcher.start()
        self.addCleanup(patcher.stop)
        for name in ("fmri_runner.schedule", "fmri_runner.display"):
            sys.modules.pop(name, None)
        self.addCleanup(lambda: [sys.modules.pop(name, None) for name in ("fmri_runner.schedule", "fmri_runner.display")])
        from fmri_runner import schedule
        self.schedule = schedule
        Clock.now = 100.0
        self.keyboard = Keyboard()

    def player(self, pause_keys: tuple[str, ...] = ()) -> object:
        window = types.SimpleNamespace(win=Screen(), kb=self.keyboard, frame=FRAME, text_color="#ffffff", message=Stim())
        return self.schedule.Player(window, plan(), Quiet(), "none", Readout(), pause_keys)

    def test_a_run_ends_on_schedule(self) -> None:
        record, rows = self.player().play()
        self.assertEqual(len(rows), 2)
        self.assertAlmostEqual(record["duration"], 4.0, delta=2 * FRAME)
        self.assertNotIn("debug", record)

    def test_every_item_shown_is_recorded_once(self) -> None:
        record, _ = self.player().play()
        self.assertEqual(record["shown_items"], ["a", "b"])

    def test_a_pause_stops_the_clock_and_every_phase_keeps_its_length(self) -> None:
        self.keyboard.script = [(101.0, "space"), (104.0, "space")]
        record, rows = self.player(("space",)).play()
        self.assertTrue(record["debug"])
        self.assertEqual(len(record["pauses"]), 1)
        self.assertAlmostEqual(record["pauses"][0]["duration"], 3.0, delta=2 * FRAME)
        # On the run clock nothing moved: the second trial is still at 2 s.
        self.assertAlmostEqual(rows[1]["onset"], 2.0, delta=2 * FRAME)
        self.assertAlmostEqual(rows[0]["duration"], 2.0, delta=2 * FRAME)
        self.assertAlmostEqual(record["duration"], 4.0, delta=2 * FRAME)

    def test_the_pause_key_does_nothing_without_debug(self) -> None:
        self.keyboard.script = [(101.0, "space")]
        record, _ = self.player().play()
        self.assertAlmostEqual(record["duration"], 4.0, delta=2 * FRAME)

    def test_quitting_while_paused_keeps_what_ran(self) -> None:
        self.keyboard.script = [(101.0, "space"), (102.0, "escape")]
        player = self.player(("space",))
        with self.assertRaises(self.schedule.Abort):
            player.play()
        self.assertTrue(player.record["aborted"])
        self.assertIsNone(player.record["pauses"][0]["duration"])
        self.assertEqual(player.record["shown_items"], ["a"])

    def test_a_press_before_the_run_does_not_pause_it(self) -> None:
        self.keyboard.script = [(100.0, "space")]
        record, _ = self.player(("space",)).play()
        self.assertEqual(record["pauses"], [])


if __name__ == "__main__":
    unittest.main()
