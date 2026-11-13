# API

How a script, a runner or an agent talks to the MRI Experiment Designer.

There are two doors, and both use the same API keys and the same roles:

- **HTTP routes** under `/api/`. `app/routes/__init__.py` is the complete list.
- **MCP** at `POST /mcp`, for agents. It is JSON-RPC over plain HTTP.

Examples use these:

```bash
BASE=http://127.0.0.1:23313      # your server.public_url, or http://host:port
KEY=$(cat key.txt)
EXP=abc123def456                 # an experiment id
```

## Authentication

### API keys

A key looks like `<id>.<secret>`. Send it in one header, and nothing else is accepted:

```
Authorization: Bearer <id>.<secret>
```

Make one in the app on **API keys**, or on the server:

```bash
scripts/run.sh manage create-key --user-id 1 --name "stim PC" [--role user] [--days 90]
```

The credential is shown once and cannot be recovered. If you lose it, revoke the key and make another.

| Rule | Detail |
|---|---|
| Role | `user` or `admin`, `user` by default. A key never outranks its owner: the effective role is the lower of the two, checked on each request. |
| Lifetime | 90 days by default (`auth.api_key_ttl_seconds`). `expires_in_days: 0` or `--days 0` never expires. The most is 3650 days. |
| Limit | 25 live keys per user. |
| Switching off | `auth.api_keys: false` stops the header being believed, and the routes that manage keys answer 404. |

A key acts as its owner. It sees the experiments the owner owns or edits, and no others. Admin means "decides who gets in": an admin gets no extra access to experiments.

To check a key:

```bash
curl -sS "$BASE/api/me" -H "Authorization: Bearer $KEY"
```

### What a key cannot do

A key never creates a credential and never deletes anything that cannot be put back. If a leaked key could make another credential, revoking it would not end the compromise. So these routes need a browser session, and a key gets 403:

- making, revoking, deleting or restoring API keys
- making accounts, login links, invite links, share links or PINs
- deleting or restoring experiments and scanner cards
- starting, watching or stopping a PsychoPy launch, which opens windows on the server's machine

The route tables below mark each one.

### Sessions and CSRF

A browser signs in with a session cookie. If a request carries both a live session and a key, the session wins.

Every state-changing route checks a CSRF token for a session. The token comes from `GET /api/me` as `csrf_token`, and goes in the JSON body as `csrf_token`. A picture upload has no JSON body, so it uses the `X-CSRF-Token` header.

A request made with an API key needs no token. Nothing attaches an Authorization header on its own, so there is nothing to forge.

### Errors and limits

Every error is JSON with one shape: `{"error": "message"}`.

| Status | Meaning |
|---|---|
| 400 | A malformed body, or a value the route refuses. |
| 401 | No valid credential. |
| 403 | Bad CSRF token, the wrong role, or a key on a session-only route. |
| 404 | Not there, or not yours. An experiment you cannot open answers the same as one that does not exist. |
| 409 | The record moved on. `{"error": ..., "revision": n}` gives the current revision. |
| 413 | A picture over `media.max_mb`. |
| 503 | PsychoPy cannot be started here. |

Requests are limited per client address: 1200 per 60 seconds by default (`server.rate_limit_max`). A body can be at most 25 MiB (`server.body_limit_bytes`).

## HTTP routes

"Key" means an API key or a session. "Session" means a browser session only.

### Experiments

| Method and path | Auth | Body and answer |
|---|---|---|
| `GET /api/experiments` | Key | The list: `id`, `name`, `owner`, `owner_name`, `is_owner`, `editors`, `revision`, `created_at`, `updated_at`, `updated_by_name`. |
| `POST /api/experiments` | Key | `{doc}`. Answers 201 with the row and `doc`. |
| `GET /api/experiments/{id}` | Key | The row and `doc`. |
| `GET /api/experiments/{id}/revision` | Key | `{revision, updated_by_name}`. What an open page polls. `updated_by_name` is empty if you made the last save. |
| `POST /api/experiments/{id}/save` | Key | `{doc, base_revision}`. Answers `{id, revision, updated_at}`, or 409 if it changed since. |
| `POST /api/experiments/{id}/action` | Key | One small edit. See [experiment_action](#experiment_action). |
| `POST /api/experiments/{id}/duplicate` | Key | `{name}`, optional. Answers 201 with the copy. |
| `POST /api/experiments/{id}/editors` | Key | `{editors: [user ids]}`. Owner only. |
| `POST /api/experiments/{id}/delete` | Session | Owner only. A soft delete. |
| `POST /api/experiments/{id}/restore` | Session | Undo a delete within a few minutes. Owner only. |

A document needs a `name` of 1 to 200 characters and an integer `format_version`, and must be at most 8 MiB. The server checks nothing else. See [The design document](#the-design-document).

Saves are optimistic. Read the document and note its `revision`. Send that back as `base_revision`. If someone saved in between, nothing is written and you get 409 with the current revision.

### Published plans and figures

| Method and path | Auth | Body and answer |
|---|---|---|
| `GET /api/experiments/{id}/published` | Key | The manifest. 404 if nothing is published. |
| `GET /api/experiments/{id}/published/plans/{label}.json` | Key | One run plan. |
| `GET /api/experiments/{id}/published/figures/{name}` | Key | A figure, `.svg` or `.png`. |
| `POST /api/experiments/{id}/publish` | Key | See below. |

See [Published plans and figures](#published-addresses).

### Media

| Method and path | Auth | Body and answer |
|---|---|---|
| `POST /api/experiments/{id}/media` | Key | The picture's bytes as the raw body. Answers 201 with its row. |
| `POST /api/experiments/{id}/media/url` | Key | `{url}`. The server fetches a copy. Answers 201. Public `http` or `https` addresses only. |
| `GET /api/experiments/{id}/media/{sha}.{ext}` | Key | The file. |

A picture is PNG, JPEG, GIF or WebP, named by its sha256. Adding one puts it in the experiment's storage but not in the document: the browser adds it to `doc.media`. A script must add the row returned to `media` itself.

### Running

| Method and path | Auth | Body and answer |
|---|---|---|
| `POST /api/experiments/{id}/bundle` | Key | `{plans: [...]}`, 1 to 64 plans. Answers the zip. |
| `POST /api/experiments/{id}/seen` | Key | `{participant}`. Answers `{items, runs, highest_visit}`. A POST, so the label stays out of URLs and logs. |
| `POST /api/experiments/{id}/seen/add` | Key | `{runs: [{experiment, participant, run, items, visit}]}`, at most 200. Answers `{added}`. A run already recorded, or from another experiment, is skipped. |
| `GET /api/experiments/{id}/results` | Key | `{runs: [...]}`, newest first: each run's numbers from `app/models/results.py` summarise, plus `level` (`ok`, `check`, `bad`) and `reasons`. |
| `POST /api/experiments/{id}/results/add` | Key | `{records: [...]}`: runner records (`<name>.json`), whole or trimmed as the run dialog sends them, at most 200. Answers `{added}`. A run already kept, a preview, or one from another experiment is skipped. |
| `POST /api/experiments/{id}/results/remove` | Key | `{run}`, the `run` of a row. Answers `{removed: true}`, or 404. The files are untouched. |
| `POST /api/experiments/{id}/report` | Key | `{tables, methods, figures, only}`, as the Report screen builds it. `only: "xlsx"` gives the workbook alone. Answers the file. |
| `GET /api/psychopy` | Key | `{available, reason}`, and when available `python`, `psychopy_version`, `python_version`, `source` and `keyboard`. `?refresh=1` checks again. |
| `POST /api/experiments/{id}/launch` | Session | `{plans, scanner, windowed, screen, debug, flip, label}`. Answers 201 with the launch. 409 if one is running. 503 if PsychoPy cannot start here. |
| `GET /api/launches/latest` | Session | Your latest launch, or `null`. |
| `GET /api/launches/{id}` | Session | `{id, label, running, exit_code, stopped, started_at, ended_at, folder, log}`. |
| `POST /api/launches/{id}/stop` | Session | Ends it as Escape does, so the results are saved. |

Plans are compiled in the browser (`static/js/compile.js`). There is no server route that compiles a design.

### Scanner cards

One library, shared by every signed-in user.

| Method and path | Auth | Body and answer |
|---|---|---|
| `GET /api/scanner-cards` | Key | Every card, with its pages. |
| `GET /api/scanner-cards/revisions` | Key | `{card id: revision}`. |
| `POST /api/scanner-cards` | Key | `{card}`. Answers 201. |
| `POST /api/scanner-cards/{id}/save` | Key | `{card, base_revision}`. 409 if it changed since. |
| `GET /api/scanner-cards/{id}/backups` | Key | Earlier versions, the last 25. |
| `POST /api/scanner-cards/{id}/backups/restore` | Key | `{revision}`. |
| `POST /api/scanner-cards/{id}/delete` | Session | 409 for the last card in the library. |
| `POST /api/scanner-cards/{id}/restore` | Session | Undo a delete. |

A card is `{label, role, note, pages: [{name, rows: [{parameter, value, indent}]}]}`. `role` is `functional`, `reference`, `structural` or `other`. Its id comes from its label.

### Sharing

| Method and path | Auth | Body and answer |
|---|---|---|
| `GET /api/experiments/{id}/share-links` | Key | The links. |
| `POST /api/experiments/{id}/share-links` | Session | `{label}`. A link is a credential. |
| `POST /api/experiments/{id}/share-links/{link}/revoke` | Key | |
| `GET /s/{credential}` | Public | The app, read-only. |
| `GET /s/{credential}/media/{sha}.{ext}` | Public | A picture. |
| `POST /api/share/open` | Public | `{credential}`. Answers `{id, name, label, revision, doc}`. |
| `POST /api/share/revision` | Public | `{credential}`. |
| `POST /api/share/bundle` | Public | `{credential, plans}`. |
| `POST /api/share/report` | Public | `{credential, tables, methods, figures, only}`. |

Holding the link is the permission, and it is checked on every request.

### You and your account

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/me` | Key | Who you are: `id`, `display_name`, `role` (effective), `account_role`, `is_owner`, `has_pin`, `auth`, `api_keys_enabled`, and `csrf_token` for a session. |
| `GET /api/team` | Key | Every active account: `id`, `display_name`. |
| `POST /api/account/rename` | Key | Change your display name. |
| `POST /api/logout` | Key | Sign out. |
| `POST /api/account/pin` | Session | Set or clear a PIN. |
| `POST /api/account/login-link` | Session | A login link for your own account. |
| `GET /api/keys`, `POST /api/keys` | Session | List or make your keys. `{name, role, expires_in_days}`; the answer has `credential`, once. |
| `POST /api/keys/{id}/revoke`, `/delete`, `/restore` | Session | Revoking has no way back. A delete can be undone for a few minutes. |

### Admin

These need the admin role. "Admin key" means an admin-scoped key or an admin's session.

| Method and path | Auth |
|---|---|
| `GET /api/admin/users` | Admin key |
| `POST /api/admin/users/{id}/disabled` | Admin key |
| `POST /api/admin/users/{id}/revoke-access` | Admin key |
| `POST /api/admin/users` | Admin session |
| `POST /api/admin/users/{id}/reissue-login` | Admin session |
| `POST /api/admin/users/{id}/delete` | Admin session |
| `GET /api/admin/invite-links` | Admin key |
| `POST /api/admin/invite-links/{id}/revoke` | Admin key |
| `POST /api/admin/invite-links` | Admin session |
| `POST /api/admin/invite-links/{id}/delete`, `/restore` | Admin session |
| `GET /api/admin/keys` | Admin session |
| `POST /api/admin/keys/{id}/revoke`, `/delete`, `/restore` | Admin session |

### Public

| Method and path | Purpose |
|---|---|
| `GET /api/health` | `{"ok": true}`. Touches nothing. |
| `GET /api/language` | The whole of `language.yaml` as JSON. |
| `GET /login/{credential}`, `POST /api/login` | The login link's page, and the call it makes. |
| `GET /join/{credential}`, `POST /api/join/info`, `/match`, `/claim`, `/create` | Invite links. |

Any other `/api/` path is a JSON 404.

## MCP

`POST /mcp` speaks the Streamable HTTP transport in its simplest form: stateless, one JSON-RPC message per POST, a plain JSON reply. There is no SSE stream and no session id.

| Rule | Detail |
|---|---|
| Auth | An API key only. A session gets 403, no credential gets 401. |
| Methods | `initialize`, `ping`, `tools/list`, `tools/call`. |
| Protocol versions | `2025-11-25`, `2025-06-18`, `2025-03-26`. If you send `MCP-Protocol-Version`, it must be one of these. |
| Notifications | A message with no `id` gets 202 and is dropped. |
| Batches | Refused. |
| `GET`, `DELETE` | 405. |
| Origin | A cross-origin `Origin` header gets 403. |
| Switching off | `server.mcp: false` or `auth.api_keys: false` removes `/mcp`. |

Any MCP client that can send a header can use it.

### Message shapes

A request:

```json
{"jsonrpc": "2.0", "id": 1, "method": "tools/call",
 "params": {"name": "get_experiment", "arguments": {"experiment_id": "abc123def456"}}}
```

`id` is a string or a number. A successful tool call answers:

```json
{"jsonrpc": "2.0", "id": 1, "result": {
  "content": [{"type": "text", "text": "{...the value as JSON...}"}],
  "structuredContent": {"...": "the value as an object"},
  "isError": false}}
```

A tool that refuses still answers with a `result`, with `isError: true` and `{"error": "reason"}` as the value. Read the reason and try something else. Anything unexpected inside a tool is reported only as `internal error`.

JSON-RPC errors are for calls that never ran:

| Code | Meaning |
|---|---|
| `-32700` | The body is not JSON. |
| `-32600` | Not a valid request, or a batch. |
| `-32601` | Unknown method. |
| `-32602` | Unknown tool, or arguments that do not match. |

Arguments are checked strictly. A missing name, a wrong type or an unknown name is `-32602`, so a misspelt argument is reported rather than ignored. An admin tool called with a user-scoped key answers like a tool that does not exist.

### Tools

`tools/list` gives the JSON Schema of each. The hints are `readOnlyHint` and `destructiveHint`, which are advice for a client. They are not protection.

Any key:

| Tool | Arguments | Answer |
|---|---|---|
| `whoami` | none | As `GET /api/me`. |
| `list_team` | none | `{members}`: id and display name. |
| `list_experiments` | none | `{experiments}`: rows without the document. |
| `get_experiment` | `experiment_id` | The row and `doc`. |
| `save_experiment` | `experiment_id`, `doc`, `base_revision` | `{id, revision, updated_at}`. Send the whole document. Refused if it changed since: read it again and reapply. |
| `experiment_action` | `experiment_id`, `action`, and see below | `{revision}`, with `id` after an add. |
| `list_scanner_cards` | none | `{cards}`: id, label, role, note and revision, no pages. |
| `get_scanner_card` | `card_id` | The whole card and its revision. |
| `create_scanner_card` | `card` | The card, without its pages. Its id comes from its label. |
| `save_scanner_card` | `card_id`, `card`, `base_revision` | The card, without its pages. Replaces it for everyone, and keeps a backup. |
| `set_scanner_parameter` | `card_id`, `page`, `parameter`, `value` | The card, without its pages. Sets one row that already exists; `parameter` ignores case. `value` is a string. Keeps a backup. |
| `scanner_card_revisions` | none | `{revisions}`: each card's id and revision. |
| `list_scanner_card_backups` | `card_id` | `{backups}`: the earlier versions kept when the card was saved over. |
| `restore_scanner_card_backup` | `card_id`, `revision` | The card, without its pages. Makes that backup the card again, for everyone, and keeps what it replaced. |
| `create_experiment` | `doc` | The new experiment's row and `doc`. `doc` needs at least `name` and `format_version` (3); the rest gets its defaults. |
| `experiment_revision` | `experiment_id` | `{revision, updated_by_name}`, as `GET /api/experiments/{id}/revision`. |
| `duplicate_experiment` | `experiment_id`, `name` (optional) | The copy's row and `doc`, owned by you, with its pictures. |
| `set_experiment_editors` | `experiment_id`, `editors` | The row. `editors` is a list of user ids from `list_team`. Owner only. |
| `get_published` | `experiment_id` | The manifest of the last publish, as `GET /api/experiments/{id}/published`. |
| `list_share_links` | `experiment_id` | `{links}`. |
| `revoke_share_link` | `experiment_id`, `link_id` | `{ok}`. The link stops working for good. Destructive. |
| `psychopy_status` | `refresh` (optional) | As `GET /api/psychopy`. |

The template's own account tools are there too (`rename_account`, `set_shortcuts`, `set_themes`, `set_theme`, and for admins the theme defaults). `config/mcp.json` lists every tool with the route it stands for. A route a key may call that has no tool says why in `config/openapi.json` (`x-mcp-http`): pictures, the bundle, the report and published files are files, publishing needs the plans the browser compiles, and the PsychoPy runner's records stay its own HTTP exchange.

Admin-scoped keys only:

| Tool | Arguments | Answer |
|---|---|---|
| `admin_list_users` | none | `{users}`: every account, with its role and which is the owner. |
| `admin_set_user_disabled` | `user_id`, `disabled` | `{ok}`. Reversible. Not for the owner or your own account. |
| `admin_revoke_access` | `user_id` | `{ok, revoked}`. Ends every session and voids every unused login link and key. Not for the owner or your own account. Destructive. |
| `admin_list_invite_links` | none | `{invite_links}`. |
| `admin_revoke_invite_link` | `link_id` | `{ok}`. Cannot be switched back on. Destructive. |

Deliberately missing: creating accounts, login links, invite links, PINs, keys and share links, and deleting anything. Those need a browser session.

### experiment_action

One small edit, without sending the whole document. The same thing is `POST /api/experiments/{id}/action`, with `action` and the other arguments in the JSON body.

An action is `<thing>.<verb>`:

| Thing | Held in | Parent argument | New id starts |
|---|---|---|---|
| `list` | `doc.lists` | | `list_` |
| `item` | `items` of a list | `list` | `i_` |
| `trial` | `doc.trial_types` | | `tt_` |
| `phase` | `phases` of a trial type | `trial` | `ph_` |
| `run` | `doc.runs` | | `run_` |
| `block` | `blocks` of a run | `run` | `b_` |
| `session` | `doc.sessions` | | `ses_` |
| `step` | `steps` of a session | `session` | `st_` |

| Verb | Arguments | What it does |
|---|---|---|
| `add` | parent, `fields` | Adds it at the end. Answers its `id`. |
| `update` | parent, `id`, `fields` | Only the fields given change. |
| `delete` | parent, `id` | Removes it. Refused while something uses it. |
| `move` | parent, `id`, `position` | Moves it. `position` counts from 0. |

That makes 32 actions, and there are two more:

| Action | Arguments | What it does |
|---|---|---|
| `settings.update` | `section`, `fields` | Merges fields into `doc.<section>`. Sections: `scanner`, `display`, `keys`, `budget`, `limits`, `hrf`, `jitter`, `fixation`, `meta`. |
| `experiment.update` | `fields` | Sets `name` and `notes`, and nothing else. |

Rules:

- `delete` is refused with `still used by ...` for a list a trial type draws from, a trial type a run uses, and a run a session uses. Other things have no such check.
- `fields` must be an object and cannot hold `id`.
- The server does not interpret a design. Fields go in as given.
- A new thing needs only the fields you care about. `static/js/schema.js` fills in everything else, and corrects wrong types, the next time the document is opened. A reference to something that does not exist shows up under **Things to fix**.
- Each action is one save. If it loses a race with another save, it is tried again against the newer document, up to 3 times, and then refused.

A `settings.update` on `jitter` needs no more than that. A duration set to inherit takes its kind, p, scale and cap from `doc.jitter` when the document is next opened.

### Worked example: read an experiment

```bash
curl -sS "$BASE/mcp" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"get_experiment","arguments":{"experiment_id":"'"$EXP"'"}}}' \
  | jq '.result.structuredContent | {name, revision, tr: .doc.scanner.tr, runs: [.doc.runs[].name]}'
```

The same read over HTTP:

```bash
curl -sS "$BASE/api/experiments/$EXP" -H "Authorization: Bearer $KEY" | jq '.revision'
```

### Worked example: make one change

Add a phase to a trial type, then change the design's TR. The trial type's id comes from `doc.trial_types[].id`.

```bash
curl -sS "$BASE/mcp" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"experiment_action","arguments":{
         "experiment_id":"'"$EXP"'",
         "action":"phase.add",
         "trial":"tt_abc123",
         "fields":{"name":"Rest","duration":{"kind":"fixed","value":2}}}}}' \
  | jq '.result.structuredContent'
```

```json
{"id": "ph_x1y2z3a4", "revision": 18}
```

```bash
curl -sS -X POST "$BASE/api/experiments/$EXP/action" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"settings.update","section":"scanner","fields":{"tr":1.5}}'
```

Anyone with the experiment open in a browser sees the change within a few seconds.

## Published addresses

Publish puts a design's run plans and figures at addresses that do not change, for a runner to fetch or a page to link to. They serve what was last published, not the current design.

```
/api/experiments/{id}/published                     the manifest
/api/experiments/{id}/published/plans/{label}.json  one run plan
/api/experiments/{id}/published/figures/{name}.svg  one figure
/api/experiments/{id}/published/figures/{name}.png  the same, where the browser could draw a PNG
/api/experiments/{id}/media/{sha}.{ext}             a picture a plan uses
```

Reading needs a session or a key, and access to the experiment. Responses say `cache-control: no-cache`. An SVG also carries a content security policy that gives it no scripts and no way to reach anything.

### The manifest

```json
{
  "experiment_id": "abc123def456",
  "version": "k3Jd9xQ2mNpL",
  "published_at": "2026-11-05T14:15:22.481903+00:00",
  "published_by": 1,
  "published_by_name": "Ada",
  "revision": 17,
  "current_revision": 18,
  "seed": 482913077,
  "plans": [
    {"label": "run-01", "run": "run_abc", "name": "Main run", "total_seconds": 312.5,
     "volumes": 161, "media": {"<sha256>": {"ext": "png", "w": 800, "h": 600}}},
    {"label": "ses-01_run-01", "run": "run_abc", "name": "Main run", "total_seconds": 318.0,
     "volumes": 163, "media": {}, "session": {"id": "ses_abc", "name": "Scan session"}}
  ],
  "figures": ["overview.png", "overview.svg", "run-main-run.svg", "trial-cue.svg"]
}
```

`revision` is the design revision that was published. `current_revision` is where the design is now. If they differ, the design has changed since.

### Labels and figure names

| Plan | Label |
|---|---|
| A run on its own | `run-NN`, its place in `doc.runs`. |
| A run in a session | `ses-VV_run-NN`. `VV` is the session's place in `doc.sessions`, and `NN` is the run's place in that session. |

Figures are named `overview`, `trial-<name>`, `run-<name>`, `session-<name>`, `hrf` and `efficiency-<run>`. Each name is lower-cased, with anything but letters and digits turned into `-`, and cut to 60 characters. Use the manifest rather than building names by hand.

### Publishing

Only a browser can compile a plan or draw a figure, so `POST /api/experiments/{id}/publish` takes what the browser made. It arrives in parts, because the whole can be larger than one request may be.

| Body field | Meaning |
|---|---|
| `version` | Empty on the first part. The answer gives the version; send it on every later part. |
| `plans` | Run plans for this part, checked as below. |
| `figures` | `[{name, svg, png}]` for this part. `png` is base64 and optional. |
| `finish` | `true` on the last part. Only this makes it the published copy. |
| `seed` | The seed, for the manifest: the design's locked order, `doc.schedule.seed`. |

A publish that fails half way changes nothing. A new publish replaces an abandoned one. Anyone who can edit the experiment can publish. The limits are 512 plans, 200 figures and 512 MiB in all.

## The design document

An experiment is one JSON document. Everything refers to everything else by id, never by name or position. The comment at the top of `static/js/schema.js` is the source; `normalise()` there holds every default and range.

The current `format_version` is 3. A document from a newer version will not open. An older one is upgraded on opening (`Schema.migrate`).

| Key | Holds |
|---|---|
| `format_version`, `name`, `notes` | |
| `meta` | `investigator`, `institution`, `design_id`: who the exports say it is. |
| `schedule` | `seed` (0: no order locked yet), `shuffled_at`, `shuffled_by`. The run dialog and Publish compile with this seed. |
| `scanner` | `tr` (default 2), `trigger_key` (`"5"`), `dummy_volumes` (4), `t0` (`last_dummy`, `after_dummies` or `first_pulse`: what the run clock starts on). |
| `display` | `background`, `text_color`, `font`, `aspect` (1.6). |
| `fixation` | `layers[]`: the one fixation mark, which a `fixation` layer shows. |
| `jitter` | `mode` (`geometric`, `uniform`, `exponential`), `p`, `scale`, `cap_trs`: how a jittered phase waits unless it says otherwise. |
| `keys` | `quit` and `advance` key names, in PsychoPy's names. |
| `budget` | `hours_available`, `participants`, `count_overhead`, `sessions_per_week`, `weeks_available` (0 means not set). |
| `limits` | `max_run_minutes`, `max_session_minutes`, `max_runs_per_session`. Warnings only. 0 means none. |
| `hrf` | `peak_delay`, `peak_dispersion`, `undershoot_delay`, `undershoot_dispersion`, `undershoot_ratio`, `span`. |
| `media[]` | `{id (sha256), name, ext, mime, w, h, size, source_url}`. |
| `lists[]` | `{id, name, notes, columns[{key, label, type}], items[{id, values{}}]}`. `type` is `text`, `image` or `number`. |
| `trial_types[]` | See below. |
| `runs[]` | See below. |
| `sessions[]` | See below. |

A trial type:

```json
{"id": "tt_...", "name": "", "notes": "", "color": "#4c78a8",
 "list": "list_...", "filter": {"column": "", "values": []},
 "order": "shuffle", "balance_by": "", "balance_pct": 50, "no_repeat": "session",
 "phases": [{"id": "ph_...", "name": "", "duration": {}, "layers": [],
             "response": {"keys": [], "ends_phase": false,
                          "correct": {"column": "", "key": "", "map": {}}},
             "modelled": false}]}
```

`order` is `shuffle` or `sequential`. `no_repeat` is `session`, `run` or `none`. A `filter` narrows the list to items whose column holds one of `values`; an empty column means every item. A phase that is `modelled` is one regressor. A phase's `response.correct` is the key it expects, for scoring: `key` alone for one fixed key, or `column` with `map` from each value of that list column to a key (`{"column": "answer", "map": {"yes": "1", "no": "2"}}`). A value with no key, or a key the phase does not record, is not scored.

A duration:

```json
{"kind": "geometric", "value": 1, "min": 2, "max": 6, "p": 0.5, "scale": 0.5,
 "cap_trs": 0, "snap_to_tr": false, "inherit": true}
```

`kind` is `fixed`, `geometric`, `uniform` or `exponential`. With `inherit` set, the kind, p, scale and cap come from `doc.jitter`. Only `min` and `max` are the duration's own.

A layer has `id`, `kind` and `pos: [x, y]`, in screen heights:

| `kind` | Fields |
|---|---|
| `text` | `text`, `height`, `color`, `wrap`, `bold` |
| `image` | `media` (a sha256 or `{column}`), `height`, `fit` |
| `shape` | `shape` (`circle`, `square`, `triangle`, `diamond`, `cross`, `polygon`), `sides`, `size`, `color`, `fill`, `ori`, `line_width` |
| `fixation` | Nothing else. It shows `doc.fixation`. |

A layer's text and picture may be a literal or `{column}`, filled from the trial's item. One that comes out empty is not drawn. An empty `color` means the display's text color.

A run:

```json
{"id": "run_...", "name": "", "notes": "", "tr": 0, "dummy_volumes": -1, "card": null,
 "instructions": {"enabled": true, "layers": []},
 "lead_in": {"seconds": 10, "layers": [], "jitter": null},
 "lead_out": {"seconds": 10, "layers": [], "jitter": null},
 "blocks": [{"id": "b_...", "name": "", "repeat": 1, "order": "shuffle",
             "mix": [{"trial_type": "tt_...", "count": 10}],
             "rest_after": {"seconds": 0, "layers": []}}]}
```

`tr: 0` and `dummy_volumes: -1` mean the experiment's settings. A block's `order` is `shuffle`, `fixed` or `alternate`. A lead's `jitter` is a duration, or null for its `seconds`.

A session:

```json
{"id": "ses_...", "name": "", "notes": "", "count": 1, "auto_break_minutes": 0,
 "steps": [{"id": "st_...", "kind": "run", "run": "run_...", "name": "", "minutes": 5,
            "card": null, "enabled": true, "repeat": 1}]}
```

`kind` is `run`, `scan` or `break`. `count` is how many of this session each participant does. `auto_break_minutes` puts a break between two run steps that sit next to each other. `enabled: false` keeps a step in the list, but it takes no time and does not play. `repeat` is 1 to 100.

`card`, on a run or a scan step, is a snapshot: the card's `id`, `label`, `tr`, `seconds` and a few other numbers. Nothing else needs the library to read the document.

## The run plan

A plan is one run with everything decided: every onset, every jittered duration, every prompt item, every layer. `app/models/plans.py` is the closed definition. An unknown key or a wrong type is refused, and the check names the first thing wrong.

The format is `fmri-run-plan/1`. A change a runner could misread bumps it, and the runner refuses a plan it does not know. An optional key that only labels or describes (`block`, `visit`, `pilot_blocks`, `scanner.t0`) does not bump it.

### Top level

| Key | Required | Type |
|---|---|---|
| `format` | yes | `"fmri-run-plan/1"` |
| `experiment` | yes | `{id, name}` |
| `run` | yes | `{id, name, label}`. `label` must be letters, digits, `-`, `_` and `.`, at most 64, for a bundle, a launch or a publish. |
| `participant` | yes | String, at most 64. May be empty. |
| `seed` | yes | Whole number, 0 to 2^53. |
| `created` | yes | String, at most 40. |
| `scanner` | yes | See below. |
| `display` | yes | `{background, text_color, font}`. Colors are `#rrggbb`. |
| `keys` | yes | `{quit: [...], advance: [...]}`. At most 20 names each. |
| `segments` | yes | 1 to 20000. See below. |
| `total_seconds` | yes | Number, 0 to 21600. |
| `volumes` | yes | Whole number: the pulses to expect. `dummy_volumes` plus the TRs that `total_seconds` covers, rounded up, less one under `after_dummies`, whose t0 pulse is itself a real volume. |
| `media` | yes | `{sha256: {ext, w, h}}`. `ext` is `png`, `jpg`, `gif` or `webp`. At most 10000. |
| `session` | no | `{id, name}`. |
| `visit` | no | 1 to 999. |
| `pilot_blocks` | no | How many blocks were kept, when the run was shortened. |
| `break_after` | no | Seconds of break planned after this run. |
| `revision` | no | The design revision this was compiled from. |

### scanner

| Key | Required | Meaning |
|---|---|---|
| `tr` | yes | 0.05 to 30 seconds. |
| `trigger_key` | yes | A key name like `5` or `t`. |
| `dummy_volumes` | yes | Pulses to wait for, 0 to 1000. A player waits for at least one. t0 is the last. |
| `wait` | yes | Boolean. False for a plan compiled with no scanner. The players take the mode from their own options, not from this. |
| `t0` | no | `"after_dummies"` or `"first_pulse"`. Says why `dummy_volumes` is one more than the design's, or 0. That number is what makes a player start on the chosen pulse. |

### Segments

| Key | Required | Meaning |
|---|---|---|
| `onset` | yes | Seconds from t0. |
| `duration` | yes | Seconds. |
| `kind` | yes | `instructions`, `lead_in`, `phase`, `rest` or `lead_out`. |
| `label` | yes | The screen's name, at most 200. |
| `layers` | yes | At most 32. |
| `trial`, `block` | no | Numbers from 0. |
| `trial_type`, `phase` | no | Names. |
| `item`, `item_label` | no | The drawn item's id, and its text. |
| `item_values` | no | `{column key: text}`, at most 32. The text and number columns, for the results. |
| `response` | no | `{keys: [...], ends_phase, correct}`. `correct`, when present, is the key this screen expects, already worked out for its item. |

An `instructions` segment comes before t0, has onset and duration 0, and is shown until a continue key. Other segments must run forward on one clock: a segment cannot start before the one before it ends, to within 1 ms.

### Layers

A plan holds only what is drawn. A `fixation` layer has become the mark's layers, `{column}` values are filled in, and empty layers are gone.

| `kind` | Required | Optional |
|---|---|---|
| `text` | `pos`, `text`, `height`, `color` | `font`, `wrap`, `bold` |
| `image` | `pos`, `media`, `height` | `width`. Without it, the picture's own shape sets the width. |
| `shape` | `pos`, `shape`, `size`, `color` | `sides`, `fill`, `ori`, `line_width` |

`media` is a sha256 that must be in `plan.media`, so a plan cannot point the runner at a path of its own choosing. Nothing in a plan is ever evaluated.

Sizes are in screen heights, as in PsychoPy's height units: the screen is 1 tall and the middle is 0,0. `pos` is centred on the layer. `size` is the circle's diameter, the square's side, or the polygon's corner-to-corner span. `ori` is degrees clockwise.

Text may be at most 2000 characters. A bundle or a launch takes 1 to 64 plans, and labels must not repeat.
