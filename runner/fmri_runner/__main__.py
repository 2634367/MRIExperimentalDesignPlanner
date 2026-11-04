"""python -m fmri_runner PLAN [PLAN | FOLDER ...] [options]

Plays each plan in turn in one window. Between runs it waits for the advance
key, so the operator can restart the scanner. Escape quits; whatever ran so
far is still written to --out.
"""
import argparse
import sys

from . import __version__, plan as plans


def arguments(argv):
    parser = argparse.ArgumentParser(prog="fmri_runner", description="Play fMRI run plans in PsychoPy.")
    parser.add_argument("plans", nargs="+", help="plan .json files, or folders of them")
    parser.add_argument("--out", default="data", help="where results go (default: data)")
    parser.add_argument("--media", default=None, help="folder holding the pictures (default: media/ beside plans/)")
    parser.add_argument("--scanner", choices=("wait", "simulate", "none"), default="wait",
                        help="wait for the trigger key, simulate pulses at the TR, or start straight away")
    parser.add_argument("--windowed", action="store_true", help="a window instead of full screen")
    parser.add_argument("--participant", default="", help="label the results with this participant")
    parser.add_argument("--check", action="store_true", help="only check the plans and pictures, then stop")
    parser.add_argument("--version", action="version", version=f"fmri_runner {__version__}")
    return parser.parse_args(argv)


def main(argv=None):
    args = arguments(sys.argv[1:] if argv is None else argv)
    try:
        loaded = [plans.load(path, args.media) for path in plans.expand(args.plans)]
    except plans.PlanError as error:
        print(f"fmri_runner: {error}", file=sys.stderr)
        return 2
    for plan in loaded:
        print(f"[plan] {plans.summary(plan)}", flush=True)
    if args.check:
        return 0

    # PsychoPy only from here on, so --check runs anywhere.
    from .log import Log
    from .schedule import BETWEEN_RUNS, Abort, Player, Window

    log = Log(args.out)
    window = Window(loaded[0]["display"], args.windowed)
    status = 0
    try:
        for number, plan in enumerate(loaded, start=1):
            log.context = {"run": plan["run"]["label"], "experiment": plan["experiment"]["name"]}
            name = log.name_for(plan, args.participant)
            log.log("run_start", plan=plan["_path"], scanner=args.scanner, seed=plan["seed"])
            print(f"[run] {number}/{len(loaded)} {plan['run']['label']} ({args.scanner})", flush=True)
            player = Player(window, plan, log, args.scanner)
            try:
                player.play()
            except Abort:
                status = 1
            finally:
                record = player.record
                record["participant"] = args.participant or plan.get("participant") or ""
                print(f"[saved] {log.write_run(name, record)}", flush=True)
                print(f"[saved] {log.write_events(name, player.rows, plan["segments"])}", flush=True)
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
