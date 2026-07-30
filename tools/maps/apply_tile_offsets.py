#!/usr/bin/env python
"""Apply each tile's real-world center offset to its optimized GLB's node
translation, in place of merging first and trying to reverse-engineer which
merged node belongs to which tile.

Each per-tile GLB currently has vertex data in a LOCAL frame (the exporter
subtracted compute_center_offset(...) before emission), and gltf-transform's
quantize step added a node translation+scale that reconstructs that LOCAL
frame exactly. Since node transform is T + S*v (no rotation), adding the
tile's real-world offset directly onto the existing translation makes the
node's full transform reconstruct absolute WORLD coordinates instead:
    world = (T_quant + O_tile) + S_quant * v_normalized
This must run on each tile individually, before merging -- merge does not
guarantee any stable/predictable node <-> source-file order, so patching
after merge would require fragile reverse-matching.

Usage:
    python apply_tile_offsets.py <map-name>
"""
import json
import struct
import sys
from pathlib import Path

from map_config import get_map


def apply_offset(glb_path: Path, offset: tuple[float, float, float], out_path: Path) -> None:
    data = glb_path.read_bytes()
    assert data[:4] == b"glTF", f"{glb_path}: bad magic"
    assert struct.unpack_from("<I", data, 4)[0] == 2, f"{glb_path}: bad version"
    json_len = struct.unpack_from("<I", data, 12)[0]
    assert data[16:20] == b"JSON", f"{glb_path}: expected JSON chunk"
    json_bytes = data[20:20 + json_len]
    gltf = json.loads(json_bytes)

    bin_chunk_start = 20 + json_len
    bin_chunk_len = struct.unpack_from("<I", data, bin_chunk_start)[0]
    assert data[bin_chunk_start + 4:bin_chunk_start + 8] == b"BIN\x00", f"{glb_path}: expected BIN chunk"
    bin_bytes = data[bin_chunk_start + 8:bin_chunk_start + 8 + bin_chunk_len]

    ox, oy, oz = offset
    patched = 0
    for node in gltf.get("nodes", []):
        if "mesh" not in node:
            continue
        tx, ty, tz = node.get("translation", [0.0, 0.0, 0.0])
        node["translation"] = [tx + ox, ty + oy, tz + oz]
        patched += 1
    assert patched >= 1, f"{glb_path}: no mesh-bearing node found to patch"

    new_json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    pad = (-len(new_json_bytes)) % 4
    new_json_bytes += b" " * pad

    bin_pad = (-len(bin_bytes)) % 4
    total_len = 12 + 8 + len(new_json_bytes) + 8 + len(bin_bytes) + bin_pad

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as f:
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


def main() -> None:
    spec = get_map(sys.argv[1])
    offsets = json.loads(spec.offsets_path.read_text(encoding="utf-8"))
    for name, info in sorted(offsets.items()):
        in_path = spec.tiles_opt_dir / f"{name}.glb"
        out_path = spec.tiles_world_dir / f"{name}.glb"
        offset = tuple(info["offset"])
        apply_offset(in_path, offset, out_path)
        print(f"{name}: patched translation += {offset} -> {out_path} ({out_path.stat().st_size} bytes)", flush=True)
    print("all tiles patched", flush=True)


if __name__ == "__main__":
    main()
