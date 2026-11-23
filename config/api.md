# fMRI Experiment Designer API

Every route this server answers, apart from the pages at /login/*, /join/*, /docs/* and /s/*. Generated from the code by scripts/api_docs.sh: an app's own routes get their docs the same way, and a test fails until they do.

This file is generated: do not edit it. Change the docs next to the handlers and run `scripts/api_docs.sh`.

## Contents

- [Calling the API](#calling-the-api)
- [Errors](#errors)
- [Account](#account)
- [Sign-in](#sign-in)
- [API keys](#api-keys)
- [Files](#files)
- [Admin](#admin)
- [Invite links](#invite-links)
- [Owner](#owner)
- [Webhooks](#webhooks)
- [Monitoring](#monitoring)
- [Experiments](#experiments)
- [Scanner cards](#scanner-cards)
- [Share links](#share-links)
- [Schemas](#schemas)

## Calling the API

| Way in | How |
|---|---|
| Browser session | A browser session. Its POSTs carry csrf_token in the body. The cookie's name is server.cookie_name, with the __Host- prefix while server.secure_cookies is on. |
| API key | An API key, as Authorization: Bearer <id>.<secret>. |

## Errors

An error reply is a JSON object whose `error` says what went wrong.

| Status | Meaning | Body |
|---|---|---|
| 400 | The request was refused as it stands. | [`Error`](#error) |
| 401 | Not signed in. | [`Error`](#error) |
| 403 | Not allowed, or a bad csrf_token. | [`Error`](#error) |
| 404 | No such thing, or this feature is switched off. | [`Error`](#error) |
| 409 | The record has moved on: an undo too late, or a stale edit. | [`Error`](#error) |
| 429 | Too many requests. | [`Error`](#error) |
| 503 | In maintenance mode. Retry-After says when to try again. | [`Maintenance`](#maintenance) |

## Account

| Method | Path | Summary | Who may call |
|---|---|---|---|
| POST | [`/api/account/login-link`](#post-apiaccountlogin-link) | A login link for yourself | browser session or API key, anyone signed in |
| POST | [`/api/account/login-link/cancel`](#post-apiaccountlogin-linkcancel) | Stop your own login link working | browser session or API key, anyone signed in |
| POST | [`/api/account/password`](#post-apiaccountpassword) | Set or clear your password | browser session only, anyone signed in |
| POST | [`/api/account/pin`](#post-apiaccountpin) | Set or clear your PIN | browser session only, anyone signed in |
| POST | [`/api/account/rename`](#post-apiaccountrename) | Rename your account | browser session or API key, anyone signed in |
| GET | [`/api/account/sessions`](#get-apiaccountsessions) | Your signed-in devices | browser session or API key, anyone signed in |
| POST | [`/api/account/sessions/revoke-others`](#post-apiaccountsessionsrevoke-others) | Sign out every other device | browser session or API key, anyone signed in |
| POST | [`/api/account/sessions/{session_id}/label`](#post-apiaccountsessionssession_idlabel) | Name one of your devices | browser session or API key, anyone signed in |
| POST | [`/api/account/sessions/{session_id}/revoke`](#post-apiaccountsessionssession_idrevoke) | Sign out one of your devices | browser session or API key, anyone signed in |
| POST | [`/api/account/shortcuts`](#post-apiaccountshortcuts) | Change your keyboard shortcuts | browser session or API key, anyone signed in |
| POST | [`/api/account/theme`](#post-apiaccounttheme) | Pick your theme | browser session or API key, anyone signed in |
| POST | [`/api/account/themes`](#post-apiaccountthemes) | Replace your own themes | browser session or API key, anyone signed in |
| POST | [`/api/account/two-factor/confirm`](#post-apiaccounttwo-factorconfirm) | Turn two-factor on | browser session only, anyone signed in |
| POST | [`/api/account/two-factor/disable`](#post-apiaccounttwo-factordisable) | Turn two-factor off | browser session only, anyone signed in |
| POST | [`/api/account/two-factor/start`](#post-apiaccounttwo-factorstart) | Begin two-factor setup | browser session only, anyone signed in |
| POST | [`/api/bulk/account/sessions/revoke`](#post-apibulkaccountsessionsrevoke) | Sign out one of your devices, for many at once | browser session or API key, anyone signed in |
| GET | [`/api/language`](#get-apilanguage) | The UI's text | anyone |
| POST | [`/api/logout`](#post-apilogout) | Sign out | browser session or API key, anyone signed in |
| POST | [`/api/logs/events`](#post-apilogsevents) | Record what happened on the page | browser session or API key, anyone signed in |
| GET | [`/api/me`](#get-apime) | Who am I | browser session or API key, anyone signed in |
| GET | [`/api/team`](#get-apiteam) | List team | browser session or API key, anyone signed in |

### POST /api/account/login-link

A login link for yourself

A link that signs your own account in on a browser or another device. An API key may ask only if your account let it, from a browser session (POST /api/keys/{key_id}/sign-in); its link works once, for at most 15 minutes.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`create_my_login_link`](mcp.md#create_my_login_link) |
| Errors | 400, 401, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `expires_in_minutes` | integer or null | no | 0 to 525600 | 0 never expires. Default auth.login_token_ttl_seconds for a link that works once, auth.multi_use_login_token_ttl_seconds otherwise. |
| `max_uses` | integer or null | no | 0 to 1000 | Sign-ins the link allows: 1-1000, or 0 for unlimited. Default 1. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `expires_at` | string (date-time) or null | yes |  | null when it never expires. |
| `expires_in_seconds` | integer | yes |  | 0 when it never expires. |
| `login_path` | string | yes |  | Path of the login link. A credential: treat it like a password. |
| `max_uses` | integer | yes |  | 0 when unlimited. |
| `unlimited` | boolean | yes |  |  |

### POST /api/account/login-link/cancel

Stop your own login link working

Void your account's live login link without making a new one. Devices it already signed in stay signed in. Answers with removed: 0 or 1.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`cancel_my_login_link`](mcp.md#cancel_my_login_link) |
| Errors | 400, 401, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |
| `removed` | integer | yes |  | Links removed: 0 or 1. |

### POST /api/account/password

Set or clear your password

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `code` | string | no |  |  |
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `password_digest` | string | yes |  |  |
| `username` | string | yes |  |  |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `has_password` | boolean | yes |  |  |
| `ok` | boolean | yes |  |  |

### POST /api/account/pin

Set or clear your PIN

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `pin` | string | yes |  |  |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `has_pin` | boolean | yes |  |  |
| `ok` | boolean | yes |  |  |

### POST /api/account/rename

Rename your account

Change your own display name (1-80 characters). expect, when given, is the name you think it has now; if someone changed it meanwhile the rename is refused with the current name, so nothing is overwritten unseen.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`rename_account`](mcp.md#rename_account) |
| Errors | 400, 401, 403, 409, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `display_name` | string | yes | 1 to 80 characters |  |
| `expect` | string or null | no |  |  |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `display_name` | string | yes |  |  |
| `ok` | boolean | yes |  |  |

### GET /api/account/sessions

Your signed-in devices

Where your account is signed in, a page at a time: id, when it started and was last seen, the browser, and the name you gave it. Through an API key no device is current. next is the offset of the following page, or null on the last one.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`list_my_sessions`](mcp.md#list_my_sessions) |
| Errors | 400, 401, 403, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `limit` | query | integer | no | 1 to 1000; default `200` | Rows to return. Default 200. |
| `offset` | query | integer | no | at least 0 | Rows to skip: the next value of the previous page. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `next` | integer or null | yes |  | Offset of the next page, or null on the last one. |
| `sessions` | array of [`Session`](#session) | yes |  |  |
| `total` | integer | yes |  |  |

### POST /api/account/sessions/revoke-others

Sign out every other device

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`revoke_my_other_sessions`](mcp.md#revoke_my_other_sessions) |
| Errors | 400, 401, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |
| `removed` | integer | yes |  |  |

### POST /api/account/sessions/{session_id}/label

Name one of your devices

Give one of your devices a name (at most 80 characters; empty clears it). expect, when given, is the name you think it has now.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`label_my_session`](mcp.md#label_my_session) |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `session_id` | path | string | yes |  | The device's id, from GET /api/account/sessions or GET /api/admin/users/{user_id}/sessions (list_my_sessions or admin_list_user_sessions over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `expect` | string or null | no |  | The name you think it has. Answers 409 if it has another. |
| `label` | string | yes | at most 80 characters | At most 80 characters. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `label` | string | yes |  |  |
| `ok` | boolean | yes |  |  |

### POST /api/account/sessions/{session_id}/revoke

Sign out one of your devices

End one of your signed-in sessions; that browser has to sign in again.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`revoke_my_session`](mcp.md#revoke_my_session) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `session_id` | path | string | yes |  | The device's id, from GET /api/account/sessions or GET /api/admin/users/{user_id}/sessions (list_my_sessions or admin_list_user_sessions over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### POST /api/account/shortcuts

Change your keyboard shortcuts

Replace your changed keyboard shortcuts: action name to binding, such as "search": "Mod+K" (Mod is Cmd on a Mac, Ctrl elsewhere). Send the whole set; an empty binding switches a key off, and {} puts every key back to its default.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`set_shortcuts`](mcp.md#set_shortcuts) |
| Errors | 400, 401, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `shortcuts` | map of string | yes |  | Action name to binding, such as "search": "Mod+K". Mod is Cmd on a Mac and Ctrl elsewhere. Only changed shortcuts are listed; an empty binding switches that key off. Replaces the whole set; {} puts every key back to its default. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |
| `shortcuts` | map of string | yes |  |  |

### POST /api/account/theme

Pick your theme

Switch to another theme from your list (or the defaults), by its id.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`set_theme`](mcp.md#set_theme) |
| Errors | 400, 401, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `theme_id` | string | yes |  | A theme's id. Empty for the first in the list. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |
| `theme_id` | string | yes |  |  |

### POST /api/account/themes

Replace your own themes

Replace your whole list of color themes (1 to 40) and pick the one you use. themes: null goes back to following the app's defaults. A theme is the Theme schema in the API reference (config/api.json): id, name, mode light|dark, accent, second, and optional colors as #rrggbb.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`set_themes`](mcp.md#set_themes) |
| Errors | 400, 401, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `builtins` | integer | no |  | Which built-in themes this list has seen: the highest since in Theme.builtIn (static/js/theme.js) when it was saved. Built-in themes added after that join the list the browser shows. Left out: 0, the first ones. |
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `theme_id` | string | no |  | The theme you use. |
| `themes` | array of [`Theme`](#theme) or null | no |  | Your whole list, 1 to 40 themes. null goes back to following the app's defaults. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |
| `theme_id` | string | yes |  |  |
| `themes` | array of [`Theme`](#theme) or null | yes |  | What you now see; null while the built-in themes apply. |
| `themes_builtins` | integer | yes |  | Which built-in themes that list has seen (see builtins on POST /api/account/themes). |
| `themes_custom` | boolean | yes |  |  |

### POST /api/account/two-factor/confirm

Turn two-factor on

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `code` | string | yes |  |  |
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `recovery_codes` | array of string | yes |  |  |

### POST /api/account/two-factor/disable

Turn two-factor off

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `code` | string | yes |  |  |
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### POST /api/account/two-factor/start

Begin two-factor setup

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `secret` | string | yes |  |  |

### POST /api/bulk/account/sessions/revoke

Sign out one of your devices, for many at once

Runs POST /api/account/sessions/{session_id}/revoke once per item: items holds each one's id and fields, shared the fields they have in common (an item's own win). Each runs as that route would, in order, and one failing does not stop the rest; the reply says how each went. At most 100 items.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`revoke_my_session_bulk`](mcp.md#revoke_my_session_bulk) |
| Errors | 400, 401, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `items` | array of object | yes |  | One entry per thing to change: its id, and any field that differs from shared. |
| `items[].session_id` | string | yes |  | The device's id, from GET /api/account/sessions or GET /api/admin/users/{user_id}/sessions (list_my_sessions or admin_list_user_sessions over MCP). |
| `shared` | object | no |  | Fields every item gets, unless the item sets its own. |

**Reply 200**: Success

[`BulkReply`](#bulkreply).

### GET /api/language

The UI's text

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 429, 503 |

**Reply 200**: Success

An empty object.

### POST /api/logout

Sign out

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: Ends a browser session; a key has none to end. |
| Errors | 400, 401, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### POST /api/logs/events

Record what happened on the page

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: The browser's own activity reports (track.js), not an action. |
| Errors | 400, 401, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `events` | array of object | yes |  |  |
| `tab` | string | yes |  |  |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `accepted` | integer | yes |  |  |

### GET /api/me

Who am I

The account this API key belongs to, the role it acts with (role -- never higher than the key's own scope), and the account's own role.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`whoami`](mcp.md#whoami) |
| Errors | 401, 429, 503 |

**Reply 200**: Success

[`Me`](#me).

### GET /api/team

List team

People with an active account, a page at a time: id and display name.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`list_team`](mcp.md#list_team) |
| Errors | 400, 401, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `limit` | query | integer | no | 1 to 1000; default `200` | Rows to return. Default 200. |
| `offset` | query | integer | no | at least 0 | Rows to skip: the next value of the previous page. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `members` | array of [`Member`](#member) | yes |  |  |
| `next` | integer or null | yes |  | Offset of the next page, or null on the last one. |
| `total` | integer | yes |  |  |

## Sign-in

| Method | Path | Summary | Who may call |
|---|---|---|---|
| POST | [`/api/login`](#post-apilogin) | Redeem a login link | anyone |
| GET | [`/api/login/options`](#get-apiloginoptions) | What sign-in offers | anyone |
| POST | [`/api/login/password`](#post-apiloginpassword) | Sign in with a password | anyone |
| POST | [`/api/login/two-factor`](#post-apilogintwo-factor) | Finish a sign-in with a code | anyone |

### POST /api/login

Redeem a login link

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 400, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `credential` | string | yes |  |  |

**Reply 200**: Success

[`SignIn`](#signin).

### GET /api/login/options

What sign-in offers

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 429, 503 |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `passwords` | boolean | yes |  |  |
| `salt` | string | no |  |  |
| `two_factor` | boolean | yes |  |  |

### POST /api/login/password

Sign in with a password

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 400, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `password_digest` | string | yes |  |  |
| `username` | string | yes |  |  |

**Reply 200**: Success

[`SignIn`](#signin).

### POST /api/login/two-factor

Finish a sign-in with a code

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 400, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `challenge` | string | yes |  |  |
| `code` | string | yes |  |  |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

## API keys

| Method | Path | Summary | Who may call |
|---|---|---|---|
| GET | [`/api/admin/keys`](#get-apiadminkeys) | Every key in the app | browser session only, admins |
| POST | [`/api/admin/keys`](#post-apiadminkeys) | Create a key that acts as someone else | browser session only, admins |
| POST | [`/api/admin/keys/{key_id}/delete`](#post-apiadminkeyskey_iddelete) | Delete anyone's key | browser session only, admins |
| POST | [`/api/admin/keys/{key_id}/expiry`](#post-apiadminkeyskey_idexpiry) | Change when anyone's key expires | browser session only, admins |
| POST | [`/api/admin/keys/{key_id}/rename`](#post-apiadminkeyskey_idrename) | Rename anyone's key | browser session only, admins |
| POST | [`/api/admin/keys/{key_id}/restore`](#post-apiadminkeyskey_idrestore) | Undo deleting anyone's key | browser session only, admins |
| POST | [`/api/admin/keys/{key_id}/revoke`](#post-apiadminkeyskey_idrevoke) | Revoke anyone's key | browser session or API key, admins |
| GET | [`/api/admin/users/{user_id}/keys`](#get-apiadminusersuser_idkeys) | An account's keys | browser session or API key, admins |
| POST | [`/api/admin/users/{user_id}/keys`](#post-apiadminusersuser_idkeys) | Make a key for an account | browser session or API key, admins |
| GET | [`/api/keys`](#get-apikeys) | Your API keys | browser session only, anyone signed in |
| POST | [`/api/keys`](#post-apikeys) | Create an API key | browser session only, anyone signed in |
| POST | [`/api/keys/self/rotate`](#post-apikeysselfrotate) | Rotate the calling key | API key only, anyone signed in |
| POST | [`/api/keys/{key_id}/delete`](#post-apikeyskey_iddelete) | Delete one of your keys | browser session only, anyone signed in |
| POST | [`/api/keys/{key_id}/expiry`](#post-apikeyskey_idexpiry) | Change when one of your keys expires | browser session only, anyone signed in |
| POST | [`/api/keys/{key_id}/mint-keys`](#post-apikeyskey_idmint-keys) | Let one of your keys make keys | browser session only, anyone signed in |
| POST | [`/api/keys/{key_id}/rename`](#post-apikeyskey_idrename) | Rename one of your keys | browser session only, anyone signed in |
| POST | [`/api/keys/{key_id}/restore`](#post-apikeyskey_idrestore) | Undo deleting one of your keys | browser session only, anyone signed in |
| POST | [`/api/keys/{key_id}/revoke`](#post-apikeyskey_idrevoke) | Revoke one of your keys | browser session only, anyone signed in |
| POST | [`/api/keys/{key_id}/rotate`](#post-apikeyskey_idrotate) | Rotate one of your keys | browser session only, anyone signed in |
| POST | [`/api/keys/{key_id}/sign-in`](#post-apikeyskey_idsign-in) | Let one of your keys make sign-in links | browser session only, anyone signed in |

### GET /api/admin/keys

Every key in the app

|  |  |
|---|---|
| Who may call | browser session only, admins |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `limit` | query | integer | no | 1 to 1000; default `200` | Rows to return. Default 200. |
| `offset` | query | integer | no | at least 0 | Rows to skip: the next value of the previous page. |
| `q` | query | string | no |  | Keep keys whose name or owner contains this, in any case. |
| `live` | query | string | no | one of `true` | Leave out revoked and expired keys. |
| `sort` | query | string | no | one of `display_name`, `name`, `role`, `last_used_at`, `expires_at`, `created_at` | Field to sort the whole list by. Rows without it go last. |
| `dir` | query | string | no | one of `asc`, `desc` | Default asc. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `keys` | array of [`APIKey`](#apikey) | yes |  |  |
| `next` | integer or null | yes |  | Offset of the next page, or null on the last one. |
| `total` | integer | yes |  |  |

### POST /api/admin/keys

Create a key that acts as someone else

Any admin may do this for an ordinary user, and only the owner for another admin. Nobody may do it for the owner. The key records who made it and shows that to the person it acts as.

|  |  |
|---|---|
| Who may call | browser session only, admins |
| Errors | 400, 401, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `expires_in_days` | integer or null | no | 0 to 3650 | Absent or null: the configured default. 0: never expires. |
| `name` | string | yes | 1 to 80 characters |  |
| `role` | string | no | one of `admin`, `user`, `viewer`; default `user` |  |
| `user_id` | integer | yes | at least 1 |  |

**Reply 201**: Success

[`NewAPIKey`](#newapikey).

### POST /api/admin/keys/{key_id}/delete

Delete anyone's key

|  |  |
|---|---|
| Who may call | browser session only, admins |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `key_id` | path | string | yes |  | The key's id, from GET /api/keys (GET /api/admin/keys for anyone's). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### POST /api/admin/keys/{key_id}/expiry

Change when anyone's key expires

|  |  |
|---|---|
| Who may call | browser session only, admins |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `key_id` | path | string | yes |  | The key's id, from GET /api/keys (GET /api/admin/keys for anyone's). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `expires_in_days` | integer | yes | 0 to 3650 | Counted from now. 0 means it never expires. |

**Reply 200**: Success

[`APIKey`](#apikey).

### POST /api/admin/keys/{key_id}/rename

Rename anyone's key

|  |  |
|---|---|
| Who may call | browser session only, admins |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `key_id` | path | string | yes |  | The key's id, from GET /api/keys (GET /api/admin/keys for anyone's). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `expect` | string or null | no |  | The name you think it has. Answers 409 if it has another. |
| `name` | string | yes | 1 to 80 characters | 1-80 characters. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `name` | string | yes |  |  |
| `ok` | boolean | yes |  |  |

### POST /api/admin/keys/{key_id}/restore

Undo deleting anyone's key

|  |  |
|---|---|
| Who may call | browser session only, admins |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `key_id` | path | string | yes |  | The key's id, from GET /api/keys (GET /api/admin/keys for anyone's). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

[`APIKey`](#apikey).

### POST /api/admin/keys/{key_id}/revoke

Revoke anyone's key

Stops the key at once, and every key it made, down the chain. Needs a browser session or a key with may_mint_keys (any other key gets 403 key_minting_off), which may not revoke the owner's keys.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | None, HTTP only: Manages API keys, which no MCP tool does. |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `key_id` | path | string | yes |  | The key's id, from GET /api/keys (GET /api/admin/keys for anyone's). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### GET /api/admin/users/{user_id}/keys

An account's keys

One account's keys, revoked and expired ones included, newest first. Each row says which key minted it (minted_by_key, empty when a person made it). Needs a browser session or a key with may_mint_keys; any other key gets 403 key_minting_off. Follows the owner ladder: nobody lists the owner's keys this way, and only the owner lists another admin's.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | None, HTTP only: Manages API keys, which no MCP tool does. |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `user_id` | path | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `keys` | array of [`APIKey`](#apikey) | yes |  |  |

### POST /api/admin/users/{user_id}/keys

Make a key for an account

Needs a browser session or a key the owner allowed to make keys (may_mint_keys); any other key gets 403 key_minting_off. The role is capped at the account's own; expires_in_days is required (1-365). Never for the owner. The new key records the key that made it, can never make keys or sign-in links itself, and is revoked when that key is revoked or deleted. Answers with the key and its credential, shown only now.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | None, HTTP only: Makes an API key, which no MCP tool does. |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `user_id` | path | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `expires_in_days` | integer | yes | 1 to 365 | Required: 1-365. A minted key always expires. |
| `name` | string | yes | 1 to 80 characters |  |
| `role` | string | yes | one of `admin`, `user`, `viewer` | Capped at the account's own role. |

**Reply 201**: Success

[`NewAPIKey`](#newapikey).

### GET /api/keys

Your API keys

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `limit` | query | integer | no | 1 to 1000; default `200` | Rows to return. Default 200. |
| `offset` | query | integer | no | at least 0 | Rows to skip: the next value of the previous page. |
| `q` | query | string | no |  | Keep keys whose name contains this, in any case. |
| `live` | query | string | no | one of `true` | Leave out revoked and expired keys. |
| `sort` | query | string | no | one of `name`, `role`, `last_used_at`, `expires_at`, `created_at` | Field to sort the whole list by. Rows without it go last. |
| `dir` | query | string | no | one of `asc`, `desc` | Default asc. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `keys` | array of [`APIKey`](#apikey) | yes |  |  |
| `next` | integer or null | yes |  | Offset of the next page, or null on the last one. |
| `total` | integer | yes |  |  |

### POST /api/keys

Create an API key

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `expires_in_days` | integer or null | no | 0 to 3650 | Absent or null: the configured default. 0: never expires. |
| `name` | string | yes | 1 to 80 characters |  |
| `role` | string | no | one of `admin`, `user`, `viewer`; default `user` |  |

**Reply 201**: Success

[`NewAPIKey`](#newapikey).

### POST /api/keys/self/rotate

Rotate the calling key

Gives the calling key a new secret and answers its new credential, shown only now. The old secret stops working at once. The key's id, name, role, grants, lineage and expiry stay as they are, so the keys and links it made keep working; rotating never extends the expiry. A viewer key may call it.

|  |  |
|---|---|
| Who may call | API key only, anyone signed in |
| MCP tool | None, HTTP only: Makes an API key's credential, which no MCP tool does. |
| Errors | 400, 401, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

[`RotatedKey`](#rotatedkey).

### POST /api/keys/{key_id}/delete

Delete one of your keys

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `key_id` | path | string | yes |  | The key's id, from GET /api/keys (GET /api/admin/keys for anyone's). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### POST /api/keys/{key_id}/expiry

Change when one of your keys expires

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `key_id` | path | string | yes |  | The key's id, from GET /api/keys (GET /api/admin/keys for anyone's). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `expires_in_days` | integer | yes | 0 to 3650 | Counted from now. 0 means it never expires. |

**Reply 200**: Success

[`APIKey`](#apikey).

### POST /api/keys/{key_id}/mint-keys

Let one of your keys make keys

Owner only, on one of your own admin-role keys. When on, the key may make keys for other accounts (never the owner's) through POST /api/admin/users/{user_id}/keys, list them, and revoke them. Each key it makes records it, and revoking or deleting this key revokes them all.

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `key_id` | path | string | yes |  | The key's id, from GET /api/keys (GET /api/admin/keys for anyone's). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `may_mint_keys` | boolean | yes |  | true lets this key make, list and revoke other accounts' keys, each recording this key and revoked with it. |

**Reply 200**: Success

[`APIKey`](#apikey).

### POST /api/keys/{key_id}/rename

Rename one of your keys

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `key_id` | path | string | yes |  | The key's id, from GET /api/keys (GET /api/admin/keys for anyone's). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `expect` | string or null | no |  | The name you think it has. Answers 409 if it has another. |
| `name` | string | yes | 1 to 80 characters | 1-80 characters. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `name` | string | yes |  |  |
| `ok` | boolean | yes |  |  |

### POST /api/keys/{key_id}/restore

Undo deleting one of your keys

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `key_id` | path | string | yes |  | The key's id, from GET /api/keys (GET /api/admin/keys for anyone's). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

[`APIKey`](#apikey).

### POST /api/keys/{key_id}/revoke

Revoke one of your keys

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `key_id` | path | string | yes |  | The key's id, from GET /api/keys (GET /api/admin/keys for anyone's). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### POST /api/keys/{key_id}/rotate

Rotate one of your keys

The owner only: gives one of the owner's own keys a new secret and answers its new credential, shown only now. The old secret stops working at once; nothing else about the key changes.

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `key_id` | path | string | yes |  | The key's id, from GET /api/keys (GET /api/admin/keys for anyone's). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

[`RotatedKey`](#rotatedkey).

### POST /api/keys/{key_id}/sign-in

Let one of your keys make sign-in links

Off by default. When on, the key may ask POST /api/account/login-link for a link that signs your account in on a browser, which then can do everything you can, including what keys may not. The link works once, for at most 15 minutes.

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `key_id` | path | string | yes |  | The key's id, from GET /api/keys (GET /api/admin/keys for anyone's). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `may_sign_in` | boolean | yes |  | true lets the key make a login link for your account: one that works once, for at most 15 minutes. |

**Reply 200**: Success

[`APIKey`](#apikey).

## Files

| Method | Path | Summary | Who may call |
|---|---|---|---|
| GET | [`/api/account/storage`](#get-apiaccountstorage) | Your storage | browser session or API key, anyone signed in |
| GET | [`/api/admin/files`](#get-apiadminfiles) | List everyone's files | browser session or API key, admins |
| POST | [`/api/admin/files/{file_id}/delete`](#post-apiadminfilesfile_iddelete) | Delete anyone's file | browser session only, admins |
| GET | [`/api/admin/files/{file_id}/download`](#get-apiadminfilesfile_iddownload) | Download anyone's file | browser session only, admins |
| POST | [`/api/admin/files/{file_id}/rename`](#post-apiadminfilesfile_idrename) | Rename any file | browser session only, admins |
| POST | [`/api/admin/files/{file_id}/restore`](#post-apiadminfilesfile_idrestore) | Put back a deleted file | browser session only, admins |
| GET | [`/api/admin/storage`](#get-apiadminstorage) | Storage for everyone | browser session or API key, admins |
| POST | [`/api/bulk/files/delete`](#post-apibulkfilesdelete) | Delete a file, for many at once | browser session or API key, anyone signed in |
| POST | [`/api/bulk/files/restore`](#post-apibulkfilesrestore) | Restore a deleted file, for many at once | browser session or API key, anyone signed in |
| GET | [`/api/files`](#get-apifiles) | List your files | browser session or API key, anyone signed in |
| POST | [`/api/files`](#post-apifiles) | Start an upload | browser session or API key, anyone signed in |
| GET | [`/api/files/{file_id}`](#get-apifilesfile_id) | One of your files | browser session or API key, anyone signed in |
| POST | [`/api/files/{file_id}/chunks/{index}`](#post-apifilesfile_idchunksindex) | Send the next piece of an upload | browser session or API key, anyone signed in |
| POST | [`/api/files/{file_id}/delete`](#post-apifilesfile_iddelete) | Delete a file | browser session or API key, anyone signed in |
| GET | [`/api/files/{file_id}/download`](#get-apifilesfile_iddownload) | Download one of your files | browser session or API key, anyone signed in |
| POST | [`/api/files/{file_id}/finish`](#post-apifilesfile_idfinish) | Finish an upload | browser session or API key, anyone signed in |
| POST | [`/api/files/{file_id}/rename`](#post-apifilesfile_idrename) | Rename a file | browser session or API key, anyone signed in |
| POST | [`/api/files/{file_id}/restore`](#post-apifilesfile_idrestore) | Restore a deleted file | browser session or API key, anyone signed in |

### GET /api/account/storage

Your storage

How many bytes your files use, and your quota (0 is no limit).

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`my_storage`](mcp.md#my_storage) |
| Errors | 401, 404, 429, 503 |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `quota_bytes` | integer | yes |  |  |
| `used_bytes` | integer | yes |  |  |

### GET /api/admin/files

List everyone's files

Every account's files, a page at a time, with whose each one is (user_id, user_name). next is the offset of the following page, or null on the last one.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_list_files`](mcp.md#admin_list_files) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `limit` | query | integer | no | 1 to 1000; default `200` | Rows to return. Default 200. |
| `offset` | query | integer | no | at least 0 | Rows to skip: the next value of the previous page. |
| `q` | query | string | no |  | Keep files whose name or owner contains this, in any case. |
| `sort` | query | string | no | one of `name`, `user_name`, `size`, `created_at` | Field to sort the whole list by. Rows without it go last. |
| `dir` | query | string | no | one of `asc`, `desc` | Default asc. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `files` | array of object | yes |  |  |
| `files[].chunks` | integer | yes |  |  |
| `files[].created_at` | string (date-time) | yes |  |  |
| `files[].id` | string | yes |  |  |
| `files[].name` | string | yes |  |  |
| `files[].received` | integer | yes |  |  |
| `files[].size` | integer | yes |  |  |
| `files[].state` | string | yes | one of `uploading`, `ready` |  |
| `files[].type` | string | yes |  |  |
| `files[].user_id` | integer | yes |  |  |
| `files[].user_name` | string | yes |  |  |
| `next` | integer or null | yes |  | Offset of the next page, or null on the last one. |
| `total` | integer | yes |  |  |

### POST /api/admin/files/{file_id}/delete

Delete anyone's file

|  |  |
|---|---|
| Who may call | browser session only, admins |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `file_id` | path | string | yes |  | The file's id, from GET /api/admin/files (admin_list_files over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### GET /api/admin/files/{file_id}/download

Download anyone's file

Written to the activity log when the file is someone else's.

|  |  |
|---|---|
| Who may call | browser session only, admins |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `file_id` | path | string | yes |  | The file's id, from GET /api/admin/files (admin_list_files over MCP). |

**Reply 200**: The file, always as an attachment

Raw bytes, as `application/octet-stream`.

### POST /api/admin/files/{file_id}/rename

Rename any file

|  |  |
|---|---|
| Who may call | browser session only, admins |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `file_id` | path | string | yes |  | The file's id, from GET /api/admin/files (admin_list_files over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `expect` | string or null | no |  | The name you think it has. Answers 409 if it has another. |
| `name` | string | yes |  | Cleaned like an upload's name. 1-255 bytes. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `name` | string | yes |  | As stored. |
| `ok` | boolean | yes |  |  |

### POST /api/admin/files/{file_id}/restore

Put back a deleted file

|  |  |
|---|---|
| Who may call | browser session only, admins |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `file_id` | path | string | yes |  | The file's id, from GET /api/admin/files (admin_list_files over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

[`File`](#file).

### GET /api/admin/storage

Storage for everyone

How many bytes everyone's files use together, and the disk's free and total bytes where the system says.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_storage`](mcp.md#admin_storage) |
| Errors | 401, 403, 404, 429, 503 |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `disk_free_bytes` | integer | no |  | Left out where the system will not say. |
| `disk_total_bytes` | integer | no |  | Left out where the system will not say. |
| `used_bytes` | integer | yes |  |  |

### POST /api/bulk/files/delete

Delete a file, for many at once

Runs POST /api/files/{file_id}/delete once per item: items holds each one's id and fields, shared the fields they have in common (an item's own win). Each runs as that route would, in order, and one failing does not stop the rest; the reply says how each went. At most 100 items.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`files_delete_bulk`](mcp.md#files_delete_bulk) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `items` | array of object | yes |  | One entry per thing to change: its id, and any field that differs from shared. |
| `items[].file_id` | string | yes |  | The file's id, from GET /api/files (files_list over MCP). |
| `shared` | object | no |  | Fields every item gets, unless the item sets its own. |

**Reply 200**: Success

[`BulkReply`](#bulkreply).

### POST /api/bulk/files/restore

Restore a deleted file, for many at once

Runs POST /api/files/{file_id}/restore once per item: items holds each one's id and fields, shared the fields they have in common (an item's own win). Each runs as that route would, in order, and one failing does not stop the rest; the reply says how each went. At most 100 items.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`files_restore_bulk`](mcp.md#files_restore_bulk) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `items` | array of object | yes |  | One entry per thing to change: its id, and any field that differs from shared. |
| `items[].file_id` | string | yes |  | The file's id, from GET /api/files (files_list over MCP). |
| `shared` | object | no |  | Fields every item gets, unless the item sets its own. |

**Reply 200**: Success

[`BulkReply`](#bulkreply).

### GET /api/files

List your files

Your uploaded files, a page at a time: id, name, type, size, state (uploading or ready) and when. next is the offset of the following page, or null on the last one.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`files_list`](mcp.md#files_list) |
| Errors | 400, 401, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `limit` | query | integer | no | 1 to 1000; default `200` | Rows to return. Default 200. |
| `offset` | query | integer | no | at least 0 | Rows to skip: the next value of the previous page. |
| `q` | query | string | no |  | Keep files whose name contains this, in any case. |
| `sort` | query | string | no | one of `name`, `size`, `created_at` | Field to sort the whole list by. Rows without it go last. |
| `dir` | query | string | no | one of `asc`, `desc` | Default asc. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `files` | array of [`File`](#file) | yes |  |  |
| `next` | integer or null | yes |  | Offset of the next page, or null on the last one. |
| `total` | integer | yes |  |  |

### POST /api/files

Start an upload

Then send each piece in order and finish. A file over files.max_file_bytes, or one that would pass files.quota_bytes_per_user, is a 409.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`files_start_upload`](mcp.md#files_start_upload) |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `name` | string | yes |  |  |
| `size` | integer | yes | at least 0 |  |
| `type` | string | no |  | Shown in the list. Downloads are always application/octet-stream. |

**Reply 201**: Created

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `chunk_bytes` | integer | yes |  | Every piece but the last is exactly this long. |
| `chunks` | integer | yes |  |  |
| `created_at` | string (date-time) | yes |  |  |
| `id` | string | yes |  |  |
| `name` | string | yes |  |  |
| `received` | integer | yes |  |  |
| `size` | integer | yes |  |  |
| `state` | string | yes | one of `uploading`, `ready` |  |
| `type` | string | yes |  |  |

### GET /api/files/{file_id}

One of your files

One file: its details, and for an unfinished upload how many pieces have arrived (received), which is where to resume.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`files_get`](mcp.md#files_get) |
| Errors | 400, 401, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `file_id` | path | string | yes |  | The file's id, from GET /api/files (files_list over MCP). |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `chunk_bytes` | integer | yes |  | Every piece but the last is exactly this long. |
| `chunks` | integer | yes |  |  |
| `created_at` | string (date-time) | yes |  |  |
| `id` | string | yes |  |  |
| `name` | string | yes |  |  |
| `received` | integer | yes |  |  |
| `size` | integer | yes |  |  |
| `state` | string | yes | one of `uploading`, `ready` |  |
| `type` | string | yes |  |  |

### POST /api/files/{file_id}/chunks/{index}

Send the next piece of an upload

The body is the raw bytes. Pieces go in order, from 0. A browser session sends its csrf token in the X-CSRF-Token header. A 409 carries received, the piece to send next. Counts against server.rate_limit_upload_max.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: File bytes: MCP messages are JSON, and clients cap their size. files_start_upload says where to send each piece, with the same key. |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `file_id` | path | string | yes |  | The file's id, from GET /api/files (files_list over MCP). |
| `index` | path | integer | yes | at least 0 |  |
| `X-CSRF-Token` | header | string | no |  | From GET /api/me. Browser sessions only. |

**Request body**

Raw bytes, as `application/octet-stream`.

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `received` | integer | yes |  |  |

### POST /api/files/{file_id}/delete

Delete a file

Move one of your files to the bin. It can be restored for ten minutes; after that it is gone.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`files_delete`](mcp.md#files_delete) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `file_id` | path | string | yes |  | The file's id, from GET /api/files (files_list over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### GET /api/files/{file_id}/download

Download one of your files

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`files_download_url`](mcp.md#files_download_url) |
| Errors | 400, 401, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `file_id` | path | string | yes |  | The file's id, from GET /api/files (files_list over MCP). |

**Reply 200**: The file, always as an attachment

Raw bytes, as `application/octet-stream`.

### POST /api/files/{file_id}/finish

Finish an upload

Seal an upload once every piece has arrived; the file is then ready to download. Asked again, it answers the same. If pieces are missing it says how many arrived (received).

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`files_finish_upload`](mcp.md#files_finish_upload) |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `file_id` | path | string | yes |  | The file's id, from GET /api/files (files_list over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

[`File`](#file).

### POST /api/files/{file_id}/rename

Rename a file

Give one of your files a new name. expect, when given, is the name you think it has now; a rename made meanwhile is refused with the current name.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`files_rename`](mcp.md#files_rename) |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `file_id` | path | string | yes |  | The file's id, from GET /api/files (files_list over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `expect` | string or null | no |  | The name you think it has. Answers 409 if it has another. |
| `name` | string | yes |  | Cleaned like an upload's name. 1-255 bytes. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `name` | string | yes |  | As stored. |
| `ok` | boolean | yes |  |  |

### POST /api/files/{file_id}/restore

Restore a deleted file

Bring back a file you deleted, while it is still in the bin and your storage quota has room.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`files_restore`](mcp.md#files_restore) |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `file_id` | path | string | yes |  | The file's id, from GET /api/files (files_list over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

[`File`](#file).

## Admin

| Method | Path | Summary | Who may call |
|---|---|---|---|
| GET | [`/api/admin/theme-defaults`](#get-apiadmintheme-defaults) | Default themes | browser session or API key, admins |
| POST | [`/api/admin/theme-defaults`](#post-apiadmintheme-defaults) | Replace the default themes | browser session or API key, admins |
| GET | [`/api/admin/users`](#get-apiadminusers) | List users | browser session or API key, admins |
| POST | [`/api/admin/users`](#post-apiadminusers) | Create an account | browser session or API key, admins |
| POST | [`/api/admin/users/{user_id}/cancel-login-link`](#post-apiadminusersuser_idcancel-login-link) | Stop an account's login link working | browser session or API key, admins |
| POST | [`/api/admin/users/{user_id}/delete`](#post-apiadminusersuser_iddelete) | Delete an account | browser session or API key, admins |
| POST | [`/api/admin/users/{user_id}/disabled`](#post-apiadminusersuser_iddisabled) | Disable or enable a user | browser session or API key, admins |
| POST | [`/api/admin/users/{user_id}/expiry`](#post-apiadminusersuser_idexpiry) | Set when an account expires | browser session or API key, admins |
| POST | [`/api/admin/users/{user_id}/reissue-login`](#post-apiadminusersuser_idreissue-login) | A new login link for an account | browser session or API key, admins |
| POST | [`/api/admin/users/{user_id}/rename`](#post-apiadminusersuser_idrename) | Rename someone | browser session or API key, admins |
| POST | [`/api/admin/users/{user_id}/reset-two-factor`](#post-apiadminusersuser_idreset-two-factor) | Turn off an account's two-factor | browser session or API key, admins |
| POST | [`/api/admin/users/{user_id}/revoke-access`](#post-apiadminusersuser_idrevoke-access) | Revoke a user's access | browser session or API key, admins |
| POST | [`/api/admin/users/{user_id}/role`](#post-apiadminusersuser_idrole) | Change an account's role | browser session or API key, admins |
| GET | [`/api/admin/users/{user_id}/sessions`](#get-apiadminusersuser_idsessions) | An account's signed-in devices | browser session or API key, admins |
| POST | [`/api/admin/users/{user_id}/sessions/{session_id}/revoke`](#post-apiadminusersuser_idsessionssession_idrevoke) | Sign out one of an account's devices | browser session or API key, admins |
| POST | [`/api/bulk/admin/users/cancel-login-link`](#post-apibulkadminuserscancel-login-link) | Stop an account's login link working, for many at once | browser session or API key, admins |
| POST | [`/api/bulk/admin/users/delete`](#post-apibulkadminusersdelete) | Delete an account, for many at once | browser session or API key, admins |
| POST | [`/api/bulk/admin/users/disabled`](#post-apibulkadminusersdisabled) | Disable or enable a user, for many at once | browser session or API key, admins |
| POST | [`/api/bulk/admin/users/reset-two-factor`](#post-apibulkadminusersreset-two-factor) | Turn off an account's two-factor, for many at once | browser session or API key, admins |
| POST | [`/api/bulk/admin/users/revoke-access`](#post-apibulkadminusersrevoke-access) | Revoke a user's access, for many at once | browser session or API key, admins |
| POST | [`/api/bulk/admin/users/role`](#post-apibulkadminusersrole) | Change an account's role, for many at once | browser session or API key, admins |
| POST | [`/api/bulk/admin/users/sessions/revoke`](#post-apibulkadminuserssessionsrevoke) | Sign out one of an account's devices, for many at once | browser session or API key, admins |

### GET /api/admin/theme-defaults

Default themes

The theme list everyone without their own list sees. themes is null while the built-in ones apply.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_get_theme_defaults`](mcp.md#admin_get_theme_defaults) |
| Errors | 401, 403, 404, 429, 503 |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `builtins` | integer | yes |  | Which built-in themes that list has seen (see builtins on POST /api/account/themes). |
| `themes` | array of [`Theme`](#theme) or null | yes |  | null while the built-in themes apply. |

### POST /api/admin/theme-defaults

Replace the default themes

Replace the theme list everyone without their own list sees, 1 to 40 themes in the Theme schema of the API reference. null puts the built-in themes back.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_set_theme_defaults`](mcp.md#admin_set_theme_defaults) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `builtins` | integer | no |  | Which built-in themes this list has seen: the highest since in Theme.builtIn (static/js/theme.js) when it was saved. Built-in themes added after that join the list the browser shows. Left out: 0, the first ones. |
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `themes` | array of [`Theme`](#theme) or null | no |  | 1 to 40 themes. null goes back to the built-in ones. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `builtins` | integer | yes |  | Which built-in themes that list has seen (see builtins on POST /api/account/themes). |
| `ok` | boolean | yes |  |  |
| `themes` | array of [`Theme`](#theme) or null | yes |  |  |

### GET /api/admin/users

List users

Accounts, a page at a time, including disabled ones, with each one's role and which is the owner. next is the offset of the following page, or null on the last one.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_list_users`](mcp.md#admin_list_users) |
| Errors | 400, 401, 403, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `limit` | query | integer | no | 1 to 1000; default `200` | Rows to return. Default 200. |
| `offset` | query | integer | no | at least 0 | Rows to skip: the next value of the previous page. |
| `q` | query | string | no |  | Keep accounts whose name or username contains this, in any case. |
| `sort` | query | string | no | one of `display_name`, `role`, `disabled`, `created_at` | Field to sort the whole list by. Rows without it go last. |
| `dir` | query | string | no | one of `asc`, `desc` | Default asc. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `next` | integer or null | yes |  | Offset of the next page, or null on the last one. |
| `total` | integer | yes |  |  |
| `users` | array of [`User`](#user) | yes |  |  |

### POST /api/admin/users

Create an account

Make a new account and its first login link, to hand to the person. role is admin, user or viewer (reads only). account_expires_at, when given, is when the account stops working. Answers with user_id and the link.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_create_user`](mcp.md#admin_create_user) |
| Errors | 400, 401, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `account_expires_at` | string (date-time) or null | no |  | When the account stops working (RFC 3339). Left out: never. expires_in_minutes is the login link's expiry, not this. |
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `display_name` | string | yes | 1 to 80 characters |  |
| `expires_in_minutes` | integer or null | no | 0 to 525600 | 0 never expires. Default auth.login_token_ttl_seconds for a link that works once, auth.multi_use_login_token_ttl_seconds otherwise. |
| `kind` | string | no | one of `person`, `service`; default `person` | person, the default. service is refused (403 service_account): a service account is made by Connect on the owner's API keys screen. |
| `max_uses` | integer or null | no | 0 to 1000 | Sign-ins the link allows: 1-1000, or 0 for unlimited. Default 1. |
| `role` | string | yes | one of `admin`, `user`, `viewer` |  |

**Reply 201**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `expires_at` | string (date-time) or null | yes |  | null when it never expires. |
| `expires_in_seconds` | integer | yes |  | 0 when it never expires. |
| `login_path` | string | yes |  | Path of the login link. A credential: treat it like a password. |
| `max_uses` | integer | yes |  | 0 when unlimited. |
| `unlimited` | boolean | yes |  |  |
| `user_id` | integer | yes |  |  |

### POST /api/admin/users/{user_id}/cancel-login-link

Stop an account's login link working

Void an account's live login link without making a new one: a link that went somewhere it should not have.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_cancel_login_link`](mcp.md#admin_cancel_login_link) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `user_id` | path | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |
| `removed` | integer | yes |  | Links removed: 0 or 1. |

### POST /api/admin/users/{user_id}/delete

Delete an account

Remove an account for good, with its sessions, login link and API keys.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_delete_user`](mcp.md#admin_delete_user) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `user_id` | path | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |
| `removed` | [`Revoked`](#revoked) | yes |  |  |

### POST /api/admin/users/{user_id}/disabled

Disable or enable a user

Switch an account off (disabled: true) or back on (false). Disabling signs it out everywhere and voids its live login link; its API keys stop working while it is off. Reversible. The owner and your own account cannot be disabled.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_set_user_disabled`](mcp.md#admin_set_user_disabled) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `user_id` | path | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `disabled` | boolean | yes |  |  |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### POST /api/admin/users/{user_id}/expiry

Set when an account expires

expires_at is when the account stops working (RFC 3339), or null for never. Once it passes the account counts as disabled: sign-in, its sessions and its keys stop, and housekeeping disables it and revokes its access. A later expiry does not re-enable an account housekeeping already disabled. It must be in the future. The owner's account never expires; only the owner sets an admin's.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_set_user_expiry`](mcp.md#admin_set_user_expiry) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `user_id` | path | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `expires_at` | string (date-time) or null | yes |  | When the account stops working (RFC 3339), or null for never. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `expires_at` | string (date-time) or null | yes |  | null when it never expires. |
| `ok` | boolean | yes |  |  |

### POST /api/admin/users/{user_id}/reissue-login

A new login link for an account

For someone who lost their device or their link: a fresh login link for their account.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_reissue_login`](mcp.md#admin_reissue_login) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `user_id` | path | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `expires_in_minutes` | integer or null | no | 0 to 525600 | 0 never expires. Default auth.login_token_ttl_seconds for a link that works once, auth.multi_use_login_token_ttl_seconds otherwise. |
| `max_uses` | integer or null | no | 0 to 1000 | Sign-ins the link allows: 1-1000, or 0 for unlimited. Default 1. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `expires_at` | string (date-time) or null | yes |  | null when it never expires. |
| `expires_in_seconds` | integer | yes |  | 0 when it never expires. |
| `login_path` | string | yes |  | Path of the login link. A credential: treat it like a password. |
| `max_uses` | integer | yes |  | 0 when unlimited. |
| `unlimited` | boolean | yes |  |  |

### POST /api/admin/users/{user_id}/rename

Rename someone

Change another account's display name (1-80 characters). Only the owner renames an admin. expect, when given, is the name you think it has now; if it changed meanwhile the rename is refused with the current name.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_rename_user`](mcp.md#admin_rename_user) |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `user_id` | path | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `display_name` | string | yes | 1 to 80 characters | 1-80 characters. |
| `expect` | string or null | no |  | The name you think they have. Answers 409 if it is another. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `display_name` | string | yes |  |  |
| `ok` | boolean | yes |  |  |

### POST /api/admin/users/{user_id}/reset-two-factor

Turn off an account's two-factor

For someone who lost both their phone and their recovery codes: switches their two-factor sign-in off so a login link lets them in again. Only the owner resets an admin's; the owner's is reset from a shell.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_reset_two_factor`](mcp.md#admin_reset_two_factor) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `user_id` | path | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### POST /api/admin/users/{user_id}/revoke-access

Revoke a user's access

For an account that may be compromised: ends every session and voids its live login link and every API key it holds, at once.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_revoke_access`](mcp.md#admin_revoke_access) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `user_id` | path | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |
| `revoked` | [`Revoked`](#revoked) | yes |  |  |

### POST /api/admin/users/{user_id}/role

Change an account's role

Make an account an admin, an ordinary user, or a viewer, who may read but change nothing. Only the owner takes an admin's rights away; the owner is always an admin, and nobody changes their own role. Becoming an admin ends the account's sessions and live login link.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_set_user_role`](mcp.md#admin_set_user_role) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `user_id` | path | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `role` | string | yes | one of `admin`, `user`, `viewer` |  |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |
| `role` | string | yes |  |  |

### GET /api/admin/users/{user_id}/sessions

An account's signed-in devices

Where an account is signed in: every session, with when it started and was last seen. Addresses are shown to the owner and service accounts only. Nobody sees the owner's, and only the owner sees another admin's.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_list_user_sessions`](mcp.md#admin_list_user_sessions) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `user_id` | path | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |
| `limit` | query | integer | no | 1 to 1000; default `200` | Rows to return. Default 200. |
| `offset` | query | integer | no | at least 0 | Rows to skip: the next value of the previous page. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `next` | integer or null | yes |  | Offset of the next page, or null on the last one. |
| `sessions` | array of [`Session`](#session) | yes |  |  |
| `total` | integer | yes |  |  |

### POST /api/admin/users/{user_id}/sessions/{session_id}/revoke

Sign out one of an account's devices

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_revoke_user_session`](mcp.md#admin_revoke_user_session) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `user_id` | path | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |
| `session_id` | path | string | yes |  | The device's id, from GET /api/account/sessions or GET /api/admin/users/{user_id}/sessions (list_my_sessions or admin_list_user_sessions over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### POST /api/bulk/admin/users/cancel-login-link

Stop an account's login link working, for many at once

Runs POST /api/admin/users/{user_id}/cancel-login-link once per item: items holds each one's id and fields, shared the fields they have in common (an item's own win). Each runs as that route would, in order, and one failing does not stop the rest; the reply says how each went. At most 100 items.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_cancel_login_link_bulk`](mcp.md#admin_cancel_login_link_bulk) |
| Errors | 400, 401, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `items` | array of object | yes |  | One entry per thing to change: its id, and any field that differs from shared. |
| `items[].user_id` | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |
| `shared` | object | no |  | Fields every item gets, unless the item sets its own. |

**Reply 200**: Success

[`BulkReply`](#bulkreply).

### POST /api/bulk/admin/users/delete

Delete an account, for many at once

Runs POST /api/admin/users/{user_id}/delete once per item: items holds each one's id and fields, shared the fields they have in common (an item's own win). Each runs as that route would, in order, and one failing does not stop the rest; the reply says how each went. At most 100 items.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_delete_user_bulk`](mcp.md#admin_delete_user_bulk) |
| Errors | 400, 401, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `items` | array of object | yes |  | One entry per thing to change: its id, and any field that differs from shared. |
| `items[].user_id` | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |
| `shared` | object | no |  | Fields every item gets, unless the item sets its own. |

**Reply 200**: Success

[`BulkReply`](#bulkreply).

### POST /api/bulk/admin/users/disabled

Disable or enable a user, for many at once

Runs POST /api/admin/users/{user_id}/disabled once per item: items holds each one's id and fields, shared the fields they have in common (an item's own win). Each runs as that route would, in order, and one failing does not stop the rest; the reply says how each went. At most 100 items.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_set_user_disabled_bulk`](mcp.md#admin_set_user_disabled_bulk) |
| Errors | 400, 401, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `items` | array of object | yes |  | One entry per thing to change: its id, and any field that differs from shared. |
| `items[].disabled` | boolean | no |  |  |
| `items[].user_id` | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |
| `shared` | object | no |  | Fields every item gets, unless the item sets its own. |
| `shared.disabled` | boolean | no |  |  |

**Reply 200**: Success

[`BulkReply`](#bulkreply).

### POST /api/bulk/admin/users/reset-two-factor

Turn off an account's two-factor, for many at once

Runs POST /api/admin/users/{user_id}/reset-two-factor once per item: items holds each one's id and fields, shared the fields they have in common (an item's own win). Each runs as that route would, in order, and one failing does not stop the rest; the reply says how each went. At most 100 items.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_reset_two_factor_bulk`](mcp.md#admin_reset_two_factor_bulk) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `items` | array of object | yes |  | One entry per thing to change: its id, and any field that differs from shared. |
| `items[].user_id` | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |
| `shared` | object | no |  | Fields every item gets, unless the item sets its own. |

**Reply 200**: Success

[`BulkReply`](#bulkreply).

### POST /api/bulk/admin/users/revoke-access

Revoke a user's access, for many at once

Runs POST /api/admin/users/{user_id}/revoke-access once per item: items holds each one's id and fields, shared the fields they have in common (an item's own win). Each runs as that route would, in order, and one failing does not stop the rest; the reply says how each went. At most 100 items.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_revoke_access_bulk`](mcp.md#admin_revoke_access_bulk) |
| Errors | 400, 401, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `items` | array of object | yes |  | One entry per thing to change: its id, and any field that differs from shared. |
| `items[].user_id` | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |
| `shared` | object | no |  | Fields every item gets, unless the item sets its own. |

**Reply 200**: Success

[`BulkReply`](#bulkreply).

### POST /api/bulk/admin/users/role

Change an account's role, for many at once

Runs POST /api/admin/users/{user_id}/role once per item: items holds each one's id and fields, shared the fields they have in common (an item's own win). Each runs as that route would, in order, and one failing does not stop the rest; the reply says how each went. At most 100 items.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_set_user_role_bulk`](mcp.md#admin_set_user_role_bulk) |
| Errors | 400, 401, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `items` | array of object | yes |  | One entry per thing to change: its id, and any field that differs from shared. |
| `items[].role` | string | no | one of `admin`, `user`, `viewer` |  |
| `items[].user_id` | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |
| `shared` | object | no |  | Fields every item gets, unless the item sets its own. |
| `shared.role` | string | no | one of `admin`, `user`, `viewer` |  |

**Reply 200**: Success

[`BulkReply`](#bulkreply).

### POST /api/bulk/admin/users/sessions/revoke

Sign out one of an account's devices, for many at once

Runs POST /api/admin/users/{user_id}/sessions/{session_id}/revoke once per item: items holds each one's id and fields, shared the fields they have in common (an item's own win). Each runs as that route would, in order, and one failing does not stop the rest; the reply says how each went. At most 100 items.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_revoke_user_session_bulk`](mcp.md#admin_revoke_user_session_bulk) |
| Errors | 400, 401, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `items` | array of object | yes |  | One entry per thing to change: its id, and any field that differs from shared. |
| `items[].session_id` | string | yes |  | The device's id, from GET /api/account/sessions or GET /api/admin/users/{user_id}/sessions (list_my_sessions or admin_list_user_sessions over MCP). |
| `items[].user_id` | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |
| `shared` | object | no |  | Fields every item gets, unless the item sets its own. |

**Reply 200**: Success

[`BulkReply`](#bulkreply).

## Invite links

| Method | Path | Summary | Who may call |
|---|---|---|---|
| GET | [`/api/admin/invite-links`](#get-apiadmininvite-links) | List invite links | browser session or API key, admins |
| POST | [`/api/admin/invite-links`](#post-apiadmininvite-links) | Create an invite link | browser session or API key, admins |
| POST | [`/api/admin/invite-links/{link_id}/delete`](#post-apiadmininvite-linkslink_iddelete) | Delete an invite link | browser session or API key, admins |
| POST | [`/api/admin/invite-links/{link_id}/limits`](#post-apiadmininvite-linkslink_idlimits) | Change an invite link's places and expiry | browser session or API key, admins |
| POST | [`/api/admin/invite-links/{link_id}/rename`](#post-apiadmininvite-linkslink_idrename) | Rename an invite link | browser session or API key, admins |
| POST | [`/api/admin/invite-links/{link_id}/restore`](#post-apiadmininvite-linkslink_idrestore) | Undo deleting an invite link | browser session or API key, admins |
| POST | [`/api/admin/invite-links/{link_id}/revoke`](#post-apiadmininvite-linkslink_idrevoke) | Switch off an invite link | browser session or API key, admins |
| POST | [`/api/admin/invite-links/{link_id}/switch-on`](#post-apiadmininvite-linkslink_idswitch-on) | Switch an invite link back on | browser session or API key, admins |
| POST | [`/api/bulk/admin/invite-links/delete`](#post-apibulkadmininvite-linksdelete) | Delete an invite link, for many at once | browser session or API key, admins |
| POST | [`/api/bulk/admin/invite-links/restore`](#post-apibulkadmininvite-linksrestore) | Undo deleting an invite link, for many at once | browser session or API key, admins |
| POST | [`/api/bulk/admin/invite-links/revoke`](#post-apibulkadmininvite-linksrevoke) | Switch off an invite link, for many at once | browser session or API key, admins |
| POST | [`/api/bulk/admin/invite-links/switch-on`](#post-apibulkadmininvite-linksswitch-on) | Switch an invite link back on, for many at once | browser session or API key, admins |
| POST | [`/api/join/claim`](#post-apijoinclaim) | Sign in as an existing account | anyone |
| POST | [`/api/join/create`](#post-apijoincreate) | Join as a new account | anyone |
| POST | [`/api/join/info`](#post-apijoininfo) | What an invite link is | anyone |
| POST | [`/api/join/match`](#post-apijoinmatch) | Accounts matching a name | anyone |

### GET /api/admin/invite-links

List invite links

Group invite links, a page at a time: label, places used and left, expiry, and whether each still works. The links themselves are never shown again after creation. next is the offset of the following page, or null on the last one.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_list_invite_links`](mcp.md#admin_list_invite_links) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `limit` | query | integer | no | 1 to 1000; default `200` | Rows to return. Default 200. |
| `offset` | query | integer | no | at least 0 | Rows to skip: the next value of the previous page. |
| `q` | query | string | no |  | Keep links whose label or maker contains this, in any case. |
| `sort` | query | string | no | one of `label`, `used`, `expires_at` | Field to sort the whole list by. Rows without it go last. |
| `dir` | query | string | no | one of `asc`, `desc` | Default asc. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `invite_links` | array of [`InviteLink`](#invitelink) | yes |  |  |
| `next` | integer or null | yes |  | Offset of the next page, or null on the last one. |
| `total` | integer | yes |  |  |

### POST /api/admin/invite-links

Create an invite link

One link for a group: each person who opens it joins as a new account with role (user, the default, or viewer), up to max_uses people, for days days.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_create_invite_link`](mcp.md#admin_create_invite_link) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `days` | integer | yes | 1 to 365 |  |
| `label` | string | yes | 1 to 80 characters |  |
| `max_uses` | integer | yes | 1 to 1000 |  |
| `role` | string | no | one of `user`, `viewer`; default `user` | The role each person who joins gets: user, or viewer (reads only). |

**Reply 201**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `created_by` | integer | yes |  |  |
| `created_by_name` | string | no |  |  |
| `expires_at` | string (date-time) | yes |  |  |
| `id` | string | yes |  |  |
| `join_path` | string | yes |  | The link to hand out, shown in this response only. A credential: treat it like a password. |
| `label` | string | yes |  |  |
| `live` | boolean | yes |  |  |
| `max_uses` | integer | yes |  |  |
| `remaining` | integer | yes |  |  |
| `revoked` | boolean | yes |  |  |
| `role` | string | yes | one of `user`, `viewer` | The role each person who joins gets. |
| `used` | integer | yes |  |  |

### POST /api/admin/invite-links/{link_id}/delete

Delete an invite link

Take an invite link off the list and stop it working. The accounts it made stay.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_delete_invite_link`](mcp.md#admin_delete_invite_link) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `link_id` | path | string | yes |  | The link's id, from GET /api/admin/invite-links (admin_list_invite_links over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### POST /api/admin/invite-links/{link_id}/limits

Change an invite link's places and expiry

Set how many people the link may take in (never fewer than have joined) and, when days is given, a new expiry counted from now. The link then counts as this key's: revoking the key switches it off.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_set_invite_link_limits`](mcp.md#admin_set_invite_link_limits) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `link_id` | path | string | yes |  | The link's id, from GET /api/admin/invite-links (admin_list_invite_links over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `days` | integer or null | no | 1 to 365 | Counted from now. Leave out to keep the expiry. |
| `max_uses` | integer | yes | 1 to 1000 | Not fewer than have joined. |

**Reply 200**: Success

[`InviteLink`](#invitelink).

### POST /api/admin/invite-links/{link_id}/rename

Rename an invite link

Change the label people see on an invite link's join page (1-80 characters). expect, when given, is the label you think it has now.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_rename_invite_link`](mcp.md#admin_rename_invite_link) |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `link_id` | path | string | yes |  | The link's id, from GET /api/admin/invite-links (admin_list_invite_links over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `expect` | string or null | no |  | The label you think it has. Answers 409 if it has another. |
| `label` | string | yes | 1 to 80 characters | 1-80 characters. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `label` | string | yes |  |  |
| `ok` | boolean | yes |  |  |

### POST /api/admin/invite-links/{link_id}/restore

Undo deleting an invite link

Bring back an invite link deleted in the last few minutes, working as before. The link then counts as this key's: revoking the key switches it off.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_restore_invite_link`](mcp.md#admin_restore_invite_link) |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `link_id` | path | string | yes |  | The link's id, from GET /api/admin/invite-links (admin_list_invite_links over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

[`InviteLink`](#invitelink).

### POST /api/admin/invite-links/{link_id}/revoke

Switch off an invite link

Stop an invite link from letting anyone else join or sign in through it. Accounts it already made keep working. Cannot be switched back on.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_revoke_invite_link`](mcp.md#admin_revoke_invite_link) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `link_id` | path | string | yes |  | The link's id, from GET /api/admin/invite-links (admin_list_invite_links over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### POST /api/admin/invite-links/{link_id}/switch-on

Switch an invite link back on

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_switch_on_invite_link`](mcp.md#admin_switch_on_invite_link) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `link_id` | path | string | yes |  | The link's id, from GET /api/admin/invite-links (admin_list_invite_links over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

[`InviteLink`](#invitelink).

### POST /api/bulk/admin/invite-links/delete

Delete an invite link, for many at once

Runs POST /api/admin/invite-links/{link_id}/delete once per item: items holds each one's id and fields, shared the fields they have in common (an item's own win). Each runs as that route would, in order, and one failing does not stop the rest; the reply says how each went. At most 100 items.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_delete_invite_link_bulk`](mcp.md#admin_delete_invite_link_bulk) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `items` | array of object | yes |  | One entry per thing to change: its id, and any field that differs from shared. |
| `items[].link_id` | string | yes |  | The link's id, from GET /api/admin/invite-links (admin_list_invite_links over MCP). |
| `shared` | object | no |  | Fields every item gets, unless the item sets its own. |

**Reply 200**: Success

[`BulkReply`](#bulkreply).

### POST /api/bulk/admin/invite-links/restore

Undo deleting an invite link, for many at once

Runs POST /api/admin/invite-links/{link_id}/restore once per item: items holds each one's id and fields, shared the fields they have in common (an item's own win). Each runs as that route would, in order, and one failing does not stop the rest; the reply says how each went. At most 100 items.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_restore_invite_link_bulk`](mcp.md#admin_restore_invite_link_bulk) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `items` | array of object | yes |  | One entry per thing to change: its id, and any field that differs from shared. |
| `items[].link_id` | string | yes |  | The link's id, from GET /api/admin/invite-links (admin_list_invite_links over MCP). |
| `shared` | object | no |  | Fields every item gets, unless the item sets its own. |

**Reply 200**: Success

[`BulkReply`](#bulkreply).

### POST /api/bulk/admin/invite-links/revoke

Switch off an invite link, for many at once

Runs POST /api/admin/invite-links/{link_id}/revoke once per item: items holds each one's id and fields, shared the fields they have in common (an item's own win). Each runs as that route would, in order, and one failing does not stop the rest; the reply says how each went. At most 100 items.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_revoke_invite_link_bulk`](mcp.md#admin_revoke_invite_link_bulk) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `items` | array of object | yes |  | One entry per thing to change: its id, and any field that differs from shared. |
| `items[].link_id` | string | yes |  | The link's id, from GET /api/admin/invite-links (admin_list_invite_links over MCP). |
| `shared` | object | no |  | Fields every item gets, unless the item sets its own. |

**Reply 200**: Success

[`BulkReply`](#bulkreply).

### POST /api/bulk/admin/invite-links/switch-on

Switch an invite link back on, for many at once

Runs POST /api/admin/invite-links/{link_id}/switch-on once per item: items holds each one's id and fields, shared the fields they have in common (an item's own win). Each runs as that route would, in order, and one failing does not stop the rest; the reply says how each went. At most 100 items.

|  |  |
|---|---|
| Who may call | browser session or API key, admins |
| MCP tool | [`admin_switch_on_invite_link_bulk`](mcp.md#admin_switch_on_invite_link_bulk) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `items` | array of object | yes |  | One entry per thing to change: its id, and any field that differs from shared. |
| `items[].link_id` | string | yes |  | The link's id, from GET /api/admin/invite-links (admin_list_invite_links over MCP). |
| `shared` | object | no |  | Fields every item gets, unless the item sets its own. |

**Reply 200**: Success

[`BulkReply`](#bulkreply).

### POST /api/join/claim

Sign in as an existing account

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 400, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `credential` | string | yes |  |  |
| `display_name` | string | no |  |  |
| `pin` | string | no |  |  |
| `user_id` | integer | no |  |  |

**Reply 200**: Success

[`Joined`](#joined).

### POST /api/join/create

Join as a new account

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 400, 403, 404, 409, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `credential` | string | yes |  |  |
| `display_name` | string | no |  |  |
| `pin` | string | no |  |  |
| `user_id` | integer | no |  |  |

**Reply 201**: Success

[`Joined`](#joined).

### POST /api/join/info

What an invite link is

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 400, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `credential` | string | yes |  |  |
| `display_name` | string | no |  |  |
| `pin` | string | no |  |  |
| `user_id` | integer | no |  |  |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `label` | string | yes |  |  |
| `remaining` | integer | yes |  |  |

### POST /api/join/match

Accounts matching a name

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 400, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `credential` | string | yes |  |  |
| `display_name` | string | no |  |  |
| `pin` | string | no |  |  |
| `user_id` | integer | no |  |  |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `can_create` | boolean | yes |  |  |
| `matches` | array of object | yes |  |  |
| `matches[].display_name` | string | yes |  |  |
| `matches[].has_pin` | boolean | yes |  |  |
| `matches[].id` | integer | yes |  |  |

## Owner

| Method | Path | Summary | Who may call |
|---|---|---|---|
| GET | [`/api/owner/jobs`](#get-apiownerjobs) | Background jobs | browser session only, the owner |
| POST | [`/api/owner/jobs/{name}/run`](#post-apiownerjobsnamerun) | Run a job now | browser session only, the owner |
| GET | [`/api/owner/logs/days`](#get-apiownerlogsdays) | The days on record | browser session only, the owner |
| GET | [`/api/owner/logs/days/{date}`](#get-apiownerlogsdaysdate) | One day's entries | browser session only, the owner |
| POST | [`/api/owner/logs/days/{date}/delete`](#post-apiownerlogsdaysdatedelete) | Delete one day | browser session only, the owner |
| GET | [`/api/owner/logs/days/{date}/download`](#get-apiownerlogsdaysdatedownload) | One day's entries as a file | browser session only, the owner |
| GET | [`/api/owner/logs/ip-names`](#get-apiownerlogsip-names) | What the owner calls addresses | browser session only, the owner |
| POST | [`/api/owner/logs/ip-names`](#post-apiownerlogsip-names) | Name an address or a range, or rename one | browser session only, the owner |
| POST | [`/api/owner/logs/ip-names/delete`](#post-apiownerlogsip-namesdelete) | Take a name off an address or a range | browser session only, the owner |
| POST | [`/api/owner/logs/prune`](#post-apiownerlogsprune) | Apply the retention rules now | browser session only, the owner |
| GET | [`/api/owner/logs/stream`](#get-apiownerlogsstream) | New log entries as they happen | browser session only, the owner |
| GET | [`/api/owner/portal`](#get-apiownerportal) | ProjectPortal's accounts | browser session only, the owner |
| POST | [`/api/owner/portal/connect`](#post-apiownerportalconnect) | Connect ProjectPortal | browser session only, the owner |
| POST | [`/api/owner/portal/disconnect`](#post-apiownerportaldisconnect) | Disconnect ProjectPortal | browser session only, the owner |
| GET | [`/api/owner/settings`](#get-apiownersettings) | config.yaml, as a form | browser session only, the owner |
| POST | [`/api/owner/settings`](#post-apiownersettings) | Save settings | browser session only, the owner |
| POST | [`/api/owner/users/{user_id}/password-access`](#post-apiownerusersuser_idpassword-access) | Allow or block an account's password | browser session only, the owner |

### GET /api/owner/jobs

Background jobs

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 404, 429, 503 |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `jobs` | array of [`Job`](#job) | yes |  |  |

### POST /api/owner/jobs/{name}/run

Run a job now

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `name` | path | string | yes |  | The job's name, from GET /api/owner/jobs. |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 202**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### GET /api/owner/logs/days

The days on record

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `q` | query | string | no |  | The Logs screen's search. |

**Reply 200**: Success

[`LogDays`](#logdays).

### GET /api/owner/logs/days/{date}

One day's entries

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `date` | path | string | yes |  | The day's date, from GET /api/owner/logs/days. |
| `q` | query | string | no |  | The Logs screen's search. |
| `before` | query | integer or null | no | at least 0 |  |
| `limit` | query | integer | no | 1 to 1000; default `200` | Rows to return. Default 200. |

**Reply 200**: Success

[`LogDay`](#logday).

### POST /api/owner/logs/days/{date}/delete

Delete one day

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `date` | path | string | yes |  | The day's date, from GET /api/owner/logs/days. |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `deleted` | boolean | yes |  |  |

### GET /api/owner/logs/days/{date}/download

One day's entries as a file

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `date` | path | string | yes |  | The day's date, from GET /api/owner/logs/days. |

**Reply 200**: Success

Text, as `application/x-ndjson`.

### GET /api/owner/logs/ip-names

What the owner calls addresses

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 403, 404, 429, 503 |

**Reply 200**: Success

[`IPNames`](#ipnames).

### POST /api/owner/logs/ip-names

Name an address or a range, or rename one

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `name` | string | yes | 1 to 80 characters |  |
| `target` | string | yes | e.g. `10.0.0.0/24` | An address, or a range such as 10.0.0.0/24. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `name` | string | yes |  |  |
| `target` | string | yes |  |  |

### POST /api/owner/logs/ip-names/delete

Take a name off an address or a range

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `target` | string | yes | e.g. `10.0.0.0/24` | An address, or a range such as 10.0.0.0/24. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `deleted` | boolean | yes |  |  |

### POST /api/owner/logs/prune

Apply the retention rules now

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

[`PruneResult`](#pruneresult).

### GET /api/owner/logs/stream

New log entries as they happen

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `q` | query | string | no |  | The Logs screen's search. |

**Reply 200**: Success

Text, as `text/event-stream`.

### GET /api/owner/portal

ProjectPortal's accounts

The service accounts ProjectPortal works through, each with its live keys and when they expire.

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 404, 429, 503 |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `accounts` | array of [`PortalAccount`](#portalaccount) | yes |  | Every service account, oldest first. |

### POST /api/owner/portal/connect

Connect ProjectPortal

Makes the service account named name (ProjectPortal when left out) if there is none, and one admin key for it, lasting days (1-365), that may make keys for other accounts and never makes sign-in links. Answers with the key and its credential, shown only now: paste it into ProjectPortal as this app's admin key.

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `days` | integer | yes | 1 to 365 | How long the key lasts, in days. |
| `name` | string | no | 1 to 80 characters; default `ProjectPortal` | The service account's name. Left out: ProjectPortal. |

**Reply 201**: Success

[`NewAPIKey`](#newapikey).

### POST /api/owner/portal/disconnect

Disconnect ProjectPortal

Revokes every key of the service account user_id, and with them every key and link those keys made. The account stays, with no way in, until Connect gives it a key again.

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `user_id` | integer | yes |  | The service account. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |
| `revoked` | integer | yes |  | Its keys revoked. The keys and links they made went with them. |

### GET /api/owner/settings

config.yaml, as a form

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 404, 429, 503 |

**Reply 200**: Success

[`SettingsSnapshot`](#settingssnapshot).

### POST /api/owner/settings

Save settings

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 403, 404, 409, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `changes` | object | yes |  | Setting paths and their new values. |
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `version` | string | yes |  |  |

**Reply 200**: Success

[`SettingsResult`](#settingsresult).

### POST /api/owner/users/{user_id}/password-access

Allow or block an account's password

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `user_id` | path | integer | yes | at least 1 | The account's id, from GET /api/admin/users (admin_list_users over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `allowed` | boolean | yes |  |  |
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |
| `password_blocked` | boolean | yes |  |  |

## Webhooks

| Method | Path | Summary | Who may call |
|---|---|---|---|
| GET | [`/api/owner/webhooks`](#get-apiownerwebhooks) | Webhooks | browser session only, the owner |
| POST | [`/api/owner/webhooks`](#post-apiownerwebhooks) | Create a webhook | browser session only, the owner |
| GET | [`/api/owner/webhooks/events`](#get-apiownerwebhooksevents) | Events a webhook can ask for | browser session only, the owner |
| POST | [`/api/owner/webhooks/{webhook_id}/delete`](#post-apiownerwebhookswebhook_iddelete) | Delete a webhook | browser session only, the owner |
| GET | [`/api/owner/webhooks/{webhook_id}/deliveries`](#get-apiownerwebhookswebhook_iddeliveries) | Recent deliveries | browser session only, the owner |
| POST | [`/api/owner/webhooks/{webhook_id}/deliveries/{delivery_id}/resend`](#post-apiownerwebhookswebhook_iddeliveriesdelivery_idresend) | Send a failed delivery again | browser session only, the owner |
| POST | [`/api/owner/webhooks/{webhook_id}/enabled`](#post-apiownerwebhookswebhook_idenabled) | Switch a webhook on or off | browser session only, the owner |
| POST | [`/api/owner/webhooks/{webhook_id}/rename`](#post-apiownerwebhookswebhook_idrename) | Rename a webhook | browser session only, the owner |
| POST | [`/api/owner/webhooks/{webhook_id}/restore`](#post-apiownerwebhookswebhook_idrestore) | Undo deleting a webhook | browser session only, the owner |
| POST | [`/api/owner/webhooks/{webhook_id}/rotate-secret`](#post-apiownerwebhookswebhook_idrotate-secret) | Replace a webhook's signing secret | browser session only, the owner |
| POST | [`/api/owner/webhooks/{webhook_id}/target`](#post-apiownerwebhookswebhook_idtarget) | Change a webhook's address and events | browser session only, the owner |
| POST | [`/api/owner/webhooks/{webhook_id}/test`](#post-apiownerwebhookswebhook_idtest) | Send a test event | browser session only, the owner |

### GET /api/owner/webhooks

Webhooks

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `limit` | query | integer | no | 1 to 1000; default `200` | Rows to return. Default 200. |
| `offset` | query | integer | no | at least 0 | Rows to skip: the next value of the previous page. |
| `q` | query | string | no |  | Keep webhooks whose name or address contains this, in any case. |
| `sort` | query | string | no | one of `name`, `url`, `enabled` | Field to sort the whole list by. Rows without it go last. |
| `dir` | query | string | no | one of `asc`, `desc` | Default asc. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `next` | integer or null | yes |  | Offset of the next page, or null on the last one. |
| `total` | integer | yes |  |  |
| `webhooks` | array of [`Webhook`](#webhook) | yes |  |  |

### POST /api/owner/webhooks

Create a webhook

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 403, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `events` | array of string | yes |  |  |
| `name` | string | yes | 1 to 80 characters |  |
| `url` | string | yes | 1 to 2000 characters |  |

**Reply 201**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `created_at` | string (date-time) | yes |  |  |
| `enabled` | boolean | yes |  |  |
| `events` | array of string | yes |  |  |
| `id` | string | yes |  |  |
| `name` | string | yes |  |  |
| `secret` | string | yes |  | Shown in this response only. |
| `url` | string | yes |  |  |

### GET /api/owner/webhooks/events

Events a webhook can ask for

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 404, 429, 503 |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `events` | array of string | yes |  |  |

### POST /api/owner/webhooks/{webhook_id}/delete

Delete a webhook

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `webhook_id` | path | string | yes |  | The webhook's id, from GET /api/owner/webhooks. |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### GET /api/owner/webhooks/{webhook_id}/deliveries

Recent deliveries

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `webhook_id` | path | string | yes |  | The webhook's id, from GET /api/owner/webhooks. |
| `limit` | query | integer | no | 1 to 1000; default `200` | Rows to return. Default 200. |
| `offset` | query | integer | no | at least 0 | Rows to skip: the next value of the previous page. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `deliveries` | array of [`WebhookDelivery`](#webhookdelivery) | yes |  |  |
| `next` | integer or null | yes |  | Offset of the next page, or null on the last one. |
| `total` | integer | yes |  |  |

### POST /api/owner/webhooks/{webhook_id}/deliveries/{delivery_id}/resend

Send a failed delivery again

A new delivery with the same body. The failed one stays listed.

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `webhook_id` | path | string | yes |  | The webhook's id, from GET /api/owner/webhooks. |
| `delivery_id` | path | string | yes |  | The delivery's id, from GET /api/owner/webhooks/{webhook_id}/deliveries. |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 202**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### POST /api/owner/webhooks/{webhook_id}/enabled

Switch a webhook on or off

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `webhook_id` | path | string | yes |  | The webhook's id, from GET /api/owner/webhooks. |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `enabled` | boolean | yes |  |  |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### POST /api/owner/webhooks/{webhook_id}/rename

Rename a webhook

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `webhook_id` | path | string | yes |  | The webhook's id, from GET /api/owner/webhooks. |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `expect` | string or null | no |  | The name you think it has. Answers 409 if it has another. |
| `name` | string | yes | 1 to 80 characters | 1-80 characters. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `name` | string | yes |  |  |
| `ok` | boolean | yes |  |  |

### POST /api/owner/webhooks/{webhook_id}/restore

Undo deleting a webhook

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `webhook_id` | path | string | yes |  | The webhook's id, from GET /api/owner/webhooks. |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

[`Webhook`](#webhook).

### POST /api/owner/webhooks/{webhook_id}/rotate-secret

Replace a webhook's signing secret

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `webhook_id` | path | string | yes |  | The webhook's id, from GET /api/owner/webhooks. |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `secret` | string | yes |  | Shown only here. The old one has stopped working. |

### POST /api/owner/webhooks/{webhook_id}/target

Change a webhook's address and events

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `webhook_id` | path | string | yes |  | The webhook's id, from GET /api/owner/webhooks. |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `events` | array of string | yes |  |  |
| `expect` | object or null | no |  | What you think it has now. Answers 409 if it has something else. |
| `expect.events` | array of string | yes |  |  |
| `expect.url` | string | yes |  |  |
| `url` | string | yes | 1 to 2000 characters | Checked like a new webhook's. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### POST /api/owner/webhooks/{webhook_id}/test

Send a test event

|  |  |
|---|---|
| Who may call | browser session only, the owner |
| Errors | 400, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `webhook_id` | path | string | yes |  | The webhook's id, from GET /api/owner/webhooks. |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 202**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

## Monitoring

| Method | Path | Summary | Who may call |
|---|---|---|---|
| GET | [`/api/api.json`](#get-apiapijson) | This document | browser session or API key, anyone signed in |
| GET | [`/api/api.md`](#get-apiapimd) | The API reference as Markdown tables for people | browser session or API key, anyone signed in |
| GET | [`/api/health`](#get-apihealth) | Is the process up | anyone |
| GET | [`/api/mcp.json`](#get-apimcpjson) | The MCP tools: every tool /mcp has, its arguments, and the route it stands for | browser session or API key, anyone signed in |
| GET | [`/api/mcp.md`](#get-apimcpmd) | The MCP tools as Markdown tables for people | browser session or API key, anyone signed in |
| GET | [`/api/ready`](#get-apiready) | Can the server do real work | anyone |
| GET | [`/mcp`](#get-mcp) | Refused: this server has no stream | anyone |
| POST | [`/mcp`](#post-mcp) | Model Context Protocol, at the key's role | API key only, anyone signed in |
| DELETE | [`/mcp`](#delete-mcp) | Refused: this server keeps no sessions | anyone |
| GET | [`/metrics`](#get-metrics) | Prometheus metrics | API key only, admins |

### GET /api/api.json

This document

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: The API reference itself; GET /api/mcp.json is the MCP one. |
| Errors | 401, 404, 429, 503 |

**Reply 200**: Success

An empty object.

### GET /api/api.md

The API reference as Markdown tables for people

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: The API reference itself, for people; GET /api/api.json is the same as JSON. |
| Errors | 401, 404, 429, 503 |

**Reply 200**: Success

Text, as `text/markdown`.

### GET /api/health

Is the process up

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 429, 503 |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### GET /api/mcp.json

The MCP tools: every tool /mcp has, its arguments, and the route it stands for

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: The MCP reference itself; tools/list gives the same list. |
| Errors | 401, 404, 429, 503 |

**Reply 200**: Success

An empty object.

### GET /api/mcp.md

The MCP tools as Markdown tables for people

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: The MCP reference itself, for people; tools/list gives the same list. |
| Errors | 401, 404, 429, 503 |

**Reply 200**: Success

Text, as `text/markdown`.

### GET /api/ready

Can the server do real work

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 429, 503 |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### GET /mcp

Refused: this server has no stream

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 404, 429, 503 |

**Reply 405**: Success

### POST /mcp

Model Context Protocol, at the key's role

|  |  |
|---|---|
| Who may call | API key only, anyone signed in |
| MCP tool | None, HTTP only: The MCP endpoint itself. |
| Errors | 400, 401, 403, 404, 429, 503 |

**Request body**

An empty object.

**Reply 200**: Success

An empty object.

### DELETE /mcp

Refused: this server keeps no sessions

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 404, 429, 503 |

**Reply 405**: Success

### GET /metrics

Prometheus metrics

|  |  |
|---|---|
| Who may call | API key only, admins |
| MCP tool | None, HTTP only: Scraped by Prometheus over HTTP. |
| Errors | 401, 403, 404, 429, 503 |

**Reply 200**: Success

Text, as `text/plain`.

## Experiments

| Method | Path | Summary | Who may call |
|---|---|---|---|
| GET | [`/api/experiments`](#get-apiexperiments) | List experiments | browser session or API key, anyone signed in |
| POST | [`/api/experiments`](#post-apiexperiments) | Create an experiment | browser session or API key, anyone signed in |
| GET | [`/api/experiments/{experiment_id}`](#get-apiexperimentsexperiment_id) | Read an experiment | browser session or API key, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/action`](#post-apiexperimentsexperiment_idaction) | Make one change to an experiment | browser session or API key, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/bundle`](#post-apiexperimentsexperiment_idbundle) | Download the PsychoPy bundle for run plans | browser session or API key, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/delete`](#post-apiexperimentsexperiment_iddelete) | Delete an experiment | browser session only, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/duplicate`](#post-apiexperimentsexperiment_idduplicate) | Duplicate an experiment | browser session or API key, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/editors`](#post-apiexperimentsexperiment_ideditors) | Choose who can edit an experiment | browser session or API key, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/launch`](#post-apiexperimentsexperiment_idlaunch) | Start PsychoPy on this machine | browser session only, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/media`](#post-apiexperimentsexperiment_idmedia) | Upload a picture | browser session or API key, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/media/url`](#post-apiexperimentsexperiment_idmediaurl) | Add a picture fetched from a URL | browser session or API key, anyone signed in |
| GET | [`/api/experiments/{experiment_id}/media/{filename}`](#get-apiexperimentsexperiment_idmediafilename) | Get a picture | browser session or API key, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/publish`](#post-apiexperimentsexperiment_idpublish) | Publish the experiment's run plans and figures | browser session or API key, anyone signed in |
| GET | [`/api/experiments/{experiment_id}/published`](#get-apiexperimentsexperiment_idpublished) | What was last published | browser session or API key, anyone signed in |
| GET | [`/api/experiments/{experiment_id}/published/figures/{name}`](#get-apiexperimentsexperiment_idpublishedfiguresname) | Get a published figure | browser session or API key, anyone signed in |
| GET | [`/api/experiments/{experiment_id}/published/plans/{name}`](#get-apiexperimentsexperiment_idpublishedplansname) | Get a published run plan | browser session or API key, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/report`](#post-apiexperimentsexperiment_idreport) | Download the report zip or report.xlsx | browser session or API key, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/restore`](#post-apiexperimentsexperiment_idrestore) | Undo deleting an experiment | browser session only, anyone signed in |
| GET | [`/api/experiments/{experiment_id}/results`](#get-apiexperimentsexperiment_idresults) | How each run brought back went | browser session or API key, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/results/add`](#post-apiexperimentsexperiment_idresultsadd) | Add run records for the results screen | browser session or API key, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/results/remove`](#post-apiexperimentsexperiment_idresultsremove) | Forget one run's results | browser session or API key, anyone signed in |
| GET | [`/api/experiments/{experiment_id}/revision`](#get-apiexperimentsexperiment_idrevision) | An experiment's revision | browser session or API key, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/save`](#post-apiexperimentsexperiment_idsave) | Save an experiment | browser session or API key, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/seen`](#post-apiexperimentsexperiment_idseen) | What a participant has been shown | browser session or API key, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/seen/add`](#post-apiexperimentsexperiment_idseenadd) | Add run records brought back from a bundle | browser session or API key, anyone signed in |
| GET | [`/api/launches/latest`](#get-apilauncheslatest) | The latest PsychoPy launch | browser session only, anyone signed in |
| GET | [`/api/launches/{launch_id}`](#get-apilauncheslaunch_id) | A PsychoPy launch's state | browser session only, anyone signed in |
| POST | [`/api/launches/{launch_id}/stop`](#post-apilauncheslaunch_idstop) | Stop a PsychoPy launch | browser session only, anyone signed in |
| GET | [`/api/psychopy`](#get-apipsychopy) | Can this server run PsychoPy | browser session or API key, anyone signed in |

### GET /api/experiments

List experiments

Every experiment this account owns or can edit: id, name, owner, editors, revision and when it last changed.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`list_experiments`](mcp.md#list_experiments) |
| Errors | 401, 429, 503 |

**Reply 200**: Success

Array of [`Experiment`](#experiment).

### POST /api/experiments

Create an experiment

A new experiment owned by this account. doc needs at least name and format_version (3); everything left out gets its default when the experiment is opened or changed. Answers the new experiment with its doc.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`create_experiment`](mcp.md#create_experiment) |
| Errors | 400, 401, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `doc` | object | yes |  | A design document: at least {"name": ..., "format_version": 3}. |

**Reply 201**: Success

[`ExperimentWithDoc`](#experimentwithdoc).

### GET /api/experiments/{experiment_id}

Read an experiment

One experiment's full design document (doc) and its revision. The doc holds scanner settings, display defaults, the fixation mark, design-wide jitter, the hours budget, media (pictures by sha256), prompt lists (columns + items), trial_types (phases with durations and layers; a layer value written {column} is filled from the trial's prompt item; a duration with inherit set follows doc.jitter), runs (blocks of trial types) and sessions (steps, each with a repeat count).

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`get_experiment`](mcp.md#get_experiment) |
| Errors | 400, 401, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Reply 200**: Success

[`ExperimentWithDoc`](#experimentwithdoc).

### POST /api/experiments/{experiment_id}/action

Make one change to an experiment

One small edit, without sending the whole document. action is <thing>.<verb>: things are list, item, trial, phase, run, block, session, step; verbs are add (fields; returns the new id), update (id, fields; only those fields change), delete (id; refused while something uses it) and move (id, position from 0). An item needs list, a phase trial, a block run, a step session: each the parent's id. Also settings.update (section: scanner, display, keys, budget, limits, hrf, jitter, fixation or meta; fields) and experiment.update (fields: name, notes). A new thing needs only the fields you care about; the rest get their defaults.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`experiment_action`](mcp.md#experiment_action) |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `action` | string | yes | one of `list.add`, `list.update`, `list.delete`, `list.move`, `item.add`, `item.update`, `item.delete`, `item.move`, `trial.add`, `trial.update`, `trial.delete`, `trial.move`, `phase.add`, `phase.update`, `phase.delete`, `phase.move`, `run.add`, `run.update`, `run.delete`, `run.move`, `block.add`, `block.update`, `block.delete`, `block.move`, `session.add`, `session.update`, `session.delete`, `session.move`, `step.add`, `step.update`, `step.delete`, `step.move`, `settings.update`, `experiment.update` | <thing>.<verb>. |
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `fields` | object | no |  | The fields to set. |
| `id` | string | no |  | What to update, delete or move. |
| `list` | string | no |  | The prompt list, for an item action. |
| `position` | integer | no | at least 0 | Where to move it, from 0. |
| `run` | string | no |  | The run, for a block action. |
| `section` | string | no |  | For settings.update. |
| `session` | string | no |  | The session, for a step action. |
| `trial` | string | no |  | The trial type, for a phase action. |

**Reply 200**: Success

[`ActionResult`](#actionresult).

### POST /api/experiments/{experiment_id}/bundle

Download the PsychoPy bundle for run plans

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: A zip download: A file, not JSON: it goes over HTTP, with the same key. |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `plans` | array of object | yes |  | 1 to 64 run plans (fmri-run-plan/1), as static/js/compile.js makes them. |

**Reply 200**: The bundle, as an attachment

Text, as `application/zip`.

### POST /api/experiments/{experiment_id}/delete

Delete an experiment

Deletes an experiment; the owner can restore it for a while. Only the owner may.

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### POST /api/experiments/{experiment_id}/duplicate

Duplicate an experiment

A copy of an experiment, owned by this account, with its pictures. name is the copy's name; left out, it keeps the original's. Answers the copy with its doc.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`duplicate_experiment`](mcp.md#duplicate_experiment) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `name` | string | no |  | The copy's name. Left out or blank, it keeps the original's. |

**Reply 201**: Success

[`ExperimentWithDoc`](#experimentwithdoc).

### POST /api/experiments/{experiment_id}/editors

Choose who can edit an experiment

Replaces the list of people, by user id, who may edit an experiment besides its owner. Only the owner may.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`set_experiment_editors`](mcp.md#set_experiment_editors) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `editors` | array of integer | yes |  | User ids, from GET /api/team (list_team over MCP). |

**Reply 200**: Success

[`Experiment`](#experiment).

### POST /api/experiments/{experiment_id}/launch

Start PsychoPy on this machine

Runs the plans in PsychoPy here, where app/core/psychopy.py says this server may (a 503 says why not). One launch at a time: a 409 while another is running.

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `debug` | boolean | no |  |  |
| `flip` | string | no | one of `none`, `horizontal`, `vertical`, `both`; default `none` |  |
| `label` | string | no |  | What to call the launch; the experiment's name when empty. Cut to 200 characters. |
| `plans` | array of object | yes |  | 1 to 64 run plans (fmri-run-plan/1), as static/js/compile.js makes them. |
| `scanner` | string | no | one of `wait`, `simulate`, `none`; default `wait` |  |
| `screen` | integer | no | 0 to 15 |  |
| `windowed` | boolean | no |  |  |

**Reply 201**: Created

[`PsychoPyLaunch`](#psychopylaunch).

### POST /api/experiments/{experiment_id}/media

Upload a picture

The body is the picture's bytes. A browser session sends its csrf token in the X-CSRF-Token header. A picture over media.max_mb is refused with a 413.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: Picture bytes: MCP messages are JSON. Send the file to this route with the same key. |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |
| `X-CSRF-Token` | header | string | no |  | From GET /api/me. Browser sessions only. |

**Request body**

Raw bytes, as `application/octet-stream`.

**Reply 201**: Created

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ext` | string | yes |  |  |
| `h` | integer | yes |  | Height in pixels. |
| `id` | string | yes |  | The picture's SHA-256, which is its name. |
| `mime` | string | yes |  |  |
| `size` | integer | yes |  | Bytes. |
| `w` | integer | yes |  | Width in pixels. |

### POST /api/experiments/{experiment_id}/media/url

Add a picture fetched from a URL

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: Adding pictures is part of editing a design in the browser; a picture's bytes never pass through MCP. |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `url` | string | yes |  | An http or https address of a picture. |

**Reply 201**: Created

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ext` | string | yes |  |  |
| `h` | integer | yes |  | Height in pixels. |
| `id` | string | yes |  | The picture's SHA-256, which is its name. |
| `mime` | string | yes |  |  |
| `size` | integer | yes |  | Bytes. |
| `source_url` | string | yes |  | Where the picture came from, after any redirects. |
| `w` | integer | yes |  | Width in pixels. |

### GET /api/experiments/{experiment_id}/media/{filename}

Get a picture

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: Picture bytes: MCP messages are JSON. |
| Errors | 400, 401, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |
| `filename` | path | string | yes |  | The picture's id and extension: <id>.<ext>. |

**Reply 200**: The picture, in its own image type, with a long private cache: its address is its content.

Raw bytes, as `application/octet-stream`.

### POST /api/experiments/{experiment_id}/publish

Publish the experiment's run plans and figures

In parts small enough for a request each: the first part (no version) starts a publish and answers its version, each later part sends it, and the part with finish makes it the published copy, answering the manifest. Readers see the old copy until then.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: Publishing compiles the plans in the browser. |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `figures` | array of any or null | no |  | Figures: {name, svg, png}, png as base64. |
| `finish` | boolean | no |  | True on the last part: it becomes the published copy. |
| `plans` | array of any or null | no |  | Run plans (fmri-run-plan/1), as the browser compiles them. |
| `seed` | integer or null | no |  | The design's seed, recorded with the publish. |
| `version` | string | no |  | The version the first part answered; empty to start a publish. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `experiment_id` | string | no |  |  |
| `figures` | array of string | no |  |  |
| `plans` | array of object | no |  |  |
| `published_at` | string (date-time) | no |  |  |
| `published_by` | integer | no |  |  |
| `published_by_name` | string | no |  |  |
| `revision` | integer | no |  |  |
| `seed` | integer | no |  |  |
| `version` | string | yes |  |  |

### GET /api/experiments/{experiment_id}/published

What was last published

The manifest of an experiment's last publish: its version, the revision it was made from, who published it and when, and the run plans and figures in it (fetched over HTTP by name), plus current_revision, so you can tell whether the design changed since. Publishing itself is done from the browser, which compiles the plans.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`get_published`](mcp.md#get_published) |
| Errors | 400, 401, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `current_revision` | integer | yes |  | The experiment's revision now. |
| `experiment_id` | string | yes |  |  |
| `figures` | array of string | yes |  | File names, each at published/figures/<name>. |
| `plans` | array of object | yes |  | label, run, name, total_seconds, volumes, media, and session for a session's plan. Each is at published/plans/<label>.json. |
| `published_at` | string (date-time) | yes |  |  |
| `published_by` | integer | yes |  |  |
| `published_by_name` | string | yes |  |  |
| `revision` | integer | yes |  | The experiment's revision it was published from. |
| `seed` | integer | yes |  |  |
| `version` | string | yes |  |  |

### GET /api/experiments/{experiment_id}/published/figures/{name}

Get a published figure

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: Figure bytes: MCP messages are JSON. |
| Errors | 400, 401, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |
| `name` | path | string | yes |  | A file name from the manifest (GET .../published). |

**Reply 200**: The figure, as SVG (with a sandboxing Content-Security-Policy) or PNG, by its name.

Raw bytes, as `application/octet-stream`.

### GET /api/experiments/{experiment_id}/published/plans/{name}

Get a published run plan

One run plan of the last publish, as fmri-run-plan/1 JSON: what a runner plays. name is <label>.json from the manifest.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: A runner fetches its plans over HTTP with its key; get_published lists them. |
| Errors | 400, 401, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |
| `name` | path | string | yes |  | A file name from the manifest (GET .../published). |

**Reply 200**: Success

An empty object.

### POST /api/experiments/{experiment_id}/report

Download the report zip or report.xlsx

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: A document download: A file, not JSON: it goes over HTTP, with the same key. |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `figures` | array of object | no |  | At most 100: each {name, svg, png}, png base64 and optional. |
| `methods` | string | no |  | The methods text, as Markdown. |
| `only` | string | no | one of ``, `xlsx` | xlsx for report.xlsx alone; otherwise the whole zip. |
| `tables` | array of object | yes |  | At most 200: each {id, title, columns, rows}. |

**Reply 200**: The report zip, or report.xlsx alone when only is xlsx, as an attachment

Raw bytes, as `application/octet-stream`.

### POST /api/experiments/{experiment_id}/restore

Undo deleting an experiment

Brings back an experiment deleted a short while ago.

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

[`Experiment`](#experiment).

### GET /api/experiments/{experiment_id}/results

How each run brought back went

How every run brought back went, newest first, each with a verdict.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: The PsychoPy runner's exchange with the designer (runner/), over HTTP with the same key. |
| Errors | 400, 401, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `runs` | array of object | yes |  | Every run brought back, newest first, each with its verdict. |

### POST /api/experiments/{experiment_id}/results/add

Add run records for the results screen

Run records brought back from a bundle, trimmed by the run dialog to what results.summarise reads.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: The PsychoPy runner's exchange with the designer (runner/), over HTTP with the same key. |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `records` | array of object | yes |  | Run records brought back from a bundle, trimmed to what app/models/results.py summarise reads. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `added` | integer | yes |  | How many were new. Records from another experiment are skipped. |

### POST /api/experiments/{experiment_id}/results/remove

Forget one run's results

For a record brought back by mistake. The files themselves are untouched.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: The PsychoPy runner's exchange with the designer (runner/), over HTTP with the same key. |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `run` | string | yes |  | The run's name, as GET .../results gives it. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `removed` | boolean | yes |  |  |

### GET /api/experiments/{experiment_id}/revision

An experiment's revision

Only the revision, and who changed it last if not you: a cheap way to see whether an experiment changed since it was read. An open page asks every few seconds.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`experiment_revision`](mcp.md#experiment_revision) |
| Errors | 400, 401, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `revision` | integer | yes |  |  |
| `updated_by_name` | string | yes |  | Who changed it last, or empty when it was you. |

### POST /api/experiments/{experiment_id}/save

Save an experiment

Replace an experiment's design document. Send the whole doc as read, changed, with base_revision set to the revision it came from. Refused with 409 (and the current revision) if it has changed since; read it again and reapply. Anyone with the experiment open in a browser sees the change within a few seconds.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`save_experiment`](mcp.md#save_experiment) |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `base_revision` | integer | yes | at least 1 | The revision the doc was read at. |
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `doc` | object | yes |  | The whole design document. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `id` | string | yes |  |  |
| `revision` | integer | yes |  |  |
| `updated_at` | string (date-time) | yes |  |  |

### POST /api/experiments/{experiment_id}/seen

What a participant has been shown

A POST so the participant's label stays out of URLs and access logs.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: The PsychoPy runner's exchange with the designer (runner/), over HTTP with the same key. |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `participant` | string | no |  | The participant's label. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `highest_visit` | integer | yes |  |  |
| `items` | array of string | yes |  | The ids of the list items this participant has been shown. |
| `runs` | integer | yes |  | How many runs of theirs were brought back. |

### POST /api/experiments/{experiment_id}/seen/add

Add run records brought back from a bundle

Run records brought back from a bundle, trimmed by the run dialog to what seen.summarise keeps. One already recorded changes nothing.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | None, HTTP only: The PsychoPy runner's exchange with the designer (runner/), over HTTP with the same key. |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `runs` | array of object | yes |  | Run records brought back from a bundle, trimmed to what app/models/seen.py summarise keeps. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `added` | integer | yes |  | How many were new. Records from another experiment are skipped. |

### GET /api/launches/latest

The latest PsychoPy launch

Your most recent launch on this machine, or null if there is none.

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 401, 403, 429, 503 |

**Reply 200**: Success

[`PsychoPyLaunch`](#psychopylaunch) or null.

### GET /api/launches/{launch_id}

A PsychoPy launch's state

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `launch_id` | path | string | yes |  | The launch's id, from POST /api/experiments/{experiment_id}/launch or GET /api/launches/latest. |

**Reply 200**: Success

[`PsychoPyLaunch`](#psychopylaunch).

### POST /api/launches/{launch_id}/stop

Stop a PsychoPy launch

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `launch_id` | path | string | yes |  | The launch's id, from POST /api/experiments/{experiment_id}/launch or GET /api/launches/latest. |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

[`PsychoPyLaunch`](#psychopylaunch).

### GET /api/psychopy

Can this server run PsychoPy

Whether this server can start PsychoPy runs itself, and why not if it cannot. refresh looks again rather than using the last answer.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`psychopy_status`](mcp.md#psychopy_status) |
| Errors | 400, 401, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `refresh` | query | boolean | no |  | Look again rather than using the last answer. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `available` | boolean | yes |  |  |
| `keyboard` | string | no |  |  |
| `psychopy_version` | string | no |  |  |
| `python` | string | no |  |  |
| `python_version` | string | no |  |  |
| `reason` | string | yes |  | Why not, when it cannot: switched_off, container, not_local, no_runner, ... |
| `source` | string | no |  |  |

## Scanner cards

| Method | Path | Summary | Who may call |
|---|---|---|---|
| GET | [`/api/scanner-cards`](#get-apiscanner-cards) | List scanner cards | browser session or API key, anyone signed in |
| POST | [`/api/scanner-cards`](#post-apiscanner-cards) | Add a scanner card | browser session or API key, anyone signed in |
| GET | [`/api/scanner-cards/revisions`](#get-apiscanner-cardsrevisions) | Scanner card revisions | browser session or API key, anyone signed in |
| GET | [`/api/scanner-cards/{card_id}`](#get-apiscanner-cardscard_id) | Read a scanner card | browser session or API key, anyone signed in |
| GET | [`/api/scanner-cards/{card_id}/backups`](#get-apiscanner-cardscard_idbackups) | A scanner card's backups | browser session or API key, anyone signed in |
| POST | [`/api/scanner-cards/{card_id}/backups/restore`](#post-apiscanner-cardscard_idbackupsrestore) | Put a scanner card back to a backup | browser session or API key, anyone signed in |
| POST | [`/api/scanner-cards/{card_id}/delete`](#post-apiscanner-cardscard_iddelete) | Delete a scanner card (restorable for a while) | browser session only, anyone signed in |
| POST | [`/api/scanner-cards/{card_id}/restore`](#post-apiscanner-cardscard_idrestore) | Undo deleting a scanner card | browser session only, anyone signed in |
| POST | [`/api/scanner-cards/{card_id}/save`](#post-apiscanner-cardscard_idsave) | Save a scanner card | browser session or API key, anyone signed in |
| POST | [`/api/scanner-cards/{card_id}/set-parameter`](#post-apiscanner-cardscard_idset-parameter) | Change one parameter on a scanner card | browser session or API key, anyone signed in |

### GET /api/scanner-cards

List scanner cards

Every card in the team's shared library: id, label, role, note and revision, and over HTTP its pages too.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`list_scanner_cards`](mcp.md#list_scanner_cards) |
| Errors | 401, 429, 503 |

**Reply 200**: Success

Array of [`ScannerCard`](#scannercard).

### POST /api/scanner-cards

Add a scanner card

Add a card to the shared library. Its id comes from its label.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`create_scanner_card`](mcp.md#create_scanner_card) |
| Errors | 400, 401, 403, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `card` | object | yes |  | label, role (functional, reference, structural or other), note, and pages: [{name, rows: [{parameter, value, indent}]}]. |
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 201**: Created

[`ScannerCard`](#scannercard).

### GET /api/scanner-cards/revisions

Scanner card revisions

Each card's id and revision only, as {id: revision}: a cheap way to see which cards changed since they were read.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`scanner_card_revisions`](mcp.md#scanner_card_revisions) |
| Errors | 401, 429, 503 |

**Reply 200**: Success

Map of integer.

### GET /api/scanner-cards/{card_id}

Read a scanner card

One card whole: the console's pages (INFO PAGE, GEOMETRY, ...), each a list of parameter rows, and its revision.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`get_scanner_card`](mcp.md#get_scanner_card) |
| Errors | 400, 401, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `card_id` | path | string | yes |  | The card's id, its slug: from GET /api/scanner-cards (list_scanner_cards over MCP). |

**Reply 200**: Success

[`ScannerCard`](#scannercard).

### GET /api/scanner-cards/{card_id}/backups

A scanner card's backups

The earlier versions of a card kept when it was saved over, newest first: revision, who saved it and when.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`list_scanner_card_backups`](mcp.md#list_scanner_card_backups) |
| Errors | 400, 401, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `card_id` | path | string | yes |  | The card's id, its slug: from GET /api/scanner-cards (list_scanner_cards over MCP). |

**Reply 200**: Success

Array of [`ScannerCardBackup`](#scannercardbackup).

### POST /api/scanner-cards/{card_id}/backups/restore

Put a scanner card back to a backup

Makes an earlier version (revision, from its backups) the card again. What it replaces is kept as a backup too. The library is shared: this changes the card for everyone.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`restore_scanner_card_backup`](mcp.md#restore_scanner_card_backup) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `card_id` | path | string | yes |  | The card's id, its slug: from GET /api/scanner-cards (list_scanner_cards over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `revision` | integer | yes |  | The backup's revision, from its backups (list_scanner_card_backups over MCP). |

**Reply 200**: Success

[`ScannerCard`](#scannercard).

### POST /api/scanner-cards/{card_id}/delete

Delete a scanner card (restorable for a while)

The last card in the library cannot be deleted (409).

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `card_id` | path | string | yes |  | The card's id, its slug: from GET /api/scanner-cards (list_scanner_cards over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### POST /api/scanner-cards/{card_id}/restore

Undo deleting a scanner card

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `card_id` | path | string | yes |  | The card's id, its slug: from GET /api/scanner-cards (list_scanner_cards over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

[`ScannerCard`](#scannercard).

### POST /api/scanner-cards/{card_id}/save

Save a scanner card

Replace a card, as read and changed, with base_revision set to the revision it came from. Refused (409, with the current revision) if it has changed since. What it replaces is kept as a backup. The library is shared: this changes the card for everyone.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`save_scanner_card`](mcp.md#save_scanner_card) |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `card_id` | path | string | yes |  | The card's id, its slug: from GET /api/scanner-cards (list_scanner_cards over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `base_revision` | integer | yes |  | The revision the card was read at. |
| `card` | object | yes |  | label, role (functional, reference, structural or other), note, and pages: [{name, rows: [{parameter, value, indent}]}]. |
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

[`ScannerCard`](#scannercard).

### POST /api/scanner-cards/{card_id}/set-parameter

Change one parameter on a scanner card

Set one parameter's value, without sending the whole card. page and parameter name a row that already exists; parameter ignores case. What it replaces is kept as a backup. The library is shared: this changes the card for everyone.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`set_scanner_parameter`](mcp.md#set_scanner_parameter) |
| Errors | 400, 401, 403, 404, 409, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `card_id` | path | string | yes |  | The card's id, its slug: from GET /api/scanner-cards (list_scanner_cards over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `page` | string | yes |  | The page's name, such as CONTRAST. |
| `parameter` | string | yes |  | The parameter's name, such as Flip angle (deg). |
| `value` | string | yes |  |  |

**Reply 200**: Success

[`ScannerCard`](#scannercard).

## Share links

| Method | Path | Summary | Who may call |
|---|---|---|---|
| GET | [`/api/experiments/{experiment_id}/share-links`](#get-apiexperimentsexperiment_idshare-links) | List an experiment's share links | browser session or API key, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/share-links`](#post-apiexperimentsexperiment_idshare-links) | Make a read-only share link | browser session only, anyone signed in |
| POST | [`/api/experiments/{experiment_id}/share-links/{link_id}/revoke`](#post-apiexperimentsexperiment_idshare-linkslink_idrevoke) | Revoke a share link | browser session or API key, anyone signed in |
| POST | [`/api/share/bundle`](#post-apisharebundle) | Download the PsychoPy bundle through a share link | anyone |
| POST | [`/api/share/open`](#post-apishareopen) | Open the experiment behind a share link | anyone |
| POST | [`/api/share/report`](#post-apisharereport) | Download the report through a share link | anyone |
| POST | [`/api/share/revision`](#post-apisharerevision) | The current revision behind a share link | anyone |
| GET | [`/s/{credential}/media/{filename}`](#get-scredentialmediafilename) | A picture, through a share link | anyone |

### GET /api/experiments/{experiment_id}/share-links

List an experiment's share links

The read-only links to this experiment that are out there: id, label, who made it, when, and whether it still works. Making one needs a browser.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`list_share_links`](mcp.md#list_share_links) |
| Errors | 400, 401, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Reply 200**: Success

Array of [`ShareLink`](#sharelink).

### POST /api/experiments/{experiment_id}/share-links

Make a read-only share link

|  |  |
|---|---|
| Who may call | browser session only, anyone signed in |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |
| `label` | string | no |  | What the link is for. Cut to 80 characters. |

**Reply 201**: Created

[`NewShareLink`](#newsharelink).

### POST /api/experiments/{experiment_id}/share-links/{link_id}/revoke

Revoke a share link

Stops a share link working, for good.

|  |  |
|---|---|
| Who may call | browser session or API key, anyone signed in |
| MCP tool | [`revoke_share_link`](mcp.md#revoke_share_link) |
| Errors | 400, 401, 403, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `experiment_id` | path | string | yes |  | The experiment's id, from GET /api/experiments (list_experiments over MCP). |
| `link_id` | path | string | yes |  | The link's id, from GET /api/experiments/{experiment_id}/share-links (list_share_links over MCP). |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `csrf_token` | string | no |  | From GET /api/me. Browser sessions only. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

### POST /api/share/bundle

Download the PsychoPy bundle through a share link

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 400, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `credential` | string | yes |  | The share link's credential: what follows /s/ in the link. |
| `plans` | array of object | yes |  | 1 to 64 run plans (fmri-run-plan/1), as static/js/compile.js makes them. |

**Reply 200**: The bundle, as an attachment

Text, as `application/zip`.

### POST /api/share/open

Open the experiment behind a share link

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 400, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `credential` | string | yes |  | The share link's credential: what follows /s/ in the link. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `doc` | object | yes |  | The whole design document. |
| `id` | string | yes |  |  |
| `label` | string | yes |  | The share link's label. |
| `name` | string | yes |  |  |
| `revision` | integer | yes |  |  |

### POST /api/share/report

Download the report through a share link

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 400, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `credential` | string | yes |  | The share link's credential: what follows /s/ in the link. |
| `figures` | array of object | no |  | At most 100: each {name, svg, png}, png base64 and optional. |
| `methods` | string | no |  | The methods text, as Markdown. |
| `only` | string | no | one of ``, `xlsx` | xlsx for report.xlsx alone; otherwise the whole zip. |
| `tables` | array of object | yes |  | At most 200: each {id, title, columns, rows}. |

**Reply 200**: The report zip, or report.xlsx alone when only is xlsx, as an attachment

Raw bytes, as `application/octet-stream`.

### POST /api/share/revision

The current revision behind a share link

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 400, 404, 429, 503 |

**Request body**

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `credential` | string | yes |  | The share link's credential: what follows /s/ in the link. |

**Reply 200**: Success

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `revision` | integer | yes |  |  |
| `updated_by_name` | string | yes |  | Always empty: a share link does not say who edits. |

### GET /s/{credential}/media/{filename}

A picture, through a share link

|  |  |
|---|---|
| Who may call | anyone |
| Errors | 400, 404, 429, 503 |

**Parameters**

| Name | In | Type | Required | Limits | Description |
|---|---|---|---|---|---|
| `credential` | path | string | yes |  | The share link's credential: what follows /s/ in the link. |
| `filename` | path | string | yes |  | <sha256>.<ext>, as the design's media lists it. |

**Reply 200**: The picture, in its own image type

Raw bytes, as `application/octet-stream`.

## Schemas

The shapes the routes above refer to by name.

### APIKey

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `created_at` | string (date-time) | yes |  |  |
| `created_by` | integer | no |  | The admin who made this key for its owner. Absent if the owner made it. |
| `created_by_name` | string | no |  |  |
| `display_name` | string | no |  | The key's owner. On the admin list only. |
| `expired` | boolean | yes |  |  |
| `expires_at` | string (date-time) | no |  |  |
| `id` | string | yes |  |  |
| `last_used_at` | string (date-time) | no |  |  |
| `live` | boolean | yes |  |  |
| `may_mint_keys` | boolean | yes |  | Whether this key may make keys for other accounts. Only the owner switches it on. |
| `may_sign_in` | boolean | yes |  | Whether this key may make a login link for its own account. |
| `minted_by_key` | string | yes |  | The key that made this one, or empty. Revoking that key revokes this one. |
| `name` | string | yes |  |  |
| `revoked` | boolean | yes |  |  |
| `revoked_at` | string (date-time) | no |  |  |
| `role` | string | yes | one of `admin`, `user`, `viewer` |  |
| `user_id` | integer | yes |  |  |

### ActionResult

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `id` | string | no |  |  |
| `revision` | integer | yes |  |  |

### BulkReply

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `done` | integer | yes |  | How many items worked. |
| `failed` | integer | yes |  | How many did not. |
| `results` | array of [`BulkResult`](#bulkresult) | yes |  | One per item, in the order they were sent. |

### BulkResult

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `error` | string | no |  | When it failed: the route's words for why. |
| `index` | integer | yes |  | The item's place in items, from 0. |
| `ok` | boolean | yes |  |  |
| `reply` | object | no |  | When it worked: the route's own reply, if it has one. |
| `request_id` | string | no |  | On a 5xx: the reference that finds this failure in the log. |
| `status` | integer | no |  | When it failed: the status the route would have answered. |

### Error

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `code` | string | no | one of `not_authenticated`, `not_admin`, `view_only`, `session_only`, `owner_required`, `owner_protected`, `key_minting_off`, `service_account`, `not_found`, `invalid`, `conflict`, `rate_limited`, `forbidden` | On a 4xx: why, for a program to branch on (error is for a person). The list is closed. |
| `error` | string | yes |  |  |
| `field` | string | no |  | On a 400 about one field: its name. |
| `request_id` | string | no |  | On a 5xx: the reference that finds this failure in the log. |

### Experiment

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `created_at` | string (date-time) | yes |  |  |
| `editors` | array of [`ExperimentEditor`](#experimenteditor) | yes |  |  |
| `id` | string | yes |  |  |
| `is_owner` | boolean | yes |  | Whether you own it: only the owner sets editors and deletes it. |
| `name` | string | yes |  |  |
| `owner` | integer | yes |  | The owner's user id. |
| `owner_name` | string | yes |  |  |
| `revision` | integer | yes |  |  |
| `updated_at` | string (date-time) | yes |  |  |
| `updated_by_name` | string | yes |  |  |

### ExperimentEditor

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `display_name` | string | yes |  |  |
| `id` | integer | yes |  |  |

### ExperimentWithDoc

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `created_at` | string (date-time) | yes |  |  |
| `doc` | object | yes |  | The whole design document. |
| `editors` | array of [`ExperimentEditor`](#experimenteditor) | yes |  |  |
| `id` | string | yes |  |  |
| `is_owner` | boolean | yes |  | Whether you own it: only the owner sets editors and deletes it. |
| `name` | string | yes |  |  |
| `owner` | integer | yes |  | The owner's user id. |
| `owner_name` | string | yes |  |  |
| `revision` | integer | yes |  |  |
| `updated_at` | string (date-time) | yes |  |  |
| `updated_by_name` | string | yes |  |  |

### File

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `chunks` | integer | yes |  |  |
| `created_at` | string (date-time) | yes |  |  |
| `id` | string | yes |  |  |
| `name` | string | yes |  |  |
| `received` | integer | yes |  |  |
| `size` | integer | yes |  |  |
| `state` | string | yes | one of `uploading`, `ready` |  |
| `type` | string | yes |  |  |

### IPNames

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `names` | array of object | yes |  |  |
| `names[].created_at` | string (date-time) | yes |  |  |
| `names[].name` | string | yes |  |  |
| `names[].target` | string | yes |  |  |

### InviteLink

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `created_by` | integer | yes |  |  |
| `created_by_name` | string | no |  |  |
| `expires_at` | string (date-time) | yes |  |  |
| `id` | string | yes |  |  |
| `label` | string | yes |  |  |
| `live` | boolean | yes |  |  |
| `max_uses` | integer | yes |  |  |
| `remaining` | integer | yes |  |  |
| `revoked` | boolean | yes |  |  |
| `role` | string | yes | one of `user`, `viewer` | The role each person who joins gets. |
| `used` | integer | yes |  |  |

### Job

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `interrupted` | boolean | yes |  |  |
| `interval_seconds` | integer | yes |  |  |
| `last_error` | string | no |  |  |
| `last_finished` | string (date-time) | no |  |  |
| `last_note` | string | no |  |  |
| `last_ok` | boolean or null | no |  |  |
| `last_started` | string (date-time) | no |  |  |
| `name` | string | yes |  |  |
| `next_due` | string (date-time) | yes |  |  |
| `running` | boolean | yes |  |  |
| `runs` | integer | yes |  |  |

### Joined

One of these:

1. An object:

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `display_name` | string | yes |  |  |
| `ok` | boolean | yes |  |  |

2. An object:

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `challenge` | string | yes |  |  |
| `two_factor` | boolean | yes |  |  |

### LogDay

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `date` | string | yes |  |  |
| `entries` | array of object | yes |  |  |
| `next` | integer or null | yes |  |  |

### LogDays

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `days` | array of object | yes |  |  |
| `dropped` | integer | yes |  |  |
| `settings` | object | yes |  |  |
| `total_bytes` | integer | yes |  |  |

### LoginLink

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `created_at` | string (date-time) | yes |  |  |
| `expires_at` | string (date-time) or null | yes |  | null when it never expires. |
| `last_used_at` | string (date-time) or null | yes |  |  |
| `max_uses` | integer | yes |  | Sign-ins it allows. 0 when unlimited. |
| `unlimited` | boolean | yes |  |  |
| `uses` | integer | yes |  | Sign-ins so far. |

### Maintenance

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `error` | string | yes |  |  |
| `maintenance` | string | yes | one of `read_only`, `full` |  |

### Me

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `account_role` | string | yes | one of `admin`, `user`, `viewer` |  |
| `announcement` | string | yes |  | server.announcement. Empty when there is none. |
| `api_doc_url` | string | yes |  | Where to read the API reference as a page for people: config/api.md in app.repo, or /docs/api when there is no repo. |
| `api_key_id` | string | no |  | API keys only. |
| `api_key_name` | string | no |  | API keys only. |
| `api_keys_enabled` | boolean | yes |  |  |
| `auth` | string | yes |  |  |
| `authenticated` | boolean | yes |  |  |
| `capabilities` | array of string | yes |  | The optional parts of that contract this app has on now: viewer_role, account_expiry, key_minting, invite_links, key_sign_in, service_accounts, key_grants, error_codes, key_rotation, admin_sessions. |
| `contract` | integer | yes |  | Which version of the portal contract this app speaks: the Portal contract section of the webserver skills' SKILL.md. |
| `csrf_token` | string | no |  | Browser sessions only. |
| `description` | string | yes |  | app.description. Empty when there is none. |
| `display_name` | string | yes |  |  |
| `files_enabled` | boolean | yes |  | files.enabled: whether the Files screen and routes are on. |
| `has_password` | boolean | yes |  |  |
| `has_pin` | boolean | yes |  |  |
| `id` | integer | yes |  |  |
| `invite_links_enabled` | boolean | yes |  | Whether invite links are on. |
| `is_owner` | boolean | yes |  |  |
| `key` | [`MeKey`](#mekey) | no |  | API keys only: what this key may do. |
| `kind` | string | yes | one of `person`, `service` | person, or service for an account that only has API keys and is never signed into (ProjectPortal's own). |
| `login_link` | [`LoginLink`](#loginlink) or null | yes |  | Your own live login link, or null. |
| `logs_enabled` | boolean | yes |  |  |
| `logs_ui_clicks` | boolean | yes |  |  |
| `maintenance` | string | yes | one of `none`, `read_only`, `full` |  |
| `may_mint_keys` | boolean | no |  | API keys only: whether this key may make keys for other accounts. |
| `mcp_doc_url` | string | yes |  | Where to read the MCP tools as a page for people: config/mcp.md in app.repo, or /docs/mcp when there is no repo. |
| `mcp_enabled` | boolean | yes |  | server.mcp: whether POST /mcp answers. |
| `mcp_url` | string | yes |  | Where to read the MCP reference: config/mcp.json in app.repo, or /api/mcp.json when there is no repo. Only with server.mcp on. |
| `openapi_url` | string | yes |  | Where to read this API's reference: config/api.json in app.repo, or /api/api.json when there is no repo. |
| `owner` | boolean | yes |  | Whether this is the owner's account: the same as is_owner, under portal contract v3's name. |
| `password_blocked` | boolean | yes |  |  |
| `passwords_enabled` | boolean | yes |  |  |
| `repo` | string | yes |  | app.repo without a trailing / or .git: where the source lives. Empty when it is not set. |
| `role` | string | yes | one of `admin`, `user`, `viewer` | The effective role: never higher than an API key's own. A viewer may read, and change nothing. |
| `shortcuts` | map of string | yes |  | The keyboard shortcuts you changed, by action. Mod is Cmd on a Mac and Ctrl elsewhere. |
| `show_about` | boolean | yes |  | app.show_about: whether the menu has About. |
| `skill` | string | no |  | The webserver skill this app was scaffolded from (go-webserver or python-webserver), from its .skill-origin.yaml. Absent when that is not known. |
| `skill_commit` | string | no |  | The skill's commit this app was scaffolded from or last upgraded to, from its .skill-origin.yaml. Absent when that is not known. |
| `theme_id` | string | yes |  | The theme you use. Empty: the first. |
| `themes` | array of [`Theme`](#theme) or null | yes |  | Your themes (see the Theme schema): your own list, else the app's defaults, else null for the built-in ones. |
| `themes_builtins` | integer | yes |  | Which built-in themes that list has seen (see builtins on POST /api/account/themes). |
| `themes_custom` | boolean | yes |  | Whether you have your own list rather than following the defaults. |
| `two_factor` | boolean | yes |  |  |
| `two_factor_enabled` | boolean | yes |  |  |
| `username` | string | yes |  |  |
| `version` | string | yes |  | The running build. dev when none was stamped. |
| `webhooks_enabled` | boolean | yes |  | webhooks.enabled: whether webhooks are sent. |

### MeKey

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `expires_at` | string (date-time) | no |  | When the key stops working. Absent when it never does. |
| `id` | string | yes |  |  |
| `may_mint_keys` | boolean | yes |  | Whether this key may make keys for other accounts. |
| `may_sign_in` | boolean | yes |  | Whether this key may make a login link for its own account. |
| `name` | string | yes |  |  |
| `role` | string | yes | one of `admin`, `user`, `viewer` | The key's own role. The role it acts with is the lower of this and the account's. |

### Member

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `display_name` | string | yes |  |  |
| `id` | integer | yes |  |  |

### NewAPIKey

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `created_at` | string (date-time) | yes |  |  |
| `created_by` | integer | no |  | The admin who made this key for its owner. Absent if the owner made it. |
| `created_by_name` | string | no |  |  |
| `credential` | string | yes |  | Shown in this response only, and never recoverable. |
| `display_name` | string | no |  | The key's owner. On the admin list only. |
| `expired` | boolean | yes |  |  |
| `expires_at` | string (date-time) | no |  |  |
| `id` | string | yes |  |  |
| `last_used_at` | string (date-time) | no |  |  |
| `live` | boolean | yes |  |  |
| `may_mint_keys` | boolean | yes |  | Whether this key may make keys for other accounts. Only the owner switches it on. |
| `may_sign_in` | boolean | yes |  | Whether this key may make a login link for its own account. |
| `minted_by_key` | string | yes |  | The key that made this one, or empty. Revoking that key revokes this one. |
| `name` | string | yes |  |  |
| `revoked` | boolean | yes |  |  |
| `revoked_at` | string (date-time) | no |  |  |
| `role` | string | yes | one of `admin`, `user`, `viewer` |  |
| `user_id` | integer | yes |  |  |

### NewShareLink

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `created_at` | string (date-time) | yes |  |  |
| `created_by` | integer | yes |  | The user id of whoever made it. |
| `id` | string | yes |  |  |
| `label` | string | yes |  |  |
| `path` | string | yes |  | /s/<credential>: the link itself, shown once. |
| `revoked` | boolean | yes |  |  |

### PortalAccount

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `display_name` | string | yes |  |  |
| `id` | integer | yes |  |  |
| `keys` | array of [`APIKey`](#apikey) | yes |  | Its live keys, newest first. |

### PruneResult

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `bytes_after` | integer | yes |  |  |
| `bytes_before` | integer | yes |  |  |
| `compressed` | integer | yes |  |  |
| `deleted` | integer | yes |  |  |

### PsychoPyLaunch

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ended_at` | string (date-time) or null | yes |  |  |
| `exit_code` | integer or null | yes |  |  |
| `folder` | string | yes |  |  |
| `id` | string | yes |  |  |
| `label` | string | yes |  |  |
| `log` | array of string | yes |  | The last lines of the runner's log. |
| `running` | boolean | yes |  |  |
| `started_at` | string (date-time) | yes |  |  |
| `stopped` | boolean | yes |  |  |

### Revoked

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `api_keys` | integer | yes |  |  |
| `login_links` | integer | yes |  |  |
| `passwords` | integer | yes |  |  |
| `sessions` | integer | yes |  |  |

### RotatedKey

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `credential` | string | yes |  | The key's new credential, shown in this response only. The old one stopped working. |

### ScannerCard

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `id` | string | yes |  |  |
| `label` | string | yes |  |  |
| `note` | string | yes |  |  |
| `pages` | array of [`ScannerCardPage`](#scannercardpage) | yes |  |  |
| `revision` | integer | yes |  |  |
| `role` | string | yes | one of `functional`, `reference`, `structural`, `other` |  |
| `updated_at` | string (date-time) | yes |  |  |

### ScannerCardBackup

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `label` | string | yes |  |  |
| `revision` | integer | yes |  |  |
| `saved_at` | string (date-time) | yes |  |  |
| `saved_by` | integer or null | yes |  | Who saved that version; null for a card the library started with. |
| `saved_by_name` | string | yes |  |  |

### ScannerCardPage

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `name` | string | yes |  |  |
| `rows` | array of [`ScannerCardRow`](#scannercardrow) | yes |  |  |

### ScannerCardRow

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `indent` | integer | yes |  |  |
| `parameter` | string | yes |  |  |
| `value` | string | yes |  |  |

### Session

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `created_at` | string (date-time) | yes |  |  |
| `current` | boolean | yes |  |  |
| `expires_at` | string (date-time) | yes |  |  |
| `id` | string | yes |  |  |
| `ip` | string | no |  |  |
| `ip_name` | string | no |  | What the owner calls this address on the Logs screen. The owner's own list only. |
| `label` | string | no |  | The name you gave this device. |
| `last_seen_at` | string (date-time) | no |  |  |
| `user_agent` | string | no |  |  |

### SettingsResult

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `applied` | array of string or null | yes |  |  |
| `changes` | array of object or null | yes |  |  |
| `restart` | array of string or null | yes |  |  |
| `scripts` | array of string or null | yes |  |  |
| `unchanged` | array of string or null | yes |  |  |
| `version` | string | yes |  |  |

### SettingsSnapshot

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `error` | object or null | yes |  |  |
| `error.at` | string (date-time) | yes |  |  |
| `error.message` | string | yes |  |  |
| `error.origin` | string | yes |  |  |
| `file` | string | yes |  |  |
| `in_container` | boolean | yes |  |  |
| `secret_file` | string | yes |  |  |
| `sections` | array of object | yes |  |  |
| `sections[].help` | string | yes |  |  |
| `sections[].keys` | array of object | yes |  |  |
| `sections[].keys[].apply` | string | yes |  |  |
| `sections[].keys[].default` | any | yes |  |  |
| `sections[].keys[].file_only` | boolean | yes |  | A path: change it in config.yaml, never here. |
| `sections[].keys[].help` | string | yes |  |  |
| `sections[].keys[].in_file` | boolean | yes |  |  |
| `sections[].keys[].key` | string | yes |  |  |
| `sections[].keys[].locked` | boolean | yes |  |  |
| `sections[].keys[].name` | string | yes |  |  |
| `sections[].keys[].pending_restart` | boolean | yes |  |  |
| `sections[].keys[].running` | any | yes |  |  |
| `sections[].keys[].type` | string | yes |  |  |
| `sections[].keys[].value` | any | yes |  |  |
| `sections[].name` | string | yes |  |  |
| `stale` | boolean | yes |  |  |
| `version` | string | yes |  | Send it back when saving: a changed file is refused with a 409. |
| `writable` | boolean | yes |  |  |

### ShareLink

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `created_at` | string (date-time) | yes |  |  |
| `created_by` | integer | yes |  | The user id of whoever made it. |
| `id` | string | yes |  |  |
| `label` | string | yes |  |  |
| `revoked` | boolean | yes |  |  |

### SignIn

One of these:

1. An object:

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `ok` | boolean | yes |  |  |

2. An object:

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `challenge` | string | yes |  |  |
| `two_factor` | boolean | yes |  |  |

### Theme

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `accent` | string | yes |  | The main color: what you can press. |
| `background` | string | no |  | The page. Left out: the mode's own. |
| `button` | object or null | no |  | How the theme's buttons look. A choice left out is the default (rounded, normal, raised, normal). |
| `button.case` | string | no | one of `normal`, `upper` |  |
| `button.depth` | string | no | one of `flat`, `raised`, `glossy` |  |
| `button.shape` | string | no | one of `square`, `soft`, `rounded`, `pill` |  |
| `button.weight` | string | no | one of `normal`, `medium`, `bold` |  |
| `dark` | object or null | no |  | A light theme's colors for dark mode, kept while it is light. Switching the theme to dark swaps them in. A light theme's light (or a dark theme's dark) is dropped. |
| `dark.accent` | string | yes |  | The main color: what you can press. |
| `dark.background` | string | no |  | The page. Left out: the mode's own. |
| `dark.overrides` | map of string | no |  | Worked-out colors replaced by name: text, accent, accentFg, accentText, second, secondFg, secondText, link, navLink, background, surface, nested, chrome, info, infoBorder, border, the Wright State roles (mast, mastFg, rule, heading, active, sunk), and for each button variant V (Secondary, Success, Danger, Warning, Info, Light, Dark) btnV, btnVFg and btnVText. Leaving one out puts the readable color back. |
| `dark.second` | string | yes |  | Says where you are: active nav item, headings, info. |
| `dark.surface` | string | no |  | Cards. Left out: the mode's own. |
| `id` | string | yes |  | Lower-case letters, digits, - and _, up to 32. |
| `light` | object or null | no |  | A dark theme's colors for light mode, kept while it is dark. Switching the theme to light swaps them in. |
| `light.accent` | string | yes |  | The main color: what you can press. |
| `light.background` | string | no |  | The page. Left out: the mode's own. |
| `light.overrides` | map of string | no |  | Worked-out colors replaced by name: text, accent, accentFg, accentText, second, secondFg, secondText, link, navLink, background, surface, nested, chrome, info, infoBorder, border, the Wright State roles (mast, mastFg, rule, heading, active, sunk), and for each button variant V (Secondary, Success, Danger, Warning, Info, Light, Dark) btnV, btnVFg and btnVText. Leaving one out puts the readable color back. |
| `light.second` | string | yes |  | Says where you are: active nav item, headings, info. |
| `light.surface` | string | no |  | Cards. Left out: the mode's own. |
| `mode` | string | yes | one of `light`, `dark` |  |
| `name` | string | yes |  | 1 to 60 characters. |
| `overrides` | map of string | no |  | Worked-out colors replaced by name: text, accent, accentFg, accentText, second, secondFg, secondText, link, navLink, background, surface, nested, chrome, info, infoBorder, border, the Wright State roles (mast, mastFg, rule, heading, active, sunk), and for each button variant V (Secondary, Success, Danger, Warning, Info, Light, Dark) btnV, btnVFg and btnVText. Leaving one out puts the readable color back. |
| `second` | string | yes |  | Says where you are: active nav item, headings, info. |
| `surface` | string | no |  | Cards. Left out: the mode's own. |

### User

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `created_at` | string (date-time) | yes |  |  |
| `disabled` | boolean | yes |  | Switched off, or its expiry has passed. |
| `display_name` | string | yes |  |  |
| `expired` | boolean | yes |  | Whether expires_at has passed. |
| `expires_at` | string (date-time) or null | yes |  | When the account stops working, or null for never. |
| `has_password` | boolean | yes |  |  |
| `id` | integer | yes |  |  |
| `kind` | string | yes | one of `person`, `service` | person, or service for an account with API keys only (ProjectPortal's own). |
| `login_link` | [`LoginLink`](#loginlink) or null | yes |  | The account's live login link, or null. |
| `owner` | boolean | yes |  |  |
| `password_blocked` | boolean | yes |  |  |
| `role` | string | yes | one of `admin`, `user`, `viewer` |  |
| `two_factor` | boolean | yes |  |  |
| `username` | string | yes |  | Empty until a password is set. |

### Webhook

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `created_at` | string (date-time) | yes |  |  |
| `enabled` | boolean | yes |  |  |
| `events` | array of string | yes |  |  |
| `id` | string | yes |  |  |
| `name` | string | yes |  |  |
| `url` | string | yes |  |  |

### WebhookDelivery

| Field | Type | Required | Limits | Description |
|---|---|---|---|---|
| `attempts` | integer | yes |  |  |
| `created_at` | string (date-time) | yes |  |  |
| `event` | string | yes |  |  |
| `finished_at` | string (date-time) | no |  |  |
| `id` | string | yes |  |  |
| `last_error` | string | no |  |  |
| `last_status` | integer | no |  |  |
| `next_attempt_at` | string (date-time) | yes |  |  |
| `status` | string | yes |  |  |
