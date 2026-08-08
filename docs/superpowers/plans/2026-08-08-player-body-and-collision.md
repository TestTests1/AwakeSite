# Тело игрока и столкновения объёмом — план работ

> **Для исполнителей-агентов:** ОБЯЗАТЕЛЬНЫЙ ПОДНАВЫК: используйте
> superpowers:subagent-driven-development (рекомендуется) или
> superpowers:executing-plans, чтобы выполнять план задача за задачей. Шаги
> размечены галочками (`- [ ]`) для отметки хода работ.

**Цель:** сделать игрока в просмотрщике телом настоящего размера из игры и
считать столкновения его объёмом, чтобы вопрос «пролезет ли между барикадами»
получал честный ответ.

**Устройство:** размеры тела вынимаются из игровой коробки попаданий
(`hitbox.mcvd`) питоновским скриптом и ложатся в репозиторий одним маленьким
JSON. Клиент читает его и строит вокруг ног коробку. Проверка пересечения идёт
через `intersectsBox` той же `three-mesh-bvh`, которая уже строит деревья для
лучей, — второй копии геометрии не появляется.

**Инструменты:** Python 3 + `scfile` 5.2 (окружение `SC_Map_Dump-main/.venv`),
TypeScript, three.js, three-mesh-bvh 0.9.13, React 19.

## Общие ограничения

Действуют на все задачи без исключения.

- **Замысел:** `docs/superpowers/specs/2026-08-08-player-body-and-character-design.md`.
  Часть B (персонаж и анимации) в этот план НЕ входит.
- **Геометрию карты не удалять — ни одну, ни по какой причине.** Столкновения
  считаются по видимой геометрии, другого источника у них нет. Правило записано
  в `tools/maps/README.md`.
- **В бинарник игры и в её память не лезем.** Читаем только файлы ресурсов.
  Это условие владельца, оно не обсуждается.
- **`src/Awake.API/appsettings.Development.json` не открывать и не цитировать.**
- **Коммитить только явными путями:** `git add <путь>`. Никогда `git add -A`,
  никогда каталог. В рабочем дереве постоянно лежит чужая правка
  `frontend/awake-web/src/routeTree.gen.ts` — она не должна попасть ни в один
  коммит.
- **Прогонов тестов на фронте нет.** Тестового запускателя в проекте не
  существует, и заводить его в этой работе не нужно. Вместо «запусти тест»
  проверка — это `npx tsc -b`, `npx eslint .` и названный в задаче замер или
  осмотр. Где написано «проверить», там указано, чем именно.
- **Эталон линтера: ровно 39 ошибок.** Столько их сейчас, все — наследство.
  Число не должно вырасти. Проверка: `cd frontend/awake-web && npx eslint .`
- **Комментарии по-русски и про «почему», а не про «что».** Так написан весь
  остальной код проекта.
- **Питон запускать интерпретатором из окружения карт:**
  `D:\Awake\SC_Map_Dump-main\.venv\Scripts\python.exe`. Своего окружения не
  заводить, `pip install` не делать — `scfile` там уже есть.
- **Разбор скелета и анимаций в `scfile` по умолчанию выключен.** Без
  `Options(skeleton=True, animation=True)` кости приходят пустым списком, и это
  выглядит как «в файле нет скелета». Ловушка настоящая, на ней уже потеряли
  время.
- **Игровые файлы в репозиторий не кладём** — только посчитанные числа.
- Ветка: работаем в текущей `feat/streaming-map-loading`, если владелец не
  скажет иначе.

## Что где лежит

| файл | за что отвечает |
|---|---|
| `tools/character/measure_body.py` | создаётся: читает игровые файлы, считает размеры тела, пишет JSON |
| `tools/character/README.md` | создаётся: откуда берутся числа и как перезапустить обмер |
| `frontend/awake-web/src/lib/playerBody.json` | создаётся: посчитанные размеры, единственный источник правды для клиента |
| `frontend/awake-web/src/lib/collision.ts` | правится: добавляется проверка объёмом `boxBlocked` |
| `frontend/awake-web/src/components/world/Player.tsx` | правится: движение коробкой, ступенька, присед |
| `frontend/awake-web/src/components/world/WorldScene.tsx` | правится: ближняя плоскость камеры |
| `frontend/awake-web/src/components/world/BodyBox.tsx` | создаётся: отладочная отрисовка коробки тела |

---

### Задача 1: обмер тела стоя

**Файлы:**
- Создать: `tools/character/measure_body.py`
- Создать: `tools/character/README.md`
- Создать: `frontend/awake-web/src/lib/playerBody.json`

**Стыки:**
- Отдаёт: `playerBody.json` вида
  `{ standing: { width, depth, height, eye }, crouching: {...}, source, notes }`.
  Все размеры — в метрах, они же блоки. Точка отсчёта — ступни (`y = 0`).
  Неизвестные значения записываются как `null`, а не как правдоподобное число.

**Что известно заранее** (проверено, можно опираться):
`D:\SteamLibrary\steamapps\common\STALCRAFT\modassets\assets\highpoly\character\hitbox.mcvd`
— формат MCSA, 13 мешей-коробок с именами костей, свой скелет из 62 костей.
Габарит целиком: X −0.4437…0.4437, Y 0…1.9507, Z −0.1974…0.1974.

- [ ] **Шаг 1: написать скрипт обмера**

Создать `tools/character/measure_body.py`:

```python
"""
Считает размеры тела игрока по игровой коробке попаданий.

Коробка попаданий — не одна коробка, а тринадцать, по костям (ступни, голени,
бёдра, таз, грудь, плечи, предплечья, шея с головой). Это то, чем игра считает
попадания; коробка движения в блочных играх обычно уже, и это осознанный
размен: взятая ширина делает ответ строгим в одну сторону — прошёл в
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
        # Поза приседа считается отдельной задачей: движения хранят дорожки без
        # имён, и сопоставление их с костями ещё не подтверждено. Ставить сюда
        # правдоподобное число нельзя — на этих числах держится весь ответ про
        # барикады.
        "crouching": {"width": None, "depth": None, "height": None, "eye": None},
        "source": "highpoly/character/hitbox.mcvd",
        "notes": {
            "eye": "оценка: верх коробки шеи минус 0.15",
            "width": "с руками, руки в бинд-позе висят вдоль тела",
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"записано: {OUT}")
    for name, value in standing.items():
        print(f"  {name}: {value}")


if __name__ == "__main__":
    main()
```

- [ ] **Шаг 2: запустить и сверить с известными числами**

Запуск:
```
D:\Awake\SC_Map_Dump-main\.venv\Scripts\python.exe tools/character/measure_body.py
```

Ожидается ровно: `width: 0.8875`, `depth: 0.3948`, `height: 1.9507`.

Если хоть одно число разошлось — **остановиться и разобраться, не подгоняя**.
Расхождение значит, что читается не тот файл или не так, и дальше по плану идти
нельзя: все размеры тела растут из этих трёх чисел.

- [ ] **Шаг 3: написать README**

Создать `tools/character/README.md`: откуда берутся числа (какой файл игры),
почему в репозитории лежит только JSON, как перезапустить обмер после
обновления игры, и предупреждение про `Options(skeleton=True)`.

- [ ] **Шаг 4: коммит**

```bash
git add tools/character/measure_body.py tools/character/README.md frontend/awake-web/src/lib/playerBody.json
git commit -m "feat(world): обмер тела игрока по игровой коробке попаданий"
```

---

### Задача 2: поза приседа

**Файлы:**
- Изменить: `tools/character/measure_body.py`
- Изменить: `frontend/awake-web/src/lib/playerBody.json`

**Стыки:**
- Потребляет: `bone_boxes`, `measure` из задачи 1.
- Отдаёт: заполненный раздел `crouching` в `playerBody.json`.

**Известная трудность и что про неё уже выяснено.**
`highpoly/animations/character.mcal` содержит 158 клипов; у `MOB_Crouch_Idle`
141 кадр, `translations` формы (141, 71, 3) и `rotations` (141, 71, 4).
Дорожек 71, **имён у них нет**, а в скелете коробки попаданий 62 кости.

Поиск опорного скелета **уже проведён по всем ресурсам игры** — повторять не
надо. Итог: модели ровно с 71 костью нет ни одной (единственное совпадение —
винтовка G36, к телу отношения не имеет). Зато выяснилось главное: базовый
скелет игрока стабилен. Из 200 проверенных моделей брони в
`stalker/models/armor/` **24 несут ровно те же 62 кости в том же порядке**, что
и коробка попаданий, — например `ark.mcsb`, `atlas.mcsb`, `armai.mcsb`.

Отсюда рабочая догадка: первые 62 дорожки идут в порядке базовых костей, а
оставшиеся девять — вспомогательные (оружие, помощники сгибов). Задача — не
искать дальше, а проверить эту догадку.

- [ ] **Шаг 1: проверить порядок дорожек на позе стоя**

Проверка самодостаточная: наложить на коробку **первый кадр
`MOB_Stand_Idle`**, считая, что дорожка `i` принадлежит кости `i` базового
скелета, и сравнить получившийся габарит с бинд-позой.

Стоячая поза обязана сойтись с уже известными 0.8875 × 0.3948 × 1.9507 с
допуском 0.02 м. Сошлось — порядок верен, идём в шаг 3.

- [ ] **Шаг 2: если не сошлось — закрыть задачу честно**

**Числа сюда не выдумываем.** Оставить `crouching` пустым, записать в
`tools/character/README.md`, что рост присевшего надо замерить в игре — встать
под перекрытием известной высоты и посмотреть, где перестаёт пускать, — и на
этом задачу закрыть. Задача 6 (присед) в таком случае не делается, это в ней
оговорено.

Перед закрытием попробовать один запасной ход, он дешёвый: сопоставить дорожки
не по порядку, а по совпадению бинд-положений — у каждой кости скелета есть
своё положение, и первый кадр покоя близок к нему. Если однозначное
сопоставление находится, порядок восстановлен и можно идти в шаг 3.

- [ ] **Шаг 3: посчитать позу приседа**

Устройство скелета в `scfile` (проверено): у кости есть `id`, `parent_id`,
`name`, `position` (3), `quaternion` (x, y, z, w); у скелета —
`inverse_bind_matrices` и `calculate_global_transforms()`.

Дописать в `measure_body.py`:

```python
def bone_matrix(position, quaternion) -> np.ndarray:
    """Матрица кости из положения и поворота."""
    x, y, z, w = (float(v) for v in quaternion)
    matrix = np.eye(4)
    matrix[:3, :3] = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w),     2 * (x * z + y * w)],
        [2 * (x * y + z * w),     1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w),     2 * (y * z + x * w),     1 - 2 * (x * x + y * y)],
    ]
    matrix[:3, 3] = position
    return matrix


def world_matrices(skeleton, translations, rotations) -> list[np.ndarray]:
    """
    Мировые матрицы костей для одного кадра.

    translations и rotations — срез этого кадра: (дорожки, 3) и (дорожки, 4).
    Дорожка i считается принадлежащей кости i базового скелета; лишние дорожки
    сверх числа костей отбрасываются — см. разбор выше.
    """
    bones = skeleton.bones
    # родитель обязан быть посчитан раньше ребёнка
    order = sorted(range(len(bones)), key=lambda i: bones[i].parent_id)
    world: list[np.ndarray | None] = [None] * len(bones)
    for index in order:
        bone = bones[index]
        local = bone_matrix(translations[bone.id], rotations[bone.id])
        parent = np.eye(4) if bone.is_root else world[bone.parent_id]
        if parent is None:
            raise SystemExit("скелет идёт не в порядке иерархии — разобраться, не угадывать")
        world[bone.id] = parent @ local
    return world  # type: ignore[return-value]


def posed_extent(boxes, skeleton, world) -> dict[str, float]:
    """Габарит всех коробок костей, поставленных в позу."""
    by_name = {bone.name: bone for bone in skeleton.bones}
    moved = []
    for name, vertices in boxes.items():
        bone = by_name.get(name)
        if bone is None:
            continue
        # коробка задана в бинд-позе, поэтому сначала снимаем бинд
        matrix = world[bone.id] @ skeleton.inverse_bind_matrices[bone.id]
        homogeneous = np.hstack([vertices, np.ones((len(vertices), 1))])
        moved.append((homogeneous @ matrix.T)[:, :3])
    every = np.vstack(moved)
    low, high = every.min(axis=0), every.max(axis=0)
    return {
        "width": round(float(high[0] - low[0]), 4),
        "depth": round(float(high[2] - low[2]), 4),
        "height": round(float(high[1] - low[1]), 4),
    }
```

Кадр брать не первый попавшийся, а **худший по макушке** из всех кадров клипа
`MOB_Crouch_Idle`: присед — это цикл с покачиванием. Нас интересует, где игрок
пройдёт наверняка, поэтому берём кадр с наибольшей высотой:

```python
    frames = range(clip.frames)
    best = max(
        (posed_extent(boxes, skeleton, world_matrices(skeleton, clip.translations[f], clip.rotations[f]))
         for f in frames),
        key=lambda extent: extent["height"],
    )
```

Высоту глаз присевшего считать тем же способом, что и стоя: верх коробки шеи
минус 0.15, и так же пометить оценкой в `notes`.

- [ ] **Шаг 4: сверить здравым смыслом**

Рост присевшего обязан быть меньше роста стоя и больше половины от него
(0.98…1.95). Выход за эти границы означает ошибку в кинематике, а не находку.
Проверка встраивается в скрипт как явная остановка с понятным сообщением.

- [ ] **Шаг 5: коммит**

```bash
git add tools/character/measure_body.py tools/character/README.md frontend/awake-web/src/lib/playerBody.json
git commit -m "feat(world): рост и ширина присевшего игрока из позы приседа"
```

---

### Задача 3: камера не залезает в стены

**Файлы:**
- Изменить: `frontend/awake-web/src/components/world/WorldScene.tsx` (камера холста)
- Изменить: `frontend/awake-web/src/components/world/Player.tsx` (отход камеры от третьего лица)

**Стыки:**
- Потребляет: ничего из прошлых задач. Задачу можно делать параллельно с 1 и 2.

**Причина.** Ближняя плоскость камеры стоит на `0.5` м, а тело подходит к стене
на 0.44. Всё, что ближе полуметра, не рисуется вовсе — сквозь стену видно
всегда, а не иногда.

- [ ] **Шаг 1: опустить ближнюю плоскость**

В `WorldScene.tsx` в свойствах `<Canvas camera={{ ... }}>` заменить `near: 0.5`
на `near: 0.1` и оставить рядом объяснение:

```tsx
{/* Ближняя плоскость меньше половины ширины тела: иначе стена, к которой
    игрок подошёл вплотную, обрезается и сквозь неё видно насквозь.
    Дальняя плоскость при этом велика, но точности буфера глубины хватает:
    туман всё равно гасит картинку на 120 метрах. */}
```

- [ ] **Шаг 2: убрать нижний предел отхода камеры**

В `Player.tsx` в `finish()`, в ветке `thirdPerson`, стоит:

```ts
        if (hit !== null) distance = Math.max(CAMERA_MIN, hit - CAMERA_MARGIN)
```

`CAMERA_MIN` равен 1.2. Когда стена ближе полутора метров за спиной, луч
находит её, но `Math.max` возвращает не расстояние до стены, а полтора метра —
и камера сознательно ставится **внутрь** стены. Именно так она туда и попадает:
не потому, что упора нет, а потому что упор перебивается нижним пределом.

Заменить на:

```ts
        // Нижнего предела здесь быть не должно: он перебивал найденное
        // расстояние до стены и загонял камеру внутрь неё. Прижались спиной —
        // камера подъезжает вплотную к затылку, это правильное поведение, а не
        // повод её отпустить.
        if (hit !== null) distance = Math.max(0, hit - CAMERA_MARGIN)
```

Постоянную `CAMERA_MIN` убрать: других мест использования у неё нет.

**Замечание к порядку задач.** Второй возможный источник той же беды — глаза
внутри блока, когда игрок подошёл к стене вплотную. Он закрывается сам собой
задачей 5: тело становится коробкой шириной 0.89, глаза стоят в её середине,
а коробка в стену не заходит. Отдельной правки не требует.

- [ ] **Шаг 3: проверить сборку и линтер**

```
cd frontend/awake-web && npx tsc -b && npx eslint .
```
Ожидается: типы чисты, ошибок линтера ровно 39.

- [ ] **Шаг 4: осмотр на стенде**

Подойти вплотную к стене от первого лица — стена обязана остаться видимой.
Прижаться спиной к стене в виде от третьего лица — камера обязана упереться, а
не уехать внутрь.

- [ ] **Шаг 5: коммит**

```bash
git add frontend/awake-web/src/components/world/WorldScene.tsx frontend/awake-web/src/components/world/Player.tsx
git commit -m "fix(world): камера больше не проходит сквозь стены"
```

---

### Задача 4: проверка объёмом в коллайдере

**Файлы:**
- Изменить: `frontend/awake-web/src/lib/collision.ts`

**Стыки:**
- Отдаёт: `TerrainCollider.boxBlocked(box: THREE.Box3): boolean` — пересекается
  ли коробка в мировых координатах с геометрией карты или с поставленными
  заграждениями. Задачи 5 и 6 пользуются только этим методом.

- [ ] **Шаг 1: добавить метод**

В `collision.ts`, рядом с `cast`:

```ts
  /**
   * Пересекается ли коробка с геометрией карты или с заграждениями.
   *
   * Ради этого метода всё и затевалось: телом игрока стал объём, а не точка,
   * и «пролезет ли между барикадами» перестало зависеть от того, удачно ли
   * расставлены лучи.
   *
   * Куски без готового дерева пропускаются — ровно как в cast: перебор
   * миллиона треугольников напрямую стоил бы кадра. Такой кусок ещё не
   * прогрет prepare, и игрок в него всё равно не упирается.
   *
   * Коробка приходит в мировых координатах, а дерево живёт в системе
   * координат меша — отсюда обратная матрица. У кусков она не единичная:
   * сжатие карты выносит размещение в матрицу узла.
   */
  boxBlocked(box: THREE.Box3): boolean {
    for (const group of [this.parts, this.dynamic]) {
      for (const part of group) {
        const tree = part.mesh.geometry.boundsTree
        if (!tree) continue
        if (!part.box.intersectsBox(box)) continue
        this.boxToMesh.copy(part.mesh.matrixWorld).invert()
        if (tree.intersectsBox(box, this.boxToMesh)) return true
      }
    }
    return false
  }
```

И рядом с прочими переиспользуемыми полями класса:

```ts
  /** Переиспользуется каждый кадр: боксов проверяется несколько за шаг. */
  private readonly boxToMesh = new THREE.Matrix4()
```

- [ ] **Шаг 2: проверить сборку и линтер**

```
cd frontend/awake-web && npx tsc -b && npx eslint .
```
Ожидается: типы чисты, ошибок ровно 39.

- [ ] **Шаг 3: коммит**

```bash
git add frontend/awake-web/src/lib/collision.ts
git commit -m "feat(world): проверка пересечения коробкой в коллайдере"
```

---

### Задача 5: движение телом, а не точкой

**Файлы:**
- Изменить: `frontend/awake-web/src/components/world/Player.tsx`

**Стыки:**
- Потребляет: `collider.boxBlocked(box)` из задачи 4;
  `playerBody.json` из задачи 1.
- Отдаёт: поведение, на которое опирается задача 6 (присед) — высота тела берётся
  из переменной, а не из постоянной.

**Важное следствие, записать в комментарии.** Коробка тела берётся квадратной в
плане, со стороной 0.8875 — по наибольшему размеру. Тело в просмотрщике не
поворачивается вместе со взглядом: иначе одна и та же щель то пропускала бы, то
нет, в зависимости от того, боком человек идёт или лицом. Так устроены блочные
игры, и так ответ остаётся строгим в одну сторону.

- [ ] **Шаг 1: подключить размеры и завести коробку**

В начале `Player.tsx`:

```ts
import body from '@/lib/playerBody.json'

/** Сторона коробки тела в плане — по наибольшему размеру, см. комментарий ниже. */
const BODY_WIDTH = body.standing.width
const BODY_STAND = body.standing.height
const EYE_HEIGHT = body.standing.eye ?? BODY_STAND - 0.15
/**
 * Зазор снизу и сверху, чтобы пол, на котором игрок стоит, не считался
 * препятствием: коробка вплотную к опоре пересекалась бы с ней каждый кадр.
 */
const SKIN = 0.02
```

Постоянные `BODY_HEIGHT`, `BODY_RADIUS`, `WALL_PROBES` убрать: их заменяет
коробка. `STEP_UP` остаётся.

Внутри компонента:

```ts
  /** Коробка тела для проверок; переиспользуется, копий не плодим. */
  const probe = useRef(new THREE.Box3())

  /** Коробка тела с ногами в (x, y, z) заданной высоты. */
  const bodyAt = (x: number, y: number, z: number, height: number) => {
    const half = BODY_WIDTH / 2
    probe.current.min.set(x - half, y + SKIN, z - half)
    probe.current.max.set(x + half, y + height - SKIN, z + half)
    return probe.current
  }
```

- [ ] **Шаг 2: заменить moveAxis**

```ts
    /**
     * Двигает по одной оси. Свободно — едем целиком; упёрлись — пробуем
     * переступить на блок вверх; не вышло — подъезжаем к стене вплотную
     * половинным делением.
     *
     * Раньше при любом попадании луча шаг по оси отменялся целиком, и игрок
     * замирал в полуметре от стены. Подъезд вплотную и есть то самое
     * скольжение вдоль стены: осевое разделение уже было, не хватало
     * остановки в точке касания.
     */
    const moveAxis = (amount: number, axis: 'x' | 'z') => {
      if (amount === 0) return
      const from = axis === 'x' ? feet.current.x : feet.current.z

      const freeAt = (value: number, y: number) => {
        const x = axis === 'x' ? value : feet.current.x
        const z = axis === 'z' ? value : feet.current.z
        return !collider.boxBlocked(bodyAt(x, y, z, bodyHeight.current))
      }
      const place = (value: number) => {
        if (axis === 'x') feet.current.x = value
        else feet.current.z = value
      }

      if (freeAt(from + amount, feet.current.y)) {
        place(from + amount)
        return
      }

      // ступенька в блок: то же движение, но телом, поднятым на STEP_UP.
      // Высоту подхватит проверка опоры ниже по кадру — если ступеньки там на
      // самом деле нет, игрок просто упадёт обратно.
      if (grounded.current && freeAt(from + amount, feet.current.y + STEP_UP)) {
        place(from + amount)
        feet.current.y += STEP_UP
        return
      }

      // подъезд вплотную: пять делений дают точность около двух сантиметров
      // при самом быстром беге
      let free = 0
      let blocked = amount
      for (let i = 0; i < 5; i++) {
        const middle = (free + blocked) / 2
        if (freeAt(from + middle, feet.current.y)) free = middle
        else blocked = middle
      }
      place(from + free)
    }
```

- [ ] **Шаг 3: завести высоту тела переменной и отдавать её наружу**

Рядом с прочими ref-ами:

```ts
  /** Текущая высота тела: меняется приседом (задача 6). */
  const bodyHeight = useRef(BODY_STAND)
```

Заменить обращения к прежней постоянной `BODY_HEIGHT` (упор макушкой в
потолок) на `bodyHeight.current`. Там же, в задаче 3, если она уже сделана,
заменить постоянную в отходе камеры.

В `RenderStats.tsx` дописать в `PlayerReport` поле:

```ts
  /** Игрок присел: нужно тем, кто рисует его тело в настоящий рост. */
  crouching: boolean
```

и публиковать его в `finish()` вместе с остальным состоянием:

```ts
        state.current.crouching = bodyHeight.current !== BODY_STAND
```

Поле заводится здесь, а не в задаче 6, нарочно: задача 6 может не состояться,
если обмер приседа не удался, а задача 7 на это поле опирается.

- [ ] **Шаг 4: проверить сборку и линтер**

```
cd frontend/awake-web && npx tsc -b && npx eslint .
```
Ожидается: типы чисты, ошибок ровно 39.

- [ ] **Шаг 5: осмотр на стенде**

Пройти вдоль стены под углом — обязано скользить, а не залипать. Подойти к
стене — обязано останавливать вплотную, а не в полуметре. Шагнуть на блок —
обязано переступать.

- [ ] **Шаг 6: коммит**

```bash
git add frontend/awake-web/src/components/world/Player.tsx
git commit -m "feat(world): игрок двигается телом, а не точкой"
```

---

### Задача 6: присед

**Файлы:**
- Изменить: `frontend/awake-web/src/components/world/Player.tsx`
- Изменить: `frontend/awake-web/src/i18n/ru.json`, `frontend/awake-web/src/i18n/en.json`
  (подсказка управления)

**Стыки:**
- Потребляет: `bodyHeight` и `bodyAt` из задачи 5; `body.crouching` из задачи 2.

**Если задача 2 закрылась без чисел** (`crouching.height === null`), присед не
делать: заглушка с выдуманной высотой хуже отсутствия приседа, потому что
выглядит как ответ. В этом случае задачу пропустить и записать это в журнал.

- [ ] **Шаг 1: завести высоту приседа**

Рядом с прочими размерами в начале `Player.tsx`:

```ts
/**
 * Рост присевшего — из позы MOB_Crouch_Idle, наложенной на игровую коробку
 * попаданий (задача 2). Если обмер не удался, значение равно null, и присед
 * не делается вовсе: выдуманная высота выглядела бы как ответ, а ответ здесь
 * дороже удобства.
 */
const CROUCH_HEIGHT = body.crouching.height
```

Если `CROUCH_HEIGHT === null` — задачу не делать, см. оговорку выше.

- [ ] **Шаг 2: переключение высоты по Ctrl**

В кадровом цикле, до расчёта перемещения:

```ts
    // Присед: держим Ctrl. В полёте клавиша занята снижением, поэтому только
    // при ходьбе.
    const wantCrouch = active && (keys.has('ControlLeft') || keys.has('ControlRight'))
    if (wantCrouch) {
      bodyHeight.current = CROUCH_HEIGHT
    } else if (bodyHeight.current !== BODY_STAND) {
      // Встать можно только если над головой есть место. Иначе присед стал бы
      // способом пролезть куда угодно и тут же выпрямиться внутри плиты.
      const free = !collider.boxBlocked(
        bodyAt(feet.current.x, feet.current.y, feet.current.z, BODY_STAND),
      )
      if (free) bodyHeight.current = BODY_STAND
    }
```

Высота глаз в `finish()` считается от `bodyHeight.current`, а не от постоянной:
иначе присев, игрок смотрел бы с прежней высоты.

- [ ] **Шаг 3: скорость приседом**

Присев, игрок движется медленнее — иначе приседом будут ходить всегда. Взять
половину шага: `WALK_SPEED / 2`. Это не замер из игры, а разумное поведение, и
так и написать в комментарии.

- [ ] **Шаг 4: дописать подсказку управления**

В `world.walkHint` обоих языков добавить Ctrl — присесть.

- [ ] **Шаг 5: проверить сборку и линтер**

```
cd frontend/awake-web && npx tsc -b && npx eslint .
```
Ожидается: типы чисты, ошибок ровно 39.

- [ ] **Шаг 6: осмотр на стенде**

Присесть под низким перекрытием и пройти. Попробовать встать под ним — не
должно вставать. Отойти и встать — должно.

- [ ] **Шаг 7: коммит**

```bash
git add frontend/awake-web/src/components/world/Player.tsx frontend/awake-web/src/i18n/ru.json frontend/awake-web/src/i18n/en.json
git commit -m "feat(world): присед с настоящей высотой из игры"
```

---

### Задача 7: коробка тела видна глазами

**Файлы:**
- Создать: `frontend/awake-web/src/components/world/BodyBox.tsx`
- Изменить: `frontend/awake-web/src/components/world/WorldScene.tsx`

**Стыки:**
- Потребляет: `playerRef` (уже есть, отдаёт положение и состояние игрока каждый
  кадр), `playerBody.json`.

**Зачем.** Ради этой работы всё и делалось: «пролезет» должно быть видно, а не
только ощущаться. Клавиша «4» показывает коробку тела — рядом с барикадой сразу
понятно, упирается она или нет.

- [ ] **Шаг 1: компонент отрисовки**

Создать `frontend/awake-web/src/components/world/BodyBox.tsx`:

```tsx
import { useEffect, useMemo, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import body from '@/lib/playerBody.json'
import type { PlayerReport } from './RenderStats'

/**
 * Коробка тела на экране.
 *
 * Ради неё всё и делалось: «пролезет ли между барикадами» должно быть видно
 * глазами, а не только ощущаться на ощупь. Монтируется только когда включена,
 * поэтому в обычной игре не стоит ничего.
 *
 * Коробка квадратная в плане и со взглядом не поворачивается — ровно та же,
 * по которой считаются столкновения. Показывать что-то другое значило бы
 * рисовать красивую неправду.
 */
export function BodyBox({ playerRef }: { playerRef: RefObject<PlayerReport | null> }) {
  const scene = useThree((state) => state.scene)
  const helper = useMemo(
    () => new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0x3ddc84)),
    [],
  )

  useEffect(() => {
    scene.add(helper)
    return () => {
      scene.remove(helper)
      helper.geometry.dispose()
    }
  }, [scene, helper])

  useFrame(() => {
    const player = playerRef.current
    if (!player) return
    const half = body.standing.width / 2
    const height = player.crouching
      ? (body.crouching.height ?? body.standing.height)
      : body.standing.height
    helper.box.min.set(player.position.x - half, player.position.y, player.position.z - half)
    helper.box.max.set(player.position.x + half, player.position.y + height, player.position.z + half)
  })

  return null
}
```

- [ ] **Шаг 2: клавиша**

Цифры 1, 2 и 3 уже заняты отладкой отрисовки (`RenderTuning.tsx`). Взять
`Digit4`, добавить в `WorldScene.tsx` рядом с прочими переключателями.

- [ ] **Шаг 3: проверить сборку и линтер**

```
cd frontend/awake-web && npx tsc -b && npx eslint .
```
Ожидается: типы чисты, ошибок ровно 39.

- [ ] **Шаг 4: замер на щелях**

В режиме строительства поставить две барикады с разными просветами, включить
коробку и пройти. Записать в журнал: при каком просвете проходит, при каком
нет. Это и есть проверка всей работы.

- [ ] **Шаг 5: коммит**

```bash
git add frontend/awake-web/src/components/world/BodyBox.tsx frontend/awake-web/src/components/world/WorldScene.tsx
git commit -m "feat(world): показ коробки тела для проверки просветов"
```
