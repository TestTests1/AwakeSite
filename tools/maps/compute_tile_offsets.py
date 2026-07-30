#!/usr/bin/env python
"""Recompute the per-tile center offset that mdat_obj_export.py's write_glb
applied (via compute_center_offset(export_blocks.keys())) when it centered
each tile's mesh around its own local origin.

Each tile was exported as an independent process, so the recentering offset
is per-tile and was never stored in the GLB. Since the offset is a pure
deterministic function of which blocks fall inside the tile's strict bbox,
we can recover it cheaply by re-running only the block-loading step (not
full geometry emission) for each tile and reusing the exporter's own
load_world / pos_in_bbox / compute_center_offset functions directly.

Usage:
    python compute_tile_offsets.py <map-name>
"""
import json
import sys

from map_config import ROOT, get_map

sys.path.insert(0, str(ROOT / "tools"))
import mdat_obj_export as exp  # noqa: E402


def main() -> None:
    spec = get_map(sys.argv[1])
    region_files = exp.iter_region_files(spec.input_dir)
    if not region_files:
        raise SystemExit(f"no region files found in {spec.input_dir}")

    offsets = {}
    for r, c, tx0, tz0, tx1, tz1 in spec.tiles():
        bbox = exp.normalize_bbox([tx0, spec.y0, tz0, tx1, spec.y1, tz1])
        world_blocks, _world_tiles, _chunks_loaded = exp.load_world(
            region_files=region_files,
            max_chunks=None,
            empty_ids={0},
            include_ids=None,
            max_blocks=None,
            bbox=bbox,
            collect_biomes=False,
        )
        export_blocks = {pos: state for pos, state in world_blocks.items() if exp.pos_in_bbox(pos, bbox)}
        offset = exp.compute_center_offset(export_blocks.keys())
        print(f"tile_{r}_{c}: bbox={bbox} blocks={len(export_blocks)} offset={offset}", flush=True)
        offsets[f"tile_{r}_{c}"] = {"offset": list(offset), "bbox": list(bbox), "blocks": len(export_blocks)}

    out_path = spec.offsets_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(offsets, indent=2), encoding="utf-8")
    print(f"wrote {out_path}", flush=True)


if __name__ == "__main__":
    main()
