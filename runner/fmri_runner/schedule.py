"""Playing one plan on one clock.

Time zero (t0) is the last pulse the plan waits for, dummy_volumes of them. The
design decides what that means for its scanner (Run clock starts at): the last
dummy pulse, the one after it, or with 0 the first pulse of all. Every segment
boundary in the plan is an absolute offset from that instant, so timing error
never accumulates across a long run. A segment's measured onset is the time
of its first flip. This is the old Inner Speech session.py's loop, minus
everything that knew about questions -- and with its switch moved one frame
earlier: it changed screens once the clock was half a frame from the
boundary, but a new screen only appears on the flip after that, so every
onset landed a whole frame late. Now the screen changes on the last frame
before the one nearest the boundary, so onsets land within half a frame of
the plan.

Scanner modes:
  wait      wait for the trigger key (dummy_volumes pulses, at least one)
  simulate  count pretend pulses at the plan's TR, then start
  none      start the moment the instructions are dismissed

With --debug, the pause key holds the run and the same key resumes it. t0
moves forward by the length of the pause, so the run clock stops and every
remaining phase keeps its full length -- but a real scanner does not stop, so
a paused run's onsets no longer line up with its volumes. For checking a task,
not for data you will analyse. The record says "debug": true and lists every
pause as {"at", "duration"}; duration is null if the run ended while paused.

The wait for the scanner has no time limit, since the quit key always works,
but the terminal says what it has seen and speaks up if nothing comes. Once
the run is going, a silence of PULSE_GAP_TRS TRs is warned about once and the
run carries on: a scanner that sends only its first pulse is not an error.
"""
import psychopy
from psychopy import core, visual
from psychopy.hardware import keyboard

from .display import Painter, draw_all, text_stim
from .keys import Abort, Keys, WindowKeys, hear_other_apps, press_time, trigger_names
from .log import now_iso

WAITING_TEXT = "Waiting for the scanner ({seen}/{total})"
BETWEEN_RUNS = "Run {done} of {total} finished.\n\nPress {keys} for the next run."
BETWEEN_RUNS_BREAK = "Run {done} of {total} finished.\n\nBreak: {length}.\n\nPress {keys} for the next run."
PAUSED_TEXT = "paused -- press {keys} to resume"
NO_PULSE_WARNING_SECONDS = 30
PULSE_GAP_TRS = 3
DROPPED_FRAME = 1.5  # a flip this many frames after the last one missed at least one
UNFINISHED = "the runner stopped before this run finished"


def round4(value):
    return round(value, 4)


def between_runs(done, total, keys, break_seconds=0):
    """What the screen says between two runs, and the planned break if any.
    The advance key still ends it: the operator decides when the next run starts."""
    if not break_seconds:
        return BETWEEN_RUNS.format(done=done, total=total, keys=keys)
    length = f"{break_seconds / 60:g} min" if break_seconds >= 60 else f"{break_seconds:g} s"
    return BETWEEN_RUNS_BREAK.format(done=done, total=total, keys=keys, length=length)


def screens():
    """(width, height) of each display attached, in PsychoPy's numbering, or
    [] when pyglet cannot say."""
    try:
        import pyglet.canvas
        return [(screen.width, screen.height) for screen in pyglet.canvas.get_display().get_screens()]
    except Exception:
        return []


class Window:
    """One window for the whole sitting, shared by every plan played in it."""

    def __init__(self, display, windowed, screen=0, keyboard_backend=None, view_scale=None):
        self.win = visual.Window(
            size=(1280, 800), fullscr=not windowed, screen=screen, color=display["background"], colorSpace="hex",
            units="height", allowGUI=windowed, waitBlanking=True, viewScale=view_scale,
        )
        self.win.mouseVisible = windowed
        self.frame = self.win.monitorFramePeriod or 1.0 / 60
        self.kb = Keys(self._reader(keyboard_backend))
        self.text_color = display["text_color"]
        self.view_scale = view_scale
        self.message = text_stim(self.win, view_scale, text="", height=0.04, color=self.text_color, colorSpace="hex", wrapWidth=1.4)

    def _reader(self, backend):
        if backend == "event":
            from psychopy import event
            return WindowKeys(event)
        reader = keyboard.Keyboard(backend=backend) if backend else keyboard.Keyboard()
        hear_other_apps(reader)
        return reader

    def say(self, text, until_keys, quit_keys):
        self.message.text = text
        self.kb.clearEvents()
        while True:
            self.message.draw()
            self.win.flip()
            for key in self.kb.getKeys(list(until_keys) + list(quit_keys), waitRelease=False):
                if key.name in quit_keys:
                    raise Abort()
                return

    def close(self):
        self.win.close()


class Player:
    def __init__(self, window, plan, log, scanner_mode, readout, pause_keys=()):
        self.window = window
        self.win = window.win
        self.kb = window.kb
        self.plan = plan
        self.log = log
        self.mode = scanner_mode
        self.scanner = plan["scanner"]
        self.quit_keys = list(plan["keys"]["quit"])
        self.advance_keys = list(plan["keys"]["advance"])
        self.trigger_keys = trigger_names(str(self.scanner["trigger_key"]))
        # Every key any segment answers with. All are read all the time: a key
        # left unread would wait in the buffer for the next response window
        # and count there, with a time from before it opened.
        self.response_keys = sorted({key for segment in plan["segments"]
                                     for key in (segment.get("response") or {}).get("keys") or []})
        self.painter = Painter(self.win, plan, window.view_scale)
        self.readout = readout
        self.pause_keys = list(pause_keys)
        self.pause_wanted = False
        self.pauses = []
        self.t0 = None
        self.triggers = []
        self.presses = []
        self.current = None
        self.dummy_pulses = 0
        self.last_pulse = None
        self.gap_warned = False
        self.pulse_gaps = []
        self.last_flip = None
        self.dropped_frames = 0
        self.worst_frame = 0.0
        self.simulated_volume = 0
        self.rows = []
        self.record = {
            "plan": {key: value for key, value in plan.items() if not key.startswith("_")},
            "started": now_iso(),
            "scanner_mode": scanner_mode,
            "aborted": False,
            "segments": [],
            # Each item's id, once, from the moment it is about to go up, so a
            # run stopped mid-trial still counts what the participant saw.
            "shown_items": [],
            "psychopy": getattr(psychopy, "__version__", None),
            "frame_ms": round(window.frame * 1000, 3),
        }

    def now(self):
        return core.getTime() - self.t0

    # -- keys ---------------------------------------------------------------

    def _poll(self, response_keys=()):
        """Drain the keyboard: log triggers, honour quit, record every
        response key, and return the ones this segment is listening for, each
        with its time on the run clock."""
        pressed = []
        names = self.trigger_keys + self.quit_keys
        if self.t0 is not None:
            names = names + self.pause_keys + self.response_keys
        for key in self.kb.getKeys(names, waitRelease=False):
            if key.name in self.quit_keys:
                raise Abort()
            if key.name in self.pause_keys:
                self.pause_wanted = True
                continue
            if self.t0 is None:
                continue
            at = press_time(key, core.getTime())
            if key.name in self.trigger_keys and self.mode == "wait":
                self._pulse(at)
                continue
            if key.name in self.response_keys:
                t = round4(at - self.t0)
                self.presses.append({"key": key.name, "t": t, "segment": self.current})
                self.log.log("press", key=key.name, t=t, segment=self.current)
                if key.name in response_keys:
                    pressed.append((key.name, t))
        if self.mode == "simulate" and self.t0 is not None:
            volume = int(self.now() // self.scanner["tr"]) + 1
            while self.simulated_volume < volume:
                self.simulated_volume += 1
                self.triggers.append(round4((self.simulated_volume - 1) * self.scanner["tr"]))
        if self.mode == "wait" and self.t0 is not None:
            self._check_pulses()
        return pressed

    def _pulse(self, at):
        t = round4(at - self.t0)
        self.triggers.append(t)
        self.last_pulse = core.getTime()
        self.gap_warned = False
        self.log.log("pulse", t=t)

    def _check_pulses(self):
        silence = core.getTime() - self.last_pulse
        if self.gap_warned or silence <= PULSE_GAP_TRS * self.scanner["tr"]:
            return
        self.gap_warned = True
        t = round4(self.now())
        self.pulse_gaps.append(t)
        self.log.log("pulse_gap", t=t, silence=round4(silence))
        self.readout.note(f"[scanner] WARNING: no pulse for {silence:.1f}s at {t:.1f}s -- the run carries on; check the scanner")

    # -- before t0 ----------------------------------------------------------

    def instructions(self, segment):
        stims = self.painter.stims(segment["layers"])
        self.kb.clearEvents()
        while True:
            draw_all(stims)
            self.win.flip()
            for key in self.kb.getKeys(self.advance_keys + self.quit_keys, waitRelease=False):
                if key.name in self.quit_keys:
                    raise Abort()
                return

    def wait_for_scanner(self):
        needed = max(1, int(self.scanner["dummy_volumes"]))
        if self.mode == "none":
            self.t0 = core.getTime()
            self.log.log("scan_start", mode="none")
            return
        if self.mode == "simulate":
            start = core.getTime()
            while True:
                seen = min(needed, int((core.getTime() - start) / self.scanner["tr"]) + 1)
                self.window.message.text = WAITING_TEXT.format(seen=seen, total=needed) + " -- simulated"
                self.window.message.draw()
                self.win.flip()
                self._poll()
                if core.getTime() - start >= (needed - 1) * self.scanner["tr"]:
                    break
            self.t0 = core.getTime()
            self.log.log("scan_start", mode="simulate", pulses=needed)
            return
        pulses = []
        self.kb.clearEvents()
        self.readout.note(f"[scanner] waiting for {needed} pulse(s) on key {self.trigger_keys[0]}")
        warn_at = core.getTime() + NO_PULSE_WARNING_SECONDS
        while len(pulses) < needed:
            self.window.message.text = WAITING_TEXT.format(seen=len(pulses), total=needed)
            self.window.message.draw()
            self.win.flip()
            for key in self.kb.getKeys(self.trigger_keys + self.quit_keys, waitRelease=False):
                if key.name in self.quit_keys:
                    raise Abort()
                pulses.append(press_time(key, core.getTime()))
                self.log.log("dummy_trigger", index=len(pulses))
                warn_at = core.getTime() + NO_PULSE_WARNING_SECONDS
                if len(pulses) < needed:
                    self.readout.note(f"[scanner] pulse {len(pulses)}/{needed}")
            if core.getTime() >= warn_at:
                warn_at = core.getTime() + NO_PULSE_WARNING_SECONDS
                self.readout.note(f"[scanner] WARNING: {len(pulses)}/{needed} pulses and nothing for "
                                  f"{NO_PULSE_WARNING_SECONDS}s -- is the trigger on key {self.trigger_keys[0]}?")
        # The hardware timestamp, when it is in the same timebase.
        self.t0 = pulses[-1]
        self.dummy_pulses = len(pulses)
        self.last_pulse = core.getTime()
        self.log.log("scan_start", mode="wait", pulses=needed)

    # -- the run --------------------------------------------------------------

    def _pause(self, stims):
        """Hold the screen until the pause key comes again, then move t0
        forward so the run carries on where it stopped."""
        self.pause_wanted = False
        began = core.getTime()
        entry = {"at": round4(began - self.t0), "duration": None}
        self.pauses.append(entry)
        self.log.log("pause", t=entry["at"])
        keys = "/".join(self.pause_keys)
        self.readout.note(f"[pause] at {entry['at']:.1f}s -- {keys} to resume")
        label = text_stim(self.win, self.window.view_scale, (0, -0.46), text=PAUSED_TEXT.format(keys=keys), height=0.025,
                                color=self.window.text_color, colorSpace="hex")
        waiting = True
        while waiting:
            draw_all(stims)
            label.draw()
            self.win.flip()
            for key in self.kb.getKeys(self.pause_keys + self.quit_keys + self.trigger_keys, waitRelease=False):
                if key.name in self.quit_keys:
                    raise Abort()
                if key.name in self.pause_keys:
                    waiting = False
                elif self.mode == "wait":
                    self._pulse(core.getTime())
        held = core.getTime() - began
        self.t0 += held
        self.last_flip = None
        self.last_pulse = core.getTime()
        entry["duration"] = round4(held)
        self.log.log("resume", t=entry["at"], paused_for=entry["duration"])
        self.readout.note(f"[pause] resumed after {held:.1f}s -- onsets no longer line up with volumes")

    def _present(self, segment, stims, t_end, upcoming):
        response = segment.get("response") or {}
        keys = response.get("keys") or []
        onset = None
        answered = None
        prepared = upcoming is None
        while True:
            if answered is None or not response.get("ends_phase"):
                draw_all(stims)
            # flip() returns when the frame went up, on the same clock as
            # core.getTime(): the truest onset there is.
            flipped = self.win.flip()
            shown_at = flipped if flipped else core.getTime()
            self._count_frame(shown_at)
            if onset is None:
                onset = round4(shown_at - self.t0)
            self.readout.tick(self.now())
            for name, at in self._poll(keys):
                # A press from just before this screen went up answered the
                # one before it; the record still has it.
                if answered is None and at >= onset:
                    answered = {"key": name, "t": at, "rt": round4(at - onset)}
            if self.pause_wanted:
                self._pause([] if answered is not None and response.get("ends_phase") else stims)
            if not prepared:
                # Build the next screen now, while this one is up, so it is
                # ready the moment this one ends.
                self.painter.stims(upcoming["layers"])
                prepared = True
            # The next flip is a frame away: stop drawing this screen if that
            # flip is already within half a frame of where the next begins.
            if self.now() + self.window.frame >= t_end - self.window.frame / 2:
                break
        return onset, round4(self.now()), answered

    def _count_frame(self, at):
        if self.last_flip is not None:
            interval = at - self.last_flip
            self.worst_frame = max(self.worst_frame, interval)
            if interval > self.window.frame * DROPPED_FRAME:
                self.dropped_frames += 1
        self.last_flip = at

    def summary(self):
        """One line for the operator: did this run do what was planned?"""
        record = self.record
        total = sum(1 for segment in self.plan["segments"] if segment["kind"] != "instructions")
        answered = sum(1 for segment in record["segments"] if segment.get("response"))
        parts = [f"{len(record['segments'])}/{total} segments", f"{answered} responses"]
        scored = [segment for segment in record["segments"] if "correct" in segment]
        if scored:
            parts.append(f"{sum(1 for segment in scored if segment['correct'])}/{len(scored)} correct")
        pulses = record.get("pulses")
        if pulses and pulses["expected"] is not None:
            parts.append(f"{pulses['seen']}/{pulses['expected']} pulses")
        if self.dropped_frames:
            parts.append(f"{self.dropped_frames} dropped frames")
        line = f"[done] {self.plan['run']['label']} {'stopped early' if record['aborted'] else 'finished'}: {', '.join(parts)}"
        # One either way is the scanner stopping as the run ends.
        if pulses and pulses["expected"] is not None and not record["aborted"] and abs(pulses["seen"] - pulses["expected"]) > 1:
            line += " -- WARNING: pulses do not match the plan; check the scan covered the run"
            dummies = self.scanner["dummy_volumes"]
            if dummies > 1 and abs(pulses["expected"] - pulses["seen"] - dummies) <= 1:
                line += ". Short by about the dummy volumes: if the scanner sends no pulses during them, t0 was late; set Run clock starts at to First pulse"
        return line

    def play(self, write_row=None):
        """write_row, if given, is called with each events row as it happens."""
        segments = self.plan["segments"]
        shown = [segment for segment in segments if segment["kind"] != "instructions"]
        record, rows = self.record, self.rows
        try:
            for segment in segments:
                if segment["kind"] == "instructions":
                    self.instructions(segment)
            if shown:
                # Everything after this waits on the clock, so the first
                # screen is built, and drawn once where nobody sees it, now.
                draw_all(self.painter.stims(shown[0]["layers"]))
                self.win.clearBuffer()
            self.wait_for_scanner()
            leftovers = self.pause_keys + self.response_keys
            if leftovers:
                # A press from before t0 must not pause frame one or answer it.
                self.kb.getKeys(leftovers, waitRelease=False)
            for index, segment in enumerate(shown):
                self.current = index
                stims = self.painter.stims(segment["layers"])
                upcoming = shown[index + 1] if index + 1 < len(shown) else None
                t_end = segment["onset"] + segment["duration"]
                self.readout.segment(index, self.now())
                if segment.get("item") and segment["item"] not in record["shown_items"]:
                    record["shown_items"].append(segment["item"])
                onset, offset, answered = self._present(segment, stims, t_end, upcoming)
                expected = (segment.get("response") or {}).get("correct")
                measured = {
                    "index": index, "kind": segment["kind"], "label": segment["label"],
                    "planned_onset": segment["onset"], "onset": onset, "offset": offset, "response": answered,
                }
                if expected:
                    # No answer is a wrong one; the response column says which.
                    measured["expected"] = expected
                    measured["correct"] = bool(answered and answered["key"] == expected)
                record["segments"].append(measured)
                self.log.log("segment", **{k: v for k, v in measured.items() if k != "response"},
                             trial=segment.get("trial"), item=segment.get("item"),
                             item_values=segment.get("item_values"),
                             response=answered["key"] if answered else None,
                             response_time=answered["rt"] if answered else None)
                row = {
                    "onset": onset,
                    "duration": round4(offset - onset),
                    "trial_type": segment.get("trial_type") or segment["kind"],
                    "phase": segment.get("phase") or segment["label"],
                    "trial": segment.get("trial") + 1 if segment.get("trial") is not None else None,
                    "block": segment.get("block") + 1 if segment.get("block") is not None else None,
                    "item": segment.get("item"),
                    "item_label": segment.get("item_label"),
                    "response": answered["key"] if answered else None,
                    "response_time": answered["rt"] if answered else None,
                    "planned_onset": segment["onset"],
                    "expected_response": expected,
                    "correct": (1 if measured["correct"] else 0) if expected else None,
                }
                for key, value in (segment.get("item_values") or {}).items():
                    row.setdefault("item_" + key, value)
                rows.append(row)
                if write_row:
                    write_row(row)
            record["duration"] = round4(self.now())
        except Abort:
            record["aborted"] = True
            record["duration"] = round4(self.now()) if self.t0 is not None else None
            self.log.log("aborted", t=record["duration"])
            raise
        except Exception as error:
            record["aborted"] = True
            record["error"] = f"{type(error).__name__}: {error}"
            record["duration"] = round4(self.now()) if self.t0 is not None else None
            self.log.log("error", t=record["duration"], error=record["error"])
            raise
        finally:
            record["ended"] = now_iso()
            record["triggers"] = self.triggers
            record["presses"] = self.presses
            record["dropped_frames"] = self.dropped_frames
            record["worst_frame_ms"] = round(self.worst_frame * 1000, 3)
            if self.mode == "wait":
                record["pulses"] = {"seen": self.dummy_pulses + len(self.triggers), "expected": self.plan.get("volumes"), "before_t0": self.dummy_pulses}
                record["pulse_gaps"] = self.pulse_gaps
            if self.pause_keys:
                record["debug"] = True
                record["pauses"] = self.pauses
        return record, rows
