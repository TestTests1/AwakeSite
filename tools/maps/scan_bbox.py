#!/usr/bin/env python
"""Scan a map_cache location and report the real populated bbox.

Streams chunks straight from read_region() and accumulates only min/max +
histograms, so memory stays flat even for a whole location (unlike
load_world, which materializes every block in a dict).

Usage:
    python scan_bbox.py <map_cache_dir>
"""
import sys
from collections import Counter
from pathlib import Path

from map_config import ROOT  # путь к стороннему инструменту разрешается там

sys.path.insert(0, str(ROOT / "tools"))
import mdat_obj_export as exp  # noqa: E402

BAND = 64  # histogram bucket size in blocks


def main() -> None:
    input_dir = Path(sys.argv[1])
    region_files = exp.iter_region_files(input_dir)
    if not region_files:
        raise SystemExit(f"no region files found in {input_dir}")
    print(f"regions: {len(region_files)}", flush=True)

    xmin = ymin = zmin = 10**9
    xmax = ymax = zmax = -10**9
    total = 0
    chunks = 0
    x_hist: Counter = Counter()
    z_hist: Counter = Counter()
    y_hist: Counter = Counter()
    y_exact: Counter = Counter()

    for region in region_files:
        for chunk in exp.read_region(region):
            chunks += 1
            if not chunk.blocks:
                continue
            base_x = chunk.chunk_x << 4
            base_z = chunk.chunk_z << 4
            for (x, y, z), state in chunk.blocks.items():
                if state.block_id == 0:
                    continue
                wx = base_x + x
                wz = base_z + z
                total += 1
                if wx < xmin:
                    xmin = wx
                if wx > xmax:
                    xmax = wx
                if y < ymin:
                    ymin = y
                if y > ymax:
                    ymax = y
                if wz < zmin:
                    zmin = wz
                if wz > zmax:
                    zmax = wz
                x_hist[wx // BAND] += 1
                z_hist[wz // BAND] += 1
                y_hist[y // BAND] += 1
                y_exact[y] += 1
        print(f"  {region.name}: chunks so far={chunks} blocks so far={total}", flush=True)

    print(f"\nchunks={chunks} blocks={total}")
    print(f"bbox X {xmin}..{xmax}  Y {ymin}..{ymax}  Z {zmin}..{zmax}")
    print(f"size  X {xmax - xmin + 1}  Y {ymax - ymin + 1}  Z {zmax - zmin + 1}")

    for name, hist in (("X", x_hist), ("Y", y_hist), ("Z", z_hist)):
        print(f"\n{name} bands (size {BAND}):")
        for band in sorted(hist):
            count = hist[band]
            bar = "#" * max(1, int(60 * count / max(hist.values())))
            print(f"  {band * BAND:>7}..{band * BAND + BAND - 1:<7} {count:>10}  {bar}")

    print("\nper-Y layer counts:")
    peak = max(y_exact.values())
    for y in range(ymin, ymax + 1):
        count = y_exact.get(y, 0)
        bar = "#" * max(0, int(60 * count / peak))
        print(f"  y={y:>4} {count:>9}  {bar}")


if __name__ == "__main__":
    main()
