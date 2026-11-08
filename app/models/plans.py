"""The run plan: the one thing both players read.

static/js/compile.js turns a design into a plan -- every onset, every sampled
jitter, every chosen prompt item and every layer already resolved to what is
drawn. The browser player (static/js/stage.js) and the PsychoPy runner
(runner/fmri_runner/) both play exactly that, and know nothing about trial
types, prompt lists or distributions. That is what keeps the run you see in
the browser, the run PsychoPy shows and the run you planned the same run.

The server never builds a plan; it only checks one before writing it to disk
for PsychoPy or into a bundle. The check is strict and closed: an unknown key
or a value of the wrong type is refused, every string has a length cap, and a
picture is named only by its sha256, so a plan cannot point the runner at a
path of its own choosing. The runner reads it as data and nothing in it is
ever evaluated.

FORMAT is versioned. A change that a runner could misread bumps it, and the
runner refuses a plan it does not know rather than guessing. An optional key
that only labels or describes (block, visit, pilot_blocks, scanner.t0) does
not: every runner still plays such a plan correctly. (scanner.t0 says why
dummy_volumes is what it is; that number is what makes a player start on the
pulse the design chose.)
"""
from __future__ import annotations

import math
import re
from typing import Any

FORMAT = "fmri-run-plan/1"

MAX_SEGMENTS = 20_000
MAX_LAYERS = 32
MAX_TEXT = 2_000
MAX_NAME = 200
MAX_PLANS = 64
MAX_SECONDS = 6 * 3600

SHAPES = ("circle", "square", "triangle", "diamond", "cross", "polygon")
SEGMENT_KINDS = ("instructions", "lead_in", "phase", "rest", "lead_out")
COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
SHA = re.compile(r"^[0-9a-f]{64}$")
KEY = re.compile(r"^[A-Za-z0-9_]{1,20}$")
COLUMN_KEY = re.compile(r"^[a-z_][a-z0-9_]{0,63}$")
MAX_ITEM_VALUES = 32
MEDIA_EXT = ("png", "jpg", "gif", "webp")


class BadPlanError(ValueError):
    pass


def _fail(where: str, message: str) -> None:
    raise BadPlanError(f"{where}: {message}")


def _object(value: Any, where: str, required: dict[str, Any], optional: dict[str, Any] | None = None) -> dict:
    """value must be a dict whose keys are exactly required + some of
    optional; each spec is a checker called as spec(value, where)."""
    if not isinstance(value, dict):
        _fail(where, "must be an object")
    optional = optional or {}
    for key in value:
        if key not in required and key not in optional:
            _fail(where, f"unknown key {key!r}")
    for key, check in required.items():
        if key not in value:
            _fail(where, f"missing {key!r}")
        check(value[key], f"{where}.{key}")
    for key, check in optional.items():
        if key in value and value[key] is not None:
            check(value[key], f"{where}.{key}")
    return value


def _string(limit: int, allow_empty: bool = True):
    def check(value: Any, where: str) -> None:
        if not isinstance(value, str) or len(value) > limit or (not allow_empty and value == ""):
            _fail(where, f"must be a string of at most {limit} characters")

    return check


def _number(low: float, high: float):
    def check(value: Any, where: str) -> None:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            _fail(where, f"must be a number from {low} to {high}")

    return check


def _integer(low: int, high: int):
    def check(value: Any, where: str) -> None:
        if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
            _fail(where, f"must be a whole number from {low} to {high}")

    return check


def _boolean(value: Any, where: str) -> None:
    if not isinstance(value, bool):
        _fail(where, "must be true or false")


def _color(value: Any, where: str) -> None:
    if not isinstance(value, str) or not COLOR.match(value):
        _fail(where, "must be a colour like #ffffff")


def _position(value: Any, where: str) -> None:
    if not isinstance(value, list) or len(value) != 2:
        _fail(where, "must be [x, y]")
    for index, part in enumerate(value):
        _number(-10, 10)(part, f"{where}[{index}]")


def _keys(value: Any, where: str) -> None:
    if not isinstance(value, list) or len(value) > 20:
        _fail(where, "must be a list of at most 20 key names")
    for index, key in enumerate(value):
        if not isinstance(key, str) or not KEY.match(key):
            _fail(f"{where}[{index}]", "must be a key name like space, escape, 1 or a")


def _key(value: Any, where: str) -> None:
    if not isinstance(value, str) or not KEY.match(value):
        _fail(where, "must be a key name like space, escape, 1 or a")


def _item_values(value: Any, where: str) -> None:
    """The drawn item's columns, { column key: text }, logged with the trial."""
    if not isinstance(value, dict) or len(value) > MAX_ITEM_VALUES:
        _fail(where, f"must be an object of at most {MAX_ITEM_VALUES} columns")
    for key, text in value.items():
        if not isinstance(key, str) or not COLUMN_KEY.match(key):
            _fail(where, f"{key!r} is not a column key")
        _string(MAX_TEXT)(text, f"{where}.{key}")


def _choice(*allowed: str):
    def check(value: Any, where: str) -> None:
        if value not in allowed:
            _fail(where, f"must be one of {', '.join(allowed)}")

    return check


def _sha(value: Any, where: str) -> None:
    if not isinstance(value, str) or not SHA.match(value):
        _fail(where, "must be a picture's sha256")


def _layer(value: Any, where: str) -> None:
    if not isinstance(value, dict):
        _fail(where, "must be an object")
    kind = value.get("kind")
    common = {"kind": _choice("text", "image", "shape"), "pos": _position}
    if kind == "text":
        _object(value, where, {**common, "text": _string(MAX_TEXT), "height": _number(0.001, 2), "color": _color},
                {"font": _string(MAX_NAME), "wrap": _number(0.01, 10), "bold": _boolean})
    elif kind == "image":
        _object(value, where, {**common, "media": _sha, "height": _number(0.001, 4)}, {"width": _number(0.001, 8)})
    elif kind == "shape":
        _object(value, where, {**common, "shape": _choice(*SHAPES), "size": _number(0.001, 4), "color": _color},
                {"sides": _integer(3, 64), "fill": _boolean, "ori": _number(-360, 360), "line_width": _number(0.1, 50)})
    else:
        _fail(f"{where}.kind", "must be text, image or shape")


def _layers(value: Any, where: str) -> None:
    if not isinstance(value, list) or len(value) > MAX_LAYERS:
        _fail(where, f"must be a list of at most {MAX_LAYERS} layers")
    for index, layer in enumerate(value):
        _layer(layer, f"{where}[{index}]")


def _segment(value: Any, where: str) -> None:
    _object(
        value,
        where,
        {
            "onset": _number(0, MAX_SECONDS),
            "duration": _number(0, MAX_SECONDS),
            "kind": _choice(*SEGMENT_KINDS),
            "label": _string(MAX_NAME),
            "layers": _layers,
        },
        {
            "trial": _integer(0, MAX_SEGMENTS),
            "block": _integer(0, MAX_SEGMENTS),
            "trial_type": _string(MAX_NAME),
            "phase": _string(MAX_NAME),
            "item": _string(MAX_NAME),
            "item_label": _string(MAX_TEXT),
            "item_values": _item_values,
            "response": lambda response, at: _object(response, at, {"keys": _keys}, {"ends_phase": _boolean, "correct": _key}),
        },
    )


def _media_entry(value: Any, where: str) -> None:
    _object(value, where, {"ext": _choice(*MEDIA_EXT), "w": _integer(1, 100_000), "h": _integer(1, 100_000)})


def check_plan(plan: Any) -> dict:
    """Return the plan if it is well formed, else raise BadPlanError naming
    the first thing wrong with it."""
    _object(
        plan,
        "plan",
        {
            "format": _choice(FORMAT),
            "experiment": lambda v, w: _object(v, w, {"id": _string(64), "name": _string(MAX_NAME)}),
            "run": lambda v, w: _object(v, w, {"id": _string(64), "name": _string(MAX_NAME), "label": _string(64, False)}),
            "participant": _string(64),
            "seed": _integer(0, 2**53),
            "created": _string(40),
            "scanner": lambda v, w: _object(
                v, w, {"tr": _number(0.05, 30), "trigger_key": _string(20, False), "dummy_volumes": _integer(0, 1000), "wait": _boolean},
                {"t0": _choice("after_dummies", "first_pulse")},
            ),
            "display": lambda v, w: _object(v, w, {"background": _color, "text_color": _color, "font": _string(MAX_NAME)}),
            "keys": lambda v, w: _object(v, w, {"quit": _keys, "advance": _keys}),
            "segments": lambda v, w: None,
            "total_seconds": _number(0, MAX_SECONDS),
            "volumes": _integer(0, 1_000_000),
            "media": lambda v, w: None,
        },
        {
            "session": lambda v, w: _object(v, w, {"id": _string(64), "name": _string(MAX_NAME)}),
            "visit": _integer(1, 999),
            "pilot_blocks": _integer(1, MAX_SEGMENTS),
            "break_after": _number(0, MAX_SECONDS),
            "revision": _integer(1, 2**53),
        },
    )
    if not KEY.match(plan["scanner"]["trigger_key"]):
        _fail("plan.scanner.trigger_key", "must be a key name like 5 or t")
    segments = plan["segments"]
    if not isinstance(segments, list) or not 1 <= len(segments) <= MAX_SEGMENTS:
        _fail("plan.segments", f"must be a list of 1 to {MAX_SEGMENTS} segments")
    previous_end = 0.0
    for index, segment in enumerate(segments):
        where = f"plan.segments[{index}]"
        _segment(segment, where)
        if segment["kind"] != "instructions":
            # Onsets run forward on one clock. A small tolerance covers the
            # 4-decimal rounding compile.js applies.
            if segment["onset"] + 1e-3 < previous_end:
                _fail(where, "starts before the segment before it ends")
            previous_end = segment["onset"] + segment["duration"]
    media = plan["media"]
    if not isinstance(media, dict) or len(media) > 10_000:
        _fail("plan.media", "must be an object of pictures")
    for sha, entry in media.items():
        _sha(sha, "plan.media key")
        _media_entry(entry, f"plan.media[{sha[:12]}]")
    for index, segment in enumerate(segments):
        for position, layer in enumerate(segment["layers"]):
            if layer["kind"] == "image" and layer["media"] not in media:
                _fail(f"plan.segments[{index}].layers[{position}]", "uses a picture that is not in plan.media")
    return plan


def check_plans(plans: Any) -> list[dict]:
    if not isinstance(plans, list) or not 1 <= len(plans) <= MAX_PLANS:
        raise BadPlanError(f"send 1 to {MAX_PLANS} run plans")
    checked = [check_plan(plan) for plan in plans]
    labels = [plan["run"]["label"] for plan in checked]
    if len(set(labels)) != len(labels):
        raise BadPlanError("two plans have the same run label")
    for label in labels:
        if not re.match(r"^[A-Za-z0-9_.-]{1,64}$", label):
            raise BadPlanError(f"run label {label!r} may only hold letters, digits, - _ and .")
    return checked


def media_used(plans: list[dict]) -> dict[str, dict]:
    used: dict[str, dict] = {}
    for plan in plans:
        used.update(plan["media"])
    return used
