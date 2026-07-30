#!/usr/bin/env python
"""Collapse a merged GLB's N per-tile scenes into a single scene containing
all nodes, working around gltf-transform merge --merge-scenes dropping the
first input file's scene. Every tile node is already an independent root
with absolute world-space translation baked in (see apply_tile_offsets.py),
so unioning their indices into one scene's `nodes` array is correct and
lossless -- no reparenting or transform changes needed.

Usage:
    python combine_scenes.py <merged.glb> <out.glb> [scene-name]
"""
import json
import struct
import sys
from pathlib import Path

IN_PATH = Path(sys.argv[1])
OUT_PATH = Path(sys.argv[2])
SCENE_NAME = sys.argv[3] if len(sys.argv) > 3 else OUT_PATH.stem


def main() -> None:
    data = IN_PATH.read_bytes()
    assert data[:4] == b"glTF"
    assert struct.unpack_from("<I", data, 4)[0] == 2
    json_len = struct.unpack_from("<I", data, 12)[0]
    assert data[16:20] == b"JSON"
    gltf = json.loads(data[20:20 + json_len])

    bin_chunk_start = 20 + json_len
    bin_chunk_len = struct.unpack_from("<I", data, bin_chunk_start)[0]
    assert data[bin_chunk_start + 4:bin_chunk_start + 8] == b"BIN\x00"
    bin_bytes = data[bin_chunk_start + 8:bin_chunk_start + 8 + bin_chunk_len]

    all_node_indices = list(range(len(gltf.get("nodes", []))))
    gltf["scenes"] = [{"name": SCENE_NAME, "nodes": all_node_indices}]
    gltf["scene"] = 0

    new_json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    pad = (-len(new_json_bytes)) % 4
    new_json_bytes += b" " * pad

    bin_pad = (-len(bin_bytes)) % 4
    total_len = 12 + 8 + len(new_json_bytes) + 8 + len(bin_bytes) + bin_pad

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "wb") as f:
        f.write(b"glTF")
        f.write(struct.pack("<II", 2, total_len))
        f.write(struct.pack("<I", len(new_json_bytes)))
        f.write(b"JSON")
        f.write(new_json_bytes)
        f.write(struct.pack("<I", len(bin_bytes) + bin_pad))
        f.write(b"BIN\x00")
        f.write(bin_bytes)
        if bin_pad:
            f.write(b"\x00" * bin_pad)

    print(f"combined {len(all_node_indices)} nodes into 1 scene -> {OUT_PATH} ({OUT_PATH.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
