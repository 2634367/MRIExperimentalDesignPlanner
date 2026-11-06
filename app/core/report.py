"""The report: tables, a methods paragraph and figures the browser made
(static/js/report.js), packed with the experiment itself into one zip -- or
just the workbook.

The browser draws everything, with the same code as its screens, so the
numbers in the report are the numbers on screen. This module only checks
what arrives and packages it; check_report refuses anything malformed or
too big before a byte is written.

The zip:
    report.xlsx          a Summary sheet, one sheet per table, one per scanner card
    report.md            every table, then the methods
    methods.txt
    markdown/<table>.md
    figures/<name>.svg   and .png where the browser could draw one
    scanner-cards/<name>.json  each card the design uses, whole
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
IDENTITY = (("investigator", "Investigator"), ("institution", "Institution"), ("design_id", "Design ID"))


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


def identity(doc: dict) -> list[str]:
    """Who the document says it is, as lines for the top of each export."""
    meta = doc.get("meta")
    if not isinstance(meta, dict):
        return []
    return [f"{label}: {meta[key]}" for key, label in IDENTITY if isinstance(meta.get(key), str) and meta[key].strip()]


def card_sheet(book: Workbook, card: dict, taken: set[str]) -> None:
    """A scanner card as the console pages it: one row per parameter."""
    sheet = book.create_sheet(_sheet_title(f"Card {card['label']}", taken))
    sheet.sheet_view.showGridLines = False
    sheet.append(["Page", "Parameter", "Value"])
    for cell in sheet[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill("solid", fgColor="EEEEEE")
    for page in card["pages"]:
        for row in page["rows"]:
            sheet.append([page["name"], "  " * row.get("indent", 0) + row["parameter"], row["value"]])
    for line in sheet.iter_rows():
        for cell in line:
            if isinstance(cell.value, str) and cell.value.startswith("="):
                cell.data_type = "s"
    sheet.freeze_panes = "A2"
    for column, width in zip("ABC", (16, 44, 32)):
        sheet.column_dimensions[column].width = width


def workbook(name: str, report: Report, lines: list[str] | None = None, cards: list[dict] | None = None) -> bytes:
    book = Workbook()
    bold = Font(bold=True)
    head_fill = PatternFill("solid", fgColor="EEEEEE")
    summary = book.active
    summary.title = "Summary"
    summary.sheet_view.showGridLines = False
    summary["A1"] = name
    summary["A1"].font = Font(bold=True, size=14)
    summary["A2"] = "Made " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    for offset, line in enumerate(lines or []):
        summary.cell(row=3 + offset, column=1, value=line).data_type = "s"
    head = 4 + len(lines or [])
    summary.cell(row=head, column=1, value="Sheet").font = bold
    summary.cell(row=head, column=2, value="Table").font = bold
    taken = {"summary"}
    for index, table in enumerate(report.tables):
        title = _sheet_title(table.title or table.slug, taken)
        summary.cell(row=head + 1 + index, column=1, value=title)
        summary.cell(row=head + 1 + index, column=2, value=table.title)
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
    for card in cards or []:
        card_sheet(book, card, taken)
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def build(name: str, doc: dict, report: Report, cards: list[dict] | None = None) -> bytes:
    """The zip, or the workbook alone when report.only_xlsx. cards are the
    scanner cards the design uses, whole, as rows."""
    lines = identity(doc)
    xlsx = workbook(name, report, lines, cards)
    if report.only_xlsx:
        return xlsx
    markdown = f"# {name}\n\n" + "".join(f"{line}  \n" for line in lines) + ("\n" if lines else "")
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
    if cards:
        listing.insert(-1, "scanner-cards/       each scanner card the design uses, whole")
    about = "".join(f"{line}\n" for line in lines)
    readme = f"{name}\n{about}\nMade {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}.\n\n" + "\n".join(listing) + "\n"
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
        taken: set[str] = set()
        for card in cards or []:
            content = {key: card.get(key) for key in ("id", "label", "role", "note", "pages")}
            archive.writestr(f"scanner-cards/{_unique(slug(card['label'], 'card'), taken)}.json", json.dumps(content, indent=2, ensure_ascii=False))
    return out.getvalue()
