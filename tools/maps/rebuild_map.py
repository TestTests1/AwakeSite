#!/usr/bin/env python
"""Rebuild a location's final GLB from the per-tile files in tiles_world/.

This is the stage to re-run after hand-editing tiles in Blender. Tiles in
tiles_world/ carry absolute world coordinates in their node transform, so a
tile can be imported, edited and re-exported on its own and still land in the
right place -- no repositioning needed.

A tile straight out of Blender is uncompressed, which would bloat the merged
model, so any tile that lost its EXT_meshopt_compression extension is pushed
back through `gltf-transform optimize` first. Re-optimizing an already
world-positioned tile is safe: quantization composes with the existing node
translation instead of replacing it (verified -- world bbox is unchanged
across edit and re-optimize).

Then: merge -> combine_scenes -> compute_spawn, same as the initial build.

Usage:
    python rebuild_map.py <map-name> [--force-optimize]
"""
import json
import struct
import subprocess
import sys
from pathlib import Path

from map_config import HERE, ROOT, get_map

MESHOPT = "EXT_meshopt_compression"


def is_compressed(path: Path) -> bool:
    data = path.read_bytes()
    if data[:4] != b"glTF":
        raise SystemExit(f"{path}: not a binary GLB -- re-export from Blender as .glb")
    json_len = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + json_len])
    return MESHOPT in gltf.get("extensionsUsed", [])


def optimize(path: Path) -> None:
    tmp = path.with_suffix(".tmp.glb")
    tmp.unlink(missing_ok=True)
    cmd = ["npx", "--yes", "@gltf-transform/cli", "optimize",
           str(path), str(tmp), "--compress", "meshopt", "--texture-size", "1024"]
    if subprocess.run(cmd, cwd=str(ROOT), shell=True).returncode != 0 or not tmp.exists():
        raise SystemExit(f"{path.name}: optimize failed")
    before, after = path.stat().st_size, tmp.stat().st_size
    tmp.replace(path)
    print(f"  {path.name}: {before} -> {after} bytes", flush=True)


def run(cmd: list[str]) -> None:
    # npx is a .cmd shim on Windows and only resolves through the shell
    if subprocess.run(cmd, cwd=str(ROOT), shell=cmd[0] == "npx").returncode != 0:
        raise SystemExit(f"failed: {' '.join(cmd[:3])} ...")


def main() -> None:
    args = sys.argv[1:]
    force = "--force-optimize" in args
    names = [a for a in args if not a.startswith("--")]
    if not names:
        raise SystemExit(__doc__)
    spec = get_map(names[0])

    tiles = sorted(spec.tiles_world_dir.glob("*.glb"))
    tiles = [t for t in tiles if not t.name.endswith(".tmp.glb")]
    if not tiles:
        raise SystemExit(f"no tiles in {spec.tiles_world_dir}")

    stale = [t for t in tiles if force or not is_compressed(t)]
    if stale:
        print(f"re-optimizing {len(stale)} edited tile(s):", flush=True)
        for t in stale:
            optimize(t)
    else:
        print("all tiles already compressed, nothing to re-optimize", flush=True)

    print(f"merging {len(tiles)} tiles...", flush=True)
    run(["npx", "--yes", "@gltf-transform/cli", "merge",
         *[str(t) for t in tiles], str(spec.merged_path)])

    # соседние стадии лежат рядом с этим файлом, в репозитории, а не в ROOT:
    # ROOT — это папка стороннего инструмента
    py = sys.executable
    run([py, str(HERE / "combine_scenes.py"),
         str(spec.merged_path), str(spec.final_path), spec.name])
    run([py, str(HERE / "compute_spawn.py"),
         str(spec.final_path), str(spec.base_dir / f"{spec.name}.spawn.json")])

    print(f"\ndone: {spec.final_path} ({spec.final_path.stat().st_size} bytes)", flush=True)


if __name__ == "__main__":
    main()
