"""The designer's server side: who can open an experiment, saves that would
overwrite someone else's, share links, pictures, the run-plan check, the
bundle, and the URL fetcher's refusal to reach private addresses."""
from __future__ import annotations

import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image

from app.core import bundle, db, fetch_image, images
from app.models import experiments, media, plans, share_links, users
from app.models.experiments import NoSuchExperimentError, NotOwnerError, RevisionConflictError
from app.models.share_links import ShareLinkInvalidError


def png(color: tuple[int, int, int] = (200, 0, 0)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (40, 20), color).save(buffer, format="PNG")
    return buffer.getvalue()


def doc(name: str = "Study") -> dict:
    return {"name": name, "format_version": 1}


def plan(media_sha: str | None = None, label: str = "run-01") -> dict:
    layers = [{"kind": "text", "text": "+", "pos": [0, 0], "height": 0.08, "color": "#ffffff"}]
    entries = {}
    if media_sha:
        layers.append({"kind": "image", "media": media_sha, "pos": [0, 0], "height": 0.4})
        entries[media_sha] = {"ext": "png", "w": 40, "h": 20}
    return {
        "format": plans.FORMAT,
        "experiment": {"id": "x", "name": "Study"},
        "run": {"id": "r", "name": "Run", "label": label},
        "participant": "",
        "seed": 1,
        "created": "2026-11-01T00:00:00Z",
        "scanner": {"tr": 2, "trigger_key": "5", "dummy_volumes": 4, "wait": True},
        "display": {"background": "#000000", "text_color": "#ffffff", "font": "Arial"},
        "keys": {"quit": ["escape"], "advance": ["space"]},
        "segments": [
            {"onset": 0, "duration": 2, "kind": "lead_in", "label": "Lead-in", "layers": []},
            {"onset": 2, "duration": 3, "kind": "phase", "label": "Prompt", "trial": 0, "trial_type": "T",
             "phase": "Prompt", "item": "i1", "item_label": "apple", "layers": layers,
             "item_values": {"text": "apple", "answer": "yes"},
             "response": {"keys": ["1", "2"], "ends_phase": False}},
        ],
        "total_seconds": 5,
        "volumes": 7,
        "media": entries,
    }


class DesignerTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.storage = Path(self.directory.name) / "storage"
        self.storage.mkdir()
        self.store = db.Store(Path(self.directory.name) / "app.db", "", False)
        self.store.initialise()
        self.admin = users.create_user(self.store, "Admin", users.ROLE_ADMIN)
        self.alice = users.create_user(self.store, "Alice", users.ROLE_USER)
        self.bob = users.create_user(self.store, "Bob", users.ROLE_USER)

    def tearDown(self) -> None:
        self.directory.cleanup()


class AccessTest(DesignerTestCase):
    def test_only_owner_and_editors_can_open(self) -> None:
        mine = experiments.create_experiment(self.store, self.alice.id, doc())
        self.assertEqual(experiments.experiment_for(self.store, mine.id, self.alice.id).id, mine.id)
        with self.assertRaises(NoSuchExperimentError):
            experiments.experiment_for(self.store, mine.id, self.bob.id)
        # Admin means "decides who gets in", not "reads everyone's work".
        with self.assertRaises(NoSuchExperimentError):
            experiments.experiment_for(self.store, mine.id, self.admin.id)
        experiments.set_editors(self.store, mine.id, self.alice.id, [self.bob.id])
        self.assertEqual(experiments.experiment_for(self.store, mine.id, self.bob.id).id, mine.id)
        self.assertEqual([e.id for e in experiments.list_for_user(self.store, self.bob.id)], [mine.id])

    def test_editors_cannot_change_editors_or_delete(self) -> None:
        mine = experiments.create_experiment(self.store, self.alice.id, doc())
        experiments.set_editors(self.store, mine.id, self.alice.id, [self.bob.id])
        with self.assertRaises(NotOwnerError):
            experiments.set_editors(self.store, mine.id, self.bob.id, [])
        with self.assertRaises(NotOwnerError):
            experiments.delete_experiment(self.store, mine.id, self.bob.id)

    def test_stale_save_is_refused_and_writes_nothing(self) -> None:
        mine = experiments.create_experiment(self.store, self.alice.id, doc("One"))
        experiments.save_doc(self.store, mine.id, self.alice.id, doc("Two"), 1)
        with self.assertRaises(RevisionConflictError) as caught:
            experiments.save_doc(self.store, mine.id, self.alice.id, doc("Three"), 1)
        self.assertEqual(caught.exception.current, 2)
        self.assertEqual(experiments.get_experiment(self.store, mine.id).name, "Two")

    def test_delete_and_restore(self) -> None:
        mine = experiments.create_experiment(self.store, self.alice.id, doc())
        experiments.delete_experiment(self.store, mine.id, self.alice.id)
        self.assertIsNone(experiments.get_experiment(self.store, mine.id))
        experiments.restore_experiment(self.store, mine.id, self.alice.id)
        self.assertIsNotNone(experiments.get_experiment(self.store, mine.id))

    def test_document_needs_name_and_version(self) -> None:
        with self.assertRaises(experiments.BadDocumentError):
            experiments.create_experiment(self.store, self.alice.id, {"name": ""})
        with self.assertRaises(experiments.BadDocumentError):
            experiments.create_experiment(self.store, self.alice.id, {"name": "x"})


class ShareLinkTest(DesignerTestCase):
    def test_link_opens_read_only_until_revoked(self) -> None:
        mine = experiments.create_experiment(self.store, self.alice.id, doc())
        credential, link = share_links.issue_share_link(self.store, mine, "irb", self.alice.id)
        self.assertEqual(share_links.load_shared(self.store, credential)[1].id, mine.id)
        with self.assertRaises(ShareLinkInvalidError):
            share_links.load_shared(self.store, link.id + ".wrong")
        self.assertTrue(share_links.revoke_share_link(self.store, mine.id, link.id))
        with self.assertRaises(ShareLinkInvalidError):
            share_links.load_shared(self.store, credential)

    def test_link_dies_with_its_experiment_and_its_makers_access(self) -> None:
        mine = experiments.create_experiment(self.store, self.alice.id, doc())
        experiments.set_editors(self.store, mine.id, self.alice.id, [self.bob.id])
        credential, _ = share_links.issue_share_link(self.store, mine, "", self.bob.id)
        share_links.load_shared(self.store, credential)
        experiments.set_editors(self.store, mine.id, self.alice.id, [])
        with self.assertRaises(ShareLinkInvalidError):
            share_links.load_shared(self.store, credential)
        own, _ = share_links.issue_share_link(self.store, mine, "", self.alice.id)
        experiments.delete_experiment(self.store, mine.id, self.alice.id)
        with self.assertRaises(ShareLinkInvalidError):
            share_links.load_shared(self.store, own)


class MediaTest(DesignerTestCase):
    def test_picture_is_served_only_through_its_experiments(self) -> None:
        mine = experiments.create_experiment(self.store, self.alice.id, doc())
        theirs = experiments.create_experiment(self.store, self.bob.id, doc())
        stored = media.add_media(self.store, self.storage, png(), mine.id)
        self.assertTrue(media.file_path(self.storage, stored).is_file())
        self.assertIsNotNone(media.media_in(self.store, stored.sha, mine.id))
        self.assertIsNone(media.media_in(self.store, stored.sha, theirs.id))
        # Copying needs the source to have it: a guessed hash moves nothing.
        self.assertEqual(media.attach(self.store, [stored.sha], theirs.id, mine.id), 0)
        copy = experiments.create_experiment(self.store, self.alice.id, doc())
        self.assertEqual(media.attach(self.store, [stored.sha], mine.id, copy.id), 1)
        self.assertIsNotNone(media.media_in(self.store, stored.sha, copy.id))

    def test_same_picture_is_stored_once(self) -> None:
        mine = experiments.create_experiment(self.store, self.alice.id, doc())
        first = media.add_media(self.store, self.storage, png(), mine.id)
        second = media.add_media(self.store, self.storage, png(), mine.id)
        self.assertEqual(first.sha, second.sha)
        self.assertEqual(len(list((self.storage / "media").iterdir())), 1)

    def test_not_a_picture_is_refused(self) -> None:
        with self.assertRaises(images.BadImageError):
            images.inspect(b'<svg xmlns="http://www.w3.org/2000/svg"/>')
        with self.assertRaises(images.BadImageError):
            images.inspect(png()[:30])


class PlanTest(unittest.TestCase):
    def test_a_good_plan_passes(self) -> None:
        plans.check_plans([plan("a" * 64)])
        plans.check_plan({**plan("a" * 64), "break_after": 120, "revision": 7})

    def test_unknown_keys_and_bad_values_are_refused(self) -> None:
        bad = plan()
        bad["segments"][1]["layers"][0]["script"] = "x"
        with self.assertRaises(plans.BadPlanError):
            plans.check_plan(bad)
        bad = plan()
        bad["segments"][1]["layers"][0]["color"] = "red; drop"
        with self.assertRaises(plans.BadPlanError):
            plans.check_plan(bad)
        bad = plan()
        bad["segments"][1]["onset"] = 1
        with self.assertRaises(plans.BadPlanError):
            plans.check_plan(bad)

    def test_item_values_are_column_keys_to_text(self) -> None:
        for values in ({"Answer": "yes"}, {"answer": 1}, {f"c{n}": "x" for n in range(33)}, ["yes"]):
            bad = plan()
            bad["segments"][1]["item_values"] = values
            with self.assertRaises(plans.BadPlanError):
                plans.check_plan(bad)

    def test_pictures_must_be_listed_and_named_by_hash(self) -> None:
        bad = plan("a" * 64)
        bad["media"] = {}
        with self.assertRaises(plans.BadPlanError):
            plans.check_plan(bad)
        bad = plan()
        bad["segments"][1]["layers"].append({"kind": "image", "media": "../../etc/passwd", "pos": [0, 0], "height": 1})
        with self.assertRaises(plans.BadPlanError):
            plans.check_plan(bad)

    def test_labels_must_be_safe_file_names_and_unique(self) -> None:
        with self.assertRaises(plans.BadPlanError):
            plans.check_plans([plan(label="../x")])
        with self.assertRaises(plans.BadPlanError):
            plans.check_plans([plan(), plan()])


class BundleTest(DesignerTestCase):
    def test_bundle_holds_runner_plans_and_pictures(self) -> None:
        mine = experiments.create_experiment(self.store, self.alice.id, doc("My study"))
        stored = media.add_media(self.store, self.storage, png(), mine.id)
        checked = plans.check_plans([plan(stored.sha)])
        data = bundle.build("My study", checked, {stored.filename: media.file_path(self.storage, stored)})
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = set(archive.namelist())
            self.assertIn("my-study/run.sh", names)
            self.assertIn("my-study/runner/fmri_runner/__main__.py", names)
            self.assertIn(f"my-study/media/{stored.filename}", names)
            self.assertEqual(json.loads(archive.read("my-study/plans/run-01.json"))["format"], plans.FORMAT)
            self.assertEqual(archive.getinfo("my-study/run.sh").external_attr >> 16 & 0o777, 0o755)


class FetchTest(unittest.TestCase):
    def test_private_and_odd_addresses_are_refused(self) -> None:
        for url in (
            "http://127.0.0.1/x.png",
            "http://localhost/x.png",
            "http://169.254.169.254/latest/meta-data",
            "http://10.0.0.1/x.png",
            "http://[::1]/x.png",
            "file:///etc/passwd",
            "ftp://example.org/x.png",
            "http://user:pass@example.org/x.png",
            "http://example.org:22/x.png",
        ):
            with self.subTest(url=url):
                with self.assertRaises(fetch_image.FetchError):
                    fetch_image.fetch(url, 1024)


if __name__ == "__main__":
    unittest.main()
