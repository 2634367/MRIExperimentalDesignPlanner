"""Scanner cards: the acquisition parameters of one sequence, as the console
shows them -- pages (INFO PAGE, GEOMETRY, ...) of parameter rows.

One shared library for the whole team, not per experiment: a sequence is
described once and every design picks from it. A run or a session's scan step
keeps a snapshot of the few numbers it needs (TR, dummy volumes, duration),
so a compiled plan or a share link never depends on the library.

The card itself is the browser's business, like an experiment document:
static/js/scanners.js edits it and reads the numbers out of its rows. The
server checks its shape and sizes, keeps the revision that stops two tabs
overwriting each other, and refuses to delete the last card.

The id is the card's slug ("EPI-TR2000-Task"), the name the old planner's
design files use, so an imported design finds its cards by name.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from app.core.db import BUCKET_SCANNER_CARDS, Record, Store
from app.models import RestoreGoneError, deleted_long_ago, from_iso, mark_deleted, to_iso, unmark_deleted, utc_now

ROLES = ("functional", "reference", "structural", "other")
LABEL_MAX = 200
NOTE_MAX = 4000
PAGES_MAX = 40
PAGE_NAME_MAX = 80
ROWS_MAX = 500
PARAMETER_MAX = 200
VALUE_MAX = 500
INDENT_MAX = 4
SLUG_MAX = 120
SLUG_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,120}")

# The cards the library starts with, in the old planner's file format.
SEED_DIR = Path(__file__).resolve().parent.parent / "seed" / "scanner_cards"
# Console page order for those files; pages not listed keep their own order.
PAGE_ORDER = ("INFO PAGE", "GEOMETRY", "CONTRAST", "POST/PROC", "MOTION", "DYN/ANG")


class NoSuchCardError(Exception):
    pass


class BadCardError(ValueError):
    pass


class LastCardError(Exception):
    def __init__(self) -> None:
        super().__init__("the library needs at least one card")


class CardConflictError(Exception):
    """The save was made from an older revision than the one stored."""

    def __init__(self, current: int) -> None:
        super().__init__("this card was changed somewhere else")
        self.current = current


@dataclass
class Card:
    id: str
    revision: int
    created_at: datetime
    updated_at: datetime
    updated_by: int | None
    card: dict[str, Any]

    def to_row(self) -> dict[str, Any]:
        return dict(self.card, id=self.id, revision=self.revision, updated_at=self.updated_at.isoformat())


def _record_to_card(record: Record) -> Card:
    return Card(
        id=record["id"],
        revision=record["revision"],
        created_at=from_iso(record["created_at"]),
        updated_at=from_iso(record["updated_at"]),
        updated_by=record.get("updated_by"),
        card=record["card"],
    )


def slugify(text: str, fallback: str = "Card") -> str:
    clean = re.sub(r"[^A-Za-z0-9]+", "-", str(text or "")).strip("-")
    return (clean or fallback)[:SLUG_MAX]


def _text(value: object, limit: int, what: str, required: bool = False) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        value = f"{value:g}"
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise BadCardError(f"{what} must be text")
    if len(value) > limit:
        raise BadCardError(f"{what} is longer than {limit} characters")
    if required and not value.strip():
        raise BadCardError(f"{what} is empty")
    return value


def check_card(card: object) -> dict[str, Any]:
    """The card's shape, normalised: label, role, note, pages of rows."""
    if not isinstance(card, dict):
        raise BadCardError("the card must be a JSON object")
    role = card.get("role")
    pages = card.get("pages")
    if not isinstance(pages, list) or len(pages) > PAGES_MAX:
        raise BadCardError(f"a card has a list of at most {PAGES_MAX} pages")
    clean_pages = []
    for page in pages:
        if not isinstance(page, dict) or not isinstance(page.get("rows"), list):
            raise BadCardError("each page needs a name and a list of rows")
        if len(page["rows"]) > ROWS_MAX:
            raise BadCardError(f"a page has at most {ROWS_MAX} rows")
        rows = []
        for row in page["rows"]:
            if not isinstance(row, dict):
                raise BadCardError("each row needs a parameter and a value")
            indent = row.get("indent", 0)
            if not isinstance(indent, int) or isinstance(indent, bool):
                indent = 0
            rows.append({
                "parameter": _text(row.get("parameter"), PARAMETER_MAX, "a parameter name"),
                "value": _text(row.get("value"), VALUE_MAX, "a parameter value"),
                "indent": max(0, min(INDENT_MAX, indent)),
            })
        clean_pages.append({"name": _text(page.get("name"), PAGE_NAME_MAX, "a page name", True).strip(), "rows": rows})
    return {
        "label": _text(card.get("label"), LABEL_MAX, "the card's name", True).strip(),
        "role": role if role in ROLES else "other",
        "note": _text(card.get("note"), NOTE_MAX, "the note"),
        "pages": clean_pages,
    }


def from_legacy(data: dict[str, Any], slug: str) -> dict[str, Any]:
    """An old planner card file ({"_meta": ..., "INFO PAGE": [...], ...})."""
    meta = data.get("_meta") if isinstance(data.get("_meta"), dict) else {}
    names = [key for key, rows in data.items() if not key.startswith("_") and isinstance(rows, list)]
    ordered = [name for name in PAGE_ORDER if name in names] + [name for name in names if name not in PAGE_ORDER]
    return check_card({
        "label": meta.get("label") or slug,
        "role": str(meta.get("role") or "other").strip().lower(),
        "note": meta.get("note") or "",
        "pages": [{"name": name, "rows": data[name]} for name in ordered],
    })


def _live(record: Record | None) -> Card | None:
    if record is None or record.get("deleted_at") is not None:
        return None
    return _record_to_card(record)


def list_cards(store: Store) -> list[Card]:
    found = [card for card in (_live(record) for _, record in store.all(BUCKET_SCANNER_CARDS)) if card is not None]
    rank = {role: index for index, role in enumerate(ROLES)}
    return sorted(found, key=lambda card: (rank.get(card.card.get("role"), len(ROLES)), card.card.get("label", "").lower()))


def get_card(store: Store, card_id: str) -> Card:
    card = _live(store.get(BUCKET_SCANNER_CARDS, card_id)) if isinstance(card_id, str) and card_id else None
    if card is None:
        raise NoSuchCardError()
    return card


def _free_slug(store: Store, wanted: str) -> str:
    """wanted, or wanted-2, wanted-3, ... -- deleted cards keep their slug
    until purged, so restoring one never collides."""
    taken = {key for key, _ in store.all(BUCKET_SCANNER_CARDS)}
    base = wanted[: SLUG_MAX - 4]
    slug, n = wanted, 2
    while slug in taken:
        slug, n = f"{base}-{n}", n + 1
    return slug


def _put_new(store: Store, slug: str, checked: dict[str, Any], user_id: int | None) -> Card:
    now = utc_now()
    record = {
        "id": slug,
        "revision": 1,
        "created_at": to_iso(now),
        "updated_at": to_iso(now),
        "updated_by": user_id,
        "deleted_at": None,
        "deleted_by": None,
        "card": checked,
    }
    store.put(BUCKET_SCANNER_CARDS, slug, record)
    return _record_to_card(record)


def create_card(store: Store, user_id: int, card: object) -> Card:
    checked = check_card(card)
    return _put_new(store, _free_slug(store, slugify(checked["label"])), checked, user_id)


def save_card(store: Store, card_id: str, user_id: int, card: object, base_revision: object) -> Card:
    checked = check_card(card)
    if not isinstance(base_revision, int) or isinstance(base_revision, bool):
        raise BadCardError("base_revision must be the revision this edit was made from")

    def mutate(record: Record) -> None:
        if _live(record) is None:
            raise NoSuchCardError()
        if record["revision"] != base_revision:
            raise CardConflictError(record["revision"])
        record["card"] = checked
        record["revision"] += 1
        record["updated_at"] = to_iso(utc_now())
        record["updated_by"] = user_id

    updated = store.update_value(BUCKET_SCANNER_CARDS, card_id, mutate)
    if updated is None:
        raise NoSuchCardError()
    return _record_to_card(updated)


def delete_card(store: Store, card_id: str, user_id: int) -> None:
    """Soft: restore_card puts it back for a few minutes."""
    if len(list_cards(store)) <= 1:
        get_card(store, card_id)
        raise LastCardError()

    def mutate(record: Record) -> None:
        if _live(record) is None:
            raise NoSuchCardError()
        mark_deleted(record, user_id)

    if store.update_value(BUCKET_SCANNER_CARDS, card_id, mutate) is None:
        raise NoSuchCardError()


def restore_card(store: Store, card_id: str, user_id: int, is_admin: bool) -> Card:
    def mutate(record: Record) -> None:
        unmark_deleted(record, user_id, is_admin)

    updated = store.update_value(BUCKET_SCANNER_CARDS, card_id, mutate)
    if updated is None:
        raise RestoreGoneError()
    return _record_to_card(updated)


def purge_deleted_cards(store: Store) -> int:
    return store.delete_where(BUCKET_SCANNER_CARDS, lambda _key, record: deleted_long_ago(record))


def seed_cards(store: Store, folder: Path = SEED_DIR) -> int:
    """Fill an empty library with the bundled cards. Only ever into an empty
    one -- once someone has a library, deleting a seed card keeps it gone."""
    if store.all(BUCKET_SCANNER_CARDS) or not folder.is_dir():
        return 0
    added = 0
    for path in sorted(folder.glob("*.json")):
        slug = path.stem
        if not SLUG_PATTERN.fullmatch(slug):
            continue
        try:
            card = from_legacy(json.loads(path.read_text(encoding="utf-8")), slug)
        except (ValueError, BadCardError) as error:
            print(f"[scanner cards] skipped {path.name}: {error}", flush=True)
            continue
        _put_new(store, slug, card, None)
        added += 1
    return added
