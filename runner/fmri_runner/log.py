"""What a run leaves behind, in --out:

  events.jsonl                 append-only, one line per thing that happened
                               (every run, every launch), never rewritten
  <name>_events.tsv            BIDS-style events for this run: onset and
                               duration in seconds from t0 (the trigger the
                               run started on), one row per segment shown,
                               plus an item_<column> for each column of the
                               drawn items (answer, category, ...)
  <name>.json                  the run record: the plan, the measured onset of
                               every segment, every key press and trigger,
                               and the items shown (the designer reads those
                               to prefer unseen items on a later visit)
"""
import csv
import json
import time
from datetime import datetime, timezone
from pathlib import Path

TSV_COLUMNS = ["onset", "duration", "trial_type", "phase", "trial", "item", "item_label",
               "response", "response_time", "planned_onset"]


def item_columns(segments):
    """item_<key> for every column the plan's items carry, in the order
    they first appear, so a run's TSV header is known before it starts."""
    columns = []
    for segment in segments:
        for key in segment.get("item_values") or {}:
            if "item_" + key not in columns:
                columns.append("item_" + key)
    return columns


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Log:
    def __init__(self, out_dir):
        self.dir = Path(out_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.events = self.dir / "events.jsonl"
        self.context = {}

    def log(self, event, **fields):
        line = {"at": now_iso(), "event": event, **self.context, **fields}
        with self.events.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(line) + "\n")

    def name_for(self, plan, participant):
        who = participant or plan.get("participant") or "anon"
        stamp = time.strftime("%Y%m%dT%H%M%S")
        safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in who)
        pilot = "_pilot" if plan.get("pilot_blocks") else ""
        return f"sub-{safe}_{plan['run']['label']}{pilot}_{stamp}"

    def write_run(self, name, record):
        path = self.dir / f"{name}.json"
        path.write_text(json.dumps(record, indent=1), encoding="utf-8")
        return path

    def write_events(self, name, rows, segments=()):
        path = self.dir / f"{name}_events.tsv"
        columns = TSV_COLUMNS + [c for c in item_columns(segments) if c not in TSV_COLUMNS]
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=columns, delimiter="\t", extrasaction="ignore")
            writer.writeheader()
            for row in rows:
                writer.writerow({key: ("n/a" if row.get(key) in (None, "") else row[key]) for key in columns})
        return path
