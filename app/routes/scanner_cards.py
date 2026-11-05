"""Scanner cards: the team's shared library of sequence parameters.

Any signed-in user can read and edit it (see app/models/scanner_cards.py for
why it is shared). Deleting and restoring need a browser session, like
deleting an experiment.
"""
from __future__ import annotations

from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.db import Store
from app.core.security import actor_from, check_csrf
from app.models import RestoreError, scanner_cards, users
from app.models.scanner_cards import BadCardError, CardConflictError, LastCardError, NoSuchBackupError, NoSuchCardError
from app.routes.helpers import bad_request, conflict, forbidden, get_store, not_found, read_json, restore_refused, run

NO_SUCH = "no such scanner card"


async def _checked_body(request: Request) -> dict[str, Any] | Response:
    body = await read_json(request)
    if body is None:
        return bad_request("malformed request body")
    if not check_csrf(request, body.get("csrf_token")):
        return forbidden("invalid csrf token")
    return body


async def list_cards(request: Request) -> Response:
    cards = await run(scanner_cards.list_cards, get_store(request))
    return JSONResponse([card.to_row() for card in cards])


async def create_card(request: Request) -> Response:
    body = await _checked_body(request)
    if isinstance(body, Response):
        return body
    try:
        created = await run(scanner_cards.create_card, get_store(request), actor_from(request).user.id, body.get("card"))
    except BadCardError as refusal:
        return bad_request(str(refusal))
    return JSONResponse(created.to_row(), status_code=201)


async def save_card(request: Request) -> Response:
    body = await _checked_body(request)
    if isinstance(body, Response):
        return body
    try:
        saved = await run(
            scanner_cards.save_card, get_store(request), request.path_params["card_id"], actor_from(request).user.id,
            body.get("card"), body.get("base_revision"),
        )
    except NoSuchCardError:
        return not_found(NO_SUCH)
    except BadCardError as refusal:
        return bad_request(str(refusal))
    except CardConflictError as stale:
        return conflict(str(stale), revision=stale.current)
    return JSONResponse(saved.to_row())


def _backup_rows(store: Store, card_id: str) -> list[dict[str, Any]]:
    names = {user.id: user.display_name for user in users.list_users(store)}
    return [dict(row, saved_by_name=names.get(row["saved_by"], "")) for row in scanner_cards.list_backups(store, card_id)]


async def list_backups(request: Request) -> Response:
    try:
        rows = await run(_backup_rows, get_store(request), request.path_params["card_id"])
    except NoSuchCardError:
        return not_found(NO_SUCH)
    return JSONResponse(rows)


async def restore_backup(request: Request) -> Response:
    body = await _checked_body(request)
    if isinstance(body, Response):
        return body
    try:
        restored = await run(
            scanner_cards.restore_backup, get_store(request), request.path_params["card_id"], actor_from(request).user.id, body.get("revision"),
        )
    except NoSuchCardError:
        return not_found(NO_SUCH)
    except NoSuchBackupError:
        return not_found("no such backup")
    return JSONResponse(restored.to_row())


async def delete_card(request: Request) -> Response:
    body = await _checked_body(request)
    if isinstance(body, Response):
        return body
    try:
        await run(scanner_cards.delete_card, get_store(request), request.path_params["card_id"], actor_from(request).user.id)
    except NoSuchCardError:
        return not_found(NO_SUCH)
    except LastCardError as refusal:
        return conflict(str(refusal))
    return JSONResponse({"ok": True})


async def restore_card(request: Request) -> Response:
    body = await _checked_body(request)
    if isinstance(body, Response):
        return body
    actor = actor_from(request)
    try:
        restored = await run(scanner_cards.restore_card, get_store(request), request.path_params["card_id"], actor.user.id, actor.is_admin)
    except RestoreError as refusal:
        return restore_refused(refusal)
    return JSONResponse(restored.to_row())
