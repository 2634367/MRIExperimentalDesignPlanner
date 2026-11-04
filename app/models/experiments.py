"""Experiments: one design document each, and who may open it.

The document itself (prompt lists, trial types, runs, sessions, the hours
budget) is the browser's business -- static/js/doc.js edits it and
static/js/validate.js checks it. The server stores it as given and owns only
what the browser must not decide for itself: who the owner is, who else may
edit, and the revision that keeps two tabs from silently overwriting each
other.

Saves are optimistic. Each one says which revision it was made from; if the
stored one has moved on since, the save is refused with the current revision
and nothing is written, so the person sees "changed somewhere else" instead of
losing someone's edit.

Access is owner + editors. Anyone else gets "no such experiment", the same as
for one that does not exist, so ids cannot be probed. Admins get no special
access: admin here means "decides who gets in", not "reads everyone's work".
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.core import encryption
from app.core.db import BUCKET_EXPERIMENTS, Record, Store
from app.models import RestoreGoneError, deleted_long_ago, from_iso, mark_deleted, to_iso, unmark_deleted, utc_now

NAME_MAX = 200
EDITORS_MAX = 50
# The stored document, as JSON. Big enough for thousands of prompt items;
# pictures are files, never inside the document.
DOC_MAX_BYTES = 8 * 1024 * 1024


class NoSuchExperimentError(Exception):
    """Missing, deleted, or not shared with this person -- one answer for all
    three."""


class NotOwnerError(Exception):
    def __init__(self) -> None:
        super().__init__("only the experiment's owner can do that")


class BadDocumentError(ValueError):
    pass


class RevisionConflictError(Exception):
    """The save was made from an older revision than the one stored."""

    def __init__(self, current: int) -> None:
        super().__init__("this experiment was changed somewhere else")
        self.current = current


@dataclass
class Experiment:
    id: str
    owner: int
    revision: int
    created_at: datetime
    updated_at: datetime
    updated_by: int
    doc: dict[str, Any]
    editors: list[int] = field(default_factory=list)
    deleted_at: datetime | None = None
    deleted_by: int | None = None

    @property
    def name(self) -> str:
        name = self.doc.get("name")
        return name if isinstance(name, str) else ""

    def can_edit(self, user_id: int) -> bool:
        return user_id == self.owner or user_id in self.editors

    def to_record(self) -> Record:
        return {
            "id": self.id,
            "owner": self.owner,
            "editors": list(self.editors),
            "revision": self.revision,
            "created_at": to_iso(self.created_at),
            "updated_at": to_iso(self.updated_at),
            "updated_by": self.updated_by,
            "deleted_at": to_iso(self.deleted_at),
            "deleted_by": self.deleted_by,
            "doc": self.doc,
        }

    @classmethod
    def from_record(cls, record: Record) -> "Experiment":
        return cls(
            id=record["id"],
            owner=record["owner"],
            editors=list(record.get("editors") or []),
            revision=record["revision"],
            created_at=from_iso(record["created_at"]),
            updated_at=from_iso(record["updated_at"]),
            updated_by=record["updated_by"],
            deleted_at=from_iso(record.get("deleted_at")),
            deleted_by=record.get("deleted_by"),
            doc=record["doc"],
        )


def check_doc(doc: object) -> dict[str, Any]:
    """The few things the server insists on. Everything else about a document
    is checked in the browser, where it is shown to the person who can fix
    it; the server never interprets a document beyond this."""
    if not isinstance(doc, dict):
        raise BadDocumentError("the experiment must be a JSON object")
    name = doc.get("name")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= NAME_MAX:
        raise BadDocumentError(f"the experiment needs a name of 1-{NAME_MAX} characters")
    version = doc.get("format_version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise BadDocumentError("the experiment has no format_version")
    if len(json.dumps(doc, separators=(",", ":"))) > DOC_MAX_BYTES:
        raise BadDocumentError(f"the experiment is larger than {DOC_MAX_BYTES // (1024 * 1024)} MB")
    return doc


def _live(record: Record | None) -> Experiment | None:
    if record is None or record.get("deleted_at") is not None:
        return None
    return Experiment.from_record(record)


def get_experiment(store: Store, experiment_id: str) -> Experiment | None:
    """The experiment whoever asks, or None. Callers that act for a person use
    experiment_for, which also checks access."""
    if not isinstance(experiment_id, str) or experiment_id == "":
        return None
    return _live(store.get(BUCKET_EXPERIMENTS, experiment_id))


def experiment_for(store: Store, experiment_id: str, user_id: int) -> Experiment:
    experiment = get_experiment(store, experiment_id)
    if experiment is None or not experiment.can_edit(user_id):
        raise NoSuchExperimentError()
    return experiment


def list_for_user(store: Store, user_id: int) -> list[Experiment]:
    found = [_live(record) for _, record in store.all(BUCKET_EXPERIMENTS)]
    mine = [experiment for experiment in found if experiment is not None and experiment.can_edit(user_id)]
    return sorted(mine, key=lambda experiment: experiment.updated_at, reverse=True)


def create_experiment(store: Store, owner: int, doc: object) -> Experiment:
    checked = check_doc(doc)
    now = utc_now()
    experiment = Experiment(
        id=encryption.url_token(9),
        owner=owner,
        revision=1,
        created_at=now,
        updated_at=now,
        updated_by=owner,
        doc=checked,
    )
    store.put(BUCKET_EXPERIMENTS, experiment.id, experiment.to_record())
    return experiment


def save_doc(store: Store, experiment_id: str, user_id: int, doc: object, base_revision: object) -> Experiment:
    """Replace the document, if it was made from the stored revision."""
    checked = check_doc(doc)
    if not isinstance(base_revision, int) or isinstance(base_revision, bool):
        raise BadDocumentError("base_revision must be the revision this edit was made from")

    def mutate(record: Record) -> None:
        current = _live(record)
        if current is None or not current.can_edit(user_id):
            raise NoSuchExperimentError()
        if record["revision"] != base_revision:
            raise RevisionConflictError(record["revision"])
        record["doc"] = checked
        record["revision"] += 1
        record["updated_at"] = to_iso(utc_now())
        record["updated_by"] = user_id

    updated = store.update_value(BUCKET_EXPERIMENTS, experiment_id, mutate)
    if updated is None:
        raise NoSuchExperimentError()
    return Experiment.from_record(updated)


def set_editors(store: Store, experiment_id: str, user_id: int, editors: list[int]) -> Experiment:
    """Owner only. The owner is never in the list; they always have access."""
    cleaned = sorted({editor for editor in editors if editor != user_id})
    if len(cleaned) > EDITORS_MAX:
        raise BadDocumentError(f"an experiment can have at most {EDITORS_MAX} editors")

    def mutate(record: Record) -> None:
        current = _live(record)
        if current is None or not current.can_edit(user_id):
            raise NoSuchExperimentError()
        if current.owner != user_id:
            raise NotOwnerError()
        record["editors"] = cleaned

    updated = store.update_value(BUCKET_EXPERIMENTS, experiment_id, mutate)
    if updated is None:
        raise NoSuchExperimentError()
    return Experiment.from_record(updated)


def delete_experiment(store: Store, experiment_id: str, user_id: int) -> None:
    """Owner only, and soft: restore_experiment puts it back for a few
    minutes. Share links stop working while it is deleted, since they read
    through get_experiment."""

    def mutate(record: Record) -> None:
        current = _live(record)
        if current is None or not current.can_edit(user_id):
            raise NoSuchExperimentError()
        if current.owner != user_id:
            raise NotOwnerError()
        mark_deleted(record, user_id)

    if store.update_value(BUCKET_EXPERIMENTS, experiment_id, mutate) is None:
        raise NoSuchExperimentError()


def restore_experiment(store: Store, experiment_id: str, user_id: int) -> Experiment:
    """Undo delete_experiment. Only the owner, who is the only one who can
    delete it, can put it back -- so admin status is never asked about."""

    def mutate(record: Record) -> None:
        if record["owner"] != user_id:
            raise RestoreGoneError()
        unmark_deleted(record, user_id, False)

    updated = store.update_value(BUCKET_EXPERIMENTS, experiment_id, mutate)
    if updated is None:
        raise RestoreGoneError()
    return Experiment.from_record(updated)


def purge_deleted_experiments(store: Store) -> int:
    return store.delete_where(BUCKET_EXPERIMENTS, lambda _key, record: deleted_long_ago(record))
