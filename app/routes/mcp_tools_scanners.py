"""MCP tools for the scanner card library: list, read, create, save, and change
one parameter.

They call what the HTTP routes in scanner_cards.py call, so a card is checked
the same way through either door, and each save keeps a backup like any other.
A save needs the revision it was made from, like the browser's.

Deliberately missing: deleting a card and restoring one. Those need a browser
session, like deleting an experiment.
"""
from __future__ import annotations

from typing import Any

from app.mcp.registry import Call, Refusal, Registry, Tool
from app.models import scanner_cards
from app.models.scanner_cards import BadCardError, CardConflictError, NoSuchBackupError, NoSuchCardError
from app.routes.scanner_cards import _backup_rows

CARD_ID = {"type": "string", "description": "The card's id, from list_scanner_cards."}
CARD_SCHEMA = {
    "type": "object",
    "description": "label, role (functional, reference, structural or other), note, and pages: [{name, rows: [{parameter, value, indent}]}].",
}
NO_SUCH = "no such scanner card"


def _brief(row: dict[str, Any]) -> dict[str, Any]:
    """A card without its pages, which are most of its size."""
    return {key: value for key, value in row.items() if key != "pages"}


def list_scanner_cards(call: Call) -> dict[str, Any]:
    call.bind({})
    return {"cards": [_brief(card.to_row()) for card in scanner_cards.list_cards(call.store)]}


def get_scanner_card(call: Call) -> dict[str, Any]:
    args = call.bind({"card_id": str})
    try:
        return scanner_cards.get_card(call.store, args["card_id"]).to_row()
    except NoSuchCardError:
        raise Refusal(NO_SUCH) from None


def create_scanner_card(call: Call) -> dict[str, Any]:
    args = call.bind({"card": dict})
    try:
        return _brief(scanner_cards.create_card(call.store, call.actor.user.id, args["card"]).to_row())
    except BadCardError as refusal:
        raise Refusal(str(refusal)) from None


def save_scanner_card(call: Call) -> dict[str, Any]:
    args = call.bind({"card_id": str, "card": dict, "base_revision": int})
    try:
        return _brief(scanner_cards.save_card(call.store, args["card_id"], call.actor.user.id, args["card"], args["base_revision"]).to_row())
    except NoSuchCardError:
        raise Refusal(NO_SUCH) from None
    except BadCardError as refusal:
        raise Refusal(str(refusal)) from None
    except CardConflictError as stale:
        raise Refusal(f"{stale} -- read it again with get_scanner_card (now revision {stale.current}) and reapply the change") from None


def set_scanner_parameter(call: Call) -> dict[str, Any]:
    args = call.bind({"card_id": str, "page": str, "parameter": str, "value": str})
    try:
        return _brief(scanner_cards.set_parameter(call.store, args["card_id"], call.actor.user.id, args["page"], args["parameter"], args["value"]).to_row())
    except NoSuchCardError:
        raise Refusal(NO_SUCH) from None
    except BadCardError as refusal:
        raise Refusal(str(refusal)) from None
    except CardConflictError as stale:
        raise Refusal(f"{stale} -- try again") from None


def scanner_card_revisions(call: Call) -> dict[str, Any]:
    call.bind({})
    return {"revisions": scanner_cards.revisions(call.store)}


def list_scanner_card_backups(call: Call) -> dict[str, Any]:
    args = call.bind({"card_id": str})
    try:
        return {"backups": _backup_rows(call.store, args["card_id"])}
    except NoSuchCardError:
        raise Refusal(NO_SUCH) from None


def restore_scanner_card_backup(call: Call) -> dict[str, Any]:
    args = call.bind({"card_id": str, "revision": int})
    try:
        return _brief(scanner_cards.restore_backup(call.store, args["card_id"], call.actor.user.id, args["revision"]).to_row())
    except NoSuchCardError:
        raise Refusal(NO_SUCH) from None
    except NoSuchBackupError:
        raise Refusal("no such backup") from None


def _schema(properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


def register(registry: Registry) -> None:
    registry.register(Tool(
        name="list_scanner_cards",
        title="List scanner cards",
        description="Every card in the team's shared library: id, label, role, note and revision. Read one with get_scanner_card for its parameters.",
        call=list_scanner_cards,
        route="GET /api/scanner-cards",
        read_only=True,
    ))
    registry.register(Tool(
        name="get_scanner_card",
        title="Read a scanner card",
        description="One card whole: the console's pages (INFO PAGE, GEOMETRY, ...), each a list of parameter rows, and its revision.",
        call=get_scanner_card,
        route="GET /api/scanner-cards",
        input_schema=_schema({"card_id": CARD_ID}),
        read_only=True,
    ))
    registry.register(Tool(
        name="create_scanner_card",
        title="Add a scanner card",
        description="Add a card to the shared library. Its id comes from its label.",
        call=create_scanner_card,
        route="POST /api/scanner-cards",
        input_schema=_schema({"card": CARD_SCHEMA}),
    ))
    registry.register(Tool(
        name="save_scanner_card",
        title="Save a scanner card",
        description=(
            "Replace a card, as returned by get_scanner_card and changed, with base_revision set to the revision it came "
            "from. Refused if it has changed since. What it replaces is kept as a backup. The library is shared: this "
            "changes the card for everyone."
        ),
        call=save_scanner_card,
        route="POST /api/scanner-cards/{card_id}/save",
        input_schema=_schema({"card_id": CARD_ID, "card": CARD_SCHEMA, "base_revision": {"type": "integer", "minimum": 1}}),
    ))
    registry.register(Tool(
        name="set_scanner_parameter",
        title="Change one parameter on a scanner card",
        description=(
            "Set one parameter's value, without sending the whole card. page and parameter name a row that already "
            "exists; parameter ignores case. What it replaces is kept as a backup. The library is shared: this changes "
            "the card for everyone."
        ),
        call=set_scanner_parameter,
        route="POST /api/scanner-cards/{card_id}/save",
        input_schema=_schema({
            "card_id": CARD_ID,
            "page": {"type": "string", "description": "The page's name, such as CONTRAST."},
            "parameter": {"type": "string", "description": "The parameter's name, such as Flip angle (deg)."},
            "value": {"type": "string"},
        }),
    ))
    registry.register(Tool(
        name="scanner_card_revisions",
        title="Scanner card revisions",
        description="Each card's id and revision only: a cheap way to see which cards changed since they were read.",
        call=scanner_card_revisions,
        route="GET /api/scanner-cards/revisions",
        read_only=True,
    ))
    registry.register(Tool(
        name="list_scanner_card_backups",
        title="A scanner card's backups",
        description="The earlier versions of a card kept when it was saved over: revision, who saved it and when.",
        call=list_scanner_card_backups,
        route="GET /api/scanner-cards/{card_id}/backups",
        input_schema=_schema({"card_id": CARD_ID}),
        read_only=True,
    ))
    registry.register(Tool(
        name="restore_scanner_card_backup",
        title="Put a scanner card back to a backup",
        description="Makes an earlier version (revision, from list_scanner_card_backups) the card again. What it replaces is kept as a backup too. The library is shared: this changes the card for everyone.",
        call=restore_scanner_card_backup,
        route="POST /api/scanner-cards/{card_id}/backups/restore",
        input_schema=_schema({"card_id": CARD_ID, "revision": {"type": "integer", "minimum": 1}}),
    ))
