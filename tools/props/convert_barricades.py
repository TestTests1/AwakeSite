"""Конвертирует модели заграждений из игровых ассетов в GLB.

Названия объектов взяты из ru.lang игры (go.clan.tournament_*), файлы моделей
подобраны по именам. Соответствие подтверждается глазами во вьюере — в самих
ассетах связки «объект -> файл модели» в открытом виде нет.
"""
import sys
from pathlib import Path

from scfile import convert

GAME = Path(r"D:\SteamLibrary\steamapps\common\STALCRAFT")
BLOCKS = GAME / "modassets" / "assets" / "customitems" / "models" / "blocks"
OUT = Path(sys.argv[1])

CANDIDATES = [
    ("barrikada", BLOCKS / "barricade" / "barrikada.mcsb"),
    ("barekad", BLOCKS / "barricade" / "barekad.mcsb"),
    ("barikada_army", BLOCKS / "barricade" / "barikada_army.mcsb"),
    ("barikada_army_2", BLOCKS / "barricade" / "barikada_army_2.mcsb"),
    ("barrikada_scrap_1", BLOCKS / "barricade" / "barrikada_scrap_1.mcsb"),
    ("barrikada_wood_1", BLOCKS / "barricade" / "barrikada_wood_1.mcsb"),
    ("sandbag_wall", BLOCKS / "barricade" / "defence_obj" / "sandbag_wall_sh_1.mcsb"),
    ("sandbag_small", BLOCKS / "barricade" / "defence_obj" / "Sandbag_small_1.mcsb"),
    ("gabion3_1", BLOCKS / "la" / "gabion" / "gabion3_1.mcsb"),
    ("gabionfull_1", BLOCKS / "la" / "gabion" / "gabionfull_1.mcsb"),
]

OUT.mkdir(parents=True, exist_ok=True)
for name, source in CANDIDATES:
    if not source.is_file():
        print(f"{name:20s} НЕТ ФАЙЛА {source}")
        continue
    try:
        convert.mcsb_to_glb(source, OUT)
        produced = OUT / (source.stem + ".glb")
        final = OUT / f"{name}.glb"
        if produced != final:
            if final.exists():
                final.unlink()
            produced.rename(final)
        print(f"{name:20s} {final.stat().st_size / 1024:8.1f} КБ")
    except Exception as error:  # noqa: BLE001 -- нужен полный перечень неудач
        print(f"{name:20s} ОШИБКА {type(error).__name__}: {error}")
