"""Read-only share links (see app/models/share_links.py).

Making, listing and revoking a link is for someone who can edit the
experiment, from a browser session -- a link is a credential, and keys never
create those. Opening one is public: /s/<credential> serves the ordinary app
page, which sees the path and asks /api/share/open for the design. Holding
the link is the permission, checked on every request; nothing is stored in
the visitor's browser.
"""
from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core import bundle
from app.core.db import Store
from app.core.security import actor_from, check_csrf
from app.models import experiments, share_links
from app.models.experiments import NoSuchExperimentError
from app.models.plans import BadPlanError, check_plans
from app.models.share_links import ShareLinkInvalidError, TooManyShareLinksError
from app.routes.helpers import bad_request, forbidden, get_config, get_store, not_found, read_json, run
from app.routes.media import MissingMediaError, files_for_plans, media_response

INVALID = "this share link does not work any more"


def _rows(store: Store, experiment_id: str, user_id: int) -> list[dict]:
    experiments.experiment_for(store, experiment_id, user_id)
    return [link.row() for link in share_links.links_for(store, experiment_id)]


async def list_links(request: Request) -> Response:
    try:
        rows = await run(_rows, get_store(request), request.path_params["experiment_id"], actor_from(request).user.id)
    except NoSuchExperimentError:
        return not_found("no such experiment")
    return JSONResponse(rows)


def _issue(store: Store, experiment_id: str, user_id: int, label: str) -> dict:
    experiment = experiments.experiment_for(store, experiment_id, user_id)
    credential, link = share_links.issue_share_link(store, experiment, label, user_id)
    row = link.row()
    row["path"] = f"/s/{credential}"
    return row


async def create_link(request: Request) -> Response:
    body = await read_json(request)
    if body is None:
        return bad_request("malformed request body")
    if not check_csrf(request, body.get("csrf_token")):
        return forbidden("invalid csrf token")
    label = body.get("label") if isinstance(body.get("label"), str) else ""
    try:
        row = await run(_issue, get_store(request), request.path_params["experiment_id"], actor_from(request).user.id, label)
    except NoSuchExperimentError:
        return not_found("no such experiment")
    except TooManyShareLinksError as refusal:
        return bad_request(str(refusal))
    return JSONResponse(row, status_code=201)


def _revoke(store: Store, experiment_id: str, user_id: int, link_id: str) -> bool:
    experiments.experiment_for(store, experiment_id, user_id)
    return share_links.revoke_share_link(store, experiment_id, link_id)


async def revoke_link(request: Request) -> Response:
    body = await read_json(request)
    if body is None:
        return bad_request("malformed request body")
    if not check_csrf(request, body.get("csrf_token")):
        return forbidden("invalid csrf token")
    try:
        revoked = await run(
            _revoke, get_store(request), request.path_params["experiment_id"], actor_from(request).user.id,
            request.path_params["link_id"],
        )
    except NoSuchExperimentError:
        return not_found("no such experiment")
    if not revoked:
        return not_found("no such share link")
    return JSONResponse({"ok": True})


# -- the public side ----------------------------------------------------------


def _open(store: Store, credential: object) -> dict:
    link, experiment = share_links.load_shared(store, credential)
    return {"id": experiment.id, "name": experiment.name, "label": link.label, "revision": experiment.revision, "doc": experiment.doc}


async def open_shared(request: Request) -> Response:
    body = await read_json(request)
    if body is None:
        return bad_request("malformed request body")
    try:
        return JSONResponse(await run(_open, get_store(request), body.get("credential")))
    except ShareLinkInvalidError:
        return not_found(INVALID)


def _revision(store: Store, credential: object) -> dict:
    _, experiment = share_links.load_shared(store, credential)
    return {"revision": experiment.revision, "updated_by_name": ""}


async def shared_revision(request: Request) -> Response:
    body = await read_json(request)
    if body is None:
        return bad_request("malformed request body")
    try:
        return JSONResponse(await run(_revision, get_store(request), body.get("credential")))
    except ShareLinkInvalidError:
        return not_found(INVALID)


def _shared_media(store: Store, storage_dir, credential: str, filename: str) -> Response:
    _, experiment = share_links.load_shared(store, credential)
    return media_response(store, storage_dir, experiment.id, filename)


async def shared_media(request: Request) -> Response:
    try:
        response = await run(
            _shared_media, get_store(request), get_config(request).storage_dir,
            request.path_params["credential"], request.path_params["filename"],
        )
    except ShareLinkInvalidError:
        return not_found(INVALID)
    # The credential is in this URL; keep it out of anything cached publicly.
    response.headers["referrer-policy"] = "no-referrer"
    return response


def _shared_bundle(store: Store, storage_dir, credential: object, plans: object) -> tuple[str, bytes]:
    _, experiment = share_links.load_shared(store, credential)
    checked = check_plans(plans)
    files = files_for_plans(store, storage_dir, experiment.id, checked)
    return experiment.name, bundle.build(experiment.name, checked, files)


async def shared_bundle(request: Request) -> Response:
    body = await read_json(request)
    if body is None:
        return bad_request("malformed request body")
    try:
        name, data = await run(_shared_bundle, get_store(request), get_config(request).storage_dir, body.get("credential"), body.get("plans"))
    except ShareLinkInvalidError:
        return not_found(INVALID)
    except (BadPlanError, MissingMediaError) as refusal:
        return bad_request(str(refusal))
    return zip_response(name, data)


def zip_response(name: str, data: bytes) -> Response:
    filename = bundle.folder_name(name) + ".zip"
    return Response(
        data,
        media_type="application/zip",
        headers={"content-disposition": f'attachment; filename="{filename}"', "cache-control": "no-store"},
    )
