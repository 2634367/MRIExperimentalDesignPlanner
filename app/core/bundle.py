"""The download that runs anywhere PsychoPy is installed.

For a VPS (where the server cannot start PsychoPy on anyone's screen), for a
stim PC that is not the machine the designer runs on, or just to keep a copy
of exactly what was run. The zip holds:

    <folder>/
      run.sh, run.bat     find a Python that has PsychoPy, then start the runner
      README.txt          what is in here and how to run it
      runner/fmri_runner/ the runner -- the same code a local launch uses
      plans/<run>.json    the run plans, already checked
      media/<sha>.<ext>   every picture those plans draw

Nothing in it talks back to the server.
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path

from app.core.psychopy import RUNNER_DIR

RUN_SH = r"""#!/usr/bin/env bash
# Runs every plan in plans/ with whichever Python has PsychoPy.
#
#   ./run.sh                          full screen, waits for the scanner trigger
#   ./run.sh --scanner simulate       pretend pulses at the plan's TR
#   ./run.sh --scanner none --windowed   a quick look, no scanner at all
#   ./run.sh --pilot                  the first 2 blocks, no scanner, in a window
#   ./run.sh --screen 1               on the second display (--list-screens shows them)
#   ./run.sh plans/run-02.json        just that run
#   ./run.sh --from-run 3             start at the third run, after stopping
#   ./run.sh --planner URL ...        the last published plans, not the ones here
#
# Results go in data/.
set -euo pipefail
cd "$(dirname "$0")"

plans=()
args=()
fetching=0
for arg in "$@"; do
  if [[ "$arg" == *.json ]]; then plans+=("$arg"); else args+=("$arg"); fi
  if [[ "$arg" == "--planner" || "$arg" == "--offline" ]]; then fetching=1; fi
done
# Fetched plans keep their own pictures, so neither of these applies to them.
sources=(--media media)
if [[ $fetching -eq 1 ]]; then
  sources=()
elif [[ ${#plans[@]} -eq 0 ]]; then
  plans=(plans/*.json)
fi

export PYTHONPATH="$PWD/runner"
if python3 -c "import psychopy" >/dev/null 2>&1; then
  exec python3 -m fmri_runner ${plans[@]+"${plans[@]}"} --out data ${sources[@]+"${sources[@]}"} ${args[@]+"${args[@]}"}
fi
for app in /Applications/PsychoPy.app "$HOME/Applications/PsychoPy.app"; do
  if [[ -x "$app/Contents/MacOS/python" ]]; then
    export PYTHONHOME="$app/Contents/Resources"
    exec "$app/Contents/MacOS/python" -m fmri_runner ${plans[@]+"${plans[@]}"} --out data ${sources[@]+"${sources[@]}"} ${args[@]+"${args[@]}"}
  fi
done
echo "PsychoPy was not found. Install PsychoPy (https://www.psychopy.org/download.html) or 'pip install psychopy'." >&2
exit 1
"""

RUN_BAT = r"""@echo off
rem Runs every plan in plans\ with whichever Python has PsychoPy.
rem   run.bat                          full screen, waits for the scanner trigger
rem   run.bat --scanner none --windowed   a quick look, no scanner at all
rem   run.bat plans\run-02.json          just that run
rem   run.bat --from-run 3               start at the third run, after stopping
setlocal
cd /d "%~dp0"
set "PYTHONPATH=%CD%\runner"
set "PY="
for %%P in ("C:\Program Files\PsychoPy\python.exe" "C:\Program Files\PsychoPy3\python.exe") do (
  if exist %%P set "PY=%%~P"
)
if "%PY%"=="" (
  python -c "import psychopy" >nul 2>&1 && set "PY=python"
)
if "%PY%"=="" (
  echo PsychoPy was not found. Install it from https://www.psychopy.org/download.html
  exit /b 1
)
set "PLANS="
set "ARGS="
set "FETCHING="
:args
if "%~1"=="" goto run
if /i "%~1"=="--planner" set "FETCHING=1"
if /i "%~1"=="--offline" set "FETCHING=1"
if /i "%~x1"==".json" (set PLANS=%PLANS% "%~1") else (set ARGS=%ARGS% "%~1")
shift
goto args
:run
if defined FETCHING (
  "%PY%" -m fmri_runner --out data %ARGS%
  exit /b
)
if not defined PLANS set "PLANS=plans"
"%PY%" -m fmri_runner %PLANS% --out data --media media %ARGS%
"""

README = """{title}

Made by the fMRI Experiment Designer. Everything needed to run it is in this
folder; nothing here talks to the designer's server.

Run it
  macOS / Linux:  ./run.sh
  Windows:        run.bat

  Options (add after the command):
    --scanner wait       wait for the scanner trigger (the default)
    --scanner simulate   pretend trigger pulses arrive every TR
    --scanner none       start straight away
    --windowed           a window instead of full screen
    --screen N           which display to use (--list-screens shows them)
    --flip WAY           mirror the display for optics that reverse it:
                         horizontal, vertical or both
    --participant ID     label the results with this participant
    --keyboard event     use window key events, if a Mac blocks PsychoPy's own
                         keyboard (the runner does this itself, with a warning)
    --pilot              a quick check: first 2 blocks, no scanner, in a window
    --blocks N           only the first N blocks of each run
    --from-run N         start at the Nth run, to carry on after stopping
    --debug              the pause key (space, or --pause-key) holds the run;
                         onsets then stop matching volumes, so not for real data

  To run the last published plans instead of these, fetching them first and
  falling back to the last fetched copy when there is no network:
    --planner URL --experiment ID --key-file key.txt --only ses-01

  Escape quits and says how to carry on. The trigger key is "{trigger}".
  Results go in data/<start time>/, so running again never overwrites anything:
  per run, a BIDS <name>_events.tsv and <name>_events.json, and a <name>.json
  run record. data/events.jsonl is an append-only log of everything that happened.

What is in here
{plans}
  runner/   the PsychoPy runner (Python 3.9+, PsychoPy 2023 or newer)
  media/    {media} picture(s)
"""


def folder_name(title: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", title).strip("-").lower()
    return (slug or "experiment")[:60]


def _runner_files() -> list[Path]:
    package = RUNNER_DIR / "fmri_runner"
    return sorted(path for path in package.glob("*.py") if path.is_file())


def build(title: str, plans: list[dict], media_files: dict[str, Path]) -> bytes:
    """plans have passed check_plans; media_files maps <sha>.<ext> to a file
    the caller has checked belongs to the experiment."""
    root = folder_name(title)
    listing = "\n".join(
        f"  plans/{plan['run']['label']}.json   {plan['run']['name']} ({plan['total_seconds'] / 60:.1f} min)" for plan in plans
    )
    readme = README.format(
        title=title,
        trigger=plans[0]["scanner"]["trigger_key"],
        plans=listing,
        media=len(media_files),
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        script = zipfile.ZipInfo(f"{root}/run.sh")
        script.external_attr = 0o755 << 16
        script.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(script, RUN_SH)
        archive.writestr(f"{root}/run.bat", RUN_BAT.replace("\n", "\r\n"))
        archive.writestr(f"{root}/README.txt", readme)
        for path in _runner_files():
            archive.write(path, f"{root}/runner/fmri_runner/{path.name}")
        for plan in plans:
            archive.writestr(f"{root}/plans/{plan['run']['label']}.json", json.dumps(plan, indent=1))
        for name, path in sorted(media_files.items()):
            archive.write(path, f"{root}/media/{name}")
        archive.writestr(f"{root}/data/.keep", "")
    return buffer.getvalue()
