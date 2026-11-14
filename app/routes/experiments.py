"""Experiments: list, open, save, duplicate, share with editors, delete.

The document is stored as the browser sends it (see app/models/experiments.py
for the few things checked). Every route here works for whoever can edit the
experiment -- its owner and its editors -- except changing the editors and
deleting it, which are the owner's.

Each route is also an MCP tool where an agent has a use for it (mcp= in its
@route), so an agent sees exactly what the browser sees and is refused for the
same reasons. A save needs the revision it was made from, like the
browser's, so an agent cannot silently overwrite a person's edit. Deleting and
restoring need a browser session.
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
from app.mcp.registry import Call  # feature:mcp
from app.models import RestoreError, actions, experiments, media, users
from app.models.experiments import (
    BadDocumentError,
    Experiment,
    NoSuchExperimentError,
    NotOwnerError,
    RevisionConflictError,
)
from app.routes.helpers import DateTime, Refused, get_store, restore_refusal

NO_SUCH = "no such experiment"
TAG = "Experiments"

# What get_experiment's doc holds, for the agent reading it.
DOC_GUIDE = (
    "The doc holds scanner settings, display defaults, the fixation mark, design-wide jitter, the hours budget, media "
    "(pictures by sha256), prompt lists (columns + items), trial_types (phases with durations and layers; a layer value "
    "written {column} is filled from the trial's prompt item; a duration with inherit set follows doc.jitter), runs "
    "(blocks of trial types) and sessions (steps, each with a repeat count)."
)
ACTION_GUIDE = (
    "action is <thing>.<verb>: things are list, item, trial, phase, run, block, session, step; verbs are add (fields; "
    "returns the new id), update (id, fields; only those fields change), delete (id; refused while something uses it) "
    "and move (id, position from 0). An item needs list, a phase trial, a block run, a step session: each the parent's "
    "id. Also settings.update (section: scanner, display, keys, budget, limits, hrf, jitter, fixation or meta; fields) "
    "and experiment.update (fields: name, notes). A new thing needs only the fields you care about; the rest get their "
    "defaults."
)

ExperimentID = Annotated[str, PATH, Meta(description="The experiment's id, from GET /api/experiments (list_experiments over MCP).")]
Doc = Annotated[dict[str, Any], Meta(description="The whole design document.")]


class ExperimentPath(RequestType):
    """The experiment a route under /api/experiments/{experiment_id} acts on."""

    experiment_id: ExperimentID


class Editor(Reply):
    api_name: ClassVar[str] = "ExperimentEditor"
    id: int
    display_name: str


class ExperimentRow(Reply):
    """An experiment as the list shows it."""

    api_name: ClassVar[str] = "Experiment"
    id: str
    name: str
    owner: Annotated[int, Meta(description="The owner's user id.")]
    owner_name: str
    is_owner: Annotated[bool, Meta(description="Whether you own it: only the owner sets editors and deletes it.")]
    editors: list[Editor]
    revision: int
    created_at: DateTime
    updated_at: DateTime
    updated_by_name: str


class ExperimentDoc(ExperimentRow):
    """An experiment with its design document."""

    api_name: ClassVar[str] = "ExperimentWithDoc"
    doc: Doc


class RevisionReply(Reply):
    revision: int
    updated_by_name: Annotated[str, Meta(description="Who changed it last, or empty when it was you.")]


class SavedReply(Reply):
    id: str
    revision: int
    updated_at: DateTime


class OKReply(Reply):
    ok: bool


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
        "created_at": experiment.created_at.isoformat(),
        "updated_at": experiment.updated_at.isoformat(),
        "updated_by_name": names.get(experiment.updated_by, ""),
    }
    if with_doc:
        row["doc"] = experiment.doc
    return row


def _doc_reply(store: Store, experiment: Experiment, user_id: int) -> ExperimentDoc:
    return msgspec.convert(experiment_row(store, experiment, user_id, True), ExperimentDoc)


def _row_reply(store: Store, experiment: Experiment, user_id: int) -> ExperimentRow:
    return msgspec.convert(experiment_row(store, experiment, user_id), ExperimentRow)


def list_rows(store: Store, user_id: int) -> list[dict[str, Any]]:
    return [experiment_row(store, experiment, user_id) for experiment in experiments.list_for_user(store, user_id)]


def revision_row(store: Store, experiment_id: str, user_id: int) -> dict[str, Any]:
    """What an open page asks every few seconds. Raises NoSuchExperimentError
    once the experiment is deleted or this user can no longer open it."""
    experiment = experiments.experiment_for(store, experiment_id, user_id)
    names = {user.id: user.display_name for user in users.list_users(store)}
    return {"revision": experiment.revision, "updated_by_name": "" if experiment.updated_by == user_id else names.get(experiment.updated_by, "")}


def _user_id(request: Request) -> int:
    return actor_from(request).user.id


def list_experiments_tool(call: Call, body: Any, serve: Callable[[Any, Any], Any]) -> dict[str, Any]:  # feature:mcp
    """The route answers a bare list; a tool answers an object."""  # feature:mcp
    return {"experiments": msgspec.to_builtins(serve(call.request, body))}  # feature:mcp


@route(
    "GET /api/experiments", summary="List experiments",
    tag=TAG,
    description="Every experiment this account owns or can edit: id, name, owner, editors, revision and when it last changed.",
    mcp="list_experiments", read_only=True, call=list_experiments_tool,  # feature:mcp
)
def list_experiments(request: Request) -> list[ExperimentRow]:
    return msgspec.convert(list_rows(get_store(request), _user_id(request)), list[ExperimentRow])


class CreateExperiment(RequestType):
    doc: Annotated[dict[str, Any], Meta(description="A design document: at least {\"name\": ..., \"format_version\": 3}.", extra={"error": "doc must be an object"})]


@route(
    "POST /api/experiments", summary="Create an experiment",
    tag=TAG, status=201,
    description="A new experiment owned by this account. doc needs at least name and format_version (3); everything "
    "left out gets its default when the experiment is opened or changed. Answers the new experiment with its doc.",
    mcp_note="To start from another experiment, duplicate_experiment is simpler; experiment_action changes it a piece at a time.",  # feature:mcp
    mcp="create_experiment",
)
def create_experiment(request: Request, body: CreateExperiment) -> ExperimentDoc:
    store, user_id = get_store(request), _user_id(request)
    try:
        created = experiments.create_experiment(store, user_id, body.doc)
    except BadDocumentError as refusal:
        raise Refused(400, str(refusal)) from None
    return _doc_reply(store, created, user_id)


@route(
    "GET /api/experiments/{experiment_id}", summary="Read an experiment",
    tag=TAG, errors=(404,),
    description="One experiment's full design document (doc) and its revision. " + DOC_GUIDE,
    mcp="get_experiment", read_only=True,
)
def get_experiment(request: Request, body: ExperimentPath) -> ExperimentDoc:
    store, user_id = get_store(request), _user_id(request)
    try:
        experiment = experiments.experiment_for(store, body.experiment_id, user_id)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None
    return _doc_reply(store, experiment, user_id)


@route(
    "GET /api/experiments/{experiment_id}/revision", summary="An experiment's revision",
    tag=TAG, errors=(404,),
    description="Only the revision, and who changed it last if not you: a cheap way to see whether an experiment "
    "changed since it was read. An open page asks every few seconds.",
    mcp="experiment_revision", read_only=True,
)
def get_revision(request: Request, body: ExperimentPath) -> RevisionReply:
    try:
        return RevisionReply(**revision_row(get_store(request), body.experiment_id, _user_id(request)))
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None


class SaveExperiment(RequestType):
    experiment_id: ExperimentID
    doc: Annotated[dict[str, Any], Meta(description="The whole design document.", extra={"error": "doc must be an object"})]
    base_revision: Annotated[int, Meta(ge=1, description="The revision the doc was read at.", extra={"error": "base_revision must be a revision number"})]


@route(
    "POST /api/experiments/{experiment_id}/save", summary="Save an experiment",
    tag=TAG, errors=(404, 409),
    description="Replace an experiment's design document. Send the whole doc as read, changed, with base_revision "
    "set to the revision it came from. Refused with 409 (and the current revision) if it has changed since; read it "
    "again and reapply. Anyone with the experiment open in a browser sees the change within a few seconds.",
    mcp_note="Read it with get_experiment.",  # feature:mcp
    mcp="save_experiment",
)
def save_experiment(request: Request, body: SaveExperiment) -> SavedReply:
    try:
        saved = experiments.save_doc(get_store(request), body.experiment_id, _user_id(request), body.doc, body.base_revision)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None
    except BadDocumentError as refusal:
        raise Refused(400, str(refusal)) from None
    except RevisionConflictError as stale:
        raise Refused(409, str(stale), revision=stale.current) from None
    return SavedReply(id=saved.id, revision=saved.revision, updated_at=saved.updated_at.isoformat())


class DuplicateExperiment(RequestType):
    experiment_id: ExperimentID
    name: Annotated[str, Meta(description="The copy's name. Left out or blank, it keeps the original's.")] = ""


def _duplicate(store: Store, experiment_id: str, user_id: int, name: str) -> Experiment:
    source = experiments.experiment_for(store, experiment_id, user_id)
    doc = dict(source.doc)
    if name.strip():
        doc["name"] = name.strip()
    copy = experiments.create_experiment(store, user_id, doc)
    shas = [entry.get("id") for entry in source.doc.get("media") or [] if isinstance(entry, dict)]
    media.attach(store, shas, source.id, copy.id)
    return copy


@route(
    "POST /api/experiments/{experiment_id}/duplicate", summary="Duplicate an experiment",
    tag=TAG, status=201, errors=(404,),
    description="A copy of an experiment, owned by this account, with its pictures. name is the copy's name; left "
    "out, it keeps the original's. Answers the copy with its doc.",
    mcp="duplicate_experiment",
)
def duplicate_experiment(request: Request, body: DuplicateExperiment) -> ExperimentDoc:
    store, user_id = get_store(request), _user_id(request)
    try:
        copy = _duplicate(store, body.experiment_id, user_id, body.name)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None
    except BadDocumentError as refusal:
        raise Refused(400, str(refusal)) from None
    return _doc_reply(store, copy, user_id)


class SetEditors(RequestType):
    experiment_id: ExperimentID
    editors: Annotated[list[int], Meta(description="User ids, from GET /api/team (list_team over MCP).", extra={"error": "editors must be a list of user ids"})]


@route(
    "POST /api/experiments/{experiment_id}/editors", summary="Choose who can edit an experiment",
    tag=TAG, errors=(403, 404),
    description="Replaces the list of people, by user id, who may edit an experiment besides its owner. Only the owner may.",
    mcp="set_experiment_editors",
)
def set_editors(request: Request, body: SetEditors) -> ExperimentRow:
    store, user_id = get_store(request), _user_id(request)
    known = {user.id for user in users.list_users(store) if not user.disabled}
    unknown = [editor for editor in body.editors if editor not in known]
    if unknown:
        raise Refused(400, f"no such user: {unknown[0]}")
    try:
        updated = experiments.set_editors(store, body.experiment_id, user_id, body.editors)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None
    except NotOwnerError as refusal:
        raise Refused(403, str(refusal)) from None
    except BadDocumentError as refusal:
        raise Refused(400, str(refusal)) from None
    return _row_reply(store, updated, user_id)


@route(
    "POST /api/experiments/{experiment_id}/delete", summary="Delete an experiment",
    tag=TAG, access=SESSION_ONLY, errors=(403, 404),
    description="Deletes an experiment; the owner can restore it for a while. Only the owner may.",
)
def delete_experiment(request: Request, body: ExperimentPath) -> OKReply:
    try:
        experiments.delete_experiment(get_store(request), body.experiment_id, _user_id(request))
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None
    except NotOwnerError as refusal:
        raise Refused(403, str(refusal)) from None
    return OKReply(ok=True)


@route(
    "POST /api/experiments/{experiment_id}/restore", summary="Undo deleting an experiment",
    tag=TAG, access=SESSION_ONLY, errors=(403, 404, 409),
    description="Brings back an experiment deleted a short while ago.",
)
def restore_experiment(request: Request, body: ExperimentPath) -> ExperimentRow:
    store, user_id = get_store(request), _user_id(request)
    try:
        restored = experiments.restore_experiment(store, body.experiment_id, user_id)
    except RestoreError as refusal:
        raise restore_refusal(refusal) from None
    return _row_reply(store, restored, user_id)


class RunAction(RequestType):
    experiment_id: ExperimentID
    action: Annotated[Literal[actions.ACTIONS], Meta(description="<thing>.<verb>.")]  # type: ignore[valid-type]
    id: Annotated[str, Meta(description="What to update, delete or move.")] | msgspec.UnsetType = msgspec.UNSET
    fields: Annotated[dict[str, Any], Meta(description="The fields to set.")] | msgspec.UnsetType = msgspec.UNSET
    position: Annotated[int, Meta(ge=0, description="Where to move it, from 0.")] | msgspec.UnsetType = msgspec.UNSET
    section: Annotated[str, Meta(description="For settings.update.")] | msgspec.UnsetType = msgspec.UNSET
    list: Annotated[str, Meta(description="The prompt list, for an item action.")] | msgspec.UnsetType = msgspec.UNSET
    trial: Annotated[str, Meta(description="The trial type, for a phase action.")] | msgspec.UnsetType = msgspec.UNSET
    run: Annotated[str, Meta(description="The run, for a block action.")] | msgspec.UnsetType = msgspec.UNSET
    session: Annotated[str, Meta(description="The session, for a step action.")] | msgspec.UnsetType = msgspec.UNSET


class ActionReply(Reply):
    """What an action answers: the new revision, and for an add the new
    thing's id."""

    api_name: ClassVar[str] = "ActionResult"
    revision: int
    id: str | msgspec.UnsetType = msgspec.UNSET


@route(
    "POST /api/experiments/{experiment_id}/action", summary="Make one change to an experiment",
    tag=TAG, errors=(404, 409),
    description="One small edit, without sending the whole document. " + ACTION_GUIDE,
    mcp="experiment_action",
)
def run_action(request: Request, body: RunAction) -> ActionReply:
    args = {name: value for name, value in msgspec.structs.asdict(body).items() if value is not msgspec.UNSET}
    try:
        result = actions.run_action(get_store(request), body.experiment_id, _user_id(request), body.action, args)
    except NoSuchExperimentError:
        raise Refused(404, NO_SUCH) from None
    except (actions.BadActionError, BadDocumentError) as refusal:
        raise Refused(400, str(refusal)) from None
    except RevisionConflictError as stale:
        raise Refused(409, f"{stale} -- try again", revision=stale.current) from None
    return msgspec.convert(result, ActionReply)
