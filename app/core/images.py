"""What a picture is, read from its bytes -- never from its name or from a
Content-Type somebody sent.

Only the four formats both a browser and PsychoPy draw are accepted. SVG is
refused on purpose: it is a document that can carry script, and PsychoPy
cannot draw it anyway.
"""
from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, UnidentifiedImageError

FORMATS = {
    "PNG": ("image/png", "png"),
    "JPEG": ("image/jpeg", "jpg"),
    "GIF": ("image/gif", "gif"),
    "WEBP": ("image/webp", "webp"),
}

# A picture this many pixels or more is refused before it is decoded, so a
# small file that claims to be 60000x60000 cannot eat the server's memory.
MAX_PIXELS = 50_000_000


class BadImageError(ValueError):
    pass


@dataclass(frozen=True)
class ImageInfo:
    mime: str
    ext: str
    width: int
    height: int


def inspect(data: bytes) -> ImageInfo:
    if not data:
        raise BadImageError("the file is empty")
    try:
        with Image.open(io.BytesIO(data)) as picture:
            kind = picture.format
            width, height = picture.size
            if kind not in FORMATS:
                raise BadImageError("only PNG, JPEG, GIF and WebP pictures can be used")
            if width * height >= MAX_PIXELS:
                raise BadImageError("the picture has too many pixels")
            # verify() reads the whole file, so a truncated or corrupt one is
            # caught here rather than when a run is already on screen.
            picture.verify()
    except BadImageError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        raise BadImageError("that is not a picture this app can use (PNG, JPEG, GIF or WebP)") from None
    mime, ext = FORMATS[kind]
    return ImageInfo(mime=mime, ext=ext, width=width, height=height)
