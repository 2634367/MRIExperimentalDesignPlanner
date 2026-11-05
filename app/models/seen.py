"""What each participant has actually been shown, so a later visit can prefer
items they have not met.

One record per experiment and participant: the items shown, the runs those
came from, and the highest visit number recorded. It is fed from run records,
never from plans, so a download that was never played or a run that stopped
early counts for exactly what reached the screen. A local launch feeds it when
the runner exits; a bundle's records come back through the run dialog.

Previews are not counted: a single-trial preview or a pilot run is someone
checking the task, even when the dialog still remembers a participant.

The browser asks for this before compiling, because that is where items are
drawn (static/js/compile.js). Preferring unseen items is a preference, not a
rule: when a list runs out, compile.js repeats and says so.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.core.db import BUCKET_EXPERIMENTS, BUCKET_SEEN, Record, Store

PARTICIPANT_MAX = 64
ITEM_MAX = 200
ITEMS_PER_RUN_MAX = 20_000
RUNS_PER_REQUEST_MAX = 200
RUN_KEY_MAX = 200
VISIT_MAX = 999


class BadRunError(ValueError):
    pass


def _key(experiment_id: str, participant: str) -> str:
    return f"{experiment_id}:{participant}"


def read(store: Store, experiment_id: str, participant: str) -> dict[str, Any]:
    record = store.get(BUCKET_SEEN, _key(experiment_id, participant)) or {}
    return {
        "items": record.get("items", []),
        "runs": len(record.get("runs", [])),
        "highest_visit": record.get("highest_visit", 0),
    }


def summarise(record: Any) -> dict[str, Any] | None:
    """The part of a runner's <name>.json this needs, or None when it is not
    one that counts."""
    if not isinstance(record, dict) or not isinstance(record.get("plan"), dict):
        return None
    plan = record["plan"]
    run = plan.get("run") if isinstance(plan.get("run"), dict) else {}
    label = run.get("label")
    participant = record.get("participant") or plan.get("participant")
    if not isinstance(label, str) or label.startswith("trial-") or plan.get("pilot_blocks") or not participant:
        return None
    experiment = plan.get("experiment") if isinstance(plan.get("experiment"), dict) else {}
    return {
        "experiment": experiment.get("id"),
        "participant": participant,
        "run": f"{label}@{record.get('started')}",
        "items": record.get("shown_items") or [],
        "visit": plan.get("visit") or 0,
    }


def _check(summary: Any) -> dict[str, Any]:
    if not isinstance(summary, dict):
        raise BadRunError("a run must be an object")
    participant, run, items, visit = (summary.get(key) for key in ("participant", "run", "items", "visit"))
    if not isinstance(participant, str) or not 1 <= len(participant) <= PARTICIPANT_MAX:
        raise BadRunError("a run needs a participant")
    if not isinstance(run, str) or not 1 <= len(run) <= RUN_KEY_MAX:
        raise BadRunError("a run needs a name")
    if not isinstance(items, list) or len(items) > ITEMS_PER_RUN_MAX:
        raise BadRunError("a run's items must be a list")
    if any(not isinstance(item, str) or not 1 <= len(item) <= ITEM_MAX for item in items):
        raise BadRunError("an item must be its id")
    if not isinstance(visit, int) or isinstance(visit, bool) or not 0 <= visit <= VISIT_MAX:
        raise BadRunError("a visit must be a number")
    return summary


def add_run(store: Store, experiment_id: str, summary: Any) -> bool:
    """Record one run; False if it was already recorded, so uploading a
    folder twice changes nothing."""
    run = _check(summary)
    key = _key(experiment_id, run["participant"])
    with store.transaction() as tx:
        record: Record = tx.get(BUCKET_SEEN, key) or {
            "experiment_id": experiment_id, "participant": run["participant"], "items": [], "runs": [], "highest_visit": 0,
        }
        if run["run"] in record["runs"]:
            return False
        known = set(record["items"])
        record["items"] += [item for item in dict.fromkeys(run["items"]) if item not in known]
        record["runs"].append(run["run"])
        record["highest_visit"] = max(record["highest_visit"], run["visit"])
        tx.put(BUCKET_SEEN, key, record)
    return True


def add_runs(store: Store, experiment_id: str, summaries: Any) -> int:
    if not isinstance(summaries, list) or len(summaries) > RUNS_PER_REQUEST_MAX:
        raise BadRunError(f"send at most {RUNS_PER_REQUEST_MAX} runs")
    checked = [_check(summary) for summary in summaries]
    # A record from another experiment's bundle says nothing about this one.
    return sum(add_run(store, experiment_id, run) for run in checked if run.get("experiment") == experiment_id)


def add_folder(store: Store, experiment_id: str, folder: Path) -> int:
    """Everything a finished launch left in folder, which is <launch>/data.
    Run records sit in a folder per start of the runner, or directly in data
    from before that; the BIDS sidecars beside them summarise to nothing."""
    added = 0
    for path in sorted(folder.rglob("*.json")):
        try:
            summary = summarise(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
        if summary is not None and summary["experiment"] == experiment_id:
            added += add_run(store, experiment_id, summary)
    return added


def purge_orphans(store: Store) -> int:
    """Drop what is held for experiments that no longer exist."""
    live = {key for key, _ in store.all(BUCKET_EXPERIMENTS)}
    return store.delete_where(BUCKET_SEEN, lambda _key, record: record["experiment_id"] not in live)
