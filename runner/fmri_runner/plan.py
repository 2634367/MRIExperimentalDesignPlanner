"""Loading run plans from disk. No PsychoPy needed, so `--check` works
anywhere."""
import json
import math
from pathlib import Path

from . import FORMAT


class PlanError(Exception):
    pass


def expand(paths):
    """Plan files in the order given; a folder means every *.json in it, by
    name."""
    found = []
    for raw in paths:
        path = Path(raw)
        if path.is_dir():
            found.extend(sorted(path.glob("*.json")))
        elif path.is_file():
            found.append(path)
        else:
            raise PlanError(f"no such plan: {path}")
    if not found:
        raise PlanError("no plans given")
    return found


def load(path, media_dir=None):
    """Read one plan and check what the runner relies on. The designer's
    server has already checked the full shape; this catches a plan from a
    newer designer, a hand edit, or a missing picture before any window
    opens."""
    try:
        plan = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise PlanError(f"{path}: not a readable plan ({error})")
    if not isinstance(plan, dict) or plan.get("format") != FORMAT:
        raise PlanError(f"{path}: not a {FORMAT} plan (format {plan.get('format') if isinstance(plan, dict) else None!r})")
    for key in ("run", "scanner", "display", "keys", "segments", "media"):
        if key not in plan:
            raise PlanError(f"{path}: missing {key!r}")
    folder = Path(media_dir) if media_dir else Path(path).resolve().parent.parent / "media"
    plan["_media_paths"] = {}
    for sha, entry in plan["media"].items():
        picture = folder / f"{sha}.{entry['ext']}"
        if not picture.is_file():
            raise PlanError(f"{path}: picture {picture.name} is not in {folder}")
        plan["_media_paths"][sha] = str(picture)
    plan["_path"] = str(path)
    return plan


def shorten(plan, blocks):
    """The plan cut to its first `blocks` block repetitions, for checking a
    task: the rest after the last block kept goes, and the lead-out moves up
    behind it. The trials kept are exactly the ones the full run would show.
    Marked pilot_blocks, so its results cannot pass for a whole run."""
    segments = plan["segments"]
    numbers = {segment["block"] for segment in segments if segment.get("block") is not None}
    if not numbers:
        raise PlanError(f"{plan['_path']}: this plan has no blocks to shorten (made by an older designer?)")
    if blocks >= len(numbers):
        return plan
    kept = []
    end = 0.0
    for segment in segments:
        block = segment.get("block")
        if block is not None and (block >= blocks or (segment["kind"] == "rest" and block == blocks - 1)):
            continue
        if segment["kind"] == "lead_out":
            segment = dict(segment, onset=round(end, 4))
        if segment["kind"] != "instructions":
            end = segment["onset"] + segment["duration"]
        kept.append(segment)
    scanner = plan["scanner"]
    total = round(end, 4)
    # As compile.js counts them: this t0 pulse is itself a real volume.
    shared = 1 if scanner.get("t0") == "after_dummies" else 0
    return dict(plan, segments=kept, total_seconds=total, pilot_blocks=blocks,
                volumes=scanner["dummy_volumes"] + math.ceil(total / scanner["tr"] - 1e-9) - shared)


def summary(plan):
    trials = {segment.get("trial") for segment in plan["segments"] if segment.get("trial") is not None}
    return (f"{plan['run']['label']}: {plan['run']['name']} -- {len(trials)} trials, "
            f"{plan['total_seconds'] / 60:.1f} min after the trigger, {plan['volumes']} volumes")
