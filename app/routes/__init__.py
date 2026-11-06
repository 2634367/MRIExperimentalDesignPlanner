"""The URL map -- the only place that knows every route this server answers.
Read build_routes top to bottom to see the whole surface.

The API stays deliberately small: it covers logging in, managing who can log
in, issuing the API keys that let non-browser callers in, and reading the UI's
text. Everything else an app does belongs in a new module in this package
(server side) and in static/js/ (browser side) -- see
references/architecture.md for where the line sits and why.

Protection comes from where a route is registered. group() attaches guards to
each route it builds, so a protected route cannot be written without its
guard, and the list below is a complete statement of who may call what.
Guards attach per route (Starlette's Route(middleware=...)), not per path
prefix, so a group never leaks onto routes outside it.
"""
from __future__ import annotations

from typing import Callable, Sequence

from starlette.middleware import Middleware
from starlette.routing import BaseRoute, Route

from app.core.config import Config
from app.core.security import RequireAdmin, RequireAPIKey, RequireLogin, RequireSession
from app.core.static_files import StaticServer
from app.mcp.protocol import Server as MCPServer
from app.routes import (
    account, admin, api_keys, auth, experiments, invite_links, join, mcp_tools, media, meta, psychopy, published, report, scanner_cards, share,
    team,
)
from app.routes.api_keys import RequireAPIKeys


def group(*guards: type) -> Callable[..., Route]:
    """A route builder whose routes all run behind the given guards, in
    order. Usage: signed_in = group(RequireLogin); signed_in("/api/me", me)."""
    middleware = [Middleware(guard) for guard in guards]

    def route(path: str, endpoint: Callable, methods: Sequence[str] = ("GET",)) -> Route:
        return Route(path, endpoint, methods=list(methods), middleware=middleware)

    return route


def build_routes(static_server: StaticServer, cfg: Config) -> list[BaseRoute]:
    public = group()
    signed_in = group(RequireLogin)
    sessions_only = group(RequireLogin, RequireSession)
    # API keys: any signed-in user manages their own, from a browser session.
    my_keys = group(RequireAPIKeys, RequireLogin, RequireSession)
    # Admin only: deciding who gets in.
    admins = group(RequireAdmin)
    # The two admin routes that hand out a login link also require a browser
    # session. A login link becomes a session, and a session can mint API
    # keys -- so if an admin-scoped key could create accounts or reissue
    # links, a leaked key could turn itself into a fresh session and a fresh
    # key, and revoking the leaked one would not end the compromise. The rule
    # is: an API key may use what an account can do, but it never creates
    # credentials. See RequireSession.
    #
    # Deleting an account requires a session too, for a different reason: it
    # cannot be undone. A leaked admin key can disable accounts, which an
    # admin can reverse; it must not be able to erase them. Who may delete
    # whom (the owner rules) is enforced in credentials.delete_user.
    admin_sessions = group(RequireAdmin, RequireSession)
    # Admin view of every key in the app -- "who has standing access" -- and
    # the ability to revoke or delete someone else's.
    admin_keys = group(RequireAPIKeys, RequireAdmin, RequireSession)

    routes: list[BaseRoute] = [
        # Public: the login link's page and the call it makes, the UI's text
        # (needed to render the signed-out page at all), and the healthcheck.
        # Opening a login link only shows a page; the link is spent by the
        # POST that page sends when the person confirms. See auth.py.
        public("/login/{credential:path}", static_server.serve_login_page),
        public("/api/login", auth.redeem_login_link, ["POST"]),
        public("/api/language", meta.get_language),
        public("/api/health", meta.get_health),
        # Public: invite links (see join.py). Holding the link is the
        # permission; like a login link, the GET only serves the page.
        public("/join/{credential:path}", static_server.serve_login_page),
        public("/api/join/info", join.join_info, ["POST"]),
        public("/api/join/match", join.join_match, ["POST"]),
        public("/api/join/claim", join.join_claim, ["POST"]),
        public("/api/join/create", join.join_create, ["POST"]),
        # Public: read-only share links (see share.py). Holding the link is the
        # permission, checked on every request; the GET only serves the page.
        public("/s/{credential}", static_server.serve_login_page),
        public("/s/{credential}/media/{filename}", share.shared_media),
        public("/api/share/open", share.open_shared, ["POST"]),
        public("/api/share/revision", share.shared_revision, ["POST"]),
        public("/api/share/bundle", share.shared_bundle, ["POST"]),
        public("/api/share/report", report.shared_report, ["POST"]),
        # Any signed-in user.
        signed_in("/api/me", account.me),
        signed_in("/api/account/rename", account.rename, ["POST"]),
        # A session only: a PIN lets its holder sign in through an invite
        # link, so a key that could set one could turn itself into a session.
        sessions_only("/api/account/pin", account.set_pin, ["POST"]),
        # A session only, for the same reason as every route that hands out
        # a login link: the link becomes a session. See admin_sessions above.
        sessions_only("/api/account/login-link", account.create_my_login_link, ["POST"]),
        signed_in("/api/logout", account.logout, ["POST"]),
        signed_in("/api/team", team.list_team),
        my_keys("/api/keys", api_keys.list_my_keys),
        my_keys("/api/keys", api_keys.create_my_key, ["POST"]),
        my_keys("/api/keys/{key_id}/revoke", api_keys.revoke_my_key, ["POST"]),
        my_keys("/api/keys/{key_id}/delete", api_keys.delete_my_key, ["POST"]),
        my_keys("/api/keys/{key_id}/restore", api_keys.restore_my_key, ["POST"]),
        admins("/api/admin/users", admin.list_users),
        admin_sessions("/api/admin/users", admin.create_user, ["POST"]),
        admin_sessions("/api/admin/users/{user_id}/reissue-login", admin.reissue_login, ["POST"]),
        admins("/api/admin/users/{user_id}/disabled", admin.set_user_disabled, ["POST"]),
        admins("/api/admin/users/{user_id}/revoke-access", admin.revoke_access, ["POST"]),
        admin_sessions("/api/admin/users/{user_id}/delete", admin.delete_user, ["POST"]),
        # Invite links: one link for a group, each person who opens it joins
        # as a new user (see invite_links.py). Creating one needs a session for
        # the same reason as creating a user -- the link mints accounts and
        # sessions. Deleting one needs a session like deleting a user. Listing
        # and switching one off are safe for an admin key.
        admins("/api/admin/invite-links", invite_links.list_invite_links),
        admin_sessions("/api/admin/invite-links", invite_links.create_invite_link, ["POST"]),
        admins("/api/admin/invite-links/{link_id}/revoke", invite_links.revoke_invite_link, ["POST"]),
        admin_sessions("/api/admin/invite-links/{link_id}/delete", invite_links.delete_invite_link, ["POST"]),
        admin_sessions("/api/admin/invite-links/{link_id}/restore", invite_links.restore_invite_link, ["POST"]),
        # Scanner cards: one library shared by every signed-in user (see
        # app/models/scanner_cards.py). Delete and restore need a session,
        # like an experiment's.
        signed_in("/api/scanner-cards", scanner_cards.list_cards),
        signed_in("/api/scanner-cards/revisions", scanner_cards.card_revisions),
        signed_in("/api/scanner-cards", scanner_cards.create_card, ["POST"]),
        signed_in("/api/scanner-cards/{card_id}/save", scanner_cards.save_card, ["POST"]),
        signed_in("/api/scanner-cards/{card_id}/backups", scanner_cards.list_backups),
        signed_in("/api/scanner-cards/{card_id}/backups/restore", scanner_cards.restore_backup, ["POST"]),
        sessions_only("/api/scanner-cards/{card_id}/delete", scanner_cards.delete_card, ["POST"]),
        sessions_only("/api/scanner-cards/{card_id}/restore", scanner_cards.restore_card, ["POST"]),
        # Experiments: any signed-in user, for the experiments they own or
        # were made an editor of (app/models/experiments.py decides which).
        # Deleting needs a session like every other delete; restoring it too.
        signed_in("/api/experiments", experiments.list_experiments),
        signed_in("/api/experiments", experiments.create_experiment, ["POST"]),
        signed_in("/api/experiments/{experiment_id}", experiments.get_experiment),
        signed_in("/api/experiments/{experiment_id}/revision", experiments.get_revision),
        signed_in("/api/experiments/{experiment_id}/save", experiments.save_experiment, ["POST"]),
        signed_in("/api/experiments/{experiment_id}/duplicate", experiments.duplicate_experiment, ["POST"]),
        signed_in("/api/experiments/{experiment_id}/editors", experiments.set_editors, ["POST"]),
        sessions_only("/api/experiments/{experiment_id}/delete", experiments.delete_experiment, ["POST"]),
        sessions_only("/api/experiments/{experiment_id}/restore", experiments.restore_experiment, ["POST"]),
        signed_in("/api/experiments/{experiment_id}/media", media.upload, ["POST"]),
        signed_in("/api/experiments/{experiment_id}/media/url", media.from_url, ["POST"]),
        signed_in("/api/experiments/{experiment_id}/media/{filename}", media.serve),
        signed_in("/api/experiments/{experiment_id}/bundle", psychopy.download_bundle, ["POST"]),
        signed_in("/api/experiments/{experiment_id}/action", experiments.run_action, ["POST"]),
        signed_in("/api/experiments/{experiment_id}/publish", published.publish, ["POST"]),
        signed_in("/api/experiments/{experiment_id}/published", published.get_manifest),
        signed_in("/api/experiments/{experiment_id}/published/plans/{name}", published.serve_plan),
        signed_in("/api/experiments/{experiment_id}/published/figures/{name}", published.serve_figure),
        signed_in("/api/experiments/{experiment_id}/seen", psychopy.read_seen, ["POST"]),
        signed_in("/api/experiments/{experiment_id}/seen/add", psychopy.add_seen, ["POST"]),
        signed_in("/api/experiments/{experiment_id}/report", report.download_report, ["POST"]),
        # Share links are credentials, so making one needs a session; listing
        # and revoking are safe for a key.
        signed_in("/api/experiments/{experiment_id}/share-links", share.list_links),
        sessions_only("/api/experiments/{experiment_id}/share-links", share.create_link, ["POST"]),
        signed_in("/api/experiments/{experiment_id}/share-links/{link_id}/revoke", share.revoke_link, ["POST"]),
        # Starting PsychoPy opens windows on this machine: a person at a
        # browser only, never a key, and only where app/core/psychopy.py says
        # this server may (psychopy.launch in config.yaml).
        signed_in("/api/psychopy", psychopy.get_status),
        sessions_only("/api/experiments/{experiment_id}/launch", psychopy.launch, ["POST"]),
        sessions_only("/api/launches/latest", psychopy.latest_launch),
        sessions_only("/api/launches/{launch_id}", psychopy.get_launch),
        sessions_only("/api/launches/{launch_id}/stop", psychopy.stop_launch, ["POST"]),
        admin_keys("/api/admin/keys", api_keys.list_all_keys),
        admin_keys("/api/admin/keys/{key_id}/revoke", api_keys.revoke_any_key, ["POST"]),
        admin_keys("/api/admin/keys/{key_id}/delete", api_keys.delete_any_key, ["POST"]),
        admin_keys("/api/admin/keys/{key_id}/restore", api_keys.restore_any_key, ["POST"]),
    ]

    # MCP: agents calling the app with an API key (see app/mcp and
    # mcp_tools.py). Keys only -- RequireAPIKey turns a browser session away --
    # and every tool runs at the key's effective role, so this is the API above
    # in another shape, not a wider one. Without API keys nothing could
    # authenticate to it, so it is not registered either.
    if cfg.mcp_enabled and cfg.api_keys_enabled:
        mcp = MCPServer(mcp_tools.build_registry())
        routes += [
            group(RequireAPIKey)("/mcp", mcp.endpoint, ["POST"]),
            public("/mcp", mcp.method_not_allowed, ["GET", "DELETE"]),
        ]

    return routes + [
        # Any other /api/ path is a JSON 404, not the index.html fallback.
        Route("/api/{rest:path}", meta.unknown_api),
        # Catch-all static serving. Must stay last -- it matches every
        # remaining path, so anything added after this line never runs.
        Route("/{path:path}", static_server.endpoint),
    ]
