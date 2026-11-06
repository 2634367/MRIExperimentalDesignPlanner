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
    def __init__(self, name: str, down: float | None = None) -> None:
        self.name = name
        self.tDown = down


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


class TimedKeyboard(Keyboard):
    """Like PsychoPy's own: a key waits in the buffer until asked for by name,
    and keeps the time it went down."""

    def getKeys(self, names: list[str], waitRelease: bool = False) -> list[Key]:  # noqa: N802,N803
        due = [item for item in self.script if item[0] <= Clock.now and item[1] in names]
        self.script = [item for item in self.script if item not in due]
        return [Key(name, at) for at, name in due]


class EventModule:
    """psychopy.event as it really answers: [name, time] pairs."""

    def __init__(self) -> None:
        self.script: list[tuple[float, str]] = []
        self.cleared: list[str] = []

    def clearEvents(self, kind: str) -> None:  # noqa: N802
        self.cleared.append(kind)

    def getKeys(self, keyList: list[str], timeStamped: bool) -> list[list]:  # noqa: N802,N803
        assert timeStamped is True
        due = [item for item in self.script if item[0] <= Clock.now and item[1] in keyList]
        self.script = [item for item in self.script if item not in due]
        return [[name, at] for at, name in due]


class Screen:
    def __init__(self) -> None:
        self.flips = 0
        self.slow_flips: dict[int, float] = {}

    def flip(self) -> float:
        self.flips += 1
        Clock.now += self.slow_flips.get(self.flips, FRAME)
        return Clock.now

    def clearBuffer(self) -> None:  # noqa: N802
        pass


class Stim:
    def __init__(self, *args: object, **kwargs: object) -> None:
        self.text = ""
        self.options = kwargs

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
    def __init__(self) -> None:
        self.notes: list[str] = []

    def note(self, text: str) -> None:
        self.notes.append(text)

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
        return self.player_for(plan(), "none", self.keyboard, pause_keys)

    def player_for(self, the_plan: dict, mode: str, keys: object, pause_keys: tuple[str, ...] = ()) -> object:
        self.screen = Screen()
        self.readout = Readout()
        window = types.SimpleNamespace(win=self.screen, kb=keys, frame=FRAME, text_color="#ffffff", message=Stim(), view_scale=None)
        return self.schedule.Player(window, the_plan, Quiet(), mode, self.readout, pause_keys)

    def answering_plan(self) -> dict:
        """Two 2 s screens; only the second takes a response."""
        the_plan = plan()
        the_plan["segments"][1]["response"] = {"keys": ["1", "2"]}
        return the_plan

    def pulses(self, start: float, count: int, tr: float = 1.0) -> list[tuple[float, str]]:
        return [(start + index * tr, "5") for index in range(count)]

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

    def test_the_fallback_keyboard_hears_trigger_response_and_escape(self) -> None:
        from fmri_runner.keys import Abort, Keys, WindowKeys
        event = EventModule()
        event.script = self.pulses(100.2, 1) + [(102.8, "1"), (103.0, "escape")]
        player = self.player_for(self.answering_plan(), "wait", Keys(WindowKeys(event)))
        with self.assertRaises(Abort):
            player.play()
        self.assertEqual(player.t0, 100.2)
        self.assertEqual([press["key"] for press in player.presses], ["1"])
        self.assertTrue(player.record["aborted"])
        self.assertEqual(event.cleared, ["keyboard"])

    def test_the_fallback_keyboard_reaches_the_window(self) -> None:
        from fmri_runner.keys import WindowKeys
        root = sys.modules["psychopy"]
        root.event = EventModule()
        self.assertIsInstance(self.schedule.Window._reader(None, "event"), WindowKeys)

    def test_a_key_from_the_number_pad_is_a_pulse(self) -> None:
        self.keyboard.script = [(100.2, "num_5"), (101.0, "num_5")]
        player = self.player_for(plan(), "wait", self.keyboard)
        record, _ = player.play()
        self.assertEqual(record["pulses"]["seen"], 2)

    def test_the_first_screen_is_built_before_the_clock_starts(self) -> None:
        built_at: list[object] = []
        player = self.player_for(plan(), "none", self.keyboard)
        real = player.painter.stims
        player.painter.stims = lambda layers: built_at.append(player.t0) or real(layers)
        player.play()
        self.assertIsNone(built_at[0])

    def test_waiting_says_what_it_has_seen_and_warns_of_silence(self) -> None:
        the_plan = plan()
        the_plan["scanner"]["dummy_volumes"] = 2
        self.keyboard.script = [(100.5, "5"), (135.0, "5")]
        self.player_for(the_plan, "wait", self.keyboard).play()
        text = "\n".join(self.readout.notes)
        self.assertIn("pulse 1/2", text)
        self.assertIn("nothing for 30s", text)

    def test_pulses_stopping_mid_run_is_warned_about_once_and_the_run_goes_on(self) -> None:
        self.keyboard.script = self.pulses(100.2, 1)
        player = self.player_for(plan(), "wait", self.keyboard)
        player.scanner["tr"] = 0.5
        record, rows = player.play()
        self.assertEqual(len(rows), 2)
        self.assertEqual(len(record["pulse_gaps"]), 1)
        self.assertEqual(sum("no pulse" in note for note in self.readout.notes), 1)

    def test_the_summary_compares_pulses_with_the_plan(self) -> None:
        the_plan = plan()
        the_plan.update(run={"label": "run-01"}, volumes=10)
        self.keyboard.script = self.pulses(100.2, 4)
        player = self.player_for(the_plan, "wait", self.keyboard)
        record, _ = player.play()
        self.assertIn("4/10 pulses", player.summary())
        self.assertIn("WARNING", player.summary())
        record["pulses"]["expected"] = 5
        self.assertNotIn("WARNING", player.summary())

    def test_every_press_is_kept_but_the_first_is_the_response(self) -> None:
        self.keyboard.script = [(103.0, "1"), (103.5, "2")]
        record, rows = self.player_for(self.answering_plan(), "none", self.keyboard).play()
        self.assertEqual(rows[1]["response"], "1")
        self.assertEqual([press["key"] for press in record["presses"]], ["1", "2"])

    def test_a_press_outside_the_window_is_recorded_and_answers_nothing(self) -> None:
        keys = TimedKeyboard()
        keys.script = [(100.9, "1")]
        record, rows = self.player_for(self.answering_plan(), "none", keys).play()
        self.assertIsNone(rows[1]["response"])
        self.assertEqual(record["presses"][0]["segment"], 0)

    def test_a_press_before_the_run_is_not_a_response(self) -> None:
        keys = TimedKeyboard()
        keys.script = self.pulses(100.5, 1) + [(100.1, "1")]
        record, rows = self.player_for(self.answering_plan(), "wait", keys).play()
        self.assertEqual(record["presses"], [])
        self.assertIsNone(rows[1]["response"])

    def test_a_press_time_on_another_clock_is_not_believed(self) -> None:
        keys = TimedKeyboard()
        keys.script = [(103.0, "1")]
        real = keys.getKeys
        keys.getKeys = lambda names, waitRelease=False: [Key(key.name, 0.5) for key in real(names)]
        record, rows = self.player_for(self.answering_plan(), "none", keys).play()
        self.assertGreater(rows[1]["response_time"], 0)
        self.assertLess(rows[1]["response_time"], 2)

    def test_rows_go_out_as_they_happen(self) -> None:
        seen: list[int] = []
        player = self.player()
        player.play(lambda row: seen.append(len(player.record["segments"])))
        self.assertEqual(seen, [1, 2])

    def test_a_row_says_its_block(self) -> None:
        the_plan = plan()
        the_plan["segments"][1]["block"] = 0
        _, rows = self.player_for(the_plan, "none", self.keyboard).play()
        self.assertIsNone(rows[0]["block"])
        self.assertEqual(rows[1]["block"], 1)

    def test_being_told_to_stop_ends_the_run_like_escape(self) -> None:
        from fmri_runner.keys import Abort, Keys
        keys = Keys(self.keyboard)
        player = self.player_for(plan(), "none", keys)
        rows: list[dict] = []

        def first_row(row: dict) -> None:
            rows.append(row)
            keys.stop()
        with self.assertRaises(Abort):
            player.play(first_row)
        self.assertEqual(len(rows), 1)
        self.assertTrue(player.record["aborted"])

    def test_a_crash_is_not_recorded_as_finished(self) -> None:
        player = self.player()

        def broken(_row: dict) -> None:
            raise OSError("disk full")
        with self.assertRaises(OSError):
            player.play(broken)
        self.assertTrue(player.record["aborted"])
        self.assertIn("disk full", player.record["error"])

    def test_dropped_frames_are_counted(self) -> None:
        player = self.player()
        self.screen.slow_flips = {5: FRAME * 3}
        record, _ = player.play()
        self.assertEqual(record["dropped_frames"], 1)
        self.assertAlmostEqual(record["worst_frame_ms"], FRAME * 3000, places=3)

    def test_the_between_runs_screen_gives_a_planned_break(self) -> None:
        self.assertNotIn("Break", self.schedule.between_runs(1, 3, "space"))
        self.assertIn("Break: 2 min", self.schedule.between_runs(1, 3, "space", 120))
        self.assertIn("Break: 45 s", self.schedule.between_runs(1, 3, "space", 45))

    def test_a_press_before_the_run_does_not_pause_it(self) -> None:
        self.keyboard.script = [(100.0, "space")]
        record, _ = self.player(("space",)).play()
        self.assertEqual(record["pauses"], [])

    def test_text_is_mirrored_by_its_own_flags_and_placed_where_the_mirror_puts_it(self) -> None:
        # viewScale leaves text alone, so without this it reads normally,
        # unmoved, beside mirrored shapes.
        from fmri_runner import display
        for scale, pos, x_flip, y_flip in (((-1, 1), (-0.3, 0.2), True, False), ((1, -1), (0.3, -0.2), False, True), ((-1, -1), (-0.3, -0.2), True, True)):
            stim = display.text_stim(None, scale, (0.3, 0.2), text="x")
            self.assertEqual(stim.options["pos"], pos)
            self.assertEqual((stim.options["flipHoriz"], stim.options["flipVert"]), (x_flip, y_flip))

    def test_with_no_mirror_text_is_as_it_was(self) -> None:
        from fmri_runner import display
        stim = display.text_stim(None, None, (0.3, 0.2), text="x")
        self.assertEqual(stim.options["pos"], (0.3, 0.2))
        self.assertEqual((stim.options["flipHoriz"], stim.options["flipVert"]), (False, False))

    def test_every_text_a_layer_draws_obeys_the_mirror(self) -> None:
        from fmri_runner import display
        the_plan = plan()
        painter = display.Painter(None, the_plan, (-1, 1))
        layer = {"kind": "text", "text": "x", "height": 0.1, "pos": [0.3, 0.2], "color": "#ffffff"}
        stim = painter.stims([layer])[0]
        self.assertEqual(stim.options["pos"], (-0.3, 0.2))
        self.assertTrue(stim.options["flipHoriz"])

    def finished(self, seen: int, expected: int, dummies: int) -> str:
        player = self.player()
        player.plan["run"] = {"label": "run-01"}
        player.scanner["dummy_volumes"] = dummies
        player.record["pulses"] = {"seen": seen, "expected": expected, "before_t0": dummies}
        return player.summary()

    def test_a_scan_short_by_the_dummies_says_what_that_may_mean(self) -> None:
        self.assertIn("First pulse", self.finished(96, 100, 4))

    def test_a_scan_short_by_something_else_only_warns(self) -> None:
        line = self.finished(80, 100, 4)
        self.assertIn("WARNING", line)
        self.assertNotIn("First pulse", line)

    def test_a_scan_that_matches_says_nothing(self) -> None:
        self.assertNotIn("WARNING", self.finished(100, 100, 4))

    def test_a_plan_with_no_dummies_starts_on_the_first_pulse(self) -> None:
        the_plan = plan()
        the_plan["scanner"]["dummy_volumes"] = 0
        keys = TimedKeyboard()
        keys.script = [(100.5, "5"), (101.5, "5")]
        player = self.player_for(the_plan, "wait", keys, ())
        player.wait_for_scanner()
        self.assertEqual(player.dummy_pulses, 1)
        self.assertEqual(player.t0, 100.5)


if __name__ == "__main__":
    unittest.main()
