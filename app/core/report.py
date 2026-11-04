"""The report: tables, a methods paragraph and figures the browser made
(static/js/report.js), packed with the experiment itself into one zip -- or
just the workbook.

The browser draws everything, with the same code as its screens, so the
numbers in the report are the numbers on screen. This module only checks
what arrives and packages it; check_report refuses anything malformed or
too big before a byte is written.

The zip:
    report.xlsx          a Summary sheet, then one sheet per table
    report.md            every table, then the methods
    methods.txt
    markdown/<table>.md
    figures/<name>.svg   and .png where the browser could draw one
    experiment.json      the document, as stored
    README.txt
"""
from __future__ import annotations

import base64
import binascii
import io
import json
import re
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

MAX_TABLES = 200
MAX_COLUMNS = 50
MAX_ROWS = 5000
MAX_CELL = 2000
MAX_TITLE = 300
MAX_FIGURES = 100
MAX_SVG = 2 * 1024 * 1024
MAX_PNG_BASE64 = 8 * 1024 * 1024
MAX_FIGURE_TOTAL = 24 * 1024 * 1024
MAX_METHODS = 100 * 1024
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


class BadReportError(ValueError):
    """What arrived is not a report this module will package."""


@dataclass
class Table:
    slug: str
    title: str
    columns: list[str]
    rows: list[list[str | int | float]]


@dataclass
class Figure:
    slug: str
    svg: str
    png: bytes | None


@dataclass
class Report:
    tables: list[Table]
    methods: str
    figures: list[Figure]
    only_xlsx: bool


def slug(text: str, fallback: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]
    return value or fallback


def _unique(name: str, taken: set[str]) -> str:
    candidate = name
    n = 2
    while candidate in taken:
        candidate = f"{name}-{n}"
        n += 1
    taken.add(candidate)
    return candidate


def _text(value: object, where: str, limit: int) -> str:
    if not isinstance(value, str):
        raise BadReportError(f"{where} must be text")
    if len(value) > limit:
        raise BadReportError(f"{where} is too long")
    return value


def _cell(value: object, where: str) -> str | int | float:
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        if len(value) > MAX_CELL:
            raise BadReportError(f"{where} is too long")
        return value
    raise BadReportError(f"{where} must be text or a number")


def check_report(body: dict) -> Report:
    tables_in = body.get("tables")
    if not isinstance(tables_in, list) or len(tables_in) > MAX_TABLES:
        raise BadReportError(f"tables must be a list of at most {MAX_TABLES}")
    taken: set[str] = set()
    tables = []
    for index, raw in enumerate(tables_in):
        where = f"tables[{index}]"
        if not isinstance(raw, dict):
            raise BadReportError(f"{where} must be an object")
        columns = raw.get("columns")
        rows = raw.get("rows")
        if not isinstance(columns, list) or not 0 < len(columns) <= MAX_COLUMNS:
            raise BadReportError(f"{where}.columns must be a list of 1 to {MAX_COLUMNS}")
        if not isinstance(rows, list) or len(rows) > MAX_ROWS:
            raise BadReportError(f"{where}.rows must be a list of at most {MAX_ROWS}")
        checked_rows = []
        for r, row in enumerate(rows):
            if not isinstance(row, list) or len(row) > MAX_COLUMNS:
                raise BadReportError(f"{where}.rows[{r}] must be a list of at most {MAX_COLUMNS}")
            checked_rows.append([_cell(value, f"{where}.rows[{r}]") for value in row])
        title = _text(raw.get("title", ""), f"{where}.title", MAX_TITLE)
        ident = raw.get("id") if isinstance(raw.get("id"), str) else ""
        tables.append(Table(
            slug=_unique(slug(title or ident, f"table-{index + 1}"), taken),
            title=title,
            columns=[str(_cell(c, f"{where}.columns")) for c in columns],
            rows=checked_rows,
        ))

    methods = _text(body.get("methods", ""), "methods", MAX_METHODS)

    figures_in = body.get("figures", [])
    if not isinstance(figures_in, list) or len(figures_in) > MAX_FIGURES:
        raise BadReportError(f"figures must be a list of at most {MAX_FIGURES}")
    total = 0
    taken = set()
    figures = []
    for index, raw in enumerate(figures_in):
        where = f"figures[{index}]"
        if not isinstance(raw, dict):
            raise BadReportError(f"{where} must be an object")
        svg = _text(raw.get("svg", ""), f"{where}.svg", MAX_SVG)
        if not svg.lstrip().startswith(("<?xml", "<svg")):
            raise BadReportError(f"{where}.svg is not an SVG")
        png = None
        encoded = raw.get("png")
        if encoded:
            encoded = _text(encoded, f"{where}.png", MAX_PNG_BASE64)
            try:
                png = base64.b64decode(encoded, validate=True)
            except (binascii.Error, ValueError) as problem:
                raise BadReportError(f"{where}.png is not base64") from problem
            if not png.startswith(PNG_MAGIC):
                raise BadReportError(f"{where}.png is not a PNG")
        total += len(svg) + (len(png) if png else 0)
        if total > MAX_FIGURE_TOTAL:
            raise BadReportError("the figures are too big together")
        name = raw.get("name") if isinstance(raw.get("name"), str) else ""
        figures.append(Figure(slug=_unique(slug(name, f"figure-{index + 1}"), taken), svg=svg, png=png))

    return Report(tables=tables, methods=methods, figures=figures, only_xlsx=body.get("only") == "xlsx")


# -- output -------------------------------------------------------------------


def markdown_table(table: Table) -> str:
    def cell(value: object) -> str:
        return str(value).replace("|", "\\|").replace("\n", " ")

    lines = ["| " + " | ".join(cell(c) for c in table.columns) + " |", "|" + " --- |" * len(table.columns)]
    lines += ["| " + " | ".join(cell(c) for c in row) + " |" for row in table.rows]
    return "\n".join(lines) + "\n"


def _sheet_title(title: str, taken: set[str]) -> str:
    base = re.sub(r"[\[\]:*?/\\]", " ", title).strip()[:28] or "Table"
    candidate = base
    n = 2
    while candidate.lower() in taken:
        suffix = f" {n}"
        candidate = base[: 31 - len(suffix)] + suffix
        n += 1
    taken.add(candidate.lower())
    return candidate


def workbook(name: str, report: Report) -> bytes:
    book = Workbook()
    bold = Font(bold=True)
    head_fill = PatternFill("solid", fgColor="EEEEEE")
    summary = book.active
    summary.title = "Summary"
    summary.sheet_view.showGridLines = False
    summary["A1"] = name
    summary["A1"].font = Font(bold=True, size=14)
    summary["A2"] = "Made " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    summary["A4"] = "Sheet"
    summary["B4"] = "Table"
    summary["A4"].font = summary["B4"].font = bold
    taken = {"summary"}
    for index, table in enumerate(report.tables):
        title = _sheet_title(table.title or table.slug, taken)
        summary.cell(row=5 + index, column=1, value=title)
        summary.cell(row=5 + index, column=2, value=table.title)
        sheet = book.create_sheet(title)
        sheet.sheet_view.showGridLines = False
        sheet.append(table.columns)
        for cell in sheet[1]:
            cell.font = bold
            cell.fill = head_fill
            cell.alignment = Alignment(vertical="top", wrap_text=True)
        for row in table.rows:
            sheet.append(row)
        # Text that starts with "=" is still text: names in a design are
        # never formulas, and must not run as one when the sheet opens.
        for line in sheet.iter_rows():
            for cell in line:
                if isinstance(cell.value, str) and cell.value.startswith("="):
                    cell.data_type = "s"
        sheet.freeze_panes = "A2"
        for column in range(1, len(table.columns) + 1):
            values = [table.columns[column - 1]] + [row[column - 1] for row in table.rows if column <= len(row)]
            width = max((len(str(v)) for v in values), default=8)
            sheet.column_dimensions[get_column_letter(column)].width = min(60, max(8, width + 2))
    summary.column_dimensions["A"].width = 32
    summary.column_dimensions["B"].width = 60
    if report.methods:
        sheet = book.create_sheet(_sheet_title("Methods", taken))
        sheet.sheet_view.showGridLines = False
        sheet["A1"] = report.methods
        sheet["A1"].data_type = "s"
        sheet["A1"].alignment = Alignment(wrap_text=True, vertical="top")
        sheet.column_dimensions["A"].width = 120
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def build(name: str, doc: dict, report: Report) -> bytes:
    """The zip, or the workbook alone when report.only_xlsx."""
    xlsx = workbook(name, report)
    if report.only_xlsx:
        return xlsx
    markdown = f"# {name}\n\n"
    markdown += "\n".join(f"## {t.title}\n\n{markdown_table(t)}" for t in report.tables)
    if report.methods:
        markdown += f"\n## Methods\n\n{report.methods}\n"
    listing = [
        "report.xlsx          every table, one sheet each, after a Summary sheet",
        "report.md            every table as Markdown, then the methods",
        "methods.txt          the methods paragraph",
        "markdown/            each table as its own Markdown file",
        "figures/             each figure as SVG (and PNG at twice its size)",
        "experiment.json      the experiment, as saved; import it in the app",
    ]
    readme = f"{name}\n\nMade {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}.\n\n" + "\n".join(listing) + "\n"
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("README.txt", readme)
        archive.writestr("report.xlsx", xlsx)
        archive.writestr("report.md", markdown)
        archive.writestr("methods.txt", report.methods + "\n")
        archive.writestr("experiment.json", json.dumps(doc, indent=2, ensure_ascii=False))
        for table in report.tables:
            archive.writestr(f"markdown/{table.slug}.md", f"# {table.title}\n\n{markdown_table(table)}")
        for figure in report.figures:
            archive.writestr(f"figures/{figure.slug}.svg", figure.svg)
            if figure.png:
                archive.writestr(f"figures/{figure.slug}.png", figure.png)
    return out.getvalue()
