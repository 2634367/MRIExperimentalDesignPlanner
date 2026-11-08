"""How well each run went, from the runner's record of it: did it finish, did
the screens go up on time, did the scanner's pulses match the plan.

One record per experiment holds a short summary of every run brought back,
fed the same two ways as app/models/seen.py: a local launch when the runner
exits, and a bundle's records through the run dialog's Add run results. Unlike
seen, pilots and debug runs are kept, because checking a pilot is what this
is for. Single-trial previews are not.

Where the design says which key a screen expects (a phase's Expected key),
answers are scored too: right, wrong, missed and the reaction time of the
right ones, per run and per trial type.

The browser sends records trimmed to what summarise reads (launch.js
RunDialog.trimRecord), so the summary is worked out here, in one place, for
both ways in. The verdict is worked out when the list is read, so changing a
threshold changes every run already stored.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.core.db import BUCKET_EXPERIMENTS, BUCKET_RESULTS, Record, Store

RUNS_PER_EXPERIMENT_MAX = 5000
RECORDS_PER_REQUEST_MAX = 200
SEGMENTS_MAX = 50_000
TEXT_MAX = 200

# A screen the runner puts up within half a frame of its planned onset is on
# time. Past these it is worth a look.
LATE_FRAMES = 1.5         # the worst onset, in frames
MEAN_LATE_FRAMES = 0.5    # the mean onset error, in frames
# One pulse either way is the scanner stopping as the run ends.
PULSE_SLACK = 1

# Why a run is unusable, worth a look, or just labelled. Codes, so the screen
# says them in its own words (config/language.yaml results.reason_*).
BAD = ("stopped", "failed", "paused", "pulses")
CHECK = ("late", "dropped", "pulse_gaps")


class BadRecordError(ValueError):
    pass


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _text(value: Any) -> str:
    return value[:TEXT_MAX] if isinstance(value, str) else ""


def _count(value: Any) -> int:
    if isinstance(value, list):
        return len(value)
    number = _number(value)
    return int(number) if number is not None and number >= 0 else 0


def summarise(record: Any) -> dict[str, Any] | None:
    """A run record's timing in a few numbers, or None when it is not one
    worth keeping (not a run record, or a single-trial preview)."""
    if not isinstance(record, dict) or not isinstance(record.get("plan"), dict):
        return None
    plan = record["plan"]
    run = plan.get("run") if isinstance(plan.get("run"), dict) else {}
    label = run.get("label")
    if not isinstance(label, str) or not label or label.startswith("trial-"):
        return None
    segments = record.get("segments") if isinstance(record.get("segments"), list) else []
    planned = plan.get("segments") if isinstance(plan.get("segments"), list) else []
    if len(segments) > SEGMENTS_MAX or len(planned) > SEGMENTS_MAX:
        raise BadRecordError("a run has too many segments")
    errors = []
    responses = 0
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        onset, planned_onset = _number(segment.get("onset")), _number(segment.get("planned_onset"))
        if onset is not None and planned_onset is not None:
            errors.append(abs(onset - planned_onset) * 1000)
        if segment.get("response"):
            responses += 1
    pulses = record.get("pulses") if isinstance(record.get("pulses"), dict) else None
    behaviour = score(segments, planned)
    experiment = plan.get("experiment") if isinstance(plan.get("experiment"), dict) else {}
    started = _text(record.get("started"))
    return {
        "experiment": _text(experiment.get("id")),
        "run": f"{label}@{started}"[:TEXT_MAX],
        "label": label[:TEXT_MAX],
        "participant": _text(record.get("participant") or plan.get("participant")),
        "visit": _count(plan.get("visit")),
        "started": started,
        "ended": _text(record.get("ended")),
        "scanner_mode": _text(record.get("scanner_mode")),
        "pilot": bool(plan.get("pilot_blocks")),
        "debug": record.get("debug") is True,
        "pauses": _count(record.get("pauses")),
        "aborted": record.get("aborted") is not False,
        "error": _text(record.get("error")),
        "segments": len(segments),
        "planned_segments": sum(1 for s in planned if isinstance(s, dict) and s.get("kind") != "instructions"),
        "responses": responses,
        "onset_error_ms": round(sum(errors) / len(errors), 2) if errors else None,
        "worst_onset_ms": round(max(errors), 2) if errors else None,
        "frame_ms": _number(record.get("frame_ms")),
        "dropped_frames": _count(record.get("dropped_frames")),
        "worst_frame_ms": _number(record.get("worst_frame_ms")),
        "pulses_seen": _count(pulses.get("seen")) if pulses else None,
        "pulses_expected": _count(pulses.get("expected")) if pulses and pulses.get("expected") is not None else None,
        "pulse_gaps": _count(record.get("pulse_gaps")),
        "duration": _number(record.get("duration")),
        "planned_seconds": _number(plan.get("total_seconds")),
        "flip": _text(record.get("flip")),
        "psychopy": _text(record.get("psychopy")),
        **behaviour,
    }


def _tally() -> dict[str, Any]:
    return {"scored": 0, "correct": 0, "missed": 0, "rt_ms_total": 0.0, "rt_n": 0}


def score(segments: list, planned: list) -> dict[str, Any]:
    """Right and wrong against the key each screen expected, in all and per
    trial type. Reaction times are of correct answers only. A screen that was
    never shown (the run stopped first) is not scored at all."""
    shown = [s for s in planned if isinstance(s, dict) and s.get("kind") != "instructions"]
    total = _tally()
    by_type: dict[str, dict[str, Any]] = {}
    for position, segment in enumerate(segments):
        if not isinstance(segment, dict):
            continue
        index = segment.get("index") if isinstance(segment.get("index"), int) else position
        plan = shown[index] if 0 <= index < len(shown) else {}
        response = plan.get("response") if isinstance(plan.get("response"), dict) else {}
        expected = segment.get("expected") or response.get("correct")
        if not isinstance(expected, str) or not expected:
            continue
        answered = segment.get("response") if isinstance(segment.get("response"), dict) else None
        right = bool(answered and answered.get("key") == expected)
        rt = _number(answered.get("rt")) if right and answered else None
        name = _text(plan.get("trial_type"))
        for tally in (total, by_type.setdefault(name, _tally())):
            tally["scored"] += 1
            tally["correct"] += right
            tally["missed"] += answered is None
            if rt is not None:
                tally["rt_ms_total"] += rt * 1000
                tally["rt_n"] += 1
    return {**total, "by_trial_type": by_type}


def assess(summary: dict[str, Any]) -> dict[str, Any]:
    """{level: ok | check | bad, reasons: [code]} for one summary."""
    reasons = []
    if summary["error"]:
        reasons.append("failed")
    elif summary["aborted"]:
        reasons.append("stopped")
    if summary["pauses"]:
        reasons.append("paused")
    seen, expected = summary["pulses_seen"], summary["pulses_expected"]
    if seen is not None and expected is not None and not summary["aborted"] and abs(seen - expected) > PULSE_SLACK:
        reasons.append("pulses")
    frame = summary["frame_ms"] or 1000 / 60
    worst, mean = summary["worst_onset_ms"], summary["onset_error_ms"]
    if (worst is not None and worst > LATE_FRAMES * frame) or (mean is not None and mean > MEAN_LATE_FRAMES * frame):
        reasons.append("late")
    if summary["dropped_frames"]:
        reasons.append("dropped")
    if summary["pulse_gaps"]:
        reasons.append("pulse_gaps")
    level = "bad" if any(r in BAD for r in reasons) else "check" if reasons else "ok"
    return {"level": level, "reasons": reasons}


def read(store: Store, experiment_id: str) -> list[dict[str, Any]]:
    """Every run brought back, newest first, each with its verdict."""
    record = store.get(BUCKET_RESULTS, experiment_id) or {}
    runs = sorted(record.get("runs", []), key=lambda run: run["started"], reverse=True)
    return [{**run, **assess(run)} for run in runs]


def add(store: Store, experiment_id: str, summaries: list[dict[str, Any]]) -> int:
    """Keep these runs; a run already kept is skipped, so bringing a folder
    back twice changes nothing."""
    if not summaries:
        return 0
    with store.transaction() as tx:
        record: Record = tx.get(BUCKET_RESULTS, experiment_id) or {"experiment_id": experiment_id, "runs": []}
        known = {run["run"] for run in record["runs"]}
        fresh = []
        for summary in summaries:
            if summary["run"] not in known:
                known.add(summary["run"])
                fresh.append(summary)
        if not fresh:
            return 0
        # The oldest go first when an experiment has more than it can hold.
        record["runs"] = sorted(record["runs"] + fresh, key=lambda run: run["started"])[-RUNS_PER_EXPERIMENT_MAX:]
        tx.put(BUCKET_RESULTS, experiment_id, record)
    return len(fresh)


def add_records(store: Store, experiment_id: str, records: Any) -> int:
    """Run records from the run dialog. One from another experiment says
    nothing about this one and is skipped."""
    if not isinstance(records, list) or len(records) > RECORDS_PER_REQUEST_MAX:
        raise BadRecordError(f"send at most {RECORDS_PER_REQUEST_MAX} run records")
    summaries = [summarise(record) for record in records]
    return add(store, experiment_id, [s for s in summaries if s is not None and s["experiment"] == experiment_id])


def add_folder(store: Store, experiment_id: str, folder: Path) -> int:
    """Everything a finished launch left in folder (<launch>/data). The BIDS
    sidecars beside the records summarise to nothing."""
    summaries = []
    for path in sorted(folder.rglob("*.json")):
        try:
            summary = summarise(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
        if summary is not None and summary["experiment"] == experiment_id:
            summaries.append(summary)
    return add(store, experiment_id, summaries)


def remove(store: Store, experiment_id: str, run: str) -> bool:
    """Forget one run, for a record brought back by mistake."""
    with store.transaction() as tx:
        record = tx.get(BUCKET_RESULTS, experiment_id)
        if not record:
            return False
        kept = [r for r in record["runs"] if r["run"] != run]
        if len(kept) == len(record["runs"]):
            return False
        record["runs"] = kept
        tx.put(BUCKET_RESULTS, experiment_id, record)
    return True


def purge_orphans(store: Store) -> int:
    """Drop what is held for experiments that no longer exist."""
    live = {key for key, _ in store.all(BUCKET_EXPERIMENTS)}
    return store.delete_where(BUCKET_RESULTS, lambda key, _record: key not in live)
