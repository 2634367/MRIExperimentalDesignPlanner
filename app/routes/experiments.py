"""Experiments: list, open, save, duplicate, share with editors, delete.

The document is stored as the browser sends it (see app/models/experiments.py
for the few things checked). Every route here works for whoever can edit the
experiment -- its owner and its editors -- except changing the editors and
deleting it, which are the owner's.
"""
from __future__ import annotations

from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.db import Store
from app.core.security import actor_from, check_csrf
from app.models import RestoreError, actions, experiments, media, users
from app.models.experiments import (
    BadDocumentError,
    Experiment,
    NoSuchExperimentError,
    NotOwnerError,
    RevisionConflictError,
)
from app.routes.helpers import bad_request, conflict, forbidden, get_store, not_found, read_json, restore_refused, run

NO_SUCH = "no such experiment"


def experiment_row(store: Store, experiment: Experiment, user_id: int, with_doc: bool = False) -> dict[str, Any]:
    names = {user.id: user.display_name for user in users.list_users(store)}
    row: dict[str, Any] = {
        "id": experiment.id,
        "name": experiment.name,
        "owner": experiment.owner,
        "owner_name": names.get(experiment.owner, ""),
        "is_owner": experiment.owner == user_id,
        "editors": [{"id": editor, "display_name": names.get(editor, "")} for editor in experiment.editors],
        "revision": experiment.revision,
        "updated_at": experiment.updated_at.isoformat(),
        "updated_by_name": names.get(experiment.updated_by, ""),
    }
    if with_doc:
        row["doc"] = experiment.doc
    return row


def list_rows(store: Store, user_id: int) -> list[dict[str, Any]]:
    """Shared with the MCP list_experiments tool."""
    return [experiment_row(store, experiment, user_id) for experiment in experiments.list_for_user(store, user_id)]


def open_row(store: Store, experiment_id: str, user_id: int) -> dict[str, Any]:
    """Shared with the MCP get_experiment tool. Raises NoSuchExperimentError."""
    return experiment_row(store, experiments.experiment_for(store, experiment_id, user_id), user_id, with_doc=True)


def save_row(store: Store, experiment_id: str, user_id: int, doc: object, base_revision: object) -> dict[str, Any]:
    """Shared with the MCP save_experiment tool."""
    saved = experiments.save_doc(store, experiment_id, user_id, doc, base_revision)
    return {"id": saved.id, "revision": saved.revision, "updated_at": saved.updated_at.isoformat()}


async def _checked_body(request: Request) -> dict[str, Any] | Response:
    body = await read_json(request)
    if body is None:
        return bad_request("malformed request body")
    if not check_csrf(request, body.get("csrf_token")):
        return forbidden("invalid csrf token")
    return body


async def list_experiments(request: Request) -> Response:
    return JSONResponse(await run(list_rows, get_store(request), actor_from(request).user.id))


async def create_experiment(request: Request) -> Response:
    body = await _checked_body(request)
    if isinstance(body, Response):
        return body
    store, user_id = get_store(request), actor_from(request).user.id
    try:
        created = await run(experiments.create_experiment, store, user_id, body.get("doc"))
    except BadDocumentError as refusal:
        return bad_request(str(refusal))
    return JSONResponse(await run(experiment_row, store, created, user_id, True), status_code=201)


async def get_experiment(request: Request) -> Response:
    try:
        row = await run(open_row, get_store(request), request.path_params["experiment_id"], actor_from(request).user.id)
    except NoSuchExperimentError:
        return not_found(NO_SUCH)
    return JSONResponse(row)


async def save_experiment(request: Request) -> Response:
    body = await _checked_body(request)
    if isinstance(body, Response):
        return body
    try:
        row = await run(
            save_row, get_store(request), request.path_params["experiment_id"], actor_from(request).user.id,
            body.get("doc"), body.get("base_revision"),
        )
    except NoSuchExperimentError:
        return not_found(NO_SUCH)
    except BadDocumentError as refusal:
        return bad_request(str(refusal))
    except RevisionConflictError as stale:
        return conflict(str(stale), revision=stale.current)
    return JSONResponse(row)


def _duplicate(store: Store, experiment_id: str, user_id: int, name: object) -> Experiment:
    source = experiments.experiment_for(store, experiment_id, user_id)
    doc = dict(source.doc)
    if isinstance(name, str) and name.strip():
        doc["name"] = name.strip()
    copy = experiments.create_experiment(store, user_id, doc)
    shas = [entry.get("id") for entry in source.doc.get("media") or [] if isinstance(entry, dict)]
    media.attach(store, shas, source.id, copy.id)
    return copy


async def duplicate_experiment(request: Request) -> Response:
    body = await _checked_body(request)
    if isinstance(body, Response):
        return body
    store, user_id = get_store(request), actor_from(request).user.id
    try:
        copy = await run(_duplicate, store, request.path_params["experiment_id"], user_id, body.get("name"))
    except NoSuchExperimentError:
        return not_found(NO_SUCH)
    except BadDocumentError as refusal:
        return bad_request(str(refusal))
    return JSONResponse(await run(experiment_row, store, copy, user_id, True), status_code=201)


def _set_editors(store: Store, experiment_id: str, user_id: int, editors: object) -> dict[str, Any]:
    if not isinstance(editors, list) or not all(isinstance(e, int) and not isinstance(e, bool) for e in editors):
        raise BadDocumentError("editors must be a list of user ids")
    known = {user.id for user in users.list_users(store) if not user.disabled}
    unknown = [editor for editor in editors if editor not in known]
    if unknown:
        raise BadDocumentError(f"no such user: {unknown[0]}")
    updated = experiments.set_editors(store, experiment_id, user_id, editors)
    return experiment_row(store, updated, user_id)


async def set_editors(request: Request) -> Response:
    body = await _checked_body(request)
    if isinstance(body, Response):
        return body
    try:
        row = await run(
            _set_editors, get_store(request), request.path_params["experiment_id"], actor_from(request).user.id,
            body.get("editors"),
        )
    except NoSuchExperimentError:
        return not_found(NO_SUCH)
    except NotOwnerError as refusal:
        return forbidden(str(refusal))
    except BadDocumentError as refusal:
        return bad_request(str(refusal))
    return JSONResponse(row)


async def delete_experiment(request: Request) -> Response:
    body = await _checked_body(request)
    if isinstance(body, Response):
        return body
    try:
        await run(experiments.delete_experiment, get_store(request), request.path_params["experiment_id"], actor_from(request).user.id)
    except NoSuchExperimentError:
        return not_found(NO_SUCH)
    except NotOwnerError as refusal:
        return forbidden(str(refusal))
    return JSONResponse({"ok": True})


async def restore_experiment(request: Request) -> Response:
    body = await _checked_body(request)
    if isinstance(body, Response):
        return body
    store, user_id = get_store(request), actor_from(request).user.id
    try:
        restored = await run(experiments.restore_experiment, store, request.path_params["experiment_id"], user_id)
    except RestoreError as refusal:
        return restore_refused(refusal)
    return JSONResponse(await run(experiment_row, store, restored, user_id))


def action_row(store: Store, experiment_id: str, user_id: int, body: dict[str, Any]) -> dict[str, Any]:
    """Shared with the MCP experiment_action tool: one small edit, see
    app/models/actions.py."""
    return actions.run_action(store, experiment_id, user_id, body.get("action"), body)


async def run_action(request: Request) -> Response:
    body = await read_json(request)
    if body is None:
        return bad_request("malformed request body")
    if not check_csrf(request, body.get("csrf_token")):
        return forbidden("invalid csrf token")
    try:
        row = await run(action_row, get_store(request), request.path_params["experiment_id"], actor_from(request).user.id, body)
    except NoSuchExperimentError:
        return not_found(NO_SUCH)
    except (actions.BadActionError, BadDocumentError) as refusal:
        return bad_request(str(refusal))
    except RevisionConflictError as stale:
        return conflict(str(stale), revision=stale.current)
    return JSONResponse(row)
