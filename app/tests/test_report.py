"""The report download: what the zip holds, that the workbook opens, who may
have one, and what is refused."""
from __future__ import annotations

import base64
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from openpyxl import load_workbook
from PIL import Image

from app.core import db, report
from app.core.report import BadReportError
from app.models import experiments, share_links, users
from app.models.experiments import NoSuchExperimentError
from app.models.share_links import ShareLinkInvalidError
from app.routes.report import _report, _shared_report

SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'


def png_base64() -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), (0, 0, 0)).save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()


def body(**extra: object) -> dict:
    out = {
        "tables": [
            {"id": "summary", "title": "Summary", "columns": ["Item", "Value"], "rows": [["TR", "2 s"], ["Runs", 1]]},
            {"id": "x", "title": "Jitter: Say › ITI", "columns": ["Wait", "P"], "rows": [[2, "50%"], ["=1+1", None]]},
        ],
        "methods": "The experiment had 2 trial types.",
        "figures": [{"name": "trial-say", "svg": SVG, "png": png_base64()}, {"name": "trial-say", "svg": SVG}],
    }
    out.update(extra)
    return out


class ReportTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.store = db.Store(Path(self.directory.name) / "app.db", "", False)
        self.store.initialise()
        self.alice = users.create_user(self.store, "Alice", users.ROLE_USER)
        self.bob = users.create_user(self.store, "Bob", users.ROLE_USER)
        self.experiment = experiments.create_experiment(self.store, self.alice.id, {"name": "Study", "format_version": 1})

    def tearDown(self) -> None:
        self.directory.cleanup()

    def test_zip_holds_every_part(self) -> None:
        name, data, only = _report(self.store, self.experiment.id, self.alice.id, body())
        self.assertEqual(name, "Study")
        self.assertFalse(only)
        names = set(zipfile.ZipFile(io.BytesIO(data)).namelist())
        for expected in ("README.txt", "report.xlsx", "report.md", "methods.txt", "experiment.json",
                         "markdown/summary.md", "markdown/jitter-say-iti.md",
                         "figures/trial-say.svg", "figures/trial-say.png", "figures/trial-say-2.svg"):
            self.assertIn(expected, names)
        self.assertNotIn("figures/trial-say-2.png", names)

    def test_workbook_opens_with_a_sheet_per_table(self) -> None:
        _, data, only = _report(self.store, self.experiment.id, self.alice.id, body(only="xlsx"))
        self.assertTrue(only)
        book = load_workbook(io.BytesIO(data))
        self.assertEqual(book.sheetnames, ["Summary", "Summary 2", "Jitter  Say › ITI", "Methods"])
        sheet = book["Jitter  Say › ITI"]
        self.assertEqual([c.value for c in sheet[1]], ["Wait", "P"])
        # Text that looks like a formula stays text.
        self.assertEqual(sheet["A3"].value, "=1+1")
        self.assertEqual(sheet["A3"].data_type, "s")

    def test_only_editors_and_share_links(self) -> None:
        with self.assertRaises(NoSuchExperimentError):
            _report(self.store, self.experiment.id, self.bob.id, body())
        credential, _ = share_links.issue_share_link(self.store, self.experiment, "", self.alice.id)
        name, data, _ = _shared_report(self.store, body(credential=credential))
        self.assertEqual(name, "Study")
        self.assertIn("report.xlsx", zipfile.ZipFile(io.BytesIO(data)).namelist())
        with self.assertRaises(ShareLinkInvalidError):
            _shared_report(self.store, body(credential="nope.nope"))

    def test_refusals(self) -> None:
        bad = [
            body(tables="x"),
            body(tables=[{"title": "T", "columns": [], "rows": []}]),
            body(tables=[{"title": "T", "columns": ["a"], "rows": [[{"x": 1}]]}]),
            body(tables=[{"title": "T", "columns": ["a"], "rows": [["x" * (report.MAX_CELL + 1)]]}]),
            body(tables=[{"title": "T", "columns": ["a"], "rows": [[1]] * (report.MAX_ROWS + 1)}]),
            body(figures=[{"name": "f", "svg": "<script>alert(1)</script>"}]),
            body(figures=[{"name": "f", "svg": SVG, "png": "not base64!"}]),
            body(figures=[{"name": "f", "svg": SVG, "png": base64.b64encode(b"GIF89a").decode()}]),
            body(figures=[{"name": "f", "svg": SVG + " " * report.MAX_SVG}]),
            body(methods=7),
        ]
        for case in bad:
            with self.assertRaises(BadReportError):
                report.check_report(case)

    def test_names_cannot_escape_their_folder(self) -> None:
        checked = report.check_report(body(figures=[{"name": "../../etc/passwd", "svg": SVG}], tables=[{"title": "../x", "columns": ["a"], "rows": []}]))
        self.assertEqual(checked.figures[0].slug, "etc-passwd")
        self.assertEqual(checked.tables[0].slug, "x")


if __name__ == "__main__":
    unittest.main()
