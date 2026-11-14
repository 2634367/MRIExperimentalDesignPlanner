"""Scanner cards: the team's shared library of sequence parameters.

Any signed-in user can read and edit it (see app/models/scanner_cards.py for
why it is shared), by a browser session or an API key, and each edit keeps a
backup like any other; a save needs the revision it was made from, through
either door. Deleting and restoring need a browser session, like deleting an
experiment, so they have no MCP tool.
"""
from __future__ import annotations

from typing import Annotated, Any, Callable, ClassVar, Literal

import msgspec
from msgspec import Meta
from starlette.requests import Request

from app.apidocs import PATH, SESSION_ONLY, Reply, route
from app.apidocs import Request as RequestType
from app.core.db import Store
from app.core.security import actor_from
from app.models import RestoreError, scanner_cards, users
from app.models.scanner_cards import BadCardError, CardConflictError, LastCardError, NoSuchBackupError, NoSuchCardError
from app.routes.helpers import DateTime, Refused, get_store, restore_refusal

NO_SUCH = "no such scanner card"
TAG = "Scanner cards"

CardID = Annotated[str, PATH, Meta(description="The card's id, its slug: from GET /api/scanner-cards (list_scanner_cards over MCP).")]
CardContent = Annotated[dict[str, Any], Meta(
    description="label, role (functional, reference, structural or other), note, and pages: [{name, rows: [{parameter, value, indent}]}].",
    extra={"error": "the card must be a JSON object"},
)]
Revision = Annotated[int, Meta(description="The backup's revision, from its backups (list_scanner_card_backups over MCP).")]


class CardPath(RequestType):
    card_id: CardID


class CardRow(Reply):
    """One parameter on a console page."""

    api_name: ClassVar[str] = "ScannerCardRow"
    parameter: str
    value: str
    indent: int


class CardPage(Reply):
    """One console page (INFO PAGE, GEOMETRY, ...) of a scanner card."""

    api_name: ClassVar[str] = "ScannerCardPage"
    name: str
    rows: list[CardRow]


class ScannerCard(Reply):
    """A card in the shared library, whole."""

    api_name: ClassVar[str] = "ScannerCard"
    id: str
    revision: int
    updated_at: DateTime
    label: str
    role: Literal["functional", "reference", "structural", "other"]
    note: str
    pages: list[CardPage]


def card_reply(card: scanner_cards.Card) -> ScannerCard:
    return msgspec.convert(card.to_row(), ScannerCard)


def _brief(row: Any) -> dict[str, Any]:  # feature:mcp
    """A card without its pages, which are most of its size."""  # feature:mcp
    return {key: value for key, value in msgspec.to_builtins(row).items() if key != "pages"}  # feature:mcp


def briefed_cards(call: Any, body: Any, serve: Callable[[Any, Any], Any]) -> dict[str, Any]:  # feature:mcp
    """list_scanner_cards: the cards without their pages, under cards."""  # feature:mcp
    return {"cards": [_brief(card) for card in serve(call.request, body)]}  # feature:mcp


def wrapped_backups(call: Any, body: Any, serve: Callable[[Any, Any], Any]) -> dict[str, Any]:  # feature:mcp
    """list_scanner_card_backups: the rows under backups, since a tool answers an object."""  # feature:mcp
    return {"backups": msgspec.to_builtins(serve(call.request, body))}  # feature:mcp


@route(
    "GET /api/scanner-cards", summary="List scanner cards",
    tag=TAG,
    description="Every card in the team's shared library: id, label, role, note and revision, and over HTTP its pages too.",
    mcp_note="Read one with get_scanner_card for its parameters.",  # feature:mcp
    mcp="list_scanner_cards", read_only=True, call=briefed_cards,  # feature:mcp
)
def list_cards(request: Request) -> list[ScannerCard]:
    return [card_reply(card) for card in scanner_cards.list_cards(get_store(request))]


@route(
    "GET /api/scanner-cards/revisions", summary="Scanner card revisions",
    tag=TAG,
    description="Each card's id and revision only, as {id: revision}: a cheap way to see which cards changed since they were read.",
    mcp="scanner_card_revisions", read_only=True,  # feature:mcp
)
def card_revisions(request: Request) -> dict[str, int]:
    return scanner_cards.revisions(get_store(request))


@route(
    "GET /api/scanner-cards/{card_id}", summary="Read a scanner card",
    tag=TAG, errors=(404,),
    description="One card whole: the console's pages (INFO PAGE, GEOMETRY, ...), each a list of parameter rows, and its revision.",
    mcp="get_scanner_card", read_only=True,  # feature:mcp
)
def get_card(request: Request, body: CardPath) -> ScannerCard:
    try:
        return card_reply(scanner_cards.get_card(get_store(request), body.card_id))
    except NoSuchCardError:
        raise Refused(404, NO_SUCH) from None


class CreateCard(RequestType):
    card: CardContent


@route(
    "POST /api/scanner-cards", summary="Add a scanner card",
    tag=TAG, status=201, reply_description="Created",
    description="Add a card to the shared library. Its id comes from its label.",
    mcp="create_scanner_card",  # feature:mcp
)
def create_card(request: Request, body: CreateCard) -> ScannerCard:
    try:
        return card_reply(scanner_cards.create_card(get_store(request), actor_from(request).user.id, body.card))
    except BadCardError as refusal:
        raise Refused(400, str(refusal)) from None


class SaveCard(RequestType):
    card_id: CardID
    card: CardContent
    base_revision: Annotated[int, Meta(
        description="The revision the card was read at.",
        extra={"error": "base_revision must be the revision this edit was made from"},
    )]


@route(
    "POST /api/scanner-cards/{card_id}/save", summary="Save a scanner card",
    tag=TAG, errors=(404, 409),
    description="Replace a card, as read and changed, with base_revision set to the revision it came from. "
    "Refused (409, with the current revision) if it has changed since. What it replaces is kept as a backup. "
    "The library is shared: this changes the card for everyone.",
    mcp_note="On \"this card was changed somewhere else\", read it again with get_scanner_card and reapply the change.",  # feature:mcp
    mcp="save_scanner_card",  # feature:mcp
)
def save_card(request: Request, body: SaveCard) -> ScannerCard:
    try:
        saved = scanner_cards.save_card(get_store(request), body.card_id, actor_from(request).user.id, body.card, body.base_revision)
    except NoSuchCardError:
        raise Refused(404, NO_SUCH) from None
    except BadCardError as refusal:
        raise Refused(400, str(refusal)) from None
    except CardConflictError as stale:
        raise Refused(409, str(stale), revision=stale.current) from None
    return card_reply(saved)


class SetParameter(RequestType):
    card_id: CardID
    page: Annotated[str, Meta(description="The page's name, such as CONTRAST.")]
    parameter: Annotated[str, Meta(description="The parameter's name, such as Flip angle (deg).")]
    value: str


@route(
    "POST /api/scanner-cards/{card_id}/set-parameter", summary="Change one parameter on a scanner card",
    tag=TAG, errors=(404, 409),
    description="Set one parameter's value, without sending the whole card. page and parameter name a row that "
    "already exists; parameter ignores case. What it replaces is kept as a backup. The library is shared: this "
    "changes the card for everyone.",
    mcp_note="On \"this card was changed somewhere else\", try again.",  # feature:mcp
    mcp="set_scanner_parameter",  # feature:mcp
)
def set_parameter(request: Request, body: SetParameter) -> ScannerCard:
    try:
        saved = scanner_cards.set_parameter(
            get_store(request), body.card_id, actor_from(request).user.id, body.page, body.parameter, body.value,
        )
    except NoSuchCardError:
        raise Refused(404, NO_SUCH) from None
    except BadCardError as refusal:
        raise Refused(400, str(refusal)) from None
    except CardConflictError as stale:
        raise Refused(409, str(stale), revision=stale.current) from None
    return card_reply(saved)


class Backup(Reply):
    """An earlier version of a card, kept when it was saved over."""

    api_name: ClassVar[str] = "ScannerCardBackup"
    revision: int
    saved_at: DateTime
    saved_by: Annotated[int | None, Meta(description="Who saved that version; null for a card the library started with.")]
    saved_by_name: str
    label: str


def _backup_rows(store: Store, card_id: str) -> list[Backup]:
    names = {user.id: user.display_name for user in users.list_users(store)}
    return [
        Backup(saved_by_name=names.get(row["saved_by"], ""), **row)
        for row in scanner_cards.list_backups(store, card_id)
    ]


@route(
    "GET /api/scanner-cards/{card_id}/backups", summary="A scanner card's backups",
    tag=TAG, errors=(404,),
    description="The earlier versions of a card kept when it was saved over, newest first: revision, who saved it and when.",
    mcp="list_scanner_card_backups", read_only=True, call=wrapped_backups,  # feature:mcp
)
def list_backups(request: Request, body: CardPath) -> list[Backup]:
    try:
        return _backup_rows(get_store(request), body.card_id)
    except NoSuchCardError:
        raise Refused(404, NO_SUCH) from None


class RestoreBackup(RequestType):
    card_id: CardID
    revision: Revision


@route(
    "POST /api/scanner-cards/{card_id}/backups/restore", summary="Put a scanner card back to a backup",
    tag=TAG, errors=(404,),
    description="Makes an earlier version (revision, from its backups) the card again. What it replaces is kept "
    "as a backup too. The library is shared: this changes the card for everyone.",
    mcp="restore_scanner_card_backup",  # feature:mcp
)
def restore_backup(request: Request, body: RestoreBackup) -> ScannerCard:
    try:
        restored = scanner_cards.restore_backup(get_store(request), body.card_id, actor_from(request).user.id, body.revision)
    except NoSuchCardError:
        raise Refused(404, NO_SUCH) from None
    except NoSuchBackupError:
        raise Refused(404, "no such backup") from None
    return card_reply(restored)


class OkReply(Reply):
    ok: bool


@route(
    "POST /api/scanner-cards/{card_id}/delete", summary="Delete a scanner card (restorable for a while)",
    tag=TAG, access=SESSION_ONLY, errors=(404, 409),
    description="The last card in the library cannot be deleted (409).",
)
def delete_card(request: Request, body: CardPath) -> OkReply:
    try:
        scanner_cards.delete_card(get_store(request), body.card_id, actor_from(request).user.id)
    except NoSuchCardError:
        raise Refused(404, NO_SUCH) from None
    except LastCardError as refusal:
        raise Refused(409, str(refusal)) from None
    return OkReply(ok=True)


@route(
    "POST /api/scanner-cards/{card_id}/restore", summary="Undo deleting a scanner card",
    tag=TAG, access=SESSION_ONLY, errors=(403, 404, 409),
)
def restore_card(request: Request, body: CardPath) -> ScannerCard:
    actor = actor_from(request)
    try:
        restored = scanner_cards.restore_card(get_store(request), body.card_id, actor.user.id, actor.is_admin)
    except RestoreError as refusal:
        raise restore_refusal(refusal) from None
    return card_reply(restored)
