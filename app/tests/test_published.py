"""Publishing: what readers are served only changes when a publish finishes,
a path can only be something published, and a runner can fetch it and run
from its copy when the designer cannot be reached."""
from __future__ import annotations

import base64
import http.server
import io
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path

from PIL import Image

from app.core import db
from app.core.psychopy import RUNNER_DIR
from app.models import experiments, published, users
from app.models.published import BadPublishError, NothingPublishedError
from app.tests.test_designer import doc, plan

sys.path.insert(0, str(RUNNER_DIR))
from fmri_runner import __main__ as runner, fetch  # noqa: E402


def png() -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), (1, 2, 3)).save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()


# With the XML declaration Charts.serialize writes.
FIGURE = {"name": "Run 1", "svg": "<?xml version='1.0'?>\n<svg xmlns='http://www.w3.org/2000/svg'></svg>", "png": png()}


class PublishTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.store = db.Store(self.root / "app.db", "", False)
        self.store.initialise()
        self.alice = users.create_user(self.store, "Alice", users.ROLE_USER)
        self.experiment = experiments.create_experiment(self.store, self.alice.id, doc())

    def tearDown(self) -> None:
        self.directory.cleanup()

    def publish(self, label: str = "run-01", finish: bool = True) -> str:
        version = published.begin(self.store, self.root, self.experiment.id)
        published.add_parts(self.root, self.experiment.id, version, [plan(label=label)], [FIGURE])
        if finish:
            published.finish(self.store, self.root, self.experiment, self.alice.id, version, 7)
        return version

    def test_a_finished_publish_is_served(self) -> None:
        self.publish()
        record = published.manifest(self.store, self.experiment.id)
        self.assertEqual([row["label"] for row in record["plans"]], ["run-01"])
        self.assertEqual(record["figures"], ["run-1.png", "run-1.svg"])
        self.assertEqual(record["seed"], 7)
        self.assertTrue(published.file_path(self.store, self.root, self.experiment.id, "plans", "run-01.json").is_file())

    def test_an_unfinished_publish_changes_nothing(self) -> None:
        self.publish("run-01")
        self.publish("run-02", finish=False)
        self.assertEqual([row["label"] for row in published.manifest(self.store, self.experiment.id)["plans"]], ["run-01"])
        self.assertTrue(published.file_path(self.store, self.root, self.experiment.id, "plans", "run-01.json").is_file())

    def test_the_next_publish_replaces_the_last(self) -> None:
        self.publish("run-01")
        self.publish("run-02")
        with self.assertRaises(NothingPublishedError):
            published.file_path(self.store, self.root, self.experiment.id, "plans", "run-01.json")
        folders = list((self.root / "published" / self.experiment.id).iterdir())
        self.assertEqual(len(folders), 1)

    def test_a_path_can_only_be_something_published(self) -> None:
        self.publish()
        for kind, name in (("plans", "../../app.db"), ("figures", "../plans/run-01.json"), ("plans", "other.json")):
            with self.assertRaises(NothingPublishedError):
                published.file_path(self.store, self.root, self.experiment.id, kind, name)

    def test_a_made_up_version_is_refused(self) -> None:
        for version in ("../../x", "short", ""):
            with self.assertRaises(BadPublishError):
                published.add_parts(self.root, self.experiment.id, version, [], [])

    def test_a_figure_must_be_what_it_says(self) -> None:
        version = published.begin(self.store, self.root, self.experiment.id)
        for bad in ({"name": "x", "svg": "<script>"}, {"name": "x", "svg": "<svg/>", "png": base64.b64encode(b"nope").decode()}):
            with self.assertRaises(BadPublishError):
                published.add_parts(self.root, self.experiment.id, version, [], [bad])

    def test_nothing_published_for_a_gone_experiment_stays(self) -> None:
        self.publish()
        self.store.delete(db.BUCKET_EXPERIMENTS, self.experiment.id)
        self.assertEqual(published.purge_orphans(self.store, self.root), 1)
        self.assertFalse((self.root / "published" / self.experiment.id).exists())


class FakeDesigner(http.server.BaseHTTPRequestHandler):
    """Answers like the published routes, for the right key only."""
    pages: dict[str, bytes] = {}

    def do_GET(self) -> None:  # noqa: N802
        if self.headers.get("Authorization") != "Bearer good-key":
            self.send_response(401)
            self.end_headers()
            return
        body = self.pages.get(self.path)
        self.send_response(200 if body is not None else 404)
        self.end_headers()
        self.wfile.write(body or b"")

    def log_message(self, *args: object) -> None:
        pass


class RunnerFetchTest(unittest.TestCase):
    SHA = "a" * 64

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeDesigner)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        run = plan(label="ses-01_run-01")
        run["media"] = {self.SHA: {"ext": "png", "w": 1, "h": 1}}
        base = "/api/experiments/x"
        FakeDesigner.pages = {
            base + "/published": json.dumps({"published_at": "then", "revision": 3, "plans": [
                {"label": "ses-01_run-01", "name": "One", "media": run["media"]}, {"label": "run-01", "name": "Two", "media": {}},
            ]}).encode(),
            base + "/published/plans/ses-01_run-01.json": json.dumps(run).encode(),
            base + "/published/plans/run-01.json": json.dumps(plan(label="run-01")).encode(),
            base + f"/media/{self.SHA}.png": b"picture",
        }
        self.key = self.root / "key.txt"
        self.key.write_text("good-key\n", encoding="utf-8")
        self.mirror = self.root / "mirror"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.directory.cleanup()

    def args(self, *extra: str) -> list[str]:
        return ["--planner", self.url, "--experiment", "x", "--key-file", str(self.key), "--mirror", str(self.mirror), *extra]

    def test_fetching_mirrors_plans_and_pictures(self) -> None:
        self.assertEqual(runner.main(self.args("--only", "ses-01", "--check")), 0)
        self.assertEqual((self.mirror / "x" / "media" / f"{self.SHA}.png").read_bytes(), b"picture")
        self.assertTrue((self.mirror / "x" / "plans" / "run-01.json").is_file())

    def test_a_run_must_be_named(self) -> None:
        self.assertEqual(runner.main(self.args("--check")), 2)

    def test_no_network_runs_the_last_copy(self) -> None:
        runner.main(self.args("--only", "ses-01", "--check"))
        args = ["--planner", "http://127.0.0.1:9", "--experiment", "x", "--key-file", str(self.key), "--mirror", str(self.mirror), "--only", "ses-01", "--check"]
        self.assertEqual(runner.main(args), 0)

    def test_no_network_and_no_copy_says_so(self) -> None:
        args = ["--planner", "http://127.0.0.1:9", "--experiment", "x", "--key-file", str(self.key), "--mirror", str(self.mirror), "--only", "x", "--check"]
        self.assertEqual(runner.main(args), 2)

    def test_offline_needs_no_key_and_no_network(self) -> None:
        runner.main(self.args("--only", "ses-01", "--check"))
        self.assertEqual(runner.main(["--offline", "--experiment", "x", "--mirror", str(self.mirror), "--only", "run-01", "--check"]), 0)

    def test_a_refused_key_is_not_retried_as_a_network_failure_with_no_copy(self) -> None:
        self.key.write_text("bad", encoding="utf-8")
        self.assertEqual(runner.main(self.args("--only", "ses-01", "--check")), 2)

    def test_a_failed_fetch_leaves_the_old_copy_whole(self) -> None:
        runner.main(self.args("--only", "ses-01", "--check"))
        del FakeDesigner.pages["/api/experiments/x/published/plans/run-01.json"]
        with self.assertRaises(fetch.FetchError):
            fetch.mirror(self.url, "x", "good-key", self.mirror / "x")
        self.assertTrue((self.mirror / "x" / "plans" / "run-01.json").is_file())
        self.assertFalse((self.mirror / "x.new").exists())

    def test_a_manifest_cannot_name_a_path_outside_the_mirror(self) -> None:
        FakeDesigner.pages["/api/experiments/x/published"] = json.dumps({"plans": [{"label": "../evil"}]}).encode()
        with self.assertRaises(fetch.FetchError):
            fetch.mirror(self.url, "x", "good-key", self.mirror / "x")


if __name__ == "__main__":
    unittest.main()
