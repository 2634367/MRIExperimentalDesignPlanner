# MRI Experiment Designer

A web app for designing fMRI experiments, and a standalone PsychoPy runner that plays them in the scanner.

You build a design in the browser: prompt lists, pictures, trial types with fixed or jittered phases, runs of blocks, sessions of runs and other scans. The app shows what that design costs in scanner hours, models the haemodynamic response, and writes a report. A design then compiles to a run plan. The run plan is the one file both players read.

The app is generic. It knows nothing about any one study. It does not solve for a design: you set the counts and it reports what they come to.

It replaced two older projects that sit beside it, in the `_old-*` folders. They are kept for reference only and are ignored by git.

Other documents:

- [TUTORIAL.md](TUTORIAL.md) walks a new researcher from an empty experiment to a run.
- [API.md](API.md) covers API keys, HTTP routes, the MCP endpoint, the design document and the run plan format.

## How it fits together

```
design document  --compile.js (in the browser)-->  run plan (fmri-run-plan/1)
                                                     |-- stage.js        plays it in a browser tab
                                                     `-- fmri_runner     plays it in PsychoPy
```

`static/js/compile.js` draws every jittered duration, picks every prompt item and resolves every layer to what is drawn. One seed gives the same run every time. The server never builds a plan. It only checks one (`app/models/plans.py`) before writing it to disk. The two players know nothing about trial types, prompt lists or distributions, so what you see in the browser and what PsychoPy shows are the same run.

The design document is stored as the browser sends it. The server owns only who may open it and the revision number that stops two people overwriting each other.

## Run it locally

You need Python 3 on `PATH`. Everything else goes in `.venv`, which the scripts create.

```bash
scripts/run.sh
```

The first run on a fresh checkout writes `config/config.yaml`, with a new secret key, and stops so you can look at it. For plain `http://` on this machine, change `secure_cookies: true` to `secure_cookies: false` in that file. Over plain http the browser drops a Secure cookie, and signing in silently does nothing. The script prints which line to change.

Run `scripts/run.sh` again. The server starts in the foreground on `http://127.0.0.1:23313`, its log streams to the terminal, and Ctrl-C stops it. On a new database it prints the owner's one-time login link.

Running `scripts/run.sh` again from another terminal stops the copy this checkout started and takes over. Python changes need that restart. Changes under `static/` need only a page reload.

With arguments, `scripts/run.sh` is a one-off that passes them to `python -m app` and leaves the running server alone:

```bash
scripts/run.sh manage list-users
scripts/run.sh manage create-login --name "Grace" --role user
scripts/run.sh manage create-key --user-id 1 --name "CI"
scripts/run.sh manage paths             # where the state lives
scripts/run.sh config check             # validate the config in use
scripts/run.sh config shell server      # every resolved value
scripts/run.sh version
scripts/run.sh help                     # every command
```

### Logging in

There is no signup page. People get in with a one-time login link (30 minutes by default) or a group invite link.

```bash
scripts/login.sh             # a link for the owner (user 1)
scripts/login.sh 3           # a link for user 3
scripts/login.sh --docker    # the docker container, even if a local server is running
scripts/login.sh --local     # this checkout's local database
```

With no flag, the script uses the local server if it is running, otherwise the docker container if that is running, otherwise the local database directly. The two deployments keep separate databases, so a link from one does nothing in the other. The script says which one it used.

Inside the app, an admin can add people on Users and Invite links.

`scripts/run.bat` and `scripts/login.bat` do the same on Windows.

### Configuration

| File | What it is |
|---|---|
| `config/defaults.yaml` | Every setting and its default, with comments. Committed. Read this to find out what a setting does. |
| `config/config.yaml` | Your settings. It holds the secret key, so it is gitignored and mode 0600. Any key you leave out takes its default. |
| `config/config.example.yaml` | Generated from the defaults with no secret key. Regenerate with `python -m app config example`. |
| `config/language.yaml` | Every piece of text the UI shows. Edit and restart to reword the app. An empty value hides its element. |

Nothing reads environment variables. An unknown key is an error, not an ignored typo.

The config file is found in this order: `./config/config.yaml`, then `~/.config/fmri-experiment-designer/config.yaml`. If neither exists the server writes the second one.

Settings you are most likely to touch:

| Setting | Default | Meaning |
|---|---|---|
| `server.port` | `23313` | The port. |
| `server.host` | `127.0.0.1` | `0.0.0.0` listens on every interface; put TLS in front if you do. |
| `server.public_url` | empty | The address people open it at. Login, invite and key links use it. |
| `server.app_dir` | empty | Where the database and storage live. Empty means `~/.config/fmri-experiment-designer/`. |
| `server.secure_cookies` | `true` | `false` only for plain `http://localhost`. |
| `server.mcp` | `true` | `false` removes `/mcp`. |
| `auth.api_keys` | `true` | `false` closes API keys completely. |
| `media.max_mb` | `20` | The largest picture accepted. |
| `psychopy.launch` | `auto` | Whether Run in PsychoPy can start PsychoPy on this machine. See below. |
| `psychopy.python` | `auto` | The Python that has PsychoPy, or `auto` to look for it. |

The state directory holds `app.db` and `storage/` (pictures, published copies and launches). Back up the state directory and `config/config.yaml` together. The secret key encrypts every database record, so each is useless without the other.

## Run it in Docker

```bash
docker/run.sh                # build the image, then run the container
docker/build.sh              # build only
docker/build.sh v1.2.3       # build and also tag v1.2.3
```

There is no compose file. `docker/run.sh` is one readable `docker run`.

Every value comes from the `docker:` section of `config/config.yaml`, plus `server.port` for the container side of the published port. The first run writes the config and stops, so you can review `server.secure_cookies`, `server.trust_proxy`, `server.trusted_proxies`, `docker.bind_address` and `docker.host_port`. Run it again to start.

The container runs as an unprivileged user with a read-only filesystem, no capabilities, and pid, memory and CPU limits. Only the data directory (`docker.data_dir`, default `./data`, mounted at `/app/data`) and a small `/tmp` are writable. `config.yaml` is mounted read-only at `/app/config/config.yaml`. A config change needs a restart, not a rebuild.

The app does not terminate TLS. `docker.bind_address` defaults to `127.0.0.1`, so put nginx, Caddy or Traefik in front and set `server.public_url`, `server.trust_proxy` and `server.trusted_proxies`. `docker/run.sh` prints what to check.

The script prints the owner's first login link. After that use `scripts/login.sh --docker`, or:

```bash
docker exec -it fmri-experiment-designer python -m app manage list-users
```

The container cannot start PsychoPy, because it has no display. Use Download for PsychoPy, or Publish and a runner on the stimulus machine. The runner is in the image only so it can be zipped into bundles.

To reword the UI in a container, put a `language.yaml` in the data directory. It wins over the bundled one.

## Repository layout

| Path | What is there |
|---|---|
| `app/` | The Starlette server. `python -m app` is the single entry point. |
| `app/routes/` | HTTP handlers and MCP tools. `__init__.py` is the complete URL map. |
| `app/models/` | Records and their rules: experiments, plans, actions, published copies, scanner cards, seen items, run results, keys, users. |
| `app/core/` | Config, database, encryption, security guards, bundle building, report building, starting PsychoPy. |
| `app/mcp/` | The JSON-RPC protocol and the shape of a tool. |
| `app/seed/scanner_cards/` | The cards an empty library starts with. |
| `app/tests/` | The test suite. |
| `static/` | The browser app: `index.html`, `css/`, `js/`, `vendor/`. One file in `js/` per screen, plus `compile.js`, `timing.js`, `schema.js` and `stage.js`. |
| `runner/fmri_runner/` | The PsychoPy runner. Standalone: Python 3.9+ and PsychoPy, nothing else. |
| `config/` | Defaults, the example config and `language.yaml`. |
| `scripts/` | `run.sh`, `login.sh` and their Windows versions. |
| `docker/` | `Dockerfile`, `build.sh`, `run.sh`. |
| `misc/` | Helper scripts and sample data. Not used at run time. `vendor.sh` adds a browser library to `static/vendor/`. |
| `_old-*` | The two earlier projects, for reference. Not part of this app. |

## The screens

The sidebar shows the design screens once an experiment is open.

| Group | Screen | What it does |
|---|---|---|
| | Experiments | Create, import, open, export and share designs. Choose who can edit one. |
| Design | Trial types | Phases, durations, jitter, what is on screen, recorded keys, which phases are modelled. Predicted response graph. |
| Design | Runs | Instructions, lead-in, blocks, rests, lead-out. Length, volumes, timeline and Design efficiency. |
| Design | Sessions | Steps of a visit: runs, other scans, breaks. |
| Design | Results | How each run brought back went: screens shown, onset error, dropped frames, pulses, and a verdict. Not on a share link. |
| Setup | Overview | Name and identity fields, scanner hours, calendar, limits, trial totals, Things to fix. |
| Setup | Prompts | Prompt lists: columns, items, CSV import and export. |
| Setup | Pictures | Every picture the experiment can show. |
| Setup | HRF model | The response shape every graph uses. |
| Setup | Scanner & display | TR, dummy volumes, trigger key, Run clock starts at, keys, display, Fixation mark, Jitter, What's on screen. |
| Setup | Report | Methods paragraph, tables, figures, downloads, Publish. |
| | Scanner cards | The team's shared library of sequence parameters. |
| You | Account, Appearance, PIN, API keys | Your own settings and keys. |
| Admin | Users, Invite links, All API keys | Who gets in. Admins only. |

Every screen has its own address, so Back, Forward, reload and a pasted link all land where you were. A design screen is `/<experiment>/<screen>`, for example `/inner-speech-pilot/overview` or `/inner-speech-pilot/trials/<id>`; `<experiment>` is the name in lowercase with dashes, and two experiments with the same name get `-2`, `-3`. Renaming an experiment changes its address. Other screens are `/experiments`, `/account`, `/scanners` and so on, and a share link's screens are `/s/<link>/<screen>`. Old `/?e=<id>#screen` links still open and are rewritten.

Edits save on their own. Ctrl+Z and Ctrl+Y undo and redo. If two people have one experiment open, each page follows the other's saves within a few seconds, and a real conflict asks whose version to keep.

Admin means "decides who gets in". An admin cannot read other people's experiments.

## How a design reaches the scanner

Every Play button (Play this trial, Play / run…, Play / run the session…) opens the same run dialog. There are four routes.

### Play in browser

The player in this tab (`static/js/stage.js`). It runs at ×1 to ×30, with pause, skip and a debug window. Use it to check a design. It writes no results, and what it shows does not count as seen.

### Run in PsychoPy

Starts PsychoPy on the machine the server runs on. It needs a browser session (never an API key), and only one launch runs at a time.

The dialog offers this button only when `GET /api/psychopy` says it can. With `psychopy.launch: auto` that means all of these hold:

- the server listens on loopback
- it is not in a container
- a Python that can import `psychopy` is found

`psychopy.launch: on` allows it on another interface, for a stimulus PC on a network you control. `off` never allows it.

The dialog shows the runner's log and a Stop button. Stop ends the run the way Escape does, so the results are saved. When the runner exits, what it showed is recorded as seen.

### Download for PsychoPy (the bundle)

A zip for any other machine. It holds `run.sh`, `run.bat`, `README.txt`, the runner, `plans/<label>.json`, `media/<sha>.<ext>` and an empty `data/`. It never talks to the server. After the download the dialog shows the command to run, with the flags you chose:

```bash
cd ~/Downloads && unzip -o my-study.zip && my-study/run.sh --participant 01
```

`run.sh` finds a Python with PsychoPy: `python3` first, then `PsychoPy.app`. It passes every `.json` argument as a plan, and all of `plans/` if there are none. It always adds `--out data --media media`. Other arguments pass through to the runner.

To count what a bundle showed as seen, bring the `.json` run records back with Add run results in the run dialog.

### Publish, then runner fetch

Report › Publish puts the run plans and figures at addresses that stay the same. A runner on another machine fetches them with an API key:

```bash
PYTHONPATH=runner python3 -m fmri_runner \
    --planner https://designer.example --experiment EXPERIMENT_ID \
    --key-file key.txt --only ses-01 --participant 01
```

Fetching mirrors the last Publish into `mirror/<experiment>/`, with the same `plans/` and `media/` a bundle has. The new copy replaces the old one only once all of it has arrived. Pictures already held are not fetched again.

If the designer cannot be reached, the last copy runs with a warning saying when it was published. `--offline` skips the network.

Fetching needs `--only` to play anything. Use `--list` first to see the labels. Published plans have no participant in them, so pass `--participant`.

Publish compiles every run and session with the design's locked order (Report > Locked order), so publishing again keeps the order and **Shuffle** picks a new one. Everyone who fetches gets the same order until then, and a session's `ses-` label is its place in the design, not the participant's visit number. See [Publish in the tutorial](TUTORIAL.md#publish) for what that means for repeat visits.

Plans here are the published ones. Publish again to change them.

A bundle's `run.sh` and `run.bat` take the same flags: with `--planner` or `--offline` they leave out the bundle's own plans and pictures.

## Where results go

Only the runner writes results. They go under `--out`:

```
<out>/
  events.jsonl                 append-only: every pulse, press and segment of every launch
  <start time>/                one folder per start of the runner, e.g. 20261105T141522
    <name>_events.tsv          BIDS events: one row per segment shown
    <name>_events.json         BIDS sidecar saying what the columns mean
    <name>.json                the run record
```

A new folder for each start means running again never overwrites an attempt. The runner warns if a run already has results.

| Route | `<out>` |
|---|---|
| Run in PsychoPy | `<app dir>/storage/launches/<stamp>-<id>/data/`, beside that launch's `plans/`, `media/` and `runner.log`. The dialog shows the folder. |
| Bundle | `data/` in the unzipped folder. |
| Runner by hand | `--out`, default `data`. |

### How they are named

`<name>` is a BIDS name built from the participant, the session, the experiment and the run:

```
sub-01_ses-02_task-MyStudy_run-03
sub-01_task-MyStudy_run-01                     a run played on its own has no session
sub-01_ses-01_task-MyStudy_acq-pilot_run-01    a shortened run
```

- `sub-` is `--participant`, or the participant in the plan, or `anon`. Only letters and digits are kept.
- `ses-` is the visit, from the plan's label.
- `task-` is the experiment's name with only letters and digits kept.
- `run-` is the run's place in the session, or in the design for a run played alone.
- `acq-pilot` marks a run cut short by Blocks to play, `--blocks` or `--pilot`.

### What is in them

`<name>_events.tsv` has one row per segment, written as the run goes, so a crash keeps what had been shown. Onsets and durations are measured, in seconds from t0, the trigger the run started on.

| Column | Meaning |
|---|---|
| `onset` | Measured time of the first frame, from t0. |
| `duration` | Measured time on screen. |
| `trial_type` | The trial type, or the kind of screen outside a trial. |
| `phase` | The phase, or the screen's label. |
| `trial`, `block` | Numbers in this run, from 1. |
| `item`, `item_label` | The drawn item's id, and the item as shown. |
| `response`, `response_time` | The first key pressed on this screen, and its time from the measured onset. |
| `planned_onset` | The onset in the plan, from t0. |
| `expected_response`, `correct` | The key the phase's Expected key asks for, and `1` if the first key pressed was it, `0` if another key or none. `n/a` on screens that are not scored. |
| `item_<column>` | One column for each text or number column of the drawn items. |

Empty values are `n/a`.

`<name>.json` is the run record:

- the whole plan
- the measured onset of every segment, and on a scored screen its `expected` key and whether the answer was `correct`
- every press and trigger
- `shown_items`, the items actually shown
- `dropped_frames` and `worst_frame_ms`
- `participant` and `scanner_mode`
- `pulses`, in wait mode, with `seen`, `expected` and `before_t0`
- `pulse_gaps`, in wait mode
- `flip`, when the display was mirrored
- `debug` and `pauses`, in debug mode

It says `"aborted": true` from the moment the run starts until it is saved, so a crash cannot pass for a finished run.

### The Results screen

Each run record that reaches the app goes on Results: a local launch's when the runner exits, and a bundle's through **Add run results**. Pilots and debug runs are listed. Single-trial previews are not. Removing a run from Results leaves its files alone.

`app/models/results.py` works out each run's numbers and verdict:

| Verdict | When |
|---|---|
| Unusable | Stopped early, failed, paused in debug, or pulses seen differ from the plan by more than one. |
| Check | The worst screen was over 1.5 frames late, the mean onset error over half a frame, frames were dropped, or the scanner went quiet for 3 TRs. |
| OK | None of these. |

Simulated-pulse and no-scanner runs are labelled, not marked down: fine for checking a task, not for data.

Where a phase has an **Expected key** (Trial types, on a phase that records keys), answers are scored: right out of scored, misses, and the mean reaction time of right answers, per run in the table. Under it, **Behaviour** adds them up per participant, or per trial type when one participant is chosen, leaving out pilots and paused runs.

## Tests

```bash
.venv/bin/python -m unittest discover -s app/tests -t .
```

`scripts/run.sh` creates `.venv`. The checks of `compile.js` need `node` on `PATH` and are skipped without it.

## The runner

`runner/fmri_runner/` draws a plan on time, waits for the scanner, records key presses and writes down what happened. It needs Python 3.9+ and PsychoPy (the bundle's README says 2023 or newer). `--check`, `--list` and argument errors work without PsychoPy.

From a checkout, put `runner/` on the path:

```bash
PYTHONPATH=runner python3 -m fmri_runner plans/run-01.json [more.json | a folder] [options]
```

The runner plays each plan in turn in one window. A folder means every `*.json` in it, by name.

It uses one clock per run. t0 is the last pulse the plan waits for, and every segment boundary is an absolute offset from t0, so timing error does not build up across a long run. A segment's measured onset is the time of its first flip.

### Flags

Plans and results:

| Flag | Default | What it does |
|---|---|---|
| `plans` | | Plan `.json` files, or folders of them. Required unless you use `--list-screens`, `--planner` or `--offline`. |
| `--out DIR` | `data` | Where results go. |
| `--media DIR` | `media/` beside `plans/` | The folder holding the pictures. |
| `--participant ID` | the plan's, else `anon` | Label the results with this participant. |
| `--check` | off | Only check the plans, the pictures and the key clashes, then stop. No PsychoPy needed. |
| `--version` | | Show the version, then stop. |

The scanner and the screen:

| Flag | Default | What it does |
|---|---|---|
| `--scanner MODE` | `wait` | `wait` waits for the trigger key. `simulate` counts pretend pulses at the plan's TR. `none` starts as soon as the instructions are dismissed. |
| `--windowed` | off | A window instead of full screen. |
| `--screen N` | `0` | Which display. The runner refuses a display that is not there, because PsychoPy would quietly use the first one. |
| `--list-screens` | | Show the displays attached, then stop. |
| `--flip WAY` | `none` | Mirror the display, for scanner optics that reverse it: `none`, `horizontal`, `vertical` or `both`. The plan does not change. The run record says how it was mirrored. |

How much to play:

| Flag | Default | What it does |
|---|---|---|
| `--blocks N` | all | Play only the first N block repetitions of each run. Results are marked `acq-pilot`, unless the run has N blocks or fewer, when nothing is cut. |
| `--from-run N` | `1` | Start at the Nth plan given, to carry on after stopping. The runner prints the number to use. |
| `--pilot` | off | A quick check: `--blocks 2 --scanner none --windowed`, unless you set `--blocks` or `--scanner` yourself. |
| `--debug` | off | Let the pause key hold the run. Not for data you will analyse. |
| `--pause-key KEY` | `space` | The key `--debug` pauses with. The runner refuses a key that is also the trigger, a quit key or a response key. |

The terminal and the keyboard:

| Flag | Default | What it does |
|---|---|---|
| `--quiet` | off | One plain line per trial, even in a terminal. |
| `--keyboard BACKEND` | PsychoPy's own | PsychoPy's keyboard backend: `ptb`, `event` or `iohub`. With no flag, a Mac that blocks direct keyboard access falls back to `event`. Naming a backend skips that check. See below. |

Fetching published plans:

| Flag | Default | What it does |
|---|---|---|
| `--planner URL` | | The designer's address, to fetch its last published plans. Needs `--experiment` and `--key-file`. Cannot be combined with plan files. |
| `--experiment ID` | | Which experiment to fetch. |
| `--key-file FILE` | | A file holding an API key. It is read from a file so that it stays out of shell history and `ps`. |
| `--only PREFIX` | | Play the fetched plans whose label starts with this. Repeatable. Required to play anything: `--only ses-01`, `--only run-02`. |
| `--list` | off | Show the fetched plans' labels, then stop. |
| `--mirror DIR` | `mirror` | Where fetched plans are kept. A run uses `<mirror>/<experiment>/`. |
| `--offline` | off | Use the last fetched copy without trying the network. Needs `--experiment`, not `--key-file`. |

`--only`, `--list`, `--mirror` and `--key-file` need `--planner` or `--offline`, and the runner refuses them without it.

### Scanner modes

| Mode | What happens before t0 |
|---|---|
| `wait` | Waits for `dummy_volumes` pulses on the trigger key, at least one. t0 is the last of them. There is no time limit, because the quit key always works. |
| `simulate` | Counts pretend pulses at the TR, then starts. |
| `none` | t0 is the moment the instructions are dismissed. |

The trigger key counts from the top row or the number pad. The runner refuses to start in `wait` mode if a response key is also the trigger, because that response would never be recorded.

During a run in `wait` mode the terminal warns if no pulse comes for 3 TRs, and the run carries on. The closing line compares pulses seen with the plan. If they differ by more than one, it warns, and if the run is short by about the dummy volumes it says to check Run clock starts at.

### Keys, stopping and carrying on

- **Continue keys** dismiss the instructions and move between runs.
- **Quit keys** stop the run. Whatever ran so far is saved, and the runner prints the `--from-run` to carry on with.
- Between runs the screen says what finished, shows any planned break, and waits for a continue key. The operator decides when the next run starts.
- Every response key is read all the time, so a stray press cannot wait in the buffer and count in a later window.

| Exit code | Meaning |
|---|---|
| `0` | Everything played, or `--check`, `--list` or `--list-screens` finished. |
| `1` | The run was stopped or failed. Results so far are saved. |
| `2` | Bad arguments, a bad plan, a missing picture, a key clash or a missing screen. Nothing ran. |

### What the terminal shows

In a terminal the last four lines rewrite in place, at most ten times a second and just after a flip, so a repaint never delays a frame. They show the run, the phase, what is on screen and what comes next. Anywhere else, or with `--quiet`, you get one plain line per trial. A local launch writes this to `runner.log`, which the run dialog shows.

With `--debug`, the pause key holds the run and the same key resumes it. t0 moves forward by the length of the pause, so every remaining phase keeps its full length. A real scanner does not stop, so a paused run's onsets no longer line up with its volumes. The record says `"debug": true` and lists every pause.

### macOS Input Monitoring

PsychoPy's own keyboard reads the hardware through PsychHID. If macOS Input Monitoring is off for the app that started the runner, PsychHID crashes the whole process with a segfault that Python cannot catch, and macOS puts a crash dialog on the operator's screen.

So on a Mac the runner asks macOS first, which touches nothing. If access is blocked and you did not name a backend with `--keyboard`, it switches to the `event` backend and prints:

```
[keyboard] WARNING: macOS is blocking direct keyboard access (Input Monitoring is off for the app that started this), which would crash PsychoPy. Using window key events instead: keys only count while the task window has focus, and their times are only good to a frame. Allow it in System Settings > Privacy & Security > Input Monitoring for real data.
```

In that state:

- Keys count only while the task window has focus. A trigger box is a keyboard, so one click on the operator's terminal would lose pulses and Escape.
- Key times are good only to a frame.

This is fine for checking a task and not for real data. Allow Input Monitoring for whatever started the process: the terminal, or the app that started the server. The run dialog shows the same warning when the server's check comes back blocked.

Naming a backend with `--keyboard ptb` or `--keyboard iohub` skips the check, so on a blocked Mac it can bring the crash back.

The `event` backend reads `psychopy.event` directly and not through PsychoPy's Keyboard class. On that backend Keyboard loses every key, Escape included (seen in PsychoPy 2026.2.2).
