"""How each run went: the numbers drawn from a run record, the verdict on
them, and the two ways records reach the Results screen."""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from app.core import db
from app.models import experiments, plans, results
from app.tests.test_designer import doc, plan

LAUNCH_JS = Path(__file__).resolve().parents[2] / "static" / "js" / "launch.js"


def record(label: str = "ses-01_run-01", started: str = "2026-11-05T10:00:00+00:00", experiment: str = "x", **extra: object) -> dict:
    """A finished run in wait mode: four screens, each a few ms late."""
    plan = {
        "experiment": {"id": experiment}, "run": {"label": label}, "participant": "01", "visit": 1, "volumes": 20,
        "total_seconds": 40.0, "segments": [{"kind": "instructions", "layers": []}] + [{"kind": "phase", "layers": [{"x": 1}]}] * 4,
    }
    plan.update(extra.pop("plan", {}))
    out = {
        "plan": plan, "participant": "01", "started": started, "ended": "2026-11-05T10:01:00+00:00",
        "scanner_mode": "wait", "aborted": False, "frame_ms": 16.667, "dropped_frames": 0, "worst_frame_ms": 17.1,
        "segments": [
            {"index": i, "kind": "phase", "label": "p", "planned_onset": i * 10.0, "onset": i * 10.0 + 0.004, "offset": 0, "response": {"key": "1", "rt": 0.5} if i % 2 else None}
            for i in range(4)
        ],
        "pulses": {"seen": 20, "expected": 20, "before_t0": 1}, "pulse_gaps": [], "shown_items": ["a"], "psychopy": "2026.2.2",
        "presses": [], "triggers": [],
    }
    out.update(extra)
    return out


class SummaryTest(unittest.TestCase):
    def test_a_good_run(self) -> None:
        summary = results.summarise(record())
        self.assertEqual((summary["segments"], summary["planned_segments"], summary["responses"]), (4, 4, 2))
        self.assertEqual((summary["onset_error_ms"], summary["worst_onset_ms"]), (4.0, 4.0))
        self.assertEqual((summary["pulses_seen"], summary["pulses_expected"]), (20, 20))
        self.assertEqual(summary["run"], "ses-01_run-01@2026-11-05T10:00:00+00:00")
        self.assertEqual(results.assess(summary), {"level": "ok", "reasons": []})

    def test_previews_are_not_kept_but_pilots_are(self) -> None:
        self.assertIsNone(results.summarise(record(label="trial-Standard")))
        self.assertIsNone(results.summarise({"plan": "nope"}))
        self.assertTrue(results.summarise(record(plan={"pilot_blocks": 2}))["pilot"])

    def test_what_makes_a_run_unusable(self) -> None:
        cases = {
            "stopped": record(aborted=True),
            "failed": record(aborted=True, error="RuntimeError: boom"),
            "paused": record(debug=True, pauses=[{"at": 3.0}]),
            "pulses": record(pulses={"seen": 16, "expected": 20, "before_t0": 1}),
        }
        for reason, run in cases.items():
            verdict = results.assess(results.summarise(run))
            self.assertEqual(verdict["level"], "bad", reason)
            self.assertIn(reason, verdict["reasons"])

    def test_what_is_worth_a_look(self) -> None:
        late = record()
        late["segments"][2]["onset"] += 0.040
        cases = {"late": late, "dropped": record(dropped_frames=3), "pulse_gaps": record(pulse_gaps=[12.0])}
        for reason, run in cases.items():
            self.assertEqual(results.assess(results.summarise(run)), {"level": "check", "reasons": [reason]})

    def test_one_pulse_either_way_is_the_scanner_stopping(self) -> None:
        verdict = results.assess(results.summarise(record(pulses={"seen": 21, "expected": 20, "before_t0": 1})))
        self.assertEqual(verdict["level"], "ok")

    def test_a_record_with_no_end_counts_as_stopped(self) -> None:
        run = record()
        del run["aborted"]
        self.assertIn("stopped", results.assess(results.summarise(run))["reasons"])


def scored_record() -> dict:
    """Four screens: two of type A expecting 1, one of B expecting 2, one
    not scored. A: right in 400 ms, wrong. B: missed."""
    run = record()
    run["plan"]["segments"] = [{"kind": "instructions"}] + [
        {"kind": "phase", "trial_type": "A", "response": {"keys": ["1", "2"], "correct": "1"}},
        {"kind": "phase", "trial_type": "A", "response": {"keys": ["1", "2"], "correct": "1"}},
        {"kind": "phase", "trial_type": "B", "response": {"keys": ["1", "2"], "correct": "2"}},
        {"kind": "phase", "trial_type": "B"},
    ]
    answers = [{"key": "1", "rt": 0.4}, {"key": "2", "rt": 0.6}, None, None]
    for segment, answer in zip(run["segments"], answers):
        segment["response"] = answer
    return run


class ScoreTest(unittest.TestCase):
    def test_answers_are_scored_against_the_expected_key(self) -> None:
        summary = results.summarise(scored_record())
        self.assertEqual({k: summary[k] for k in ("scored", "correct", "missed", "rt_ms_total", "rt_n")},
                         {"scored": 3, "correct": 1, "missed": 1, "rt_ms_total": 400.0, "rt_n": 1})
        self.assertEqual(summary["by_trial_type"]["A"], {"scored": 2, "correct": 1, "missed": 0, "rt_ms_total": 400.0, "rt_n": 1})
        self.assertEqual(summary["by_trial_type"]["B"]["missed"], 1)

    def test_the_runner_s_own_verdict_is_used_when_it_has_one(self) -> None:
        run = scored_record()
        run["plan"]["segments"][1]["response"].pop("correct")
        run["segments"][0]["expected"] = "1"
        self.assertEqual(results.summarise(run)["scored"], 3)

    def test_screens_never_shown_are_not_scored(self) -> None:
        run = scored_record()
        run["segments"] = run["segments"][:1]
        self.assertEqual(results.summarise(run)["scored"], 1)

    def test_a_plan_may_carry_the_expected_key(self) -> None:
        good = plan()
        good["segments"][1]["response"]["correct"] = "1"
        plans.check_plans([good])
        good["segments"][1]["response"]["correct"] = "not a key"
        with self.assertRaises(plans.BadPlanError):
            plans.check_plans([good])

    def test_a_design_without_expected_keys_scores_nothing(self) -> None:
        self.assertEqual(results.summarise(record())["scored"], 0)


class StoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = db.Store(Path(self.directory.name) / "app.db", "", False)
        self.store.initialise()

    def test_records_are_kept_once_newest_first(self) -> None:
        older, newer = record(started="2026-11-05T09:00:00+00:00"), record(started="2026-11-05T11:00:00+00:00")
        self.assertEqual(results.add_records(self.store, "x", [older, newer]), 2)
        self.assertEqual(results.add_records(self.store, "x", [newer]), 0)
        self.assertEqual([r["started"] for r in results.read(self.store, "x")], [newer["started"], older["started"]])
        self.assertEqual(results.read(self.store, "x")[0]["level"], "ok")

    def test_records_from_another_experiment_are_skipped(self) -> None:
        self.assertEqual(results.add_records(self.store, "x", [record(experiment="y")]), 0)
        with self.assertRaises(results.BadRecordError):
            results.add_records(self.store, "x", "not a list")

    def test_a_launch_folder_is_read_and_sidecars_skipped(self) -> None:
        start = Path(self.directory.name) / "data" / "20261105T100000"
        start.mkdir(parents=True)
        (start / "sub-01_run-01.json").write_text(json.dumps(record()), encoding="utf-8")
        (start / "sub-01_run-01_events.json").write_text(json.dumps({"onset": {"Units": "s"}}), encoding="utf-8")
        (start / "broken.json").write_text("{", encoding="utf-8")
        self.assertEqual(results.add_folder(self.store, "x", start.parent), 1)

    def test_a_finished_launch_feeds_seen_and_results(self) -> None:
        from app.models import seen
        from app.routes.psychopy import _collect
        start = Path(self.directory.name) / "data" / "20261105T100000"
        start.mkdir(parents=True)
        (start / "sub-01_run-01.json").write_text(json.dumps(record()), encoding="utf-8")
        _collect(self.store, "x", start.parent)
        self.assertEqual(len(results.read(self.store, "x")), 1)
        self.assertEqual(seen.read(self.store, "x", "01")["runs"], 1)

    def test_a_run_can_be_removed(self) -> None:
        results.add_records(self.store, "x", [record()])
        name = results.read(self.store, "x")[0]["run"]
        self.assertTrue(results.remove(self.store, "x", name))
        self.assertFalse(results.remove(self.store, "x", name))
        self.assertEqual(results.read(self.store, "x"), [])

    def test_results_for_a_gone_experiment_go(self) -> None:
        live = experiments.create_experiment(self.store, 1, doc())
        results.add_records(self.store, live.id, [record(experiment=live.id)])
        results.add_records(self.store, "gone", [record(experiment="gone")])
        self.assertEqual(results.purge_orphans(self.store), 1)
        self.assertEqual(len(results.read(self.store, live.id)), 1)


@unittest.skipUnless(shutil.which("node"), "needs node")
class TrimTest(unittest.TestCase):
    """The run dialog sends a trimmed record; it must summarise exactly like
    the whole one, or uploads and local launches would disagree."""

    def trim(self, run: dict) -> dict:
        script = (
            "const fs = require('fs'); const vm = require('vm'); const ctx = vm.createContext({});"
            f"vm.runInContext(fs.readFileSync({json.dumps(str(LAUNCH_JS))}, 'utf8') + ';this.RunDialog = RunDialog;', ctx);"
            "process.stdout.write(JSON.stringify(ctx.RunDialog.trimRecord(JSON.parse(fs.readFileSync(0, 'utf8')))));"
        )
        done = subprocess.run(["node", "-e", script], input=json.dumps(run), capture_output=True, text=True, timeout=30, check=True)
        return json.loads(done.stdout)

    def test_trimmed_and_whole_records_agree(self) -> None:
        late = record(dropped_frames=2, debug=True, pauses=[{"at": 1.0}], flip="horizontal", plan={"pilot_blocks": 1})
        late["segments"][1]["onset"] += 0.03
        for run in (record(), late, record(aborted=True, error="x"), scored_record()):
            trimmed = self.trim(run)
            self.assertNotIn("shown_items", trimmed)
            self.assertEqual(results.summarise(trimmed), results.summarise(run))

    def test_previews_are_not_sent(self) -> None:
        self.assertIsNone(self.trim(record(label="trial-x")))


if __name__ == "__main__":
    unittest.main()
