#!/usr/bin/env python
"""Idempotent tiled export of a STALCRAFT location.

Splits the real populated bbox (see map_config.py / scan_bbox.py) into a grid
and exports each tile as its own small, fast, low-memory
mdat_obj_export.py invocation instead of one giant multi-hour run. Each tile
uses --context-padding so cross-tile neighbor blocks are still visible for
face culling -- no seams between tiles.

Re-running this script skips tiles whose output .glb already exists, so if
the whole process gets killed partway (this environment appears to kill
long-running background processes after ~40-60 minutes regardless of launch
mechanism), just run it again -- it resumes instead of restarting from zero.
Each tile writes to a .tmp path first and only renames to the final name on
a clean, full success, so a killed-mid-tile run never leaves a "done" file
that is actually incomplete.

Usage:
    python tile_export.py <map-name>
"""
import subprocess
import sys

from map_config import CONTEXT_PADDING, CTM_DIR, ROOT, TEXARR, get_map

VENV_PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"
EXPORT_SCRIPT = ROOT / "tools" / "mdat_obj_export.py"


def main() -> None:
    spec = get_map(sys.argv[1])
    out_dir = spec.tiles_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    all_tiles = list(spec.tiles())
    print(f"map={spec.name} total tiles: {len(all_tiles)}", flush=True)
    for r, c, tx0, tz0, tx1, tz1 in all_tiles:
        out_path = out_dir / f"tile_{r}_{c}.glb"
        tmp_path = out_dir / f"tile_{r}_{c}.glb.tmp"
        if out_path.exists():
            print(f"tile_{r}_{c}: already done ({out_path.stat().st_size} bytes), skipping", flush=True)
            continue
        tmp_path.unlink(missing_ok=True)
        print(f"tile_{r}_{c}: exporting bbox {tx0},{spec.y0},{tz0} .. {tx1},{spec.y1},{tz1}", flush=True)
        cmd = [
            str(VENV_PYTHON), str(EXPORT_SCRIPT),
            str(spec.input_dir), str(tmp_path),
            "--double-sided", "--force-mask", "--hide-invisible",
            "--bbox", str(tx0), str(spec.y0), str(tz0), str(tx1), str(spec.y1), str(tz1),
            "--context-padding", str(CONTEXT_PADDING),
            "--texarr", TEXARR,
            "--ctm-dir", CTM_DIR,
        ]
        result = subprocess.run(cmd, cwd=str(ROOT))
        if result.returncode != 0 or not tmp_path.exists():
            print(f"tile_{r}_{c}: FAILED (exit={result.returncode})", flush=True)
            sys.exit(1)
        tmp_path.rename(out_path)
        print(f"tile_{r}_{c}: done, {out_path.stat().st_size} bytes", flush=True)
    print("all tiles complete", flush=True)


if __name__ == "__main__":
    main()
