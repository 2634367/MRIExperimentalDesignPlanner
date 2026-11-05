"""Small edits: each changes only what it says, keeps ids honest, refuses to
leave a reference pointing at nothing, and survives losing a race."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.core import db
from app.mcp.registry import Call, InvalidArguments
from app.models import actions, experiments, users
from app.models.actions import BadActionError
from app.models.experiments import NoSuchExperimentError, RevisionConflictError


class ActionsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.store = db.Store(Path(self.directory.name) / "app.db", "", False)
        self.store.initialise()
        self.alice = users.create_user(self.store, "Alice", users.ROLE_USER)
        self.bob = users.create_user(self.store, "Bob", users.ROLE_USER)
        self.id = experiments.create_experiment(self.store, self.alice.id, {"name": "Study", "format_version": 1}).id

    def tearDown(self) -> None:
        self.directory.cleanup()

    def act(self, action: str, **args: object) -> dict:
        return actions.run_action(self.store, self.id, self.alice.id, action, args)

    def doc(self) -> dict:
        return experiments.experiment_for(self.store, self.id, self.alice.id).doc

    def test_adding_returns_the_new_id_and_a_new_revision(self) -> None:
        row = self.act("trial.add", fields={"name": "Standard"})
        self.assertTrue(row["id"].startswith("tt_"))
        self.assertEqual(row["revision"], 2)
        self.assertEqual(self.doc()["trial_types"], [{"name": "Standard", "id": row["id"]}])

    def test_nested_things_go_in_their_parent(self) -> None:
        trial = self.act("trial.add", fields={"name": "T"})["id"]
        phase = self.act("phase.add", trial=trial, fields={"name": "P"})["id"]
        self.act("phase.update", trial=trial, id=phase, fields={"modelled": True})
        self.assertEqual(self.doc()["trial_types"][0]["phases"], [{"name": "P", "id": phase, "modelled": True}])

    def test_update_changes_only_the_fields_given(self) -> None:
        run = self.act("run.add", fields={"name": "R", "notes": "n"})["id"]
        self.act("run.update", id=run, fields={"name": "S"})
        self.assertEqual(self.doc()["runs"][0], {"name": "S", "notes": "n", "id": run})

    def test_move_reorders(self) -> None:
        first = self.act("run.add", fields={"name": "A"})["id"]
        self.act("run.add", fields={"name": "B"})
        self.act("run.move", id=first, position=1)
        self.assertEqual([run["name"] for run in self.doc()["runs"]], ["B", "A"])

    def test_something_in_use_cannot_be_deleted(self) -> None:
        list_id = self.act("list.add", fields={"name": "L"})["id"]
        trial = self.act("trial.add", fields={"name": "T", "list": list_id})["id"]
        run = self.act("run.add", fields={"name": "R", "blocks": [{"id": "b", "mix": [{"trial_type": trial, "count": 1}]}]})["id"]
        self.act("session.add", fields={"name": "S", "steps": [{"id": "s", "kind": "run", "run": run}]})
        for action, target in (("list.delete", list_id), ("trial.delete", trial), ("run.delete", run)):
            with self.assertRaisesRegex(BadActionError, "still used"):
                self.act(action, id=target)

    def test_settings_and_the_name(self) -> None:
        self.act("settings.update", section="scanner", fields={"tr": 0.8})
        self.act("experiment.update", fields={"name": "Renamed"})
        self.assertEqual(self.doc()["scanner"], {"tr": 0.8})
        self.assertEqual(self.doc()["name"], "Renamed")

    def test_bad_requests_are_refused_and_change_nothing(self) -> None:
        run = self.act("run.add", fields={"name": "R"})["id"]
        before = self.doc()
        for action, args in (
            ("nonsense.add", {}), ("run.add", {}), ("run.update", {"id": "gone", "fields": {}}),
            ("run.update", {"id": run, "fields": {"id": "x"}}), ("phase.add", {"trial": "gone", "fields": {}}),
            ("run.move", {"id": run, "position": 5}), ("settings.update", {"section": "name", "fields": {}}),
            ("experiment.update", {"fields": {"runs": []}}),
        ):
            with self.subTest(action=action), self.assertRaises(BadActionError):
                self.act(action, **args)
        self.assertEqual(self.doc(), before)

    def test_only_those_who_can_edit_can_act(self) -> None:
        with self.assertRaises(NoSuchExperimentError):
            actions.run_action(self.store, self.id, self.bob.id, "run.add", {"fields": {}})

    def test_losing_a_race_tries_again_on_the_newer_document(self) -> None:
        calls = []

        def racing(store: db.Store, experiment_id: str, user_id: int, doc: dict, revision: int) -> experiments.Experiment:
            if not calls:
                calls.append(1)
                self.act("run.add", fields={"name": "Theirs"})
                raise RevisionConflictError(revision + 1)
            return experiments.save_doc(store, experiment_id, user_id, doc, revision)

        actions.run_action(self.store, self.id, self.alice.id, "run.add", {"fields": {"name": "Mine"}}, save=racing)
        self.assertEqual([run["name"] for run in self.doc()["runs"]], ["Theirs", "Mine"])


class ToolArgumentsTest(unittest.TestCase):
    def call(self, args: dict) -> Call:
        return Call(actor=None, store=None, config=None, request=None, args=args)

    def test_optional_arguments_may_be_left_out(self) -> None:
        bound = self.call({"a": "x"}).bind({"a": str}, optional={"b": int})
        self.assertEqual(bound, {"a": "x"})

    def test_optional_arguments_are_still_checked(self) -> None:
        with self.assertRaises(InvalidArguments):
            self.call({"a": "x", "b": "not a number"}).bind({"a": str}, optional={"b": int})

    def test_a_misspelt_argument_is_still_refused(self) -> None:
        with self.assertRaises(InvalidArguments):
            self.call({"a": "x", "c": 1}).bind({"a": str}, optional={"b": int})

    def test_a_required_argument_is_still_required(self) -> None:
        with self.assertRaises(InvalidArguments):
            self.call({}).bind({"a": str}, optional={"b": int})


if __name__ == "__main__":
    unittest.main()
