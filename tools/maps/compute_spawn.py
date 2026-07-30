#!/usr/bin/env python
"""Report a finished GLB's world-space bounding box and pick a spawn point.

After `gltf-transform optimize --compress meshopt`, POSITION accessors are
quantized: componentType 5122 (SHORT) with normalized=true, and accessor
min/max hold the RAW integers (+-32767), not world units. Reading min/max
directly gives coordinates in the millions. The real world position is

    world = node.translation + node.scale * (raw / 32767)

which is what this script reconstructs. Every tile node is a root with only
translation+scale (no rotation), so no matrix math is needed.

The spawn point is the horizontal center of the bbox, at bbox top + a small
margin, so the player falls onto whatever surface is below instead of
spawning inside geometry.

Usage:
    python compute_spawn.py <model.glb> [spawn.json]
"""
import json
import struct
import sys
from pathlib import Path

# glTF componentType -> normalization divisor for signed/unsigned normalized data
NORM_DIVISOR = {
    5120: 127.0,     # BYTE
    5121: 255.0,     # UNSIGNED_BYTE
    5122: 32767.0,   # SHORT
    5123: 65535.0,   # UNSIGNED_SHORT
}
SPAWN_MARGIN = 2.0


def read_gltf_json(path: Path) -> dict:
    data = path.read_bytes()
    assert data[:4] == b"glTF", f"{path}: not a binary GLB"
    assert struct.unpack_from("<I", data, 4)[0] == 2, f"{path}: not glTF 2.0"
    json_len = struct.unpack_from("<I", data, 12)[0]
    assert data[16:20] == b"JSON", f"{path}: expected JSON chunk"
    return json.loads(data[20:20 + json_len])


def main() -> None:
    path = Path(sys.argv[1])
    gltf = read_gltf_json(path)
    accessors = gltf.get("accessors", [])
    meshes = gltf.get("meshes", [])

    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    node_count = 0

    for node in gltf.get("nodes", []):
        if "mesh" not in node:
            continue
        node_count += 1
        tr = node.get("translation", [0.0, 0.0, 0.0])
        sc = node.get("scale", [1.0, 1.0, 1.0])
        assert "rotation" not in node and "matrix" not in node, \
            f"{path}: node has rotation/matrix, plain translate+scale assumed"
        for prim in meshes[node["mesh"]].get("primitives", []):
            acc = accessors[prim["attributes"]["POSITION"]]
            divisor = NORM_DIVISOR[acc["componentType"]] if acc.get("normalized") else 1.0
            for axis in range(3):
                lo[axis] = min(lo[axis], tr[axis] + sc[axis] * (acc["min"][axis] / divisor))
                hi[axis] = max(hi[axis], tr[axis] + sc[axis] * (acc["max"][axis] / divisor))

    spawn = {
        "x": (lo[0] + hi[0]) / 2.0,
        "y": hi[1] + SPAWN_MARGIN,
        "z": (lo[2] + hi[2]) / 2.0,
    }

    print(f"file    {path} ({path.stat().st_size} bytes)")
    print(f"nodes   {node_count} mesh-bearing, scenes={len(gltf.get('scenes', []))}")
    print(f"bbox min [{lo[0]:.2f}, {lo[1]:.2f}, {lo[2]:.2f}]")
    print(f"bbox max [{hi[0]:.2f}, {hi[1]:.2f}, {hi[2]:.2f}]")
    print(f"size     [{hi[0] - lo[0]:.2f}, {hi[1] - lo[1]:.2f}, {hi[2] - lo[2]:.2f}]")
    print(f"spawn    {json.dumps(spawn)}")

    if len(sys.argv) > 2:
        out_path = Path(sys.argv[2])
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(spawn, indent=2) + "\n", encoding="utf-8")
        print(f"wrote    {out_path}")


if __name__ == "__main__":
    main()
