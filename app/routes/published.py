"""Publishing a design, and the addresses it is then served at (see
app/models/published.py). Anyone who can edit the experiment can publish;
reading works for them too, with a session or an API key, which is how a
runner on another machine fetches its plans.
"""
from __future__ import annotations

from pathlib import Path

from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response

from app.core.db import Store
from app.core.security import actor_from, check_csrf
from app.models import experiments, published, users
from app.models.experiments import NoSuchExperimentError
from app.models.plans import BadPlanError, check_plan
from app.models.published import BadPublishError, NothingPublishedError
from app.routes.helpers import bad_request, forbidden, get_config, get_store, not_found, read_json, run
from app.routes.media import MissingMediaError, files_for_plans

NOTHING = "nothing published"
# A published SVG came from a browser, not from this server. Served as an
# image it can do nothing, but opened directly it is a document on this origin,
# so it gets no scripts and no way to reach anything.
SVG_HEADERS = {"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox", "x-content-type-options": "nosniff"}
MEDIA_TYPES = {".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json"}


def _publish(store: Store, storage_dir: Path, experiment_id: str, user_id: int, body: dict) -> dict:
    experiment = experiments.experiment_for(store, experiment_id, user_id)
    version = body.get("version") or published.begin(store, storage_dir, experiment.id)
    plans = body.get("plans")
    if isinstance(plans, list):
        # Every picture a plan names must be this experiment's.
        files_for_plans(store, storage_dir, experiment.id, [check_plan(plan) for plan in plans])
    published.add_parts(storage_dir, experiment.id, version, plans, body.get("figures"))
    if body.get("finish") is True:
        return _row(store, published.finish(store, storage_dir, experiment, user_id, version, body.get("seed")))
    return {"version": version}


def _row(store: Store, record: dict) -> dict:
    names = {user.id: user.display_name for user in users.list_users(store)}
    return dict(record, published_by_name=names.get(record["published_by"], ""))


async def publish(request: Request) -> Response:
    body = await read_json(request)
    if body is None:
        return bad_request("malformed request body")
    if not check_csrf(request, body.get("csrf_token")):
        return forbidden("invalid csrf token")
    try:
        row = await run(_publish, get_store(request), get_config(request).storage_dir, request.path_params["experiment_id"], actor_from(request).user.id, body)
    except NoSuchExperimentError:
        return not_found("no such experiment")
    except (BadPublishError, BadPlanError, MissingMediaError) as refusal:
        return bad_request(str(refusal))
    return JSONResponse(row)


def _manifest(store: Store, experiment_id: str, user_id: int) -> dict:
    experiment = experiments.experiment_for(store, experiment_id, user_id)
    return dict(_row(store, published.manifest(store, experiment.id)), current_revision=experiment.revision)


async def get_manifest(request: Request) -> Response:
    try:
        return JSONResponse(await run(_manifest, get_store(request), request.path_params["experiment_id"], actor_from(request).user.id))
    except NoSuchExperimentError:
        return not_found("no such experiment")
    except NothingPublishedError:
        return not_found(NOTHING)


def _file(store: Store, storage_dir: Path, experiment_id: str, user_id: int, kind: str, name: str) -> Path:
    experiment = experiments.experiment_for(store, experiment_id, user_id)
    return published.file_path(store, storage_dir, experiment.id, kind, name)


async def _serve(request: Request, kind: str) -> Response:
    name = request.path_params["name"]
    try:
        path = await run(_file, get_store(request), get_config(request).storage_dir, request.path_params["experiment_id"], actor_from(request).user.id, kind, name)
    except NoSuchExperimentError:
        return not_found("no such experiment")
    except NothingPublishedError:
        return not_found(NOTHING)
    headers = {"cache-control": "no-cache"}
    if path.suffix == ".svg":
        headers.update(SVG_HEADERS)
    return FileResponse(path, media_type=MEDIA_TYPES[path.suffix], headers=headers)


async def serve_plan(request: Request) -> Response:
    return await _serve(request, "plans")


async def serve_figure(request: Request) -> Response:
    return await _serve(request, "figures")
