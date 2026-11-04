"""Pictures: one file per distinct image under storage/media/, named by the
sha256 of its bytes, and one record per file saying which experiments use it.

Content addressing means the same picture uploaded twice, or into two
experiments, is stored once, and a name is never trusted for a path. The
record's experiments list is the access rule: a picture is served through an
experiment (or that experiment's share link) only if it was added to that
experiment. Knowing a hash is not enough to fetch someone else's picture.

The records are encrypted at rest like every other record; the image files
are not. They sit in the app directory with the database (mode 0700), so they
are backed up and protected together, but a copy of the storage folder shows
the pictures.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from app.core import encryption, images
from app.core.db import BUCKET_MEDIA, Record, Store
from app.models import from_iso, to_iso, utc_now

MEDIA_DIR_NAME = "media"
SHA = re.compile(r"^[0-9a-f]{64}$")


@dataclass
class Media:
    sha: str
    mime: str
    ext: str
    width: int
    height: int
    size: int
    created_at: datetime
    experiments: list[str] = field(default_factory=list)

    @property
    def filename(self) -> str:
        return f"{self.sha}.{self.ext}"

    def row(self) -> dict:
        """What the browser keeps in the experiment's media list."""
        return {"id": self.sha, "mime": self.mime, "ext": self.ext, "w": self.width, "h": self.height, "size": self.size}

    def to_record(self) -> Record:
        return {
            "sha": self.sha,
            "mime": self.mime,
            "ext": self.ext,
            "width": self.width,
            "height": self.height,
            "size": self.size,
            "created_at": to_iso(self.created_at),
            "experiments": list(self.experiments),
        }

    @classmethod
    def from_record(cls, record: Record) -> "Media":
        return cls(
            sha=record["sha"],
            mime=record["mime"],
            ext=record["ext"],
            width=record["width"],
            height=record["height"],
            size=record["size"],
            created_at=from_iso(record["created_at"]),
            experiments=list(record.get("experiments") or []),
        )


def media_dir(storage_dir: Path) -> Path:
    path = storage_dir / MEDIA_DIR_NAME
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path


def file_path(storage_dir: Path, media: Media) -> Path:
    return media_dir(storage_dir) / media.filename


def add_media(store: Store, storage_dir: Path, data: bytes, experiment_id: str) -> Media:
    """Store a picture (once) and attach it to an experiment. Raises
    images.BadImageError for anything that is not a usable picture."""
    info = images.inspect(data)
    sha = encryption.sha256_bytes_hex(data)
    target = media_dir(storage_dir) / f"{sha}.{info.ext}"
    if not target.exists():
        # Written beside the target and renamed, so a reader never sees half
        # a file and two simultaneous uploads of one picture cannot clash.
        temporary = target.with_name(f".{sha}.{os.getpid()}.{encryption.url_token(6)}.tmp")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
        os.replace(temporary, target)

    with store.transaction() as tx:
        record = tx.get(BUCKET_MEDIA, sha)
        media = Media.from_record(record) if record else Media(
            sha=sha, mime=info.mime, ext=info.ext, width=info.width, height=info.height,
            size=len(data), created_at=utc_now(),
        )
        if experiment_id not in media.experiments:
            media.experiments.append(experiment_id)
        tx.put(BUCKET_MEDIA, sha, media.to_record())
    return media


def attach(store: Store, shas: list[str], from_experiment: str, to_experiment: str) -> int:
    """Let another experiment use pictures this one already has -- for a
    duplicate. Only pictures attached to from_experiment move, so this cannot
    be used to reach a picture by guessing its hash."""
    attached = 0
    with store.transaction() as tx:
        for sha in {sha for sha in shas if isinstance(sha, str) and SHA.match(sha)}:
            record = tx.get(BUCKET_MEDIA, sha)
            if record is None or from_experiment not in (record.get("experiments") or []):
                continue
            if to_experiment not in record["experiments"]:
                record["experiments"].append(to_experiment)
                tx.put(BUCKET_MEDIA, sha, record)
            attached += 1
    return attached


def media_in(store: Store, sha: str, experiment_id: str) -> Media | None:
    """The picture, if it belongs to this experiment."""
    if not isinstance(sha, str) or not SHA.match(sha):
        return None
    record = store.get(BUCKET_MEDIA, sha)
    if record is None or experiment_id not in (record.get("experiments") or []):
        return None
    return Media.from_record(record)
