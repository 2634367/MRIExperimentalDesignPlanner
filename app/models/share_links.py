"""Anonymous read-only links to one experiment: /s/<id>.<secret>.

Whoever holds the link can look at the design, play it in the browser and
download the PsychoPy bundle. They cannot change anything, see any other
experiment, or launch PsychoPy on the server. No account is created and no
session is set; the link is checked on every request.

Same "<id>.<secret>" shape and the same rule as invite links: only the sha256
of the secret is stored, so the link is shown once, when it is made. A link
dies when it is revoked, when its experiment is deleted, and when the person
who made it loses access to the experiment.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from app.core import encryption
from app.core.db import BUCKET_EXPERIMENTS, BUCKET_SHARE_LINKS, Record, Store
from app.models import from_iso, to_iso, utc_now
from app.models.experiments import Experiment, get_experiment
from app.models.sessions import split_credential

LABEL_MAX = 80
LINKS_PER_EXPERIMENT_MAX = 50


class ShareLinkInvalidError(Exception):
    """Malformed, unknown, wrong secret, revoked, or its experiment is gone --
    one answer for all of them."""


class TooManyShareLinksError(Exception):
    def __init__(self) -> None:
        super().__init__(f"an experiment can have at most {LINKS_PER_EXPERIMENT_MAX} share links")


@dataclass
class ShareLink:
    id: str
    secret_hash: str
    experiment_id: str
    label: str
    created_by: int
    created_at: datetime
    revoked_at: datetime | None = None

    def row(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "created_by": self.created_by,
            "created_at": to_iso(self.created_at),
            "revoked": self.revoked_at is not None,
        }

    def to_record(self) -> Record:
        return {
            "id": self.id,
            "secret_hash": self.secret_hash,
            "experiment_id": self.experiment_id,
            "label": self.label,
            "created_by": self.created_by,
            "created_at": to_iso(self.created_at),
            "revoked_at": to_iso(self.revoked_at),
        }

    @classmethod
    def from_record(cls, record: Record) -> "ShareLink":
        return cls(
            id=record["id"],
            secret_hash=record["secret_hash"],
            experiment_id=record["experiment_id"],
            label=record["label"],
            created_by=record["created_by"],
            created_at=from_iso(record["created_at"]),
            revoked_at=from_iso(record.get("revoked_at")),
        )


def links_for(store: Store, experiment_id: str) -> list[ShareLink]:
    links = [ShareLink.from_record(record) for _, record in store.all(BUCKET_SHARE_LINKS)]
    return sorted((link for link in links if link.experiment_id == experiment_id), key=lambda link: link.created_at)


def issue_share_link(store: Store, experiment: Experiment, label: str, created_by: int) -> tuple[str, ShareLink]:
    """Returns (credential, link); the credential exists only in this
    answer."""
    if sum(1 for link in links_for(store, experiment.id) if link.revoked_at is None) >= LINKS_PER_EXPERIMENT_MAX:
        raise TooManyShareLinksError()
    secret = encryption.url_token(24)
    link = ShareLink(
        id=encryption.url_token(9),
        secret_hash=encryption.sha256_hex(secret),
        experiment_id=experiment.id,
        label=(label or "").strip()[:LABEL_MAX],
        created_by=created_by,
        created_at=utc_now(),
    )
    store.put(BUCKET_SHARE_LINKS, link.id, link.to_record())
    return f"{link.id}.{secret}", link


def revoke_share_link(store: Store, experiment_id: str, link_id: str) -> bool:
    """Final, like revoking an invite link: a link that may have leaked must
    not quietly come back."""

    def mutate(record: Record) -> None:
        if record["experiment_id"] != experiment_id:
            raise ShareLinkInvalidError()
        if record.get("revoked_at") is None:
            record["revoked_at"] = to_iso(utc_now())

    try:
        return store.update_value(BUCKET_SHARE_LINKS, link_id, mutate) is not None
    except ShareLinkInvalidError:
        return False


def load_shared(store: Store, credential: object) -> tuple[ShareLink, Experiment]:
    parts = split_credential(credential.strip().strip("/")) if isinstance(credential, str) else None
    record = None if parts is None else store.get(BUCKET_SHARE_LINKS, parts[0])
    if record is None:
        raise ShareLinkInvalidError()
    link = ShareLink.from_record(record)
    if not encryption.constant_time_equal(link.secret_hash, encryption.sha256_hex(parts[1])) or link.revoked_at is not None:
        raise ShareLinkInvalidError()
    experiment = get_experiment(store, link.experiment_id)
    if experiment is None or not experiment.can_edit(link.created_by):
        raise ShareLinkInvalidError()
    return link, experiment


def purge_orphaned_share_links(store: Store) -> int:
    """Links whose experiment has been purged for good. A link is always made
    after its experiment, so reading the experiments first cannot miss one."""
    live = {key for key, _ in store.all(BUCKET_EXPERIMENTS)}
    return store.delete_where(BUCKET_SHARE_LINKS, lambda _key, record: record["experiment_id"] not in live)
