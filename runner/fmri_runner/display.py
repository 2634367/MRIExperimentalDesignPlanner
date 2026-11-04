"""Layers -> PsychoPy stimuli, in height units, exactly as the designer's
browser player draws them (static/js/display.js):

  text   centred on pos, `height` tall, optional wrap width and bold
  image  `height` tall, width from the picture's own aspect ratio unless
         `width` is given, centred on pos
  shape  `size` across (the circle's diameter, the square's side, the
         polygon's corner-to-corner span), centred on pos, `ori` degrees
         clockwise; filled unless fill is false

Building a TextStim takes a few milliseconds, so identical layer lists (the
fixation cross on every trial) share one set of stimuli, kept in a small
cache.
"""
import json
from collections import OrderedDict

from psychopy import visual

CACHE_SIZE = 64


class Painter:
    def __init__(self, win, plan):
        self.win = win
        self.media = plan["_media_paths"]
        self.sizes = plan["media"]
        self.font = plan["display"].get("font") or "Arial"
        self.cache = OrderedDict()

    def stims(self, layers):
        key = json.dumps(layers, sort_keys=True)
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key]
        built = [self._build(layer) for layer in layers]
        self.cache[key] = built
        if len(self.cache) > CACHE_SIZE:
            self.cache.popitem(last=False)
        return built

    def _build(self, layer):
        kind = layer["kind"]
        pos = tuple(layer["pos"])
        if kind == "text":
            return visual.TextStim(
                self.win, text=layer["text"], height=layer["height"], pos=pos,
                color=layer["color"], colorSpace="hex", font=layer.get("font") or self.font,
                wrapWidth=layer.get("wrap"), bold=bool(layer.get("bold")), anchorHoriz="center", anchorVert="center",
                alignText="center",
            )
        if kind == "image":
            entry = self.sizes[layer["media"]]
            height = layer["height"]
            width = layer.get("width") or height * entry["w"] / entry["h"]
            return visual.ImageStim(self.win, image=self.media[layer["media"]], size=(width, height), pos=pos)
        return self._shape(layer, pos)

    def _shape(self, layer, pos):
        size = layer["size"]
        color = layer["color"]
        fill = layer.get("fill", True)
        common = dict(
            pos=pos, ori=layer.get("ori", 0), colorSpace="hex", lineColor=color,
            fillColor=color if fill else None, lineWidth=layer.get("line_width", 3),
        )
        shape = layer["shape"]
        if shape == "circle":
            return visual.Circle(self.win, radius=size / 2, edges=96, **common)
        if shape == "square":
            return visual.Rect(self.win, width=size, height=size, **common)
        if shape == "cross":
            # The same plus the browser draws: two bars a fifth as thick as long.
            bar = size / 5
            half, thin = size / 2, bar / 2
            vertices = [(-thin, half), (thin, half), (thin, thin), (half, thin), (half, -thin), (thin, -thin),
                        (thin, -half), (-thin, -half), (-thin, -thin), (-half, -thin), (-half, thin), (-thin, thin)]
            return visual.ShapeStim(self.win, vertices=vertices, closeShape=True, **common)
        edges = {"triangle": 3, "diamond": 4}.get(shape, layer.get("sides", 5))
        # Polygon's first corner points straight up, as the browser's does.
        return visual.Polygon(self.win, edges=edges, radius=size / 2, **common)


def draw_all(stims):
    for stim in stims:
        stim.draw()
