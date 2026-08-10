#!/usr/bin/env python
"""
Где на локации стоят блоки с текстурой и объекты с 3D-моделью.

Зачем это нужно. В экспорт карты попадает только геометрия: кубики с
натянутыми текстурами. По ней нельзя ответить, где на локации стоит камыш,
ящик или баррикада, — в готовой модели они неотличимы от рельефа. А исходный
кэш карты знает это точно: у каждого блока есть номер, а у номера — запись во
внешнем реестре с именем текстуры (`icon`) и, у части блоков, с путём к
настоящей 3D-модели (`model`).

Отдельно про модели. Блоки с `model` экспортёр рисует не моделью, а крестом из
двух плоскостей: настоящие модели ему никто не подаёт. Поэтому на карте вместо
травы и камыша стоят кресты, и координаты из этого обмера — то, по чему их
можно будет заменить моделями из библиотеки ресурсов.

Запуск (интерпретатор из окружения SC_Map_Dump, там есть zstandard):
  D:\\Awake\\SC_Map_Dump-main\\.venv\\Scripts\\python.exe tools/maps/scan_objects.py nizina
  ... --models --out D:\\tmp\\nizina_models.json

Без --out печатается только сводка: сколько чего стоит. Координаты весят
много, поэтому в файл они пишутся только по явной просьбе.
"""
import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

from map_config import ROOT, get_map

# Экспортёр лежит в чужом инструменте и импортируется как модуль: свой разбор
# формата регионов писать незачем, он там уже выверен.
sys.path.insert(0, str(ROOT / "tools"))

from mdat_obj_export import (  # noqa: E402
    DEFAULT_EXTERNAL_REGISTRY,
    DEFAULT_MAP_BLOCKS,
    iter_region_files,
    load_external_block_configs,
    read_region,
)


def pda_names(path: Path) -> dict[int, str]:
    """
    Имена обычных блоков рельефа: номер -> имя текстуры вида `stalcraft:log_3`.

    Внешний реестр знает только предметы игры (ящики, замки, трава с моделью),
    а рельеф в него не входит — без этой таблицы половина обмера выглядела бы
    как «блок 2421, 59 тысяч штук» без единого намёка, что это. Таблица взята
    из карты КПК: она заодно даёт цвет, которым блок рисуется на миникарте, но
    здесь нужно только имя.
    """
    if not path.exists():
        return {}
    names: dict[int, str] = {}
    for entry in json.loads(path.read_text(encoding="utf-8")):
        icon = entry.get("iconName")
        if not icon:
            continue
        # Записей на один номер несколько — по одной на разновидность (meta).
        # Берём первую: нам нужно узнаваемое имя, а не точная разновидность.
        names.setdefault(int(entry["id"]), icon)
    return names


def block_names(registry_path: Path) -> dict[int, dict]:
    """Номер блока -> что о нём известно: имя текстуры и путь к модели."""
    configs = load_external_block_configs(registry_path)
    known = {}
    for block_id, entry in configs.items():
        config = entry.get("config") if isinstance(entry.get("config"), dict) else entry
        if not isinstance(config, dict):
            continue
        known[int(block_id)] = {
            "icon": config.get("icon"),
            "model": config.get("model"),
            "collide": config.get("collide"),
        }
    return known


def scan(spec, wanted: set[int] | None, keep_positions: bool):
    """
    Считает блоки по номерам в границах локации.

    Границы те же, что у экспорта (map_config), иначе обмер посчитал бы то,
    чего на нашей карте нет: кэш хранит куски далеко за пределами вырезанной
    области.
    """
    counts: Counter[int] = Counter()
    positions: dict[int, list] = defaultdict(list)
    regions = iter_region_files(spec.input_dir)
    if not regions:
        raise SystemExit(f"в {spec.input_dir} нет файлов регионов reg.*.mdat")

    for index, region in enumerate(regions, 1):
        for chunk in read_region(region):
            base_x = chunk.chunk_x << 4
            base_z = chunk.chunk_z << 4
            # Кусок целиком за границей отбрасывается по своим 16x16, а не по
            # каждому блоку: так обмер идёт в разы быстрее.
            if base_x + 15 < spec.x0 or base_x > spec.x1:
                continue
            if base_z + 15 < spec.z0 or base_z > spec.z1:
                continue
            for (x, y, z), state in chunk.blocks.items():
                if wanted is not None and state.block_id not in wanted:
                    continue
                if y < spec.y0 or y > spec.y1:
                    continue
                world_x = base_x + x
                world_z = base_z + z
                if world_x < spec.x0 or world_x > spec.x1:
                    continue
                if world_z < spec.z0 or world_z > spec.z1:
                    continue
                counts[state.block_id] += 1
                if keep_positions:
                    positions[state.block_id].append([world_x, y, world_z, state.meta])
        print(f"  регион {index}/{len(regions)}: {region.name}", flush=True)
    return counts, positions


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("location", help="имя локации из map_config (nizina, hvoiny, small_berdovka)")
    parser.add_argument("--models", action="store_true",
                        help="только блоки с настоящей 3D-моделью, а не с одной текстурой")
    parser.add_argument("--ids", help="перечень номеров блоков через запятую")
    parser.add_argument("--all", action="store_true",
                        help="считать все блоки, включая обычный рельеф без записи в реестре")
    parser.add_argument("--out", help="файл, куда записать координаты (json)")
    args = parser.parse_args()

    spec = get_map(args.location)
    known = block_names(Path(DEFAULT_EXTERNAL_REGISTRY))
    terrain = pda_names(Path(DEFAULT_MAP_BLOCKS))

    if args.ids:
        wanted = {int(value) for value in args.ids.split(",") if value.strip()}
    elif args.models:
        wanted = {block_id for block_id, info in known.items() if info["model"]}
    elif args.all:
        wanted = None
    else:
        # По умолчанию — всё, что игра считает своим предметом: у такого блока
        # есть имя текстуры, а часто и модель. Обычный рельеф в реестр не
        # входит и здесь не считается.
        wanted = set(known)

    print(f"локация {spec.name} ({spec.location})", flush=True)
    print(f"границы X {spec.x0}..{spec.x1}  Y {spec.y0}..{spec.y1}  Z {spec.z0}..{spec.z1}", flush=True)
    print(f"ищем номеров блоков: {'все' if wanted is None else len(wanted)}", flush=True)

    counts, positions = scan(spec, wanted, keep_positions=bool(args.out))

    kinds = []
    for block_id, count in counts.most_common():
        info = known.get(block_id, {})
        kinds.append({
            "block_id": block_id,
            "icon": info.get("icon") or terrain.get(block_id),
            "model": info.get("model"),
            "count": count,
            **({"positions": positions[block_id]} if args.out else {}),
        })

    print(f"\nвсего видов: {len(kinds)}, блоков: {sum(counts.values())}")
    for kind in kinds[:40]:
        name = kind["model"] or kind["icon"] or "без записи в реестре"
        print(f"  {kind['count']:>8}  {kind['block_id']:>5}  {name}")
    if len(kinds) > 40:
        print(f"  ... и ещё {len(kinds) - 40} видов")

    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "location": spec.name,
            "bbox": {"x0": spec.x0, "x1": spec.x1, "y0": spec.y0, "y1": spec.y1,
                     "z0": spec.z0, "z1": spec.z1},
            "kinds": kinds,
        }
        out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        print(f"\nзаписано: {out} ({out.stat().st_size} байт)")


if __name__ == "__main__":
    main()
