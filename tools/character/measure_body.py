"""
Считает размеры тела игрока по игровой коробке попаданий.

Коробка попаданий — не одна коробка, а четырнадцать, по костям (ступни, голени,
бёдра, таз двумя частями, грудь, плечи, предплечья, шея с головой). Это то, чем
игра считает попадания; коробка движения в блочных играх обычно уже, и это
осознанный размен: взятая ширина делает ответ строгим в одну сторону — прошёл в
просмотрщике, значит пройдёт и в игре.

Игровые файлы в репозиторий не кладутся, поэтому скрипт читает их по месту
установки игры и оставляет здесь только посчитанные числа.

Запуск (интерпретатор из окружения карт, там уже стоит scfile):
  D:\\Awake\\SC_Map_Dump-main\\.venv\\Scripts\\python.exe tools/character/measure_body.py
"""

import json
import os
from pathlib import Path

import numpy as np
from scfile.core.options import Options
from scfile.formats.mcsa.decoder import McsaDecoder

GAME = Path(os.environ.get(
    "SC_GAME_ASSETS",
    r"D:\SteamLibrary\steamapps\common\STALCRAFT\modassets\assets",
))
HITBOX = GAME / "highpoly" / "character" / "hitbox.mcvd"
OUT = Path(__file__).resolve().parents[2] / "frontend/awake-web/src/lib/playerBody.json"

# Разбор скелета выключен в scfile по умолчанию: без этого кости приходят
# пустым списком, и файл выглядит как модель без скелета.
OPTIONS = Options(skeleton=True, animation=True)


def bone_boxes(path: Path) -> dict[str, np.ndarray]:
    """Коробка каждой кости в бинд-позе: {имя: массив вершин (N, 3)}."""
    if not path.exists():
        raise SystemExit(
            f"нет файла коробки попаданий: {path}\n"
            "путь к ресурсам игры задаётся переменной SC_GAME_ASSETS"
        )
    with McsaDecoder(path, options=OPTIONS) as decoder:
        model = decoder.decode()
    boxes = {}
    for mesh in model.scene.meshes:
        vertices = np.asarray(mesh.vertices)
        boxes[mesh.name] = vertices[:, :3] if vertices.ndim == 2 else vertices
    return boxes


def measure(boxes: dict[str, np.ndarray]) -> dict[str, float]:
    """Габарит всех коробок вместе."""
    every = np.vstack(list(boxes.values()))
    low, high = every.min(axis=0), every.max(axis=0)
    return {
        "width": round(float(high[0] - low[0]), 4),
        "depth": round(float(high[2] - low[2]), 4),
        "height": round(float(high[1] - low[1]), 4),
    }


def main() -> None:
    boxes = bone_boxes(HITBOX)
    standing = measure(boxes)

    # Глаза — по верху коробки шеи: в неё входит голова целиком. Точное
    # положение зрачка отсюда не достать, поэтому значение помечено оценкой,
    # а не выдаётся за замер.
    neck = boxes.get("neck")
    standing["eye"] = round(float(neck[:, 1].max()) - 0.15, 4) if neck is not None else None

    payload = {
        "standing": standing,
        # Присед пуст не потому, что до него не дошли руки: источника нет.
        # Движения игрока лежат в скелете на 71 безымянную дорожку, коробка
        # попаданий — на 62 кости, и соответствие между ними опровергнуто
        # замером (разбор — в README). Правдоподобное число сюда ставить нельзя:
        # на этих числах держится весь ответ про барикады.
        "crouching": {"width": None, "depth": None, "height": None, "eye": None},
        "source": "highpoly/character/hitbox.mcvd",
        "notes": {
            "eye": "оценка: верх коробки шеи минус 0.15",
            "width": "с руками, руки в бинд-позе висят вдоль тела",
            "crouching": "не измерен: движения игрока в скелете без имён, "
                         "мерить надо руками в игре — см. tools/character/README.md",
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"записано: {OUT}")
    for name, value in standing.items():
        print(f"  {name}: {value}")


if __name__ == "__main__":
    main()
