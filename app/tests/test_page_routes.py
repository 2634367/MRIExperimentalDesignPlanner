"""The page's own addresses (app/core/pages.py) serve index.html; every other
path that is not a file is still a 404."""
from __future__ import annotations

import unittest

from app.core import pages
from app.tests.route_support import RoutesTestCase

BROWSER = "text/html,application/xhtml+xml,*/*;q=0.8"


class IsAppPageTests(unittest.TestCase):
    def test_shapes(self) -> None:
        good = ["account", "experiments", "scanners/EPI-TR2000-Task", "logs", "two-factor",
                "fmri-pilot/overview", "fmri-pilot/trials/tt_abc123", "pilot-2/report/", "a/hrf"]
        bad = ["", "nope", "account/x/y", "fmri-pilot", "fmri-pilot/nope", "Bad_Slug/overview",
               "api/overview", "account-x/overview/a/b", "s/overview", "overview/runs", "js/overview",
               "fmri--pilot/overview", "-pilot/overview"]
        for path in good:
            self.assertTrue(pages.is_app_page(path), path)
        for path in bad:
            self.assertFalse(pages.is_app_page(path), path)

    def test_share_screens(self) -> None:
        self.assertTrue(pages.is_share_screen("runs"))
        self.assertTrue(pages.is_share_screen("trials", "tt_1"))
        self.assertFalse(pages.is_share_screen("results"))
        self.assertFalse(pages.is_share_screen("account"))


class PageRouteTests(RoutesTestCase):
    def fetch(self, path: str) -> object:
        return self.client.get(path, headers={"accept": BROWSER})

    def test_app_pages_serve_the_page(self) -> None:
        for path in ["/account", "/experiments", "/scanners/some-card", "/fmri-pilot/overview",
                     "/fmri-pilot/trials/abc", "/s/some-credential/runs", "/s/some-credential/trials/abc"]:
            response = self.fetch(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertIn('id="users-table"', response.text, path)

    def test_share_screens_keep_the_credential_out_of_referers(self) -> None:
        response = self.fetch("/s/some-credential/overview")
        self.assertEqual(response.headers["referrer-policy"], "no-referrer")

    def test_other_paths_are_still_not_found(self) -> None:
        for path in ["/nope", "/account/x/y", "/api-x/nope", "/Bad_Slug/overview", "/fmri/notascreen",
                     "/settings", "/s/some-credential/results", "/s/some-credential/account"]:
            self.assertEqual(self.fetch(path).status_code, 404, path)

    def test_api_and_files_are_unchanged(self) -> None:
        self.assertEqual(self.fetch("/api/nope").json(), {"error": "not found"})
        self.assertEqual(self.client.get("/js/nav.js").status_code, 200)
