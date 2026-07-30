#!/usr/bin/env python
"""Per-location settings for the tiled export pipeline.

Every stage (tile_export -> optimize_tiles -> compute_tile_offsets ->
apply_tile_offsets -> merge -> combine_scenes) takes a map name from here, so
adding a location means adding one entry instead of editing five scripts.

bbox values come from scan_bbox.py. Y0 deliberately cuts off the solid
bedrock fill below the terrain (scan_bbox's per-Y histogram shows a constant
~full-footprint block count for every layer below it) -- those blocks are
never visible and would roughly quadruple the export.

Grid size is chosen so each tile's block volume stays near the ~10M that
tournament_hvoiny's 4x3 grid produced, which exported in reasonable time and
memory per process.
"""
import os
from pathlib import Path
from typing import Dict, Iterator, NamedTuple, Tuple

# Папка самих скриптов конвейера — они лежат в репозитории проекта.
HERE = Path(__file__).resolve().parent

# Папка стороннего инструмента SC_Map_Dump: в ней лежат сам экспортёр
# (tools/mdat_obj_export.py), его виртуальное окружение, node_modules и рабочий
# каталог tmp_export с промежуточными тайлами. Инструмент чужой и в репозиторий
# не входит, поэтому путь к нему задаётся снаружи, а по умолчанию берётся
# соседним с репозиторием.
# HERE = <репозиторий>/tools/maps, поэтому parents[1] — корень репозитория
ROOT = Path(os.environ.get("SC_MAP_DUMP", HERE.parents[1] / "SC_Map_Dump-main")).resolve()

if not (ROOT / "tools" / "mdat_obj_export.py").exists():
    raise SystemExit(
        f"не найден SC_Map_Dump в {ROOT}\n"
        "укажите путь переменной окружения SC_MAP_DUMP"
    )

MAP_CACHE = Path(r"D:\SteamLibrary\steamapps\common\STALCRAFT\map_cache\5.0")
TEXARR = r"D:\SteamLibrary\steamapps\common\STALCRAFT\bin_global\patchassets\assets\stalcraft\textures\blockMap.texarr"
CTM_DIR = r"D:\SteamLibrary\steamapps\common\STALCRAFT\modassets\assets\stalcraft\ctmpatcher\ctm"
CONTEXT_PADDING = 3


class MapSpec(NamedTuple):
    location: str
    x0: int
    x1: int
    z0: int
    z1: int
    y0: int
    y1: int
    cols: int
    rows: int

    @property
    def input_dir(self) -> Path:
        return MAP_CACHE / self.location

    @property
    def base_dir(self) -> Path:
        return ROOT / "tmp_export" / self.name

    @property
    def name(self) -> str:
        return self.location.replace("tournament_", "")

    @property
    def tiles_dir(self) -> Path:
        return self.base_dir / "tiles"

    @property
    def tiles_opt_dir(self) -> Path:
        return self.base_dir / "tiles_opt"

    @property
    def tiles_world_dir(self) -> Path:
        return self.base_dir / "tiles_world"

    @property
    def offsets_path(self) -> Path:
        return self.base_dir / "tile_offsets.json"

    @property
    def merged_path(self) -> Path:
        return self.base_dir / f"{self.name}_raw_merge.glb"

    @property
    def final_path(self) -> Path:
        return self.base_dir / f"{self.name}.glb"

    def tiles(self) -> Iterator[Tuple[int, int, int, int, int, int]]:
        """Yield (row, col, tx0, tz0, tx1, tz1) for every tile in the grid."""
        xw = (self.x1 - self.x0 + 1) / self.cols
        zw = (self.z1 - self.z0 + 1) / self.rows
        for r in range(self.rows):
            for c in range(self.cols):
                tx0 = round(self.x0 + c * xw)
                tx1 = round(self.x0 + (c + 1) * xw) - 1 if c < self.cols - 1 else self.x1
                tz0 = round(self.z0 + r * zw)
                tz1 = round(self.z0 + (r + 1) * zw) - 1 if r < self.rows - 1 else self.z1
                yield r, c, tx0, tz0, tx1, tz1


MAPS: Dict[str, MapSpec] = {
    # scan: X 3328..4351  Y 0..196  Z -2496..-1649
    # Layers y0..y54 hold exactly 782848 blocks each -- a seamless solid slab.
    # From y55 the count drops (780918, 778962, ...), i.e. the terrain already
    # has air pockets at 55, and their floor sits on the slab below the old
    # y0=55 cut -- that is what showed up in-viewer as see-through voids.
    # y0=54 would already seal every hole; 53 keeps one spare layer.
    "hvoiny": MapSpec(
        location="tournament_hvoiny",
        x0=3328, x1=4351,
        z0=-2496, z1=-1649,
        y0=53, y1=200,
        cols=4, rows=3,
    ),
    # scan: X -1328..-177  Y 0..133  Z -720..431, 91.5M blocks, bedrock fill <= y58
    "small_berdovka": MapSpec(
        location="tournament_small_berdovka",
        x0=-1328, x1=-177,
        z0=-720, z1=431,
        y0=56, y1=133,
        cols=4, rows=4,
    ),
    # scan: X 6912..8303  Y 0..173  Z 4688..5743, 88.2M blocks, bedrock fill <= y58
    "nizina": MapSpec(
        location="tournament_nizina",
        x0=6912, x1=8303,
        z0=4688, z1=5743,
        y0=56, y1=173,
        cols=5, rows=4,
    ),
}


def get_map(name: str) -> MapSpec:
    if name not in MAPS:
        raise SystemExit(f"unknown map '{name}'; known: {', '.join(sorted(MAPS))}")
    return MAPS[name]
