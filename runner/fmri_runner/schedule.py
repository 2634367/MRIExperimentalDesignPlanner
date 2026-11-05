"""Playing one plan on one clock.

Time zero (t0) is the last trigger pulse of the dummy volumes. Every segment
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
"""
from psychopy import core, visual
from psychopy.hardware import keyboard

from .display import Painter, draw_all
from .log import now_iso

WAITING_TEXT = "Waiting for the scanner ({seen}/{total})"
BETWEEN_RUNS = "Run {done} of {total} finished.\n\nPress {keys} for the next run."
PAUSED_TEXT = "paused -- press {keys} to resume"


class Abort(Exception):
    """The operator pressed the quit key."""


def round4(value):
    return round(value, 4)


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

    def __init__(self, display, windowed, screen=0, keyboard_backend=None):
        self.win = visual.Window(
            size=(1280, 800), fullscr=not windowed, screen=screen, color=display["background"], colorSpace="hex",
            units="height", allowGUI=windowed, waitBlanking=True,
        )
        self.win.mouseVisible = windowed
        self.frame = self.win.monitorFramePeriod or 1.0 / 60
        self.kb = keyboard.Keyboard(backend=keyboard_backend) if keyboard_backend else keyboard.Keyboard()
        self.text_color = display["text_color"]
        self.message = visual.TextStim(self.win, text="", height=0.04, color=self.text_color, colorSpace="hex", wrapWidth=1.4)

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
        self.trigger = str(self.scanner["trigger_key"])
        self.painter = Painter(self.win, plan)
        self.readout = readout
        self.pause_keys = list(pause_keys)
        self.pause_wanted = False
        self.pauses = []
        self.t0 = None
        self.triggers = []
        self.simulated_volume = 0

    def now(self):
        return core.getTime() - self.t0

    # -- keys ---------------------------------------------------------------

    def _poll(self, response_keys=()):
        """Drain the keyboard: log triggers, honour quit, and return the
        response keys pressed, each with its time on the run clock."""
        pressed = []
        names = [self.trigger] + self.quit_keys + list(response_keys)
        if self.t0 is not None:
            names += self.pause_keys
        for key in self.kb.getKeys(names, waitRelease=False):
            if key.name in self.quit_keys:
                raise Abort()
            if key.name in self.pause_keys:
                self.pause_wanted = True
                continue
            at = key.tDown if getattr(key, "tDown", None) else core.getTime()
            if key.name == self.trigger and self.t0 is not None and self.mode == "wait":
                self.triggers.append(round4(at - self.t0))
                continue
            if key.name in response_keys:
                pressed.append((key.name, round4(at - self.t0)))
        if self.mode == "simulate" and self.t0 is not None:
            volume = int(self.now() // self.scanner["tr"]) + 1
            while self.simulated_volume < volume:
                self.simulated_volume += 1
                self.triggers.append(round4((self.simulated_volume - 1) * self.scanner["tr"]))
        return pressed

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
        while len(pulses) < needed:
            self.window.message.text = WAITING_TEXT.format(seen=len(pulses), total=needed)
            self.window.message.draw()
            self.win.flip()
            for key in self.kb.getKeys([self.trigger] + self.quit_keys, waitRelease=False):
                if key.name in self.quit_keys:
                    raise Abort()
                pulses.append((getattr(key, "tDown", None), core.getTime()))
                self.log.log("dummy_trigger", index=len(pulses))
        t_down, t_seen = pulses[-1]
        # The hardware timestamp, when it is in the same timebase.
        self.t0 = t_down if t_down and abs(t_seen - t_down) < 0.1 else t_seen
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
        label = visual.TextStim(self.win, text=PAUSED_TEXT.format(keys=keys), height=0.025, pos=(0, -0.46),
                                color=self.window.text_color, colorSpace="hex")
        waiting = True
        while waiting:
            draw_all(stims)
            label.draw()
            self.win.flip()
            for key in self.kb.getKeys(self.pause_keys + self.quit_keys + [self.trigger], waitRelease=False):
                if key.name in self.quit_keys:
                    raise Abort()
                if key.name in self.pause_keys:
                    waiting = False
                elif self.mode == "wait":
                    self.triggers.append(round4(core.getTime() - self.t0))
        held = core.getTime() - began
        self.t0 += held
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
            if onset is None:
                onset = round4((flipped if flipped else core.getTime()) - self.t0)
            self.readout.tick(self.now())
            for name, at in self._poll(keys):
                if answered is None:
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

    def play(self):
        segments = self.plan["segments"]
        shown = [segment for segment in segments if segment["kind"] != "instructions"]
        record = {
            "plan": {key: value for key, value in self.plan.items() if not key.startswith("_")},
            "started": now_iso(),
            "scanner_mode": self.mode,
            "aborted": False,
            "segments": [],
            # Each item's id, once, from the moment it is about to go up, so a
            # run stopped mid-trial still counts what the participant saw.
            "shown_items": [],
        }
        rows = []
        try:
            for segment in segments:
                if segment["kind"] == "instructions":
                    self.instructions(segment)
            self.wait_for_scanner()
            if self.pause_keys:
                # A press left over from before t0 must not pause frame one.
                self.kb.getKeys(self.pause_keys, waitRelease=False)
            for index, segment in enumerate(shown):
                stims = self.painter.stims(segment["layers"])
                upcoming = shown[index + 1] if index + 1 < len(shown) else None
                t_end = segment["onset"] + segment["duration"]
                self.readout.segment(index, self.now())
                if segment.get("item") and segment["item"] not in record["shown_items"]:
                    record["shown_items"].append(segment["item"])
                onset, offset, answered = self._present(segment, stims, t_end, upcoming)
                measured = {
                    "index": index, "kind": segment["kind"], "label": segment["label"],
                    "planned_onset": segment["onset"], "onset": onset, "offset": offset, "response": answered,
                }
                record["segments"].append(measured)
                self.log.log("segment", **{k: v for k, v in measured.items() if k != "response"},
                             trial=segment.get("trial"), item=segment.get("item"),
                             item_values=segment.get("item_values"),
                             response=answered["key"] if answered else None)
                row = {
                    "onset": onset,
                    "duration": round4(offset - onset),
                    "trial_type": segment.get("trial_type") or segment["kind"],
                    "phase": segment.get("phase") or segment["label"],
                    "trial": segment.get("trial") + 1 if segment.get("trial") is not None else None,
                    "item": segment.get("item"),
                    "item_label": segment.get("item_label"),
                    "response": answered["key"] if answered else None,
                    "response_time": answered["rt"] if answered else None,
                    "planned_onset": segment["onset"],
                }
                for key, value in (segment.get("item_values") or {}).items():
                    row.setdefault("item_" + key, value)
                rows.append(row)
            record["duration"] = round4(self.now())
        except Abort:
            record["aborted"] = True
            record["duration"] = round4(self.now()) if self.t0 is not None else None
            self.log.log("aborted", t=record["duration"])
            raise
        finally:
            record["ended"] = now_iso()
            record["triggers"] = self.triggers
            if self.pause_keys:
                record["debug"] = True
                record["pauses"] = self.pauses
            self.record, self.rows = record, rows
        return record, rows
