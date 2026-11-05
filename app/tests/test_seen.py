"""What counts as seen: only what a run record says reached the screen, once,
and never a preview."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.core import db
from app.models import seen


def record(participant: str = "01", label: str = "ses-01_run-01", items: tuple = ("a", "b"), **plan: object) -> dict:
    return {
        "participant": participant, "started": "2026-11-05T10:00:00+00:00", "shown_items": list(items),
        "plan": {"experiment": {"id": "x"}, "run": {"label": label}, "participant": participant, **plan},
    }


class SeenTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.store = db.Store(Path(self.directory.name) / "app.db", "", False)
        self.store.initialise()

    def tearDown(self) -> None:
        self.directory.cleanup()

    def test_a_run_adds_its_items_and_visit_once(self) -> None:
        summary = seen.summarise(record(visit=2))
        self.assertTrue(seen.add_run(self.store, "x", summary))
        self.assertFalse(seen.add_run(self.store, "x", summary))
        self.assertEqual(seen.read(self.store, "x", "01"), {"items": ["a", "b"], "runs": 1, "highest_visit": 2})

    def test_participants_and_experiments_stay_apart(self) -> None:
        seen.add_run(self.store, "x", seen.summarise(record()))
        self.assertEqual(seen.read(self.store, "x", "02")["items"], [])
        self.assertEqual(seen.read(self.store, "y", "01")["items"], [])

    def test_previews_do_not_count(self) -> None:
        self.assertIsNone(seen.summarise(record(label="trial-Standard")))
        self.assertIsNone(seen.summarise(record(pilot_blocks=2)))
        self.assertIsNone(seen.summarise(record(participant="")))

    def test_a_finished_launch_folder_is_read(self) -> None:
        folder = Path(self.directory.name) / "data"
        folder.mkdir()
        (folder / "good.json").write_text(json.dumps(record()), encoding="utf-8")
        (folder / "other.json").write_text(json.dumps(record(label="run-02", experiment={"id": "y"})), encoding="utf-8")
        (folder / "broken.json").write_text("{", encoding="utf-8")
        self.assertEqual(seen.add_folder(self.store, "x", folder), 1)
        self.assertEqual(seen.read(self.store, "x", "01")["runs"], 1)

    def test_records_in_a_folder_per_start_are_read_and_sidecars_skipped(self) -> None:
        folder = Path(self.directory.name) / "data"
        start = folder / "20261105T120000"
        start.mkdir(parents=True)
        (start / "sub-01_run-01.json").write_text(json.dumps(record()), encoding="utf-8")
        (start / "sub-01_run-01_events.json").write_text(json.dumps({"onset": {"Units": "s"}}), encoding="utf-8")
        self.assertEqual(seen.add_folder(self.store, "x", folder), 1)

    def test_uploads_for_another_experiment_are_ignored(self) -> None:
        self.assertEqual(seen.add_runs(self.store, "y", [seen.summarise(record())]), 0)

    def test_bad_uploads_are_refused(self) -> None:
        for bad in ({"participant": "", "run": "r", "items": [], "visit": 0},
                    {"participant": "p", "run": "r", "items": [1], "visit": 0},
                    {"participant": "p", "run": "r", "items": [], "visit": "1"}):
            with self.assertRaises(seen.BadRunError):
                seen.add_runs(self.store, "x", [bad])


if __name__ == "__main__":
    unittest.main()
