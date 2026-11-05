"""python -m fmri_runner PLAN [PLAN | FOLDER ...] [options]

Plays each plan in turn in one window. Between runs it waits for the advance
key, so the operator can restart the scanner. Escape quits; whatever ran so
far is still written to --out.

  --screen N        which display, numbered as --list-screens shows them
  --pilot           a quick look: first 2 blocks, no scanner, in a window
  --blocks N        only the first N blocks of each run
  --debug           the pause key holds the run (see schedule.py)
  --planner URL     fetch the last published plans (see fetch.py)
"""
import argparse
import ctypes
import sys
from pathlib import Path

from . import __version__, fetch, plan as plans

PILOT_BLOCKS = 2
IOKIT = "/System/Library/Frameworks/IOKit.framework/IOKit"
LISTEN_EVENT = 1  # kIOHIDRequestTypeListenEvent
ACCESS_GRANTED = 0  # kIOHIDAccessTypeGranted
NO_HID_WARNING = (
    "[keyboard] WARNING: macOS is blocking direct keyboard access (Input Monitoring is off for the app that started "
    "this), which would crash PsychoPy. Using window key events instead: keys only count while the task window has "
    "focus, and their times are only good to a frame. Allow it in System Settings > Privacy & Security > Input "
    "Monitoring for real data."
)


def arguments(argv):
    parser = argparse.ArgumentParser(prog="fmri_runner", description="Play fMRI run plans in PsychoPy.")
    parser.add_argument("plans", nargs="*", help="plan .json files, or folders of them")
    parser.add_argument("--out", default="data", help="where results go (default: data)")
    parser.add_argument("--media", default=None, help="folder holding the pictures (default: media/ beside plans/)")
    parser.add_argument("--scanner", choices=("wait", "simulate", "none"), default=None,
                        help="wait for the trigger key (the default), simulate pulses at the TR, or start straight away")
    parser.add_argument("--windowed", action="store_true", help="a window instead of full screen")
    parser.add_argument("--screen", type=int, default=0, help="which display to use (default: 0, see --list-screens)")
    parser.add_argument("--list-screens", action="store_true", help="show the displays attached, then stop")
    parser.add_argument("--blocks", type=int, default=None, help="play only the first N blocks of each run")
    parser.add_argument("--pilot", action="store_true",
                        help=f"a quick check: --blocks {PILOT_BLOCKS} --scanner none --windowed, unless you set those yourself")
    parser.add_argument("--debug", action="store_true", help="let the pause key hold the run; not for data you will analyse")
    parser.add_argument("--pause-key", default="space", help="the key --debug pauses with (default: space)")
    parser.add_argument("--quiet", action="store_true", help="one plain line per trial, even in a terminal")
    parser.add_argument("--keyboard", choices=("ptb", "event", "iohub"), default=None,
                        help="PsychoPy's keyboard backend (default: its own, or event on a Mac that blocks it)")
    parser.add_argument("--planner", default=None, help="the designer's address, to fetch its last published plans")
    parser.add_argument("--experiment", default=None, help="which experiment to fetch")
    parser.add_argument("--key-file", default=None, help="a file holding an API key for --planner")
    parser.add_argument("--only", action="append", default=[], help="fetched plans whose label starts with this (repeatable)")
    parser.add_argument("--list", action="store_true", help="show the fetched plans' labels, then stop")
    parser.add_argument("--mirror", default="mirror", help="where fetched plans are kept (default: mirror)")
    parser.add_argument("--offline", action="store_true", help="use the last fetched copy without trying the network")
    parser.add_argument("--participant", default="", help="label the results with this participant")
    parser.add_argument("--check", action="store_true", help="only check the plans and pictures, then stop")
    parser.add_argument("--version", action="version", version=f"fmri_runner {__version__}")
    args = parser.parse_args(argv)
    fetching = bool(args.planner or args.offline)
    if fetching and not args.experiment:
        parser.error("--planner and --offline need --experiment")
    if args.planner and not args.offline and not args.key_file:
        parser.error("--planner needs --key-file")
    if fetching and args.plans:
        parser.error("give plan files or --planner, not both")
    if not args.plans and not args.list_screens and not fetching:
        parser.error("give at least one plan or folder")
    if args.blocks is not None and args.blocks < 1:
        parser.error("--blocks must be at least 1")
    if args.pilot:
        args.windowed = True
        args.scanner = args.scanner or "none"
        args.blocks = args.blocks or PILOT_BLOCKS
    args.scanner = args.scanner or "wait"
    return args


def fetched_plans(args):
    """The plan files to play from the mirror, fetching it first unless told
    not to. No network is not a failure while there is a copy to run from."""
    folder = Path(args.mirror) / args.experiment
    if args.offline:
        manifest = fetch.read_mirror(folder)
    else:
        try:
            manifest = fetch.mirror(args.planner, args.experiment, fetch.read_key(args.key_file), folder)
            print(f"[fetch] published {manifest.get('published_at')}, revision {manifest.get('revision')}", flush=True)
        except fetch.FetchError as error:
            print(f"[fetch] {error}", flush=True)
            manifest = fetch.read_mirror(folder)
            print(f"[fetch] WARNING: running the copy published {manifest.get('published_at')}", flush=True)
    return manifest, folder


def keyboard_works():
    """Whether macOS allows PsychoPy's own keyboard. Where it does not, PsychHID
    takes the whole process down with a segfault no Python can catch, and macOS
    then puts a crash dialog on the operator's screen. So ask macOS first,
    which touches nothing. Where it cannot be asked, PsychoPy goes ahead as
    it always did."""
    try:
        iokit = ctypes.CDLL(IOKIT)
        iokit.IOHIDCheckAccess.argtypes = [ctypes.c_int]
        iokit.IOHIDCheckAccess.restype = ctypes.c_int
        return iokit.IOHIDCheckAccess(LISTEN_EVENT) == ACCESS_GRANTED
    except (OSError, AttributeError):
        return True


def keyboard_backend(requested, platform=sys.platform, works=keyboard_works):
    """(backend to ask PsychoPy for, a warning to print). None means its
    default. Only a Mac has this problem, so only a Mac pays for the check."""
    if requested or platform != "darwin" or works():
        return requested, None
    return "event", NO_HID_WARNING


def pause_key_problem(plan, key):
    """The pause key has to mean only that. A run's own keys are read first,
    so a clash would quietly stop one of them working."""
    taken = {plan["scanner"]["trigger_key"]: "the scanner trigger"}
    taken.update({name: "the quit key" for name in plan["keys"]["quit"]})
    for segment in plan["segments"]:
        for name in (segment.get("response") or {}).get("keys") or []:
            taken.setdefault(name, "a response key")
    if key in taken:
        return f"--pause-key {key} is {taken[key]} in {plan['run']['label']}; pick another key"
    return None


def screen_problem(number, attached):
    """Asked for a display that is not there, PsychoPy quietly uses the first
    one, which at a scanner is the operator's. Better not to start."""
    if attached and not 0 <= number < len(attached):
        return f"no screen {number}: {describe_screens(attached)}"
    return None


def describe_screens(attached):
    if not attached:
        return "could not list the displays"
    return ", ".join(f"{index} = {width}x{height}" for index, (width, height) in enumerate(attached))


def main(argv=None):
    args = arguments(sys.argv[1:] if argv is None else argv)
    # A log file on Windows may not take every character an item holds.
    sys.stdout.reconfigure(errors="replace")
    if args.list_screens:
        from .schedule import screens
        print(f"[screens] {describe_screens(screens())}", flush=True)
        return 0
    try:
        if args.planner or args.offline:
            manifest, folder = fetched_plans(args)
            if args.list:
                for row in manifest["plans"]:
                    print(f"[plan] {row['label']}: {row.get('name', '')}", flush=True)
                return 0
            args.plans = fetch.select(manifest, folder, args.only)
        loaded = [plans.load(path, args.media) for path in plans.expand(args.plans)]
        if args.blocks:
            loaded = [plans.shorten(plan, args.blocks) for plan in loaded]
    except (plans.PlanError, fetch.FetchError) as error:
        print(f"fmri_runner: {error}", file=sys.stderr)
        return 2
    pause_keys = [args.pause_key] if args.debug else []
    if args.debug:
        clashes = [problem for problem in (pause_key_problem(plan, args.pause_key) for plan in loaded) if problem]
        if clashes:
            print(f"fmri_runner: {clashes[0]}", file=sys.stderr)
            return 2
    for plan in loaded:
        print(f"[plan] {plans.summary(plan)}", flush=True)
    if args.check:
        return 0

    # PsychoPy only from here on, so --check runs anywhere.
    from .log import Log
    from .readout import Readout
    from .schedule import BETWEEN_RUNS, Abort, Player, Window, screens

    problem = screen_problem(args.screen, screens())
    if problem:
        print(f"fmri_runner: {problem}", file=sys.stderr)
        return 2
    backend, warning = keyboard_backend(args.keyboard)
    if warning:
        print(warning, flush=True)
    log = Log(args.out)
    if backend:
        log.log("keyboard", backend=backend)
    window = Window(loaded[0]["display"], args.windowed, args.screen, backend)
    status = 0
    try:
        for number, plan in enumerate(loaded, start=1):
            log.context = {"run": plan["run"]["label"], "experiment": plan["experiment"]["name"]}
            name = log.name_for(plan, args.participant)
            log.log("run_start", plan=plan["_path"], scanner=args.scanner, seed=plan["seed"])
            print(f"[run] {number}/{len(loaded)} {plan['run']['label']} ({args.scanner})", flush=True)
            player = Player(window, plan, log, args.scanner, Readout(plan, args.quiet), pause_keys)
            try:
                player.play()
            except Abort:
                status = 1
            finally:
                record = player.record
                record["participant"] = args.participant or plan.get("participant") or ""
                print(f"[saved] {log.write_run(name, record)}", flush=True)
                print(f"[saved] {log.write_events(name, player.rows, plan['segments'])}", flush=True)
                log.log("run_end", aborted=record["aborted"], duration=record.get("duration"))
            if status:
                print("[quit] escape pressed -- stopping", flush=True)
                break
            if number < len(loaded):
                keys = "/".join(plan["keys"]["advance"])
                window.say(BETWEEN_RUNS.format(done=number, total=len(loaded), keys=keys), plan["keys"]["advance"], plan["keys"]["quit"])
    except Abort:
        status = 1
    finally:
        window.close()
    return status


if __name__ == "__main__":
    sys.exit(main())
