"""Scanner cards through the API tools, what a page follows, the report's
acquisition and identity, and the runner's mirror."""
from __future__ import annotations

import io
import json
import subprocess
import sys
import tempfile
import types
import unittest
import zipfile
from pathlib import Path
from unittest import mock

from openpyxl import load_workbook

from app.core import bundle, db, psychopy, report
from app.core.psychopy import RUNNER_DIR
from app.mcp.registry import Call, Refusal, Registry
from app.models import experiments, plans, published, scanner_cards, share_links, users
from app.models.experiments import NoSuchExperimentError
from app.models.plans import BadPlanError
from app.models.scanner_cards import BadCardError
from app.models.share_links import ShareLinkInvalidError
from app.routes import mcp_tools_experiments, mcp_tools_scanners
from app.routes.experiments import revision_row
from app.routes.share import _revision

sys.path.insert(0, str(RUNNER_DIR))
from fmri_runner import __main__ as runner  # noqa: E402


def card(label: str = "EPI") -> dict:
    return {"label": label, "role": "functional", "note": "", "pages": [
        {"name": "CONTRAST", "rows": [{"parameter": "Flip angle (deg)", "value": "90", "indent": 0}]},
    ]}


class StoreTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = db.Store(Path(self.directory.name) / "app.db", "", False)
        self.store.initialise()
        self.alice = users.create_user(self.store, "Alice", users.ROLE_USER)
        self.bob = users.create_user(self.store, "Bob", users.ROLE_USER)


class ScannerToolsTest(StoreTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.registry = Registry()
        mcp_tools_scanners.register(self.registry)
        self.actor = types.SimpleNamespace(user=self.alice)

    def call(self, function, **args: object) -> dict:
        return function(Call(actor=self.actor, store=self.store, config=None, request=None, args=args))

    def make(self) -> str:
        return self.call(mcp_tools_scanners.create_scanner_card, card=card())["id"]

    def test_a_card_can_be_made_read_and_listed(self) -> None:
        card_id = self.make()
        self.assertEqual(self.call(mcp_tools_scanners.get_scanner_card, card_id=card_id)["pages"][0]["name"], "CONTRAST")
        listed = self.call(mcp_tools_scanners.list_scanner_cards)["cards"]
        self.assertEqual([row["id"] for row in listed], [card_id])
        self.assertNotIn("pages", listed[0])

    def test_saving_needs_the_revision_it_came_from(self) -> None:
        card_id = self.make()
        current = self.call(mcp_tools_scanners.get_scanner_card, card_id=card_id)
        self.call(mcp_tools_scanners.save_scanner_card, card_id=card_id, card=card("Renamed"), base_revision=current["revision"])
        with self.assertRaises(Refusal):
            self.call(mcp_tools_scanners.save_scanner_card, card_id=card_id, card=card("Again"), base_revision=current["revision"])

    def test_one_parameter_changes_and_the_rest_stay(self) -> None:
        card_id = self.make()
        self.call(mcp_tools_scanners.set_scanner_parameter, card_id=card_id, page="CONTRAST", parameter="flip angle (DEG)", value="80")
        row = self.call(mcp_tools_scanners.get_scanner_card, card_id=card_id)["pages"][0]["rows"][0]
        self.assertEqual((row["parameter"], row["value"]), ("Flip angle (deg)", "80"))

    def test_a_change_is_backed_up(self) -> None:
        card_id = self.make()
        self.call(mcp_tools_scanners.set_scanner_parameter, card_id=card_id, page="CONTRAST", parameter="Flip angle (deg)", value="80")
        self.assertEqual(len(scanner_cards.list_backups(self.store, card_id)), 1)

    def test_a_parameter_that_is_not_there_is_refused(self) -> None:
        card_id = self.make()
        for page, parameter in (("CONTRAST", "Nothing"), ("NOWHERE", "Flip angle (deg)")):
            with self.assertRaises(Refusal):
                self.call(mcp_tools_scanners.set_scanner_parameter, card_id=card_id, page=page, parameter=parameter, value="1")

    def test_a_bad_card_or_a_missing_one_is_refused(self) -> None:
        with self.assertRaises(Refusal):
            self.call(mcp_tools_scanners.create_scanner_card, card={"label": "x"})
        with self.assertRaises(Refusal):
            self.call(mcp_tools_scanners.get_scanner_card, card_id="none")

    def test_nothing_deletes_a_card(self) -> None:
        names = list(self.registry._tools)
        self.assertEqual(len(names), 8)
        # Restoring a backup only puts an earlier version back; nothing deletes a card.
        self.assertFalse([name for name in names if "delete" in name or ("restore" in name and name != "restore_scanner_card_backup")])

    def test_a_parameter_change_survives_losing_a_race(self) -> None:
        card_id = self.make()
        real = scanner_cards.save_card
        calls = []

        def racing(store, target, user_id, content, base_revision):
            calls.append(base_revision)
            if len(calls) == 1:
                real(store, target, self.bob.id, card("Theirs"), base_revision)
            return real(store, target, user_id, content, scanner_cards.get_card(store, target).revision if len(calls) > 1 else base_revision)

        with mock.patch.object(scanner_cards, "save_card", racing):
            saved = scanner_cards.set_parameter(self.store, card_id, self.alice.id, "CONTRAST", "Flip angle (deg)", "70")
        self.assertEqual(len(calls), 2)
        self.assertEqual(saved.card["pages"][0]["rows"][0]["value"], "70")
        self.assertEqual(saved.card["label"], "Theirs")

    def test_set_parameter_needs_the_page_it_names(self) -> None:
        with self.assertRaises(BadCardError):
            scanner_cards.set_parameter(self.store, self.make(), self.alice.id, "X", "Y", "1")


class FollowingTest(StoreTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.experiment = experiments.create_experiment(self.store, self.alice.id, {"name": "Study", "format_version": 3})

    def test_a_save_moves_the_revision(self) -> None:
        before = revision_row(self.store, self.experiment.id, self.alice.id)["revision"]
        experiments.save_doc(self.store, self.experiment.id, self.alice.id, {"name": "New", "format_version": 3}, before)
        self.assertEqual(revision_row(self.store, self.experiment.id, self.alice.id)["revision"], before + 1)

    def test_it_says_who_when_it_was_someone_else(self) -> None:
        experiments.set_editors(self.store, self.experiment.id, self.alice.id, [self.bob.id])
        experiments.save_doc(self.store, self.experiment.id, self.bob.id, {"name": "New", "format_version": 3}, self.experiment.revision)
        self.assertEqual(revision_row(self.store, self.experiment.id, self.alice.id)["updated_by_name"], "Bob")
        self.assertEqual(revision_row(self.store, self.experiment.id, self.bob.id)["updated_by_name"], "")

    def test_a_deleted_experiment_stops_answering(self) -> None:
        experiments.delete_experiment(self.store, self.experiment.id, self.alice.id)
        with self.assertRaises(NoSuchExperimentError):
            revision_row(self.store, self.experiment.id, self.alice.id)

    def test_someone_who_cannot_open_it_learns_nothing(self) -> None:
        with self.assertRaises(NoSuchExperimentError):
            revision_row(self.store, self.experiment.id, self.bob.id)

    def test_a_share_link_follows_until_it_is_revoked(self) -> None:
        credential, link = share_links.issue_share_link(self.store, self.experiment, "", self.alice.id)
        self.assertEqual(_revision(self.store, credential)["revision"], self.experiment.revision)
        share_links.revoke_share_link(self.store, self.experiment.id, link.id)
        with self.assertRaises(ShareLinkInvalidError):
            _revision(self.store, credential)

    def test_card_revisions_show_a_change(self) -> None:
        made = scanner_cards.create_card(self.store, self.alice.id, card())
        before = scanner_cards.revisions(self.store)
        scanner_cards.set_parameter(self.store, made.id, self.alice.id, "CONTRAST", "Flip angle (deg)", "80")
        self.assertEqual(scanner_cards.revisions(self.store)[made.id], before[made.id] + 1)


class ReportTest(StoreTestCase):
    DOC = {"name": "Study", "format_version": 3, "meta": {"investigator": "A. Person", "institution": "Uni", "design_id": ""}}

    def checked(self, **extra: object) -> report.Report:
        return report.check_report({"tables": [{"id": "t", "title": "T", "columns": ["a"], "rows": [[1]]}], "methods": "m", "figures": [], **extra})

    def test_only_the_cards_a_design_uses_come_along(self) -> None:
        used = scanner_cards.create_card(self.store, self.alice.id, card("Used"))
        scanner_cards.create_card(self.store, self.alice.id, card("Other"))
        doc = {"runs": [{"card": {"id": used.id}}, {"card": None}], "sessions": [{"steps": [{"card": {"id": "deleted"}}, {"card": {"id": used.id}}]}]}
        self.assertEqual([row["label"] for row in scanner_cards.used_by(self.store, doc)], ["Used"])

    def test_the_zip_and_workbook_hold_each_card(self) -> None:
        cards = [scanner_cards.create_card(self.store, self.alice.id, card()).to_row()]
        archive = zipfile.ZipFile(io.BytesIO(report.build("Study", self.DOC, self.checked(), cards)))
        self.assertEqual(json.loads(archive.read("scanner-cards/epi.json"))["label"], "EPI")
        self.assertIn("scanner-cards/", archive.read("README.txt").decode())
        book = load_workbook(io.BytesIO(archive.read("report.xlsx")))
        sheet = book["Card EPI"]
        self.assertEqual([cell.value for cell in sheet[2]], ["CONTRAST", "Flip angle (deg)", "90"])

    def test_no_cards_means_no_folder(self) -> None:
        archive = zipfile.ZipFile(io.BytesIO(report.build("Study", self.DOC, self.checked())))
        self.assertFalse([name for name in archive.namelist() if name.startswith("scanner-cards")])

    def test_each_export_says_who_it_is(self) -> None:
        archive = zipfile.ZipFile(io.BytesIO(report.build("Study", self.DOC, self.checked())))
        for name in ("README.txt", "report.md"):
            text = archive.read(name).decode()
            self.assertIn("Investigator: A. Person", text)
            self.assertIn("Institution: Uni", text)
            self.assertNotIn("Design ID", text)
        summary = load_workbook(io.BytesIO(archive.read("report.xlsx")))["Summary"]
        self.assertEqual(summary["A3"].value, "Investigator: A. Person")
        self.assertEqual(summary["A6"].value, "Sheet")

    def test_a_design_with_no_identity_is_unchanged(self) -> None:
        self.assertEqual(report.identity({"name": "x"}), [])
        self.assertEqual(report.identity({"meta": "nonsense"}), [])


class PlanTest(unittest.TestCase):
    def plan(self, **scanner: object) -> dict:
        from app.tests.test_designer import plan
        built = plan()
        built["scanner"].update(scanner)
        return built

    def test_a_plan_may_say_which_pulse_it_starts_on(self) -> None:
        plans.check_plan(self.plan(t0="first_pulse", dummy_volumes=0))
        plans.check_plan(self.plan(t0="after_dummies", dummy_volumes=5))

    def test_any_other_t0_is_refused(self) -> None:
        with self.assertRaises(BadPlanError):
            plans.check_plan(self.plan(t0="whenever"))


class DocsTest(unittest.TestCase):
    """The flags were only in --help, and the tools only in the code. A new one
    has to reach the docs, or this fails."""

    ROOT = RUNNER_DIR.parent

    def test_every_runner_flag_is_in_the_readme(self) -> None:
        readme = (self.ROOT / "README.md").read_text(encoding="utf-8")
        parser = {}
        real = runner.argparse.ArgumentParser.parse_args
        with mock.patch.object(runner.argparse.ArgumentParser, "parse_args", lambda self, argv: parser.setdefault("it", self) and real(self, argv)):
            runner.arguments(["plan.json"])
        flags = [flag for action in parser["it"]._actions for flag in action.option_strings if flag.startswith("--")]
        self.assertGreater(len(flags), 20)
        self.assertEqual([flag for flag in flags if flag not in readme and flag != "--help"], [])

    def test_every_tool_is_in_the_api_document(self) -> None:
        api = (self.ROOT / "API.md").read_text(encoding="utf-8")
        registry = Registry()
        mcp_tools_scanners.register(registry)
        mcp_tools_experiments.register(registry)
        self.assertEqual([name for name in registry._tools if name not in api], [])

    def test_the_documents_link_to_each_other(self) -> None:
        readme = (self.ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("(TUTORIAL.md)", readme)
        self.assertIn("(API.md)", readme)


class RunnerFlagsTest(unittest.TestCase):
    def test_fetch_flags_with_nothing_to_fetch_are_refused(self) -> None:
        for flags in (["--list"], ["--only", "ses-01"], ["--key-file", "k.txt"], ["--mirror", "elsewhere"]):
            with mock.patch("sys.stderr", io.StringIO()), self.assertRaises(SystemExit):
                runner.arguments(["plan.json", *flags])

    def test_they_still_work_when_fetching(self) -> None:
        args = runner.arguments(["--offline", "--experiment", "x", "--list", "--only", "ses-01", "--mirror", "elsewhere"])
        self.assertTrue(args.list)

    def plan(self, blocks: int, **scanner: object) -> dict:
        segments = [{"kind": "phase", "block": block, "onset": block * 2.0, "duration": 2.0} for block in range(blocks)]
        return {"segments": segments, "_path": "p", "scanner": {"tr": 1.0, "dummy_volumes": 4, **scanner}, "total_seconds": blocks * 2.0, "volumes": 0}

    def test_a_pilot_of_a_short_run_is_still_a_pilot(self) -> None:
        args = runner.arguments(["p.json", "--pilot"])
        self.assertEqual(runner.shortened([self.plan(1)], args)[0]["pilot_blocks"], 2)

    def test_a_pilot_that_cuts_keeps_what_it_kept(self) -> None:
        args = runner.arguments(["p.json", "--pilot", "--blocks", "1"])
        self.assertEqual(runner.shortened([self.plan(3)], args)[0]["pilot_blocks"], 1)

    def test_a_whole_run_asked_for_by_blocks_is_a_whole_run(self) -> None:
        args = runner.arguments(["p.json", "--blocks", "5"])
        self.assertNotIn("pilot_blocks", runner.shortened([self.plan(3)], args)[0])

    def test_shortening_counts_volumes_as_compile_does(self) -> None:
        args = runner.arguments(["p.json", "--blocks", "1"])
        self.assertEqual(runner.shortened([self.plan(3)], args)[0]["volumes"], 6)
        self.assertEqual(runner.shortened([self.plan(3, dummy_volumes=5, t0="after_dummies")], args)[0]["volumes"], 6)


class BundleScriptTest(unittest.TestCase):
    """run.sh, run for real, with a python3 that only says what it was given."""

    def run_script(self, *flags: str) -> list[str]:
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / "run.sh").write_text(bundle.RUN_SH, encoding="utf-8")
            (folder / "plans").mkdir()
            (folder / "plans" / "run-01.json").write_text("{}", encoding="utf-8")
            (folder / "bin").mkdir()
            fake = folder / "bin" / "python3"
            fake.write_text('#!/bin/sh\nif [ "$1" = "-c" ]; then exit 0; fi\nfor a in "$@"; do echo "$a"; done\n', encoding="utf-8")
            fake.chmod(0o755)
            result = subprocess.run(["bash", str(folder / "run.sh"), *flags], capture_output=True, text=True, check=True,
                                    env={"PATH": f"{folder / 'bin'}:/usr/bin:/bin"})
            return result.stdout.split()

    def test_plain_it_plays_the_bundle(self) -> None:
        said = self.run_script("--windowed")
        self.assertIn("plans/run-01.json", said)
        self.assertEqual(said[said.index("--media") + 1], "media")
        self.assertIn("--windowed", said)

    def test_with_no_flags_it_still_runs(self) -> None:
        self.assertIn("plans/run-01.json", self.run_script())

    def test_a_chosen_plan_is_the_only_one(self) -> None:
        said = self.run_script("plans/other.json")
        self.assertIn("plans/other.json", said)
        self.assertNotIn("plans/run-01.json", said)

    def test_fetching_leaves_out_the_bundles_plans_and_pictures(self) -> None:
        said = self.run_script("--planner", "https://x", "--experiment", "e", "--key-file", "k", "--only", "ses-01")
        self.assertNotIn("plans/run-01.json", said)
        self.assertNotIn("--media", said)
        self.assertEqual(runner.arguments(said[2:]).planner, "https://x")

    def test_the_same_goes_for_offline(self) -> None:
        self.assertNotIn("plans/run-01.json", self.run_script("--offline", "--experiment", "e"))


class PublishedFiguresTest(unittest.TestCase):
    def test_two_names_with_one_slug_both_survive(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / "figures").mkdir()
            published.add_figure(folder, {"name": "Trial: A", "svg": "<svg>1</svg>"})
            published.add_figure(folder, {"name": "Trial A", "svg": "<svg>2</svg>"})
            texts = sorted(path.read_text(encoding="utf-8") for path in (folder / "figures").glob("*.svg"))
            self.assertEqual(texts, ["<svg>1</svg>", "<svg>2</svg>"])


class MirrorTest(unittest.TestCase):
    def test_no_flip_is_the_default(self) -> None:
        self.assertEqual(runner.arguments(["plan.json"]).flip, "none")
        self.assertIsNone(runner.FLIPS["none"])

    def test_each_way_scales_the_view(self) -> None:
        self.assertEqual(runner.FLIPS["horizontal"], (-1, 1))
        self.assertEqual(runner.FLIPS["vertical"], (1, -1))
        self.assertEqual(runner.FLIPS["both"], (-1, -1))

    def test_a_way_that_does_not_exist_is_refused(self) -> None:
        with mock.patch("sys.stderr", io.StringIO()), self.assertRaises(SystemExit):
            runner.arguments(["plan.json", "--flip", "sideways"])

    def test_the_launcher_offers_the_same_ways(self) -> None:
        self.assertEqual(set(psychopy.FLIPS), set(runner.FLIPS))
