"""Reading the keyboard the same way, whichever way PsychoPy reads it. No
PsychoPy here, so all of this can be tested anywhere.

PsychoPy's Keyboard cannot be used on its "event" backend: it takes the
[name, time] pair event.getKeys hands it as the key's name, so a filter like
["5", "escape"] never matches and every key is lost, Escape included (seen in
2026.2.2's hardware/keyboard.py). WindowKeys reads psychopy.event directly.

Keys wraps whichever reader is in use, so that a request to stop (Designer's
Stop button sends SIGTERM) ends the run at the next key check, like Escape. A
signal handler that raised straight away could land in the middle of saving
the results. Every wait in the runner reads keys each frame, so none can miss it.
"""


class Abort(Exception):
    """The operator pressed the quit key, or asked the runner to stop."""


class Press:
    def __init__(self, name, down):
        self.name = name
        self.tDown = down


class WindowKeys:
    """event.getKeys behind the two calls the runner makes. Its times are on
    core.getTime()'s clock, taken when the window reported the key."""

    def __init__(self, event):
        self.event = event

    def clearEvents(self):
        self.event.clearEvents("keyboard")

    def getKeys(self, names, waitRelease=False):
        return [Press(entry[0], entry[-1]) for entry in self.event.getKeys(keyList=names, timeStamped=True)]


class Keys:
    def __init__(self, reader):
        self.reader = reader
        self.stopping = False

    def stop(self, *_signal):
        self.stopping = True

    def clearEvents(self):
        self.reader.clearEvents()

    def getKeys(self, names, waitRelease=False):
        if self.stopping:
            raise Abort()
        return self.reader.getKeys(names, waitRelease=waitRelease)


def hear_other_apps(keyboard):
    """PsychoPy drops keys while another app is in front, on Mac and Windows.
    A trigger box is a keyboard, so one click on the operator's terminal would
    lose pulses and Escape. The switch is on the device, and only in newer
    PsychoPy; where it is missing there is nothing to turn off."""
    device = getattr(keyboard, "device", None)
    if hasattr(device, "muteOutsidePsychopy"):
        device.muteOutsidePsychopy = False


def trigger_names(key):
    """A digit can arrive from the top row or the number pad."""
    return [key, "num_" + key] if key.isdigit() else [key]


def press_time(key, now):
    """When a key went down, on core.getTime()'s clock. tDown is only trusted
    if it is close to now: on some backends it is on another clock."""
    down = getattr(key, "tDown", None)
    return down if down and abs(now - down) < 0.1 else now
