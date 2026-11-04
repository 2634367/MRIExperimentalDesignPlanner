"""Pictures for an experiment: upload one, fetch one from a URL, serve one.

An upload is the file itself as the request body, not a multipart form, so no
form-parsing dependency is needed; the CSRF token travels in the
X-CSRF-Token header since there is no JSON body to carry it.

A picture is served only through an experiment it was added to (or that
experiment's share link -- see share.py), with a long private cache: its
address is its content, so it can never change under that URL.
"""
from __future__ import annotations

from pathlib import Path

from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response

from app.core import fetch_image, images
from app.core.db import Store
from app.core.security import actor_from, check_csrf
from app.models import experiments, media
from app.models.experiments import NoSuchExperimentError
from app.models.plans import media_used
from app.routes.helpers import bad_request, error, forbidden, get_config, get_store, not_found, read_json, run

CACHE = "private, max-age=31536000, immutable"


class MissingMediaError(Exception):
    pass


def _add(store: Store, storage_dir: Path, experiment_id: str, user_id: int, data: bytes) -> dict:
    experiments.experiment_for(store, experiment_id, user_id)
    return media.add_media(store, storage_dir, data, experiment_id).row()


async def upload(request: Request) -> Response:
    if not check_csrf(request, request.headers.get("x-csrf-token")):
        return forbidden("invalid csrf token")
    cfg = get_config(request)
    data = await request.body()
    if len(data) > cfg.media_max_bytes:
        return error(413, f"the picture is larger than {cfg.media_max_bytes // (1024 * 1024)} MB")
    try:
        row = await run(_add, get_store(request), cfg.storage_dir, request.path_params["experiment_id"], actor_from(request).user.id, data)
    except NoSuchExperimentError:
        return not_found("no such experiment")
    except images.BadImageError as refusal:
        return bad_request(str(refusal))
    return JSONResponse(row, status_code=201)


def _fetch_and_add(store: Store, storage_dir: Path, max_bytes: int, experiment_id: str, user_id: int, url: str) -> dict:
    # Access first, so a stranger cannot use this server to fetch URLs at all.
    experiments.experiment_for(store, experiment_id, user_id)
    data, final_url = fetch_image.fetch(url, max_bytes)
    row = media.add_media(store, storage_dir, data, experiment_id).row()
    row["source_url"] = final_url
    return row


async def from_url(request: Request) -> Response:
    body = await read_json(request)
    if body is None:
        return bad_request("malformed request body")
    if not check_csrf(request, body.get("csrf_token")):
        return forbidden("invalid csrf token")
    cfg = get_config(request)
    try:
        row = await run(
            _fetch_and_add, get_store(request), cfg.storage_dir, cfg.media_max_bytes,
            request.path_params["experiment_id"], actor_from(request).user.id, body.get("url"),
        )
    except NoSuchExperimentError:
        return not_found("no such experiment")
    except (fetch_image.FetchError, images.BadImageError) as refusal:
        return bad_request(str(refusal))
    return JSONResponse(row, status_code=201)


def media_response(store: Store, storage_dir: Path, experiment_id: str, filename: str) -> Response:
    sha, _, ext = filename.partition(".")
    found = media.media_in(store, sha, experiment_id)
    if found is None or found.ext != ext:
        return not_found("no such picture")
    path = media.file_path(storage_dir, found)
    if not path.is_file():
        return not_found("no such picture")
    return FileResponse(path, media_type=found.mime, headers={"cache-control": CACHE})


def _serve(store: Store, storage_dir: Path, experiment_id: str, user_id: int, filename: str) -> Response:
    experiments.experiment_for(store, experiment_id, user_id)
    return media_response(store, storage_dir, experiment_id, filename)


async def serve(request: Request) -> Response:
    try:
        return await run(
            _serve, get_store(request), get_config(request).storage_dir,
            request.path_params["experiment_id"], actor_from(request).user.id, request.path_params["filename"],
        )
    except NoSuchExperimentError:
        return not_found("no such experiment")


def files_for_plans(store: Store, storage_dir: Path, experiment_id: str, plans: list[dict]) -> dict[str, Path]:
    """<sha>.<ext> -> the file on disk, for every picture the plans draw.
    Each one must belong to the experiment, so a plan cannot pull in a picture
    from somewhere else. Raises MissingMediaError naming the first one that
    does not."""
    files: dict[str, Path] = {}
    for sha, entry in media_used(plans).items():
        found = media.media_in(store, sha, experiment_id)
        if found is None or found.ext != entry["ext"]:
            raise MissingMediaError(f"picture {sha[:12]} is not part of this experiment")
        path = media.file_path(storage_dir, found)
        if not path.is_file():
            raise MissingMediaError(f"picture {sha[:12]} is missing from storage")
        files[found.filename] = path
    return files
