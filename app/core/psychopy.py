"""Running PsychoPy on the machine this server runs on.

Two questions, answered once and cached: is there a Python here that can
import psychopy, and is this server allowed to start it (psychopy.launch in
config.yaml -- see defaults.yaml for what auto means). When the answer is no,
the UI offers the bundle download instead, which works everywhere.

A launch writes the checked run plans and the pictures they use into a fresh
folder under storage/launches/, then starts

    <python> -m fmri_runner plans/run-01.json ... --out data --scanner <mode>

with a fixed argument list and no shell, so nothing in a plan can become part
of a command line. The runner (runner/fmri_runner/) is the same code the
bundle ships. Its output -- events.tsv, the run record, its log -- stays in
that folder; the folder is the record of what was run.

One launch at a time: PsychoPy takes the whole screen, and two would fight
over it and over the scanner's trigger key.
"""
from __future__ import annotations

import ipaddress
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable

from app.core import encryption
from app.core.config import Config
from app.core.layout import in_container
from app.models import utc_now

logger = logging.getLogger(__name__)

RUNNER_DIR = Path(__file__).resolve().parents[2] / "runner"
FLIPS = ("none", "horizontal", "vertical", "both")
LAUNCHES_DIR_NAME = "launches"
# The last line says whether macOS lets this Python read the keyboard directly
# (see keyboard_works in the runner); asked here, under this server, because
# the answer depends on what started the process.
PROBE = """
import ctypes, sys
import psychopy
print(psychopy.__version__)
print(sys.version.split()[0])
try:
    iokit = ctypes.CDLL("/System/Library/Frameworks/IOKit.framework/IOKit")
    iokit.IOHIDCheckAccess.argtypes = [ctypes.c_int]
    iokit.IOHIDCheckAccess.restype = ctypes.c_int
    print("allowed" if iokit.IOHIDCheckAccess(1) == 0 else "blocked")
except (OSError, AttributeError):
    print("unknown")
"""
PROBE_TIMEOUT = 90
LOG_TAIL_LINES = 40
SCANNER_MODES = ("wait", "simulate", "none")
MAX_SCREEN = 15

MAC_APPS = ("/Applications/PsychoPy.app", "~/Applications/PsychoPy.app")
WINDOWS_PYTHONS = (r"C:\Program Files\PsychoPy\python.exe", r"C:\Program Files\PsychoPy3\python.exe")


@dataclass(frozen=True)
class Interpreter:
    python: str
    # Only for PsychoPy.app's bundled interpreter, which needs to be told
    # where its own standard library lives -- the same thing the old
    # run.sh did.
    python_home: str
    psychopy_version: str
    python_version: str
    source: str
    keyboard: str = "unknown"


@dataclass(frozen=True)
class Status:
    available: bool
    reason: str
    interpreter: Interpreter | None = None

    def row(self) -> dict:
        row = {"available": self.available, "reason": self.reason}
        if self.interpreter is not None:
            row.update(
                {
                    "python": self.interpreter.python,
                    "psychopy_version": self.interpreter.psychopy_version,
                    "python_version": self.interpreter.python_version,
                    "source": self.interpreter.source,
                    "keyboard": self.interpreter.keyboard,
                }
            )
        return row


def child_environment(python_home: str) -> dict[str, str]:
    """What the runner process starts with. It gets the server's own
    environment -- PsychoPy needs PATH, HOME and the display -- minus anything
    that would point it at this server's Python instead of its own. Nothing
    here configures the server; it is only passed through."""
    environment = {
        name: value
        for name, value in os.environ.items()
        if name not in ("PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "VIRTUAL_ENV", "__PYVENV_LAUNCHER__")
    }
    if python_home:
        environment["PYTHONHOME"] = python_home
    environment["PYTHONPATH"] = str(RUNNER_DIR)
    environment["PYTHONUNBUFFERED"] = "1"
    return environment


def _candidates(setting: str) -> list[tuple[str, str, str]]:
    """(python, python_home, where it came from), in the order tried."""
    if setting != "auto":
        return [(os.path.expanduser(setting), "", "psychopy.python")]
    found: list[tuple[str, str, str]] = []
    for name in ("python3", "python"):
        path = shutil.which(name)
        if path:
            found.append((path, "", f"{name} on PATH"))
    if sys.platform == "darwin":
        for app in MAC_APPS:
            root = Path(os.path.expanduser(app))
            python = root / "Contents" / "MacOS" / "python"
            if python.exists():
                found.append((str(python), str(root / "Contents" / "Resources"), str(root)))
    if sys.platform == "win32":
        found += [(path, "", path) for path in WINDOWS_PYTHONS if Path(path).exists()]
    return found


def _probe(python: str, python_home: str) -> tuple[str, str, str] | None:
    try:
        result = subprocess.run(
            [python, "-c", PROBE],
            env=child_environment(python_home),
            capture_output=True,
            text=True,
            timeout=PROBE_TIMEOUT,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    lines = result.stdout.strip().splitlines()
    if result.returncode != 0 or len(lines) < 3:
        return None
    return lines[-3].strip(), lines[-2].strip(), lines[-1].strip()


def _loopback(host: str) -> bool:
    if host.strip().lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.strip()).is_loopback
    except ValueError:
        return False


_status_lock = threading.Lock()
_status: Status | None = None


def status(cfg: Config, refresh: bool = False) -> Status:
    """Whether "Run in PsychoPy" works here. Slow the first time (importing
    psychopy takes seconds), cached after that; refresh re-checks, for
    someone who has just installed it."""
    global _status
    with _status_lock:
        if _status is not None and not refresh:
            return _status
        _status = _work_out_status(cfg)
        return _status


def _work_out_status(cfg: Config) -> Status:
    if cfg.psychopy_launch == "off":
        return Status(False, "switched_off")
    if in_container():
        return Status(False, "container")
    if cfg.psychopy_launch == "auto" and not _loopback(cfg.host):
        return Status(False, "not_local")
    if not (RUNNER_DIR / "fmri_runner" / "__main__.py").exists():
        return Status(False, "no_runner")
    for python, python_home, source in _candidates(cfg.psychopy_python):
        versions = _probe(python, python_home)
        if versions is not None:
            return Status(True, "ok", Interpreter(python, python_home, versions[0], versions[1], source, versions[2]))
    return Status(False, "not_installed")


# ---------------------------------------------------------------------------
# launches
# ---------------------------------------------------------------------------


@dataclass
class Launch:
    id: str
    user_id: int
    label: str
    folder: Path
    process: subprocess.Popen
    started_at: datetime
    log_path: Path
    stopped: bool = False
    ended_at: datetime | None = None

    def row(self) -> dict:
        code = self.process.poll()
        if code is not None and self.ended_at is None:
            self.ended_at = utc_now()
        return {
            "id": self.id,
            "label": self.label,
            "running": code is None,
            "exit_code": code,
            "stopped": self.stopped,
            "started_at": self.started_at.isoformat(),
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "folder": str(self.folder),
            "log": _tail(self.log_path),
        }


def _tail(path: Path) -> list[str]:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            return list(deque(handle, maxlen=LOG_TAIL_LINES))
    except OSError:
        return []


class AlreadyRunningError(Exception):
    def __init__(self) -> None:
        super().__init__("PsychoPy is already running a launch -- stop it first")


class LaunchUnavailableError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(f"PsychoPy cannot be started from this server ({reason})")
        self.reason = reason


_launch_lock = threading.Lock()
_launches: dict[str, Launch] = {}


def _write_launch_folder(storage_dir: Path, plans: list[dict], media_files: dict[str, Path], stamp: str) -> Path:
    folder = storage_dir / LAUNCHES_DIR_NAME / stamp
    (folder / "plans").mkdir(mode=0o700, parents=True)
    (folder / "media").mkdir(mode=0o700)
    (folder / "data").mkdir(mode=0o700)
    for plan in plans:
        (folder / "plans" / f"{plan['run']['label']}.json").write_text(json.dumps(plan, indent=1), encoding="utf-8")
    for name, source in media_files.items():
        shutil.copyfile(source, folder / "media" / name)
    return folder


def start(cfg: Config, plans: list[dict], media_files: dict[str, Path], user_id: int, label: str,
          scanner: str, windowed: bool, screen: int = 0, debug: bool = False,
          on_end: Callable[[Path], object] | None = None, flip: str = "none") -> Launch:
    """plans must already have passed app.models.plans.check_plans, and
    media_files maps media/<name> to files the caller has checked belong to
    the experiment. on_end is called with the data folder when the runner
    exits, however it exits, and whether or not anyone is watching."""
    current = status(cfg)
    if not current.available or current.interpreter is None:
        raise LaunchUnavailableError(current.reason)
    if scanner not in SCANNER_MODES:
        raise ValueError("scanner must be wait, simulate or none")
    if not isinstance(screen, int) or isinstance(screen, bool) or not 0 <= screen <= MAX_SCREEN:
        raise ValueError(f"screen must be a number from 0 to {MAX_SCREEN}")
    if flip not in FLIPS:
        raise ValueError("flip must be none, horizontal, vertical or both")
    with _launch_lock:
        if any(launch.process.poll() is None for launch in _launches.values()):
            raise AlreadyRunningError()
        launch_id = encryption.url_token(6)
        stamp = utc_now().strftime("%Y%m%dT%H%M%S") + "-" + launch_id
        folder = _write_launch_folder(cfg.storage_dir, plans, media_files, stamp)
        argv = [current.interpreter.python, "-m", "fmri_runner"]
        argv += [str(folder / "plans" / f"{plan['run']['label']}.json") for plan in plans]
        argv += ["--out", str(folder / "data"), "--media", str(folder / "media"), "--scanner", scanner]
        argv += ["--screen", str(screen)]
        if flip != "none":
            argv += ["--flip", flip]
        if windowed:
            argv.append("--windowed")
        if debug:
            argv.append("--debug")
        log_path = folder / "runner.log"
        with log_path.open("wb") as log:
            process = subprocess.Popen(
                argv,
                cwd=folder,
                env=child_environment(current.interpreter.python_home),
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                # Its own process group, so Stop ends the runner and anything it
                # started, and a Ctrl+C in the server's terminal does not.
                start_new_session=(os.name != "nt"),
            )
        launch = Launch(launch_id, user_id, label, folder, process, utc_now(), log_path)
        _launches[launch_id] = launch
        if on_end is not None:
            threading.Thread(target=_when_ended, args=(launch, on_end), daemon=True).start()
        # Keep the last few for the status panel; older ones are on disk.
        for old in sorted(_launches.values(), key=lambda item: item.started_at)[:-10]:
            if old.process.poll() is not None:
                _launches.pop(old.id, None)
        return launch


def _when_ended(launch: Launch, on_end: Callable[[Path], object]) -> None:
    launch.process.wait()
    try:
        on_end(launch.folder / "data")
    except Exception:
        # The run itself is safe on disk; a failure here costs only the
        # participant's seen list, so it must not end the thread loudly.
        logger.exception("could not record what launch %s showed", launch.id)


def get(launch_id: str, user_id: int) -> Launch | None:
    launch = _launches.get(launch_id)
    return launch if launch is not None and launch.user_id == user_id else None


def latest(user_id: int) -> Launch | None:
    mine = [launch for launch in _launches.values() if launch.user_id == user_id]
    return max(mine, key=lambda launch: launch.started_at) if mine else None


def stop(launch_id: str, user_id: int) -> Launch | None:
    launch = get(launch_id, user_id)
    if launch is None:
        return None
    if launch.process.poll() is None:
        launch.stopped = True
        launch.process.terminate()
        try:
            launch.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            launch.process.kill()
    return launch
