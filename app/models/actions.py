"""Small edits to an experiment, one at a time: add a phase, rename a run,
move a session step. For scripts and agents, which would otherwise have to
read the whole document, change it and send it all back.

An action is `<thing>.<verb>`. The things are the lists of the document and
what they hold; the verbs are the same for all of them:

    list   item      trial   phase     run   block     session   step
    add    { parent id }, fields               -> the new id
    update { parent id }, id, fields           -- only the fields given change
    delete { parent id }, id                   -- refused while something uses it
    move   { parent id }, id, position

and settings.update { section, fields } for scanner, display, keys, budget,
limits and hrf, and experiment.update { fields } for name and notes.

The server still does not interpret a design: fields go in as given, and a new
thing needs only what you care about, because static/js/schema.js fills in
everything else the next time the document is opened. Each action is one save,
with the same revision check as any other; a save that loses a race is simply
tried again against the newer document, since the action says what to change
rather than what the result should be.
"""
from __future__ import annotations

import copy
from typing import Any, Callable

from app.core import encryption
from app.core.db import Store
from app.models import experiments
from app.models.experiments import Experiment, RevisionConflictError

RETRIES = 3
SETTINGS = ("scanner", "display", "keys", "budget", "limits", "hrf")
EXPERIMENT_FIELDS = ("name", "notes")
VERBS = ("add", "update", "delete", "move")
# thing -> (the key it is held under, the thing that holds it, its id prefix)
THINGS: dict[str, tuple[str, str | None, str]] = {
    "list": ("lists", None, "list"),
    "item": ("items", "list", "i"),
    "trial": ("trial_types", None, "tt"),
    "phase": ("phases", "trial", "ph"),
    "run": ("runs", None, "run"),
    "block": ("blocks", "run", "b"),
    "session": ("sessions", None, "ses"),
    "step": ("steps", "session", "st"),
}
ACTIONS = tuple(f"{thing}.{verb}" for thing in THINGS for verb in VERBS) + ("settings.update", "experiment.update")


class BadActionError(ValueError):
    pass


def _fields(args: dict[str, Any]) -> dict[str, Any]:
    fields = args.get("fields")
    if not isinstance(fields, dict):
        raise BadActionError("fields must be an object")
    if "id" in fields:
        raise BadActionError("an id cannot be changed")
    return fields


def _find(rows: list[dict[str, Any]], wanted: object, what: str) -> dict[str, Any]:
    for row in rows:
        if isinstance(row, dict) and row.get("id") == wanted:
            return row
    raise BadActionError(f"no such {what}: {wanted}")


def _rows(doc: dict[str, Any], thing: str, args: dict[str, Any]) -> list[dict[str, Any]]:
    """The list a thing lives in, reached through its parent if it has one."""
    key, parent, _ = THINGS[thing]
    if parent is None:
        return doc.setdefault(key, [])
    holder = _find(doc.get(THINGS[parent][0], []), args.get(parent), parent)
    return holder.setdefault(key, [])


def _uses(doc: dict[str, Any], thing: str, wanted: object) -> list[str]:
    """What still points at this thing; the document holds ids, so deleting
    it would leave them pointing at nothing."""
    if thing == "list":
        return [tt.get("name") or tt.get("id", "") for tt in doc.get("trial_types", []) if tt.get("list") == wanted]
    if thing == "trial":
        return [run.get("name") or run.get("id", "") for run in doc.get("runs", [])
                if any(entry.get("trial_type") == wanted for block in run.get("blocks", []) for entry in block.get("mix", []))]
    if thing == "run":
        return [session.get("name") or session.get("id", "") for session in doc.get("sessions", [])
                if any(step.get("run") == wanted for step in session.get("steps", []))]
    return []


def apply(doc: dict[str, Any], action: object, args: dict[str, Any]) -> dict[str, Any]:
    """Make the change in doc; what to tell the caller."""
    if action not in ACTIONS:
        raise BadActionError(f"no such action: {action}")
    thing, verb = str(action).split(".")
    if thing == "settings":
        section = args.get("section")
        if section not in SETTINGS:
            raise BadActionError(f"section must be one of {', '.join(SETTINGS)}")
        doc.setdefault(section, {}).update(_fields(args))
        return {}
    if thing == "experiment":
        fields = _fields(args)
        unknown = [key for key in fields if key not in EXPERIMENT_FIELDS]
        if unknown:
            raise BadActionError(f"an experiment has no field {unknown[0]}")
        doc.update(fields)
        return {}
    rows = _rows(doc, thing, args)
    if verb == "add":
        row = dict(_fields(args), id=f"{THINGS[thing][2]}_{encryption.url_token(6)}")
        rows.append(row)
        return {"id": row["id"]}
    row = _find(rows, args.get("id"), thing)
    if verb == "update":
        row.update(_fields(args))
    elif verb == "delete":
        users = _uses(doc, thing, row["id"])
        if users:
            raise BadActionError(f"still used by {', '.join(users)}")
        rows.remove(row)
    else:
        position = args.get("position")
        if not isinstance(position, int) or isinstance(position, bool) or not 0 <= position < len(rows):
            raise BadActionError(f"position must be from 0 to {len(rows) - 1}")
        rows.remove(row)
        rows.insert(position, row)
    return {}


def run_action(store: Store, experiment_id: str, user_id: int, action: object, args: dict[str, Any],
               save: Callable[..., Experiment] = experiments.save_doc) -> dict[str, Any]:
    for attempt in range(RETRIES):
        experiment = experiments.experiment_for(store, experiment_id, user_id)
        doc = copy.deepcopy(experiment.doc)
        result = apply(doc, action, args)
        try:
            saved = save(store, experiment_id, user_id, doc, experiment.revision)
        except RevisionConflictError:
            if attempt == RETRIES - 1:
                raise
            continue
        return dict(result, revision=saved.revision)
    raise AssertionError("unreachable")
