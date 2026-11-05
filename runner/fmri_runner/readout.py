"""What the operator sees in the terminal during a run: where it is, what is
on screen and what comes next.

In a terminal the last four lines are rewritten in place, at most ten times a
second and just after a flip, so a repaint never delays a frame:

  run    #########-----------------  36%   trial 36/100   block 4/10   8:47 / 24:20
  phase  ##############------------ answer  1.8s   fixation > [answer] > blank
  now    Is a plum a fruit?                                            standard
  next   Is the pictured object an animal?                             standard

Anywhere else -- a local launch writes to runner.log, which the run dialog
shows -- or with --quiet, it is one plain line per trial instead. No PsychoPy
here, so it can be tested anywhere.
"""
import shutil
import sys
import time

REFRESH_SECONDS = 0.1
UP_AND_CLEAR = "\x1b[{lines}F\x1b[J"


def clock(seconds):
    seconds = max(0, int(seconds or 0))
    return f"{seconds // 60}:{seconds % 60:02d}"


def bar(fraction, width):
    filled = max(0, min(width, round(fraction * width)))
    return "#" * filled + "-" * (width - filled)


def fit(text, width):
    text = " ".join(str(text).split())
    width = max(8, width)
    return text if len(text) <= width else text[:width - 3] + "..."


def row(left, right, width):
    """left, and right pushed to the margin when both fit."""
    gap = width - len(left) - len(right)
    return left + " " * gap + right if gap >= 2 else fit(left, width)


def describe(segment):
    """The text of what a segment shows, for the now and next lines."""
    if segment is None:
        return "(end of run)", ""
    label = segment.get("item_label") or segment.get("label") or segment.get("kind", "")
    return label, segment.get("trial_type") or segment.get("kind", "")


class Readout:
    def __init__(self, plan, quiet=False, stream=None):
        self.out = stream or sys.stdout
        self.live = not quiet and self.out.isatty()
        self.shown = [segment for segment in plan["segments"] if segment["kind"] != "instructions"]
        self.total = plan["total_seconds"]
        self.trials = len({s["trial"] for s in self.shown if s.get("trial") is not None})
        self.blocks = len({s["block"] for s in self.shown if s.get("block") is not None})
        self.phases = {}
        for segment in self.shown:
            if segment.get("trial") is not None:
                self.phases.setdefault(segment["trial"], []).append(segment)
        self.index = None
        self.painted = 0
        self.next_paint = 0.0
        self.last_trial = None

    def _write(self, text):
        try:
            self.out.write(text)
            self.out.flush()
        except (ValueError, OSError):
            pass  # stdout went away during shutdown; the run still matters more

    def _next_of(self, index):
        """The next thing that is not this trial, for the next line."""
        trial = self.shown[index].get("trial")
        for position in range(index + 1, len(self.shown)):
            if trial is None or self.shown[position].get("trial") != trial:
                return self.shown[position]
        return None

    def where(self, segment):
        """"trial 36/100   block 4/10", as far as the plan can say."""
        parts = []
        if segment.get("trial") is not None and self.trials:
            parts.append(f"trial {segment['trial'] + 1}/{self.trials}")
        if segment.get("block") is not None and self.blocks:
            parts.append(f"block {segment['block'] + 1}/{self.blocks}")
        return "   ".join(parts)

    def lines(self, now, width):
        segment = self.shown[self.index]
        fraction = now / self.total if self.total else 0
        left = f"  run    {bar(fraction, 26)} {round(fraction * 100):3d}%   {self.where(segment)}"
        phases = self.phases.get(segment.get("trial"), [segment])
        strip = " > ".join(f"[{s['label']}]" if s is segment else s["label"] for s in phases)
        remaining = segment["onset"] + segment["duration"] - now
        elapsed = 1 - remaining / segment["duration"] if segment["duration"] else 1
        phase = f"  phase  {bar(elapsed, 26)} {segment['label'] or segment['kind']}  {max(0, remaining):.1f}s"
        now_text, now_type = describe(segment)
        next_text, next_type = describe(self._next_of(self.index))
        return [
            row(left, f"{clock(now)} / {clock(self.total)}", width),
            row(phase, strip, width),
            row("  now    " + fit(now_text, width - 30), now_type, width),
            row("  next   " + fit(next_text, width - 30), next_type, width),
        ]

    def plain(self, now):
        segment = self.shown[self.index]
        text, kind = describe(segment)
        where = self.where(segment)
        head = f"[{'trial' if segment.get('trial') is not None else segment['kind']}]"
        return " ".join(part for part in (head, where, f"{clock(now)}/{clock(self.total)}", f"{kind}:", fit(text, 60)) if part)

    def segment(self, index, now):
        """A new segment has started."""
        self.index = index
        segment = self.shown[index]
        if self.live:
            self.next_paint = 0.0
            self.tick(now)
            return
        trial = segment.get("trial")
        if trial is None or trial != self.last_trial:
            self.last_trial = trial
            self._write(self.plain(now) + "\n")

    def tick(self, now):
        if not self.live or self.index is None:
            return
        moment = time.monotonic()
        if moment < self.next_paint:
            return
        self.next_paint = moment + REFRESH_SECONDS
        width = shutil.get_terminal_size((100, 24)).columns - 1
        lines = self.lines(now, width)
        erase = UP_AND_CLEAR.format(lines=self.painted) if self.painted else ""
        self._write(erase + "\n".join(lines) + "\n")
        self.painted = len(lines)

    def note(self, text):
        """A line that stays, above the live block."""
        erase = UP_AND_CLEAR.format(lines=self.painted) if self.live and self.painted else ""
        self.painted = 0
        self.next_paint = 0.0
        self._write(erase + text + "\n")
