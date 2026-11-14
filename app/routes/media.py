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
from typing import Annotated

from msgspec import Meta
from starlette.requests import Request
from starlette.responses import FileResponse, Response

from app.apidocs import PATH, Reply, route
from app.apidocs import Request as RequestType
from app.core import fetch_image, images
from app.core.db import Store
from app.core.security import actor_from
from app.models import experiments, media
from app.models.experiments import NoSuchExperimentError
from app.models.plans import media_used
from app.routes.helpers import Refused, get_config, get_store, not_found, run

CACHE = "private, max-age=31536000, immutable"
NO_SUCH_EXPERIMENT = "no such experiment"

ExperimentID = Annotated[str, PATH, Meta(description="The experiment's id, from GET /api/experiments (list_experiments over MCP).")]


class MissingMediaError(Exception):
    pass


class ExperimentPath(RequestType):
    experiment_id: ExperimentID


class MediaRow(Reply):
    """A picture added to an experiment. Its address is
    /api/experiments/{experiment_id}/media/{id}.{ext}."""

    id: Annotated[str, Meta(description="The picture's SHA-256, which is its name.")]
    mime: str
    ext: str
    w: Annotated[int, Meta(description="Width in pixels.")]
    h: Annotated[int, Meta(description="Height in pixels.")]
    size: Annotated[int, Meta(description="Bytes.")]


class FetchedMediaRow(MediaRow):
    source_url: Annotated[str, Meta(description="Where the picture came from, after any redirects.")]


def _add(store: Store, storage_dir: Path, experiment_id: str, user_id: int, data: bytes) -> dict:
    experiments.experiment_for(store, experiment_id, user_id)
    return media.add_media(store, storage_dir, data, experiment_id).row()


@route(
    "POST /api/experiments/{experiment_id}/media", summary="Upload a picture",
    tag="Experiments", status=201, errors=(404,), body_type="application/octet-stream",
    reply_description="Created",
    description="The body is the picture's bytes. A browser session sends its csrf token in the X-CSRF-Token "
    "header. A picture over media.max_mb is refused with a 413.",
    mcp_http="Picture bytes: MCP messages are JSON. Send the file to this route with the same key.",
)
async def upload(request: Request, body: ExperimentPath) -> MediaRow:
    """The body is the raw file, not a multipart form, so its csrf token comes
    in the X-CSRF-Token header, which @route checks (body_type)."""
    cfg = get_config(request)
    data = await request.body()
    if len(data) > cfg.media_max_bytes:
        raise Refused(413, f"the picture is larger than {cfg.media_max_bytes // (1024 * 1024)} MB")
    try:
        row = await run(_add, get_store(request), cfg.storage_dir, body.experiment_id, actor_from(request).user.id, data)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH_EXPERIMENT) from None
    except images.BadImageError as refusal:
        raise Refused(400, str(refusal)) from None
    return MediaRow(**row)


def _fetch_and_add(store: Store, storage_dir: Path, max_bytes: int, experiment_id: str, user_id: int, url: str) -> dict:
    # Access first, so a stranger cannot use this server to fetch URLs at all.
    experiments.experiment_for(store, experiment_id, user_id)
    data, final_url = fetch_image.fetch(url, max_bytes)
    row = media.add_media(store, storage_dir, data, experiment_id).row()
    row["source_url"] = final_url
    return row


class FromURL(RequestType):
    experiment_id: ExperimentID
    url: Annotated[str, Meta(description="An http or https address of a picture.", extra={"error": "that is not a web address"})]


@route(
    "POST /api/experiments/{experiment_id}/media/url", summary="Add a picture fetched from a URL",
    tag="Experiments", status=201, errors=(404,), reply_description="Created",
    mcp_http="Adding pictures is part of editing a design in the browser; a picture's bytes never pass through MCP.",
)
def from_url(request: Request, body: FromURL) -> FetchedMediaRow:
    cfg = get_config(request)
    try:
        row = _fetch_and_add(get_store(request), cfg.storage_dir, cfg.media_max_bytes, body.experiment_id, actor_from(request).user.id, body.url)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH_EXPERIMENT) from None
    except (fetch_image.FetchError, images.BadImageError) as refusal:
        raise Refused(400, str(refusal)) from None
    return FetchedMediaRow(**row)


def media_response(store: Store, storage_dir: Path, experiment_id: str, filename: str) -> Response:
    sha, _, ext = filename.partition(".")
    found = media.media_in(store, sha, experiment_id)
    if found is None or found.ext != ext:
        return not_found("no such picture")
    path = media.file_path(storage_dir, found)
    if not path.is_file():
        return not_found("no such picture")
    return FileResponse(path, media_type=found.mime, headers={"cache-control": CACHE})


class MediaPath(RequestType):
    experiment_id: ExperimentID
    filename: Annotated[str, PATH, Meta(description="The picture's id and extension: <id>.<ext>.")]


@route(
    "GET /api/experiments/{experiment_id}/media/{filename}", summary="Get a picture",
    tag="Experiments", errors=(404,), reply_type="application/octet-stream",
    reply_description="The picture, in its own image type, with a long private cache: its address is its content.",
    mcp_http="Picture bytes: MCP messages are JSON.",
)
def serve(request: Request, body: MediaPath) -> Response:
    """Only through an experiment the picture was added to."""
    store = get_store(request)
    try:
        experiments.experiment_for(store, body.experiment_id, actor_from(request).user.id)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH_EXPERIMENT) from None
    return media_response(store, get_config(request).storage_dir, body.experiment_id, body.filename)


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
