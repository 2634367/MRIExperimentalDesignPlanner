"""MCP tools for experiments: list them, read one, save one, or make one small
change without sending the whole document (app/models/actions.py).

They share their bodies with the HTTP routes in experiments.py (list_rows,
open_row, save_row), so an agent sees exactly what the browser sees and is
refused for the same reasons. A save needs the revision it was made from,
like the browser's, so an agent cannot silently overwrite a person's edit.

Deliberately missing: deleting an experiment, and making share links (a
credential). Those need a browser session. Files (pictures, the bundle, the
report, published plans and figures) and the PsychoPy runner's records stay
HTTP, with the same key: config/openapi.json says why on each (x-mcp-http).
"""
from __future__ import annotations

from typing import Any

from app.mcp.registry import Call, Refusal, Registry, Tool
from app.models.actions import ACTIONS, BadActionError
from app.core import psychopy
from app.models import experiments
from app.models.experiments import BadDocumentError, NoSuchExperimentError, NotOwnerError, RevisionConflictError
from app.models.published import NothingPublishedError
from app.routes.experiments import _duplicate, _set_editors, action_row, experiment_row, list_rows, open_row, revision_row, save_row
from app.routes.published import _manifest
from app.routes.share import _revoke, _rows

ID_SCHEMA = {"type": "string", "description": "The experiment's id, from list_experiments."}
ACTION_ARGUMENTS = {
    "id": str, "fields": dict, "position": int, "section": str,
    "list": str, "trial": str, "run": str, "session": str,
}


def list_experiments(call: Call) -> dict[str, Any]:
    call.bind({})
    return {"experiments": list_rows(call.store, call.actor.user.id)}


def get_experiment(call: Call) -> dict[str, Any]:
    args = call.bind({"experiment_id": str})
    try:
        return open_row(call.store, args["experiment_id"], call.actor.user.id)
    except NoSuchExperimentError:
        raise Refusal("no such experiment") from None


def save_experiment(call: Call) -> dict[str, Any]:
    args = call.bind({"experiment_id": str, "doc": dict, "base_revision": int})
    try:
        return save_row(call.store, args["experiment_id"], call.actor.user.id, args["doc"], args["base_revision"])
    except NoSuchExperimentError:
        raise Refusal("no such experiment") from None
    except BadDocumentError as refusal:
        raise Refusal(str(refusal)) from None
    except RevisionConflictError as stale:
        raise Refusal(f"{stale} -- read it again with get_experiment (now revision {stale.current}) and reapply the change") from None


def experiment_action(call: Call) -> dict[str, Any]:
    args = call.bind({"experiment_id": str, "action": str}, optional=ACTION_ARGUMENTS)
    try:
        return action_row(call.store, args["experiment_id"], call.actor.user.id, args)
    except NoSuchExperimentError:
        raise Refusal("no such experiment") from None
    except (BadActionError, BadDocumentError) as refusal:
        raise Refusal(str(refusal)) from None
    except RevisionConflictError as stale:
        raise Refusal(f"{stale} -- try again") from None


def create_experiment(call: Call) -> dict[str, Any]:
    args = call.bind({"doc": dict})
    try:
        created = experiments.create_experiment(call.store, call.actor.user.id, args["doc"])
    except BadDocumentError as refusal:
        raise Refusal(str(refusal)) from None
    return experiment_row(call.store, created, call.actor.user.id, True)


def experiment_revision(call: Call) -> dict[str, Any]:
    args = call.bind({"experiment_id": str})
    try:
        return revision_row(call.store, args["experiment_id"], call.actor.user.id)
    except NoSuchExperimentError:
        raise Refusal("no such experiment") from None


def duplicate_experiment(call: Call) -> dict[str, Any]:
    args = call.bind({"experiment_id": str}, optional={"name": str})
    try:
        copy = _duplicate(call.store, args["experiment_id"], call.actor.user.id, args.get("name"))
    except NoSuchExperimentError:
        raise Refusal("no such experiment") from None
    except BadDocumentError as refusal:
        raise Refusal(str(refusal)) from None
    return experiment_row(call.store, copy, call.actor.user.id, True)


def set_experiment_editors(call: Call) -> dict[str, Any]:
    args = call.bind({"experiment_id": str, "editors": list})
    try:
        return _set_editors(call.store, args["experiment_id"], call.actor.user.id, args["editors"])
    except NoSuchExperimentError:
        raise Refusal("no such experiment") from None
    except (NotOwnerError, BadDocumentError) as refusal:
        raise Refusal(str(refusal)) from None


def get_published(call: Call) -> dict[str, Any]:
    args = call.bind({"experiment_id": str})
    try:
        return _manifest(call.store, args["experiment_id"], call.actor.user.id)
    except NoSuchExperimentError:
        raise Refusal("no such experiment") from None
    except NothingPublishedError:
        raise Refusal("nothing published") from None


def list_share_links(call: Call) -> dict[str, Any]:
    args = call.bind({"experiment_id": str})
    try:
        return {"links": _rows(call.store, args["experiment_id"], call.actor.user.id)}
    except NoSuchExperimentError:
        raise Refusal("no such experiment") from None


def revoke_share_link(call: Call) -> dict[str, Any]:
    args = call.bind({"experiment_id": str, "link_id": str})
    try:
        revoked = _revoke(call.store, args["experiment_id"], call.actor.user.id, args["link_id"])
    except NoSuchExperimentError:
        raise Refusal("no such experiment") from None
    if not revoked:
        raise Refusal("no such share link")
    return {"ok": True}


def psychopy_status(call: Call) -> dict[str, Any]:
    args = call.bind({}, optional={"refresh": bool})
    return psychopy.status(call.config, bool(args.get("refresh"))).row()


def _schema(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {"type": "object", "properties": properties,
            "required": list(properties) if required is None else required, "additionalProperties": False}


def register(registry: Registry) -> None:
    registry.register(Tool(
        name="list_experiments",
        title="List experiments",
        description="Every experiment this account owns or can edit: id, name, owner, editors, revision and when it last changed.",
        call=list_experiments,
        route="GET /api/experiments",
        read_only=True,
    ))
    registry.register(Tool(
        name="get_experiment",
        title="Read an experiment",
        description=(
            "One experiment's full design document (doc) and its revision. The doc holds scanner settings, display "
            "defaults, the fixation mark, design-wide jitter, the hours budget, media (pictures by sha256), prompt lists "
            "(columns + items), trial_types (phases with durations and layers; a layer value written {column} is filled "
            "from the trial's prompt item; a duration with inherit set follows doc.jitter), runs (blocks of trial types) "
            "and sessions (steps, each with a repeat count)."
        ),
        call=get_experiment,
        route="GET /api/experiments/{experiment_id}",
        input_schema={
            "type": "object",
            "properties": {"experiment_id": ID_SCHEMA},
            "required": ["experiment_id"],
            "additionalProperties": False,
        },
        read_only=True,
    ))
    registry.register(Tool(
        name="save_experiment",
        title="Save an experiment",
        description=(
            "Replace an experiment's design document. Send the whole doc as returned by get_experiment, changed, "
            "with base_revision set to the revision it came from. Refused if it has changed since; read it again "
            "and reapply. Anyone with the experiment open in a browser sees the change within a few seconds."
        ),
        call=save_experiment,
        route="POST /api/experiments/{experiment_id}/save",
        input_schema={
            "type": "object",
            "properties": {
                "experiment_id": ID_SCHEMA,
                "doc": {"type": "object", "description": "The whole design document."},
                "base_revision": {"type": "integer", "minimum": 1},
            },
            "required": ["experiment_id", "doc", "base_revision"],
            "additionalProperties": False,
        },
    ))
    registry.register(Tool(
        name="experiment_action",
        title="Make one change to an experiment",
        description=(
            "One small edit, without sending the whole document. action is <thing>.<verb>: things are list, item, "
            "trial, phase, run, block, session, step; verbs are add (fields; returns the new id), update (id, fields; "
            "only those fields change), delete (id; refused while something uses it) and move (id, position from 0). "
            "An item needs list, a phase trial, a block run, a step session: each the parent's id. Also "
            "settings.update (section: scanner, display, keys, budget, limits, hrf, jitter, fixation or meta; fields) and experiment.update "
            "(fields: name, notes). A new thing needs only the fields you care about; the rest get their defaults."
        ),
        call=experiment_action,
        route="POST /api/experiments/{experiment_id}/action",
        input_schema={
            "type": "object",
            "properties": {
                "experiment_id": ID_SCHEMA,
                "action": {"type": "string", "enum": list(ACTIONS)},
                "id": {"type": "string", "description": "What to update, delete or move."},
                "fields": {"type": "object", "description": "The fields to set."},
                "position": {"type": "integer", "minimum": 0},
                "section": {"type": "string"},
                "list": {"type": "string", "description": "The prompt list, for an item action."},
                "trial": {"type": "string", "description": "The trial type, for a phase action."},
                "run": {"type": "string", "description": "The run, for a block action."},
                "session": {"type": "string", "description": "The session, for a step action."},
            },
            "required": ["experiment_id", "action"],
            "additionalProperties": False,
        },
    ))
    registry.register(Tool(
        name="create_experiment",
        title="Create an experiment",
        description=(
            "A new experiment owned by this account. doc needs at least name and format_version (3); everything "
            "left out gets its default when the experiment is opened or changed with experiment_action. To start "
            "from another experiment, duplicate_experiment is simpler. Answers the new experiment with its doc."
        ),
        call=create_experiment,
        route="POST /api/experiments",
        input_schema=_schema({"doc": {"type": "object", "description": "A design document: at least {\"name\": ..., \"format_version\": 3}."}}),
    ))
    registry.register(Tool(
        name="experiment_revision",
        title="An experiment's revision",
        description="Only the revision, and who changed it last if not you: a cheap way to see whether an experiment changed since it was read.",
        call=experiment_revision,
        route="GET /api/experiments/{experiment_id}/revision",
        input_schema=_schema({"experiment_id": ID_SCHEMA}),
        read_only=True,
    ))
    registry.register(Tool(
        name="duplicate_experiment",
        title="Duplicate an experiment",
        description="A copy of an experiment, owned by this account, with its pictures. name is the copy's name; left out, it keeps the original's.",
        call=duplicate_experiment,
        route="POST /api/experiments/{experiment_id}/duplicate",
        input_schema=_schema({"experiment_id": ID_SCHEMA, "name": {"type": "string"}}, required=["experiment_id"]),
    ))
    registry.register(Tool(
        name="set_experiment_editors",
        title="Choose who can edit an experiment",
        description="Replaces the list of people, by user id (see list_team), who may edit an experiment besides its owner. Only the owner may.",
        call=set_experiment_editors,
        route="POST /api/experiments/{experiment_id}/editors",
        input_schema=_schema({"experiment_id": ID_SCHEMA, "editors": {"type": "array", "items": {"type": "integer"}}}),
    ))
    registry.register(Tool(
        name="get_published",
        title="What was last published",
        description=(
            "The manifest of an experiment's last publish: its version, the revision it was made from, who published "
            "it and when, and the run plans and figures in it (fetched over HTTP by name), plus current_revision, so "
            "you can tell whether the design changed since. Publishing itself is done from the browser, which compiles the plans."
        ),
        call=get_published,
        route="GET /api/experiments/{experiment_id}/published",
        input_schema=_schema({"experiment_id": ID_SCHEMA}),
        read_only=True,
    ))
    registry.register(Tool(
        name="list_share_links",
        title="List an experiment's share links",
        description="The read-only links to this experiment that are out there: id, label, who made it, when, and whether it still works. Making one needs a browser.",
        call=list_share_links,
        route="GET /api/experiments/{experiment_id}/share-links",
        input_schema=_schema({"experiment_id": ID_SCHEMA}),
        read_only=True,
    ))
    registry.register(Tool(
        name="revoke_share_link",
        title="Revoke a share link",
        description="Stops a share link working, for good. link_id is from list_share_links.",
        call=revoke_share_link,
        route="POST /api/experiments/{experiment_id}/share-links/{link_id}/revoke",
        input_schema=_schema({"experiment_id": ID_SCHEMA, "link_id": {"type": "string"}}),
        destructive=True,
    ))
    registry.register(Tool(
        name="psychopy_status",
        title="Can this server run PsychoPy",
        description="Whether this server can start PsychoPy runs itself, and why not if it cannot. refresh looks again rather than using the last answer.",
        call=psychopy_status,
        route="GET /api/psychopy",
        input_schema=_schema({"refresh": {"type": "boolean"}}, required=[]),
        read_only=True,
    ))
