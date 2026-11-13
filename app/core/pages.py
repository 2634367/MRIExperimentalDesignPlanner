"""The page addresses the app answers with index.html.

The browser navigates by path (static/js/nav.js): /experiments, /account,
/scanners/<card>, /<experiment-slug>/overview, /<experiment-slug>/trials/<id>,
and on a share link /s/<credential>/runs. The server serves the same page for every one of
them and leaves the rest to the browser -- including whether a slug names an
experiment, which only the signed-in page knows. Anything that is not one of
these shapes is still a 404 (see static_files.py).

Keep the lists in step with the <section data-view> names in index.html and
with Nav.topScreens / Nav.docScreens / Nav.reserved in nav.js.
"""
from __future__ import annotations

import re

# Screens that stand on their own: /<screen>[/<item>]. The old screens that
# became cards on Account (password, pin, two-factor, api-keys) still open there.
TOP_SCREENS = frozenset({
    "experiments", "scanners", "account", "appearance", "shortcuts", "files", "about",
    "users", "invite-links", "all-keys", "logs", "jobs", "webhooks", "app-settings",
    "password", "pin", "two-factor", "api-keys",
})

# Screens of one experiment: /<slug>/<screen>[/<item>].
DOC_SCREENS = frozenset({
    "overview", "prompts", "pictures", "trials", "runs", "sessions", "results", "hrf", "report", "settings",
})

# First path parts an experiment slug can never be, because something else
# already lives there. The browser gives such an experiment "-experiment".
RESERVED = TOP_SCREENS | DOC_SCREENS | frozenset({
    "api", "s", "login", "join", "js", "css", "vendor", "mcp", "metrics", "media",
    "index.html", "favicon.ico", "robots.txt", "wsu-mark.svg",
})

SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
# An item id after the screen (a trial type, a scanner card's slug): one path
# part, kept short.
ITEM = re.compile(r"^[^/]{1,128}$")


def is_app_page(path: str) -> bool:
    """True for a path (without its leading slash) the page itself handles."""
    parts = path.rstrip("/").split("/") if path else []
    if not parts:
        return False
    if parts[0] in TOP_SCREENS:
        return len(parts) == 1 or (len(parts) == 2 and bool(ITEM.match(parts[1])))
    if len(parts) in (2, 3):
        slug, screen = parts[0], parts[1]
        if slug in RESERVED or len(slug) > 64 or not SLUG.match(slug) or screen not in DOC_SCREENS:
            return False
        return len(parts) == 2 or bool(ITEM.match(parts[2]))
    return False


def is_share_screen(screen: str, item: str = "") -> bool:
    """The part of /s/<credential>/<screen>[/<item>] after the credential."""
    if screen not in DOC_SCREENS or screen == "results":
        return False
    return item == "" or bool(ITEM.match(item))
