"""Publishing a design, and the addresses it is then served at (see
app/models/published.py). Anyone who can edit the experiment can publish;
reading works for them too, with a session or an API key, which is how a
runner on another machine fetches its plans.
"""
from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any

import msgspec
from msgspec import UNSET, Meta, UnsetType
from starlette.requests import Request
from starlette.responses import FileResponse, Response

from app.apidocs import PATH, Reply, route
from app.apidocs import Request as RequestType
from app.core.db import Store
from app.core.security import actor_from
from app.models import experiments, published, users
from app.models.experiments import NoSuchExperimentError
from app.models.plans import BadPlanError, check_plan
from app.models.published import BadPublishError, NothingPublishedError
from app.routes.helpers import DateTime, Refused, get_config, get_store
from app.routes.media import MissingMediaError, files_for_plans

NOTHING = "nothing published"
NO_SUCH_EXPERIMENT = "no such experiment"
# A published SVG came from a browser, not from this server. Served as an
# image it can do nothing, but opened directly it is a document on this origin,
# so it gets no scripts and no way to reach anything.
SVG_HEADERS = {"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox", "x-content-type-options": "nosniff"}
MEDIA_TYPES = {".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json"}

ExperimentID = Annotated[str, PATH, Meta(description="The experiment's id, from GET /api/experiments (list_experiments over MCP).")]


class ExperimentPath(RequestType):
    experiment_id: ExperimentID


class Publish(RequestType):
    experiment_id: ExperimentID
    version: Annotated[str, Meta(description="The version the first part answered; empty to start a publish.")] = ""
    plans: Annotated[list[Any] | None, Meta(description="Run plans (fmri-run-plan/1), as the browser compiles them.")] = None
    figures: Annotated[list[Any] | None, Meta(description="Figures: {name, svg, png}, png as base64.")] = None
    finish: Annotated[bool, Meta(description="True on the last part: it becomes the published copy.")] = False
    seed: Annotated[int | None, Meta(description="The design's seed, recorded with the publish.")] = None


class PublishReply(Reply):
    """A part's answer is its version alone; the last part's (finish) is the
    whole manifest."""

    version: str
    experiment_id: str | UnsetType = UNSET
    published_at: DateTime | UnsetType = UNSET
    published_by: int | UnsetType = UNSET
    published_by_name: str | UnsetType = UNSET
    revision: int | UnsetType = UNSET
    seed: int | UnsetType = UNSET
    plans: list[dict[str, Any]] | UnsetType = UNSET
    figures: list[str] | UnsetType = UNSET


class Manifest(Reply):
    """What an experiment's last publish holds."""

    experiment_id: str
    version: str
    published_at: DateTime
    published_by: int
    published_by_name: str
    revision: Annotated[int, Meta(description="The experiment's revision it was published from.")]
    seed: int
    plans: Annotated[list[dict[str, Any]], Meta(description="label, run, name, total_seconds, volumes, media, and session for a session's plan. Each is at published/plans/<label>.json.")]
    figures: Annotated[list[str], Meta(description="File names, each at published/figures/<name>.")]


class ManifestReply(Manifest):
    current_revision: Annotated[int, Meta(description="The experiment's revision now.")]


def _publish(store: Store, storage_dir: Path, experiment_id: str, user_id: int, body: Publish) -> dict:
    experiment = experiments.experiment_for(store, experiment_id, user_id)
    version = body.version or published.begin(store, storage_dir, experiment.id)
    plans = body.plans
    if isinstance(plans, list):
        # Every picture a plan names must be this experiment's.
        files_for_plans(store, storage_dir, experiment.id, [check_plan(plan) for plan in plans])
    published.add_parts(storage_dir, experiment.id, version, plans, body.figures)
    if body.finish:
        return _row(store, published.finish(store, storage_dir, experiment, user_id, version, body.seed))
    return {"version": version}


def _row(store: Store, record: dict) -> dict:
    names = {user.id: user.display_name for user in users.list_users(store)}
    return dict(record, published_by_name=names.get(record["published_by"], ""))


@route(
    "POST /api/experiments/{experiment_id}/publish", summary="Publish the experiment's run plans and figures",
    tag="Experiments", errors=(404,),
    description="In parts small enough for a request each: the first part (no version) starts a publish and "
    "answers its version, each later part sends it, and the part with finish makes it the published copy, "
    "answering the manifest. Readers see the old copy until then.",
    mcp_http="Publishing compiles the plans in the browser.",
)
def publish(request: Request, body: Publish) -> PublishReply:
    try:
        row = _publish(get_store(request), get_config(request).storage_dir, body.experiment_id, actor_from(request).user.id, body)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH_EXPERIMENT) from None
    except (BadPublishError, BadPlanError, MissingMediaError) as refusal:
        raise Refused(400, str(refusal)) from None
    return msgspec.convert(row, PublishReply)


def _manifest(store: Store, experiment_id: str, user_id: int) -> dict:
    experiment = experiments.experiment_for(store, experiment_id, user_id)
    return dict(_row(store, published.manifest(store, experiment.id)), current_revision=experiment.revision)


@route(
    "GET /api/experiments/{experiment_id}/published", summary="What was last published",
    tag="Experiments", errors=(404,),
    description="The manifest of an experiment's last publish: its version, the revision it was made from, who "
    "published it and when, and the run plans and figures in it (fetched over HTTP by name), plus "
    "current_revision, so you can tell whether the design changed since. Publishing itself is done from the "
    "browser, which compiles the plans.",
    mcp="get_published", read_only=True,  # feature:mcp
)
def get_manifest(request: Request, body: ExperimentPath) -> ManifestReply:
    try:
        row = _manifest(get_store(request), body.experiment_id, actor_from(request).user.id)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH_EXPERIMENT) from None
    except NothingPublishedError:
        raise Refused(404, NOTHING) from None
    return msgspec.convert(row, ManifestReply)


def _serve(request: Request, experiment_id: str, kind: str, name: str) -> Response:
    try:
        experiment = experiments.experiment_for(get_store(request), experiment_id, actor_from(request).user.id)
        path = published.file_path(get_store(request), get_config(request).storage_dir, experiment.id, kind, name)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH_EXPERIMENT) from None
    except NothingPublishedError:
        raise Refused(404, NOTHING) from None
    headers = {"cache-control": "no-cache"}
    if path.suffix == ".svg":
        headers.update(SVG_HEADERS)
    return FileResponse(path, media_type=MEDIA_TYPES[path.suffix], headers=headers)


class PublishedFile(RequestType):
    experiment_id: ExperimentID
    name: Annotated[str, PATH, Meta(description="A file name from the manifest (GET .../published).")]


@route(
    "GET /api/experiments/{experiment_id}/published/plans/{name}", summary="Get a published run plan",
    tag="Experiments", errors=(404,),
    description="One run plan of the last publish, as fmri-run-plan/1 JSON: what a runner plays. name is "
    "<label>.json from the manifest.",
    mcp_http="A runner fetches its plans over HTTP with its key; get_published lists them.",
)
def serve_plan(request: Request, body: PublishedFile) -> dict[str, Any]:
    return _serve(request, body.experiment_id, "plans", body.name)  # type: ignore[return-value]


@route(
    "GET /api/experiments/{experiment_id}/published/figures/{name}", summary="Get a published figure",
    tag="Experiments", errors=(404,), reply_type="application/octet-stream",
    reply_description="The figure, as SVG (with a sandboxing Content-Security-Policy) or PNG, by its name.",
    mcp_http="Figure bytes: MCP messages are JSON.",
)
def serve_figure(request: Request, body: PublishedFile) -> Response:
    return _serve(request, body.experiment_id, "figures", body.name)
