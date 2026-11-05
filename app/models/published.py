"""The published copy of a design: run plans and figures at addresses that do
not change, for a paper, a wiki page, or a runner fetching over the network.

Only the browser can compile a plan or draw a figure, so nothing here is
current by magic: pressing Publish sends what the browser made, and those
files stay what the addresses serve until the next Publish. The manifest says
when that was and from which revision, so a reader can tell how old it is.

A publish arrives in parts, because the whole thing can be larger than one
request may be. Each part lands in a folder of its own; only finish() points
the experiment at it, so a publish that fails half way changes nothing and
someone reading a figure never sees half of one and half of another.

    <storage>/published/<experiment id>/<version>/plans/<label>.json
                                                 /figures/<name>.svg | .png
"""
from __future__ import annotations

import base64
import binascii
import json
import re
import shutil
from pathlib import Path
from typing import Any

from app.core import encryption
from app.core.db import BUCKET_EXPERIMENTS, BUCKET_PUBLISHED, Record, Store
from app.core.report import MAX_PNG_BASE64, MAX_SVG, PNG_MAGIC, slug
from app.models import to_iso, utc_now
from app.models.experiments import Experiment
from app.models.plans import check_plan

PUBLISHED_DIR_NAME = "published"
MAX_PLANS = 512
MAX_FIGURES = 200
MAX_TOTAL_BYTES = 512 * 1024 * 1024
SVG_HEAD = 300
VERSION = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
LABEL = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
FILE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,120}\.(svg|png)$")


class BadPublishError(ValueError):
    pass


class NothingPublishedError(Exception):
    pass


def _folder(storage_dir: Path, experiment_id: str) -> Path:
    return storage_dir / PUBLISHED_DIR_NAME / experiment_id


def _version_folder(storage_dir: Path, experiment_id: str, version: object) -> Path:
    if not isinstance(version, str) or not VERSION.match(version):
        raise BadPublishError("no such publish in progress")
    folder = _folder(storage_dir, experiment_id) / version
    if not folder.is_dir():
        raise BadPublishError("no such publish in progress")
    return folder


def _size(folder: Path) -> int:
    return sum(path.stat().st_size for path in folder.rglob("*") if path.is_file())


def _clear_unfinished(store: Store, storage_dir: Path, experiment_id: str) -> None:
    """One publish at a time per experiment: a new one replaces any that was
    abandoned. The version readers are being served is never touched."""
    current = (store.get(BUCKET_PUBLISHED, experiment_id) or {}).get("version")
    root = _folder(storage_dir, experiment_id)
    if root.is_dir():
        for folder in root.iterdir():
            if folder.is_dir() and folder.name != current:
                shutil.rmtree(folder, ignore_errors=True)


def begin(store: Store, storage_dir: Path, experiment_id: str) -> str:
    _clear_unfinished(store, storage_dir, experiment_id)
    version = encryption.url_token(12)
    folder = _folder(storage_dir, experiment_id) / version
    (folder / "plans").mkdir(mode=0o700, parents=True)
    (folder / "figures").mkdir(mode=0o700)
    return version


def add_plan(folder: Path, plan: object) -> None:
    checked = check_plan(plan)
    label = checked["run"]["label"]
    if not LABEL.match(label):
        raise BadPublishError(f"run label {label!r} may only hold letters, digits, - _ and .")
    path = folder / "plans" / f"{label}.json"
    if path.exists():
        raise BadPublishError(f"two plans have the label {label}")
    if sum(1 for _ in (folder / "plans").iterdir()) >= MAX_PLANS:
        raise BadPublishError(f"at most {MAX_PLANS} plans")
    path.write_text(json.dumps(checked, indent=1), encoding="utf-8")


def add_figure(folder: Path, figure: object) -> None:
    if not isinstance(figure, dict):
        raise BadPublishError("a figure must be an object")
    name = slug(str(figure.get("name") or ""), "figure")
    svg, png = figure.get("svg"), figure.get("png")
    # The browser's SVGs start with an XML declaration.
    if not isinstance(svg, str) or "<svg" not in svg[:SVG_HEAD] or len(svg) > MAX_SVG:
        raise BadPublishError(f"figure {name}: not an SVG of a size this will keep")
    if sum(1 for _ in (folder / "figures").glob("*.svg")) >= MAX_FIGURES:
        raise BadPublishError(f"at most {MAX_FIGURES} figures")
    (folder / "figures" / f"{name}.svg").write_text(svg, encoding="utf-8")
    if png:
        if not isinstance(png, str) or len(png) > MAX_PNG_BASE64:
            raise BadPublishError(f"figure {name}: the PNG is too big")
        try:
            data = base64.b64decode(png, validate=True)
        except (binascii.Error, ValueError):
            raise BadPublishError(f"figure {name}: the PNG is not base64") from None
        if not data.startswith(PNG_MAGIC):
            raise BadPublishError(f"figure {name}: not a PNG")
        (folder / "figures" / f"{name}.png").write_bytes(data)


def add_parts(storage_dir: Path, experiment_id: str, version: object, plans: object, figures: object) -> None:
    folder = _version_folder(storage_dir, experiment_id, version)
    for label, parts in (("plans", plans), ("figures", figures)):
        if parts is not None and not isinstance(parts, list):
            raise BadPublishError(f"{label} must be a list")
    for plan in plans or []:
        add_plan(folder, plan)
    for figure in figures or []:
        add_figure(folder, figure)
    if _size(folder) > MAX_TOTAL_BYTES:
        shutil.rmtree(folder, ignore_errors=True)
        raise BadPublishError("this is too much to publish")


def _plan_row(path: Path) -> dict[str, Any]:
    plan = json.loads(path.read_text(encoding="utf-8"))
    row = {
        "label": plan["run"]["label"], "run": plan["run"]["id"], "name": plan["run"]["name"],
        "total_seconds": plan["total_seconds"], "volumes": plan["volumes"], "media": plan["media"],
    }
    if plan.get("session"):
        row["session"] = plan["session"]
    return row


def finish(store: Store, storage_dir: Path, experiment: Experiment, user_id: int, version: object, seed: object) -> dict[str, Any]:
    folder = _version_folder(storage_dir, experiment.id, version)
    plans = [_plan_row(path) for path in sorted((folder / "plans").glob("*.json"))]
    if not plans and not any((folder / "figures").iterdir()):
        raise BadPublishError("nothing to publish")
    record: Record = {
        "experiment_id": experiment.id,
        "version": version,
        "published_at": to_iso(utc_now()),
        "published_by": user_id,
        "revision": experiment.revision,
        "seed": seed if isinstance(seed, int) and not isinstance(seed, bool) else 0,
        "plans": plans,
        "figures": sorted(path.name for path in (folder / "figures").iterdir()),
    }
    store.put(BUCKET_PUBLISHED, experiment.id, record)
    _clear_unfinished(store, storage_dir, experiment.id)
    return record


def manifest(store: Store, experiment_id: str) -> Record:
    record = store.get(BUCKET_PUBLISHED, experiment_id)
    if record is None:
        raise NothingPublishedError()
    return record


def file_path(store: Store, storage_dir: Path, experiment_id: str, kind: str, name: str) -> Path:
    """A published file. name is matched against what was published, so a
    path can only ever be one of those."""
    record = manifest(store, experiment_id)
    if kind == "plans":
        known = {f"{plan['label']}.json" for plan in record["plans"]}
    else:
        known = {name_ for name_ in record["figures"] if FILE.match(name_)}
    if name not in known:
        raise NothingPublishedError()
    path = _folder(storage_dir, experiment_id) / record["version"] / kind / name
    if not path.is_file():
        raise NothingPublishedError()
    return path


def purge_orphans(store: Store, storage_dir: Path) -> int:
    """Drop what is held for experiments that no longer exist."""
    live = {key for key, _ in store.all(BUCKET_EXPERIMENTS)}
    removed = store.delete_where(BUCKET_PUBLISHED, lambda _key, record: record["experiment_id"] not in live)
    root = storage_dir / PUBLISHED_DIR_NAME
    if root.is_dir():
        for folder in root.iterdir():
            if folder.is_dir() and folder.name not in live:
                shutil.rmtree(folder, ignore_errors=True)
    return removed

