"""Running a design: download a PsychoPy bundle, or start PsychoPy here.

Both take run plans the browser compiled (static/js/compile.js) and check
them with app.models.plans before anything touches the disk. The bundle works
for anyone who can open the experiment. Launching starts a process on this
machine, so it needs a browser session (never an API key) and is refused
unless app/core/psychopy.py says this server may do it.
"""
from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core import bundle, psychopy
from app.core.db import Store
from app.core.security import actor_from, check_csrf
from app.models import experiments, seen
from app.models.experiments import NoSuchExperimentError
from app.models.plans import BadPlanError, check_plans
from app.routes.helpers import bad_request, conflict, error, forbidden, get_config, get_store, not_found, read_json, run
from app.routes.media import MissingMediaError, files_for_plans
from app.routes.share import zip_response


async def get_status(request: Request) -> Response:
    refresh = request.query_params.get("refresh") == "1"
    current = await run(psychopy.status, get_config(request), refresh)
    return JSONResponse(current.row())


def _bundle(store: Store, storage_dir, experiment_id: str, user_id: int, plans: object) -> tuple[str, bytes]:
    experiment = experiments.experiment_for(store, experiment_id, user_id)
    checked = check_plans(plans)
    files = files_for_plans(store, storage_dir, experiment.id, checked)
    return experiment.name, bundle.build(experiment.name, checked, files)


async def download_bundle(request: Request) -> Response:
    body = await read_json(request)
    if body is None:
        return bad_request("malformed request body")
    if not check_csrf(request, body.get("csrf_token")):
        return forbidden("invalid csrf token")
    try:
        name, data = await run(
            _bundle, get_store(request), get_config(request).storage_dir,
            request.path_params["experiment_id"], actor_from(request).user.id, body.get("plans"),
        )
    except NoSuchExperimentError:
        return not_found("no such experiment")
    except (BadPlanError, MissingMediaError) as refusal:
        return bad_request(str(refusal))
    return zip_response(name, data)


def _launch(store: Store, cfg, experiment_id: str, user_id: int, body: dict) -> dict:
    experiment = experiments.experiment_for(store, experiment_id, user_id)
    checked = check_plans(body.get("plans"))
    files = files_for_plans(store, cfg.storage_dir, experiment.id, checked)
    label = body.get("label") if isinstance(body.get("label"), str) else ""
    launch = psychopy.start(
        cfg, checked, files, user_id, (label or experiment.name)[:200],
        body.get("scanner", "wait"), body.get("windowed") is True, body.get("screen", 0), body.get("debug") is True,
        on_end=lambda folder: seen.add_folder(store, experiment.id, folder),
    )
    return launch.row()


async def launch(request: Request) -> Response:
    body = await read_json(request)
    if body is None:
        return bad_request("malformed request body")
    if not check_csrf(request, body.get("csrf_token")):
        return forbidden("invalid csrf token")
    try:
        row = await run(_launch, get_store(request), get_config(request), request.path_params["experiment_id"], actor_from(request).user.id, body)
    except NoSuchExperimentError:
        return not_found("no such experiment")
    except (BadPlanError, MissingMediaError, ValueError) as refusal:
        return bad_request(str(refusal))
    except psychopy.LaunchUnavailableError as refusal:
        return error(503, str(refusal))
    except psychopy.AlreadyRunningError as refusal:
        return conflict(str(refusal))
    return JSONResponse(row, status_code=201)


def _read_seen(store: Store, experiment_id: str, user_id: int, participant: object) -> dict:
    experiment = experiments.experiment_for(store, experiment_id, user_id)
    return seen.read(store, experiment.id, participant if isinstance(participant, str) else "")


async def read_seen(request: Request) -> Response:
    """What a participant has been shown. A POST so the participant's label
    stays out of URLs and access logs."""
    body = await read_json(request)
    if body is None:
        return bad_request("malformed request body")
    if not check_csrf(request, body.get("csrf_token")):
        return forbidden("invalid csrf token")
    try:
        row = await run(_read_seen, get_store(request), request.path_params["experiment_id"], actor_from(request).user.id, body.get("participant"))
    except NoSuchExperimentError:
        return not_found("no such experiment")
    return JSONResponse(row)


def _add_seen(store: Store, experiment_id: str, user_id: int, runs: object) -> int:
    experiment = experiments.experiment_for(store, experiment_id, user_id)
    return seen.add_runs(store, experiment.id, runs)


async def add_seen(request: Request) -> Response:
    """Run records brought back from a bundle, trimmed by the run dialog to
    what seen.summarise keeps."""
    body = await read_json(request)
    if body is None:
        return bad_request("malformed request body")
    if not check_csrf(request, body.get("csrf_token")):
        return forbidden("invalid csrf token")
    try:
        added = await run(_add_seen, get_store(request), request.path_params["experiment_id"], actor_from(request).user.id, body.get("runs"))
    except NoSuchExperimentError:
        return not_found("no such experiment")
    except seen.BadRunError as refusal:
        return bad_request(str(refusal))
    return JSONResponse({"added": added})


async def latest_launch(request: Request) -> Response:
    found = psychopy.latest(actor_from(request).user.id)
    return JSONResponse(found.row() if found else None)


async def get_launch(request: Request) -> Response:
    found = psychopy.get(request.path_params["launch_id"], actor_from(request).user.id)
    if found is None:
        return not_found("no such launch")
    return JSONResponse(found.row())


async def stop_launch(request: Request) -> Response:
    body = await read_json(request)
    if body is None:
        return bad_request("malformed request body")
    if not check_csrf(request, body.get("csrf_token")):
        return forbidden("invalid csrf token")
    stopped = await run(psychopy.stop, request.path_params["launch_id"], actor_from(request).user.id)
    if stopped is None:
        return not_found("no such launch")
    return JSONResponse(stopped.row())
