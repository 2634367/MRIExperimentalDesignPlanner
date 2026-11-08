"""The Results routes: editors add, read and remove; nobody else sees them."""
from __future__ import annotations

import unittest

from app.models import experiments
from app.tests.route_support import RoutesTestCase
from app.tests.test_designer import doc
from app.tests.test_results import record


class ResultsRoutesTest(RoutesTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.id = experiments.create_experiment(self.store, self.owner.id, doc()).id
        self.base = f"/api/experiments/{self.id}/results"

    def test_add_read_and_remove(self) -> None:
        csrf = self.csrf(self.owner_cookie)
        status, body = self.call("POST", self.base + "/add", cookie=self.owner_cookie, body={"csrf_token": csrf, "records": [record(experiment=self.id)]})
        self.assertEqual((status, body), (200, {"added": 1}))
        status, body = self.call("GET", self.base, cookie=self.owner_cookie)
        self.assertEqual(status, 200)
        self.assertEqual([(r["label"], r["level"]) for r in body["runs"]], [("ses-01_run-01", "ok")])
        name = body["runs"][0]["run"]
        self.assertEqual(self.call("POST", self.base + "/remove", cookie=self.owner_cookie, body={"csrf_token": csrf, "run": name})[0], 200)
        self.assertEqual(self.call("POST", self.base + "/remove", cookie=self.owner_cookie, body={"csrf_token": csrf, "run": name})[0], 404)

    def test_someone_who_cannot_edit_sees_nothing(self) -> None:
        self.assertEqual(self.call("GET", self.base, cookie=self.user_cookie)[0], 404)

    def test_bad_uploads_are_refused(self) -> None:
        csrf = self.csrf(self.owner_cookie)
        self.assertEqual(self.call("POST", self.base + "/add", cookie=self.owner_cookie, body={"csrf_token": csrf, "records": "x"})[0], 400)
        self.assertEqual(self.call("POST", self.base + "/add", cookie=self.owner_cookie, body={"records": []})[0], 403)


if __name__ == "__main__":
    unittest.main()
