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
#   ./run.sh plans/run-02.json        just that run
#
# Results go in data/.
set -euo pipefail
cd "$(dirname "$0")"

plans=()
args=()
for arg in "$@"; do
  if [[ "$arg" == *.json ]]; then plans+=("$arg"); else args+=("$arg"); fi
done
if [[ ${#plans[@]} -eq 0 ]]; then plans=(plans/*.json); fi

export PYTHONPATH="$PWD/runner"
if python3 -c "import psychopy" >/dev/null 2>&1; then
  exec python3 -m fmri_runner "${plans[@]}" --out data --media media "${args[@]+"${args[@]}"}"
fi
for app in /Applications/PsychoPy.app "$HOME/Applications/PsychoPy.app"; do
  if [[ -x "$app/Contents/MacOS/python" ]]; then
    export PYTHONHOME="$app/Contents/Resources"
    exec "$app/Contents/MacOS/python" -m fmri_runner "${plans[@]}" --out data --media media "${args[@]+"${args[@]}"}"
  fi
done
echo "PsychoPy was not found. Install PsychoPy (https://www.psychopy.org/download.html) or 'pip install psychopy'." >&2
exit 1
"""

RUN_BAT = r"""@echo off
rem Runs every plan in plans\ with whichever Python has PsychoPy.
rem   run.bat                          full screen, waits for the scanner trigger
rem   run.bat --scanner none --windowed   a quick look, no scanner at all
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
"%PY%" -m fmri_runner plans --out data --media media %*
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
    --participant ID     label the results with this participant

  Escape quits. The trigger key is "{trigger}". Results are written to data/:
  one <run>_events.tsv (BIDS-style onsets) and one <run>.json run record per
  run, plus events.jsonl, an append-only log of everything that happened.

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
