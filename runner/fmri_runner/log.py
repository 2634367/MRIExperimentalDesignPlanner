"""What a run leaves behind, in --out:

  events.jsonl                 append-only, one line per thing that happened
                               (every run, every launch), never rewritten:
                               pulses, presses and segments as they occur
  <start time>/                one folder per start of the runner, so running
                               a run again never overwrites the last attempt
    <name>_events.tsv          BIDS events for this run: onset and duration in
                               seconds from t0 (the trigger the run started
                               on), one row per segment shown, plus an
                               item_<column> for each column of the drawn
                               items (answer, category, ...). Written row by
                               row, so a crash keeps what had been shown
    <name>_events.json         BIDS sidecar saying what those columns mean
    <name>.json                the run record: the plan, the measured onset of
                               every segment, every key press and trigger, and
                               the items shown (the designer reads those to
                               prefer unseen items on a later visit). Says
                               "aborted": true from the moment the run starts
                               until it is saved, so a crash cannot pass for a
                               finished run

<name> is a BIDS name, sub-X_ses-01_task-Y_run-02, or with acq-pilot for a
shortened run.
"""
import csv
import json
import time
from datetime import datetime, timezone
from pathlib import Path

TSV_COLUMNS = ["onset", "duration", "trial_type", "phase", "trial", "block", "item", "item_label",
               "response", "response_time", "planned_onset", "expected_response", "correct"]
COLUMN_MEANINGS = {
    "onset": {"Description": "Measured time of the first frame, from t0, the trigger the run started on", "Units": "s"},
    "duration": {"Description": "Measured time on screen", "Units": "s"},
    "trial_type": {"Description": "Trial type, or the kind of screen outside a trial"},
    "phase": {"Description": "Phase of the trial, or the screen's label"},
    "trial": {"Description": "Trial number in this run, from 1"},
    "block": {"Description": "Block number in this run, from 1"},
    "item": {"Description": "Id of the item drawn from the list"},
    "item_label": {"Description": "The item as shown"},
    "response": {"Description": "First key pressed on this screen; the run record has every press"},
    "response_time": {"Description": "That press, from the measured onset", "Units": "s"},
    "planned_onset": {"Description": "Onset in the plan, from t0", "Units": "s"},
    "expected_response": {"Description": "The key the design expects on this screen, when it scores responses"},
    "correct": {"Description": "1 if the first key pressed was the expected one, 0 if another key or none; n/a when not scored",
                "Levels": {"1": "correct", "0": "wrong or no response"}},
}


def bids_label(text, fallback):
    """BIDS labels are letters and digits only."""
    return "".join(c for c in str(text or "") if c.isascii() and c.isalnum()) or fallback


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


class EventsFile:
    """A run's TSV, written as the run goes. Flushed but not fsynced: this
    survives the runner dying, and costs almost nothing between two frames."""

    def __init__(self, path, columns):
        self.path = path
        self.columns = columns
        self.handle = path.open("w", encoding="utf-8", newline="")
        self.writer = csv.DictWriter(self.handle, fieldnames=columns, delimiter="\t", extrasaction="ignore")
        self.writer.writeheader()
        self.handle.flush()

    def write(self, row):
        self.writer.writerow({key: ("n/a" if row.get(key) in (None, "") else row[key]) for key in self.columns})
        self.handle.flush()

    def close(self):
        self.handle.close()


class Log:
    def __init__(self, out_dir):
        self.root = Path(out_dir)
        self.root.mkdir(parents=True, exist_ok=True)
        self.events = self.root / "events.jsonl"
        self.context = {}
        self.dir = self._new_folder()

    def _new_folder(self):
        stamp = time.strftime("%Y%m%dT%H%M%S")
        folder, again = self.root / stamp, 1
        while folder.exists():
            again += 1
            folder = self.root / f"{stamp}-{again}"
        folder.mkdir()
        return folder

    def log(self, event, **fields):
        line = {"at": now_iso(), "event": event, **self.context, **fields}
        with self.events.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(line) + "\n")

    def name_for(self, plan, participant):
        who = bids_label(participant or plan.get("participant"), "anon")
        task = bids_label(plan["experiment"]["name"], "task")
        label = plan["run"]["label"]
        fields = label.split("_")
        session = next((field for field in fields if field.startswith("ses-")), None)
        run = next((field for field in fields if field.startswith("run-")), None)
        acquisition = ("pilot" if plan.get("pilot_blocks") else "") + ("" if run else bids_label(label, ""))
        parts = [f"sub-{who}", session, f"task-{task}", f"acq-{acquisition}" if acquisition else None, run]
        return "_".join(part for part in parts if part)

    def earlier_results(self, name):
        """This run's events from an earlier start of the runner."""
        return sorted(path for path in self.root.rglob(f"{name}_events.tsv") if path.parent != self.dir)

    def write_run(self, name, record):
        path = self.dir / f"{name}.json"
        path.write_text(json.dumps(record, indent=1), encoding="utf-8")
        return path

    def open_events(self, name, segments=()):
        columns = TSV_COLUMNS + [c for c in item_columns(segments) if c not in TSV_COLUMNS]
        return EventsFile(self.dir / f"{name}_events.tsv", columns)

    def write_sidecar(self, name, segments, record):
        meanings = dict(COLUMN_MEANINGS)
        for column in item_columns(segments):
            meanings.setdefault(column, {"Description": f"The drawn item's {column[len('item_'):]} column"})
        sidecar = dict(meanings, StimulusPresentation={"SoftwareName": "PsychoPy", "SoftwareVersion": record.get("psychopy")},
                       Aborted=record["aborted"])
        path = self.dir / f"{name}_events.json"
        path.write_text(json.dumps(sidecar, indent=1), encoding="utf-8")
        return path
