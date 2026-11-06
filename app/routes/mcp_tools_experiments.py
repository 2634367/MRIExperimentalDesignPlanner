"""MCP tools for experiments: list them, read one, save one, or make one small
change without sending the whole document (app/models/actions.py).

They share their bodies with the HTTP routes in experiments.py (list_rows,
open_row, save_row), so an agent sees exactly what the browser sees and is
refused for the same reasons. A save needs the revision it was made from,
like the browser's, so an agent cannot silently overwrite a person's edit.

Deliberately missing: deleting an experiment, and making share links (a
credential). Those need a browser session.
"""
from __future__ import annotations

from typing import Any

from app.mcp.registry import Call, Refusal, Registry, Tool
from app.models.actions import ACTIONS, BadActionError
from app.models.experiments import BadDocumentError, NoSuchExperimentError, RevisionConflictError
from app.routes.experiments import action_row, list_rows, open_row, save_row

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


def register(registry: Registry) -> None:
    registry.register(Tool(
        name="list_experiments",
        title="List experiments",
        description="Every experiment this account owns or can edit: id, name, owner, editors, revision and when it last changed.",
        call=list_experiments,
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
