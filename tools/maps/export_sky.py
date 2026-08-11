"""Готовит игровой скайбокс к показу в просмотрщике локаций.

В игре небо лежит кубической картой в собственном формате .ol. После
расшифровки это .dds: заголовок 128 байт, дальше шесть граней подряд, каждая со
своей цепочкой мипмап, пиксели BGRA без сжатия. Порядок граней в файле
стандартный для DDS — +X, -X, +Y, -Y, +Z, -Z, — и совпадает с тем, который
принимает CubeTextureLoader в three.js, поэтому переставлять ничего не нужно.

Мипмапы из файла отбрасываются: браузер считает их сам, а хранить их в шести
отдельных webp негде.

Запускать питоном стороннего инструмента, там стоят scfile и Pillow:

    D:/Awake/SC_Map_Dump-main/.venv/Scripts/python.exe tools/maps/export_sky.py
"""

from __future__ import annotations

import argparse
import pathlib
import tempfile

from PIL import Image
from scfile.convert import auto

SKY_DIR = pathlib.Path(
    r"D:\SteamLibrary\steamapps\common\STALCRAFT\modassets\assets\gloomycore\sky\skybox"
)
# tools/maps -> корень репозитория
OUT_DIR = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "awake-web" / "public" / "sky"
FACES = ("px", "nx", "py", "ny", "pz", "nz")
SIZE = 1024
QUALITY = 82
HEADER = 128


def face_stride(size: int) -> int:
    """Длина одной грани вместе со всей цепочкой мипмап, в байтах."""
    total, side = 0, size
    while side >= 1:
        total += side * side * 4
        side //= 2
    return total


def read_faces(dds: pathlib.Path) -> list[Image.Image]:
    """Шесть граней нулевого уровня, в порядке файла."""
    raw = dds.read_bytes()
    stride = face_stride(SIZE)
    faces = []
    for index in range(6):
        start = HEADER + index * stride
        chunk = raw[start : start + SIZE * SIZE * 4]
        if len(chunk) != SIZE * SIZE * 4:
            raise SystemExit(f"грань {index} обрывается: файл короче ожидаемого")
        faces.append(Image.frombytes("RGBA", (SIZE, SIZE), chunk, "raw", "BGRA").convert("RGB"))
    return faces


def main() -> None:
    parser = argparse.ArgumentParser(description="экспорт игрового скайбокса")
    parser.add_argument("--name", default="Day_ClearSky_01", help="имя скайбокса без расширения")
    parser.add_argument("--out", type=pathlib.Path, default=OUT_DIR)
    args = parser.parse_args()

    source = SKY_DIR / f"{args.name}.ol"
    if not source.exists():
        raise SystemExit(f"не найден скайбокс {source}")

    args.out.mkdir(parents=True, exist_ok=True)
    # .dds получается на 32 МБ и нужен только на время работы
    with tempfile.TemporaryDirectory() as tmp:
        auto(source, pathlib.Path(tmp))
        faces = read_faces(pathlib.Path(tmp) / f"{args.name}.dds")

    for name, image in zip(FACES, faces):
        path = args.out / f"{name}.webp"
        image.save(path, "WEBP", quality=QUALITY)
        print(f"{path.name}: {path.stat().st_size // 1024} КБ")


if __name__ == "__main__":
    main()
