#!/usr/bin/env python3
"""Print real intrinsic widths for Gulnish Crochet catalogue photos.

The JS builds <img srcset> descriptors from this data. Anything that is not the
usual 800w full / 480w sm twin must be listed, otherwise the browser is told a
wrong width and either under-fetches (soft photos) or over-fetches (wasted
bytes). 132 files is too many to hardcode by hand, so re-run this whenever
photos are added, replaced or re-exported:

    python3 scripts/img-widths.py

Paste the printed object into IMAGE_WIDTHS in js/script.js. The 800/480
fallback in imageWidth() covers the standard files, so only the exceptions are
listed there.
"""

import glob
import json
import struct
import sys

# Directories that ship an sm/ twin; mirrors photoDirs in js/script.js.
PHOTO_DIRS = [
    "bags", "bouquets", "gajrays", "geometry", "headbands",
    "jewellery", "keychains", "pencil", "pencilbox", "purses",
]

FULL_DEFAULT = 800
SM_DEFAULT = 480


def intrinsic_width(path):
    """Width in pixels from a WebP VP8L / VP8 / VP8X header."""
    with open(path, "rb") as fh:
        head = fh.read(40)
    if len(head) < 30 or head[0:4] != b"RIFF" or head[8:12] != b"WEBP":
        return None
    chunk = head[12:16]
    if chunk == b"VP8L":
        bits = int.from_bytes(head[21:25], "little")
        return (bits & 0x3FFF) + 1
    if chunk == b"VP8 ":
        return int.from_bytes(head[26:28], "little") & 0x3FFF
    if chunk == b"VP8X":
        return int.from_bytes(head[24:27], "little") + 1
    return None


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    exceptions = {}
    missing = []
    for category in PHOTO_DIRS:
        for path in sorted(glob.glob(f"{root}/images/{category}/*.webp")):
            key = path[len(root) + 1:]
            width = intrinsic_width(path)
            if width is None:
                missing.append(key)
            elif width != FULL_DEFAULT:
                exceptions[key] = width
        for path in sorted(glob.glob(f"{root}/images/{category}/sm/*.webp")):
            key = path[len(root) + 1:]
            width = intrinsic_width(path)
            if width is None:
                missing.append(key)
            elif width != SM_DEFAULT:
                exceptions[key] = width

    print(json.dumps(exceptions, indent=2, sort_keys=True))
    print(f"{len(exceptions)} exception(s) beyond the "
          f"{FULL_DEFAULT}w/{SM_DEFAULT}w defaults, "
          f"{len(missing)} unreadable", file=sys.stderr)


if __name__ == "__main__":
    main()