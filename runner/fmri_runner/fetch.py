"""Getting published plans from the designer, and keeping a copy to run from
when the network is not there.

    python -m fmri_runner --planner https://designer.example --experiment ID \
        --key-file key.txt --only ses-01

Fetching mirrors the last Publish into mirror/<experiment>/, the same plans/
and media/ a bundle has, swapped in only once all of it has arrived. If the
designer cannot be reached the last copy runs instead, with a warning saying
how old it is, so a scanner room with no network still works; --offline skips
trying. Plans here are the published ones: Publish again in the designer to
change them.

The API key is read from a file, not given on the command line, where it
would end up in the shell's history and in `ps`. Standard library only.
"""
import json
import re
import shutil
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TIMEOUT_SECONDS = 30
LABEL = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
SHA = re.compile(r"^[0-9a-f]{64}$")
EXT = re.compile(r"^[a-z]{3,4}$")
MANIFEST = "manifest.json"


class FetchError(Exception):
    pass


def read_key(path):
    try:
        key = Path(path).read_text(encoding="utf-8").strip()
    except OSError as error:
        raise FetchError(f"cannot read the key file: {error}")
    if not key:
        raise FetchError(f"the key file {path} is empty")
    return key


def get(url, key):
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}", "User-Agent": "fmri_runner"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise FetchError("the designer refused the API key")
        if error.code == 404:
            raise FetchError("nothing published for this experiment, or the key cannot see it")
        raise FetchError(f"the designer answered {error.code}")
    except (urllib.error.URLError, OSError) as error:
        raise FetchError(f"cannot reach the designer ({error})")


def base_url(planner, experiment):
    return planner.rstrip("/") + "/api/experiments/" + urllib.parse.quote(experiment, safe="")


def check_manifest(manifest):
    """Everything here becomes a path or a URL, so it is checked first, even
    though it comes from a server this was pointed at."""
    if not isinstance(manifest, dict) or not isinstance(manifest.get("plans"), list):
        raise FetchError("the designer sent something that is not a manifest")
    for plan in manifest["plans"]:
        if not isinstance(plan, dict) or not LABEL.match(str(plan.get("label"))):
            raise FetchError("the manifest has a run label this will not use")
        for sha, entry in (plan.get("media") or {}).items():
            if not SHA.match(sha) or not EXT.match(str(entry.get("ext"))):
                raise FetchError("the manifest names a picture this will not use")
    return manifest


def mirror(planner, experiment, key, folder):
    """Bring folder up to the last Publish. Pictures it already holds are
    kept rather than fetched again: a name is its content's hash."""
    folder = Path(folder)
    base = base_url(planner, experiment)
    try:
        manifest = check_manifest(json.loads(get(base + "/published", key)))
    except ValueError:
        raise FetchError("the designer sent something that is not a manifest")
    fresh = folder.with_name(folder.name + ".new")
    shutil.rmtree(fresh, ignore_errors=True)
    (fresh / "plans").mkdir(parents=True)
    (fresh / "media").mkdir()
    try:
        for plan in manifest["plans"]:
            (fresh / "plans" / f"{plan['label']}.json").write_bytes(get(f"{base}/published/plans/{plan['label']}.json", key))
            for sha, entry in (plan.get("media") or {}).items():
                name = f"{sha}.{entry['ext']}"
                kept = folder / "media" / name
                if (fresh / "media" / name).exists():
                    continue
                if kept.is_file():
                    shutil.copy2(kept, fresh / "media" / name)
                else:
                    (fresh / "media" / name).write_bytes(get(f"{base}/media/{name}", key))
        (fresh / MANIFEST).write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    except BaseException:
        shutil.rmtree(fresh, ignore_errors=True)
        raise
    old = folder.with_name(folder.name + ".old")
    shutil.rmtree(old, ignore_errors=True)
    if folder.exists():
        folder.rename(old)
    fresh.rename(folder)
    shutil.rmtree(old, ignore_errors=True)
    return manifest


def read_mirror(folder):
    try:
        return check_manifest(json.loads((Path(folder) / MANIFEST).read_text(encoding="utf-8")))
    except (OSError, ValueError):
        raise FetchError(f"no copy to run from in {folder}: fetch once while the designer can be reached")


def select(manifest, folder, only):
    """The plan files whose label starts with one of only, in manifest order."""
    labels = [plan["label"] for plan in manifest["plans"]]
    picked = [label for label in labels if any(label.startswith(prefix) for prefix in only)]
    if not picked:
        raise FetchError(f"say which plans with --only: {', '.join(labels)}")
    return [str(Path(folder) / "plans" / f"{label}.json") for label in picked]
