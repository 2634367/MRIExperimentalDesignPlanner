"""Read-only share links (see app/models/share_links.py).

Making, listing and revoking a link is for someone who can edit the
experiment; making one needs a browser session -- a link is a credential, and
keys never create those. Opening one is public: /s/<credential> serves the
ordinary app page, which sees the path and asks /api/share/open for the
design. Holding the link is the permission, checked on every request; nothing
is stored in the visitor's browser.
"""
from __future__ import annotations

from typing import Annotated, Any, Callable, ClassVar

import msgspec
from msgspec import Meta
from starlette.requests import Request
from starlette.responses import Response

from app.apidocs import PATH, PUBLIC, SESSION_ONLY, Reply, route
from app.apidocs import Request as RequestType
from app.core import bundle
from app.core.db import Store
from app.core.security import actor_from
from app.mcp.registry import Call  # feature:mcp
from app.models import experiments, share_links
from app.models.experiments import NoSuchExperimentError
from app.models.plans import MAX_PLANS, BadPlanError, check_plans
from app.models.share_links import ShareLinkInvalidError, TooManyShareLinksError
from app.routes.experiments import NO_SUCH, Doc, ExperimentID, ExperimentPath
from app.routes.helpers import DateTime, Refused, get_config, get_store
from app.routes.media import MissingMediaError, files_for_plans, media_response

TAG = "Share links"
INVALID = "this share link does not work any more"

Credential = Annotated[str, Meta(description="The share link's credential: what follows /s/ in the link.")]


class ShareLink(Reply):
    """A share link, without its secret."""

    api_name: ClassVar[str] = "ShareLink"
    id: str
    label: str
    created_by: Annotated[int, Meta(description="The user id of whoever made it.")]
    created_at: DateTime
    revoked: bool


def _rows(store: Store, experiment_id: str, user_id: int) -> list[dict]:
    experiments.experiment_for(store, experiment_id, user_id)
    return [link.row() for link in share_links.links_for(store, experiment_id)]


def list_share_links(call: Call, body: Any, serve: Callable[[Any, Any], Any]) -> dict[str, Any]:  # feature:mcp
    """The route answers a bare list; a tool answers an object."""  # feature:mcp
    return {"links": msgspec.to_builtins(serve(call.request, body))}  # feature:mcp


@route(
    "GET /api/experiments/{experiment_id}/share-links", summary="List an experiment's share links",
    tag=TAG, errors=(404,),
    description="The read-only links to this experiment that are out there: id, label, who made it, when, and "
    "whether it still works. Making one needs a browser.",
    mcp="list_share_links", read_only=True, call=list_share_links,  # feature:mcp
)
def list_links(request: Request, body: ExperimentPath) -> list[ShareLink]:
    try:
        rows = _rows(get_store(request), body.experiment_id, actor_from(request).user.id)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None
    return [ShareLink(**row) for row in rows]


class CreateLinkRequest(ExperimentPath):
    label: Annotated[str, Meta(description=f"What the link is for. Cut to {share_links.LABEL_MAX} characters.")] = ""


class NewShareLink(ShareLink):
    api_name: ClassVar[str] = "NewShareLink"
    path: Annotated[str, Meta(description="/s/<credential>: the link itself, shown once.")]


def _issue(store: Store, experiment_id: str, user_id: int, label: str) -> dict:
    experiment = experiments.experiment_for(store, experiment_id, user_id)
    credential, link = share_links.issue_share_link(store, experiment, label, user_id)
    row = link.row()
    row["path"] = f"/s/{credential}"
    return row


@route(
    "POST /api/experiments/{experiment_id}/share-links", summary="Make a read-only share link",
    tag=TAG, access=SESSION_ONLY, status=201, errors=(404,),
    reply_description="Created",
)
def create_link(request: Request, body: CreateLinkRequest) -> NewShareLink:
    try:
        row = _issue(get_store(request), body.experiment_id, actor_from(request).user.id, body.label)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None
    except TooManyShareLinksError as refusal:
        raise Refused(400, str(refusal)) from None
    return NewShareLink(**row)


class LinkPath(RequestType):
    experiment_id: ExperimentID
    link_id: Annotated[str, PATH, Meta(description="The link's id, from GET /api/experiments/{experiment_id}/share-links (list_share_links over MCP).")]


class OKReply(Reply):
    ok: bool


def _revoke(store: Store, experiment_id: str, user_id: int, link_id: str) -> bool:
    experiments.experiment_for(store, experiment_id, user_id)
    return share_links.revoke_share_link(store, experiment_id, link_id)


@route(
    "POST /api/experiments/{experiment_id}/share-links/{link_id}/revoke", summary="Revoke a share link",
    tag=TAG, errors=(404,),
    description="Stops a share link working, for good.",
    mcp_note="link_id is from list_share_links.",  # feature:mcp
    mcp="revoke_share_link", destructive=True,  # feature:mcp
)
def revoke_link(request: Request, body: LinkPath) -> OKReply:
    try:
        revoked = _revoke(get_store(request), body.experiment_id, actor_from(request).user.id, body.link_id)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None
    if not revoked:
        raise Refused(404, "no such share link")
    return OKReply(ok=True)


# -- the public side ----------------------------------------------------------
# Holding the link is the permission, so none of these looks for a csrf
# token: there is no session to forge.


class SharedRequest(RequestType):
    credential: Credential


def _load(store: Store, credential: str) -> tuple[share_links.ShareLink, experiments.Experiment]:
    try:
        return share_links.load_shared(store, credential)
    except ShareLinkInvalidError:
        raise Refused(404, INVALID) from None


class SharedExperiment(Reply):
    id: str
    name: str
    label: Annotated[str, Meta(description="The share link's label.")]
    revision: int
    doc: Doc


@route(
    "POST /api/share/open", summary="Open the experiment behind a share link",
    tag=TAG, access=PUBLIC, errors=(404,),
)
def open_shared(request: Request, body: SharedRequest) -> SharedExperiment:
    link, experiment = _load(get_store(request), body.credential)
    return SharedExperiment(id=experiment.id, name=experiment.name, label=link.label, revision=experiment.revision, doc=experiment.doc)


class SharedRevision(Reply):
    revision: int
    updated_by_name: Annotated[str, Meta(description="Always empty: a share link does not say who edits.")]


@route(
    "POST /api/share/revision", summary="The current revision behind a share link",
    tag=TAG, access=PUBLIC, errors=(404,),
)
def shared_revision(request: Request, body: SharedRequest) -> SharedRevision:
    _, experiment = _load(get_store(request), body.credential)
    return SharedRevision(revision=experiment.revision, updated_by_name="")


class SharedMediaPath(RequestType):
    credential: Annotated[str, PATH, Meta(description="The share link's credential: what follows /s/ in the link.")]
    filename: Annotated[str, PATH, Meta(description="<sha256>.<ext>, as the design's media lists it.")]


@route(
    "GET /s/{credential}/media/{filename}", summary="A picture, through a share link",
    tag=TAG, access=PUBLIC, errors=(404,), reply_type="application/octet-stream",
    reply_description="The picture, in its own image type",
)
def shared_media(request: Request, body: SharedMediaPath) -> Response:
    _, experiment = _load(get_store(request), body.credential)
    response = media_response(get_store(request), get_config(request).storage_dir, experiment.id, body.filename)
    # The credential is in this URL; keep it out of anything cached publicly.
    response.headers["referrer-policy"] = "no-referrer"
    return response


class SharedBundleRequest(SharedRequest):
    plans: Annotated[
        list[dict[str, Any]],
        Meta(description=f"1 to {MAX_PLANS} run plans (fmri-run-plan/1), as static/js/compile.js makes them.",
             extra={"error": f"send 1 to {MAX_PLANS} run plans"}),
    ]


@route(
    "POST /api/share/bundle", summary="Download the PsychoPy bundle through a share link",
    tag=TAG, access=PUBLIC, errors=(404,), reply_type="application/zip",
    reply_description="The bundle, as an attachment",
)
def shared_bundle(request: Request, body: SharedBundleRequest) -> Response:
    store = get_store(request)
    _, experiment = _load(store, body.credential)
    try:
        checked = check_plans(body.plans)
        files = files_for_plans(store, get_config(request).storage_dir, experiment.id, checked)
    except (BadPlanError, MissingMediaError) as refusal:
        raise Refused(400, str(refusal)) from None
    return zip_response(experiment.name, bundle.build(experiment.name, checked, files))


def zip_response(name: str, data: bytes) -> Response:
    filename = bundle.folder_name(name) + ".zip"
    return Response(
        data,
        media_type="application/zip",
        headers={"content-disposition": f'attachment; filename="{filename}"', "cache-control": "no-store"},
    )
