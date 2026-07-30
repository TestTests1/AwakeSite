#!/usr/bin/env python
"""Idempotent per-tile optimization via gltf-transform.

Optimizes each raw tile GLB individually (texture compression + meshopt)
before merging, to keep peak memory low. Skips tiles whose optimized output
already exists, and writes to a .tmp path first so a killed run never leaves
a fake "done" file.

The temp path MUST end in .glb: the gltf-transform CLI picks its output
format from the file extension, so a name like tile.glb.tmp silently writes
plain JSON instead of binary GLB.

Usage:
    python optimize_tiles.py <map-name>
"""
import os
import subprocess
import sys

from map_config import ROOT, get_map


def main() -> None:
    spec = get_map(sys.argv[1])
    in_dir = spec.tiles_dir
    out_dir = spec.tiles_opt_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    for r, c, *_ in spec.tiles():
        in_path = in_dir / f"tile_{r}_{c}.glb"
        out_path = out_dir / f"tile_{r}_{c}.glb"
        # PID in the temp name so two runs of this script (e.g. one started
        # before the export finished, one after) cannot write the same file
        tmp_path = out_dir / f"tile_{r}_{c}.{os.getpid()}.tmp.glb"
        if out_path.exists():
            print(f"tile_{r}_{c}: already optimized ({out_path.stat().st_size} bytes), skipping", flush=True)
            continue
        if not in_path.exists():
            print(f"tile_{r}_{c}: MISSING input {in_path}", flush=True)
            sys.exit(1)
        tmp_path.unlink(missing_ok=True)
        print(f"tile_{r}_{c}: optimizing ({in_path.stat().st_size} bytes)...", flush=True)
        cmd = [
            "npx", "--yes", "@gltf-transform/cli", "optimize",
            str(in_path), str(tmp_path),
            "--compress", "meshopt", "--texture-size", "1024",
        ]
        result = subprocess.run(cmd, cwd=str(ROOT), shell=True)
        if result.returncode != 0 or not tmp_path.exists():
            print(f"tile_{r}_{c}: FAILED (exit={result.returncode})", flush=True)
            sys.exit(1)
        os.replace(tmp_path, out_path)  # rename() raises on Windows if target exists
        print(f"tile_{r}_{c}: done, {out_path.stat().st_size} bytes", flush=True)
    print("all tiles optimized", flush=True)


if __name__ == "__main__":
    main()
