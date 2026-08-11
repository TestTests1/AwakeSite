# Небо над локацией и вход от первого лица — план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поставить за краем карты игровое небо с туманом и убрать обзорный режим, чтобы просмотрщик открывался сразу от первого лица.

**Architecture:** Скайбокс из файлов STALCRAFT расшифровывается отдельным скриптом конвейера в шесть граней webp и кладётся в `public/` — грузится браузером как обычная статика. В сцене он ставится в `scene.background`, дальние блоки растворяет `THREE.Fog` цвета горизонта. Обзорная камера и весь ветвящийся по ней код уходят; вместо них — постоянный режим ходьбы и меню по Esc, куда переезжают панель расстановок и выход.

**Tech Stack:** three 0.185, @react-three/fiber 9, @react-three/drei 10, TypeScript, Vite; Python 3 + Pillow + scfile для подготовки ассетов.

## Global Constraints

- Спека: `docs/superpowers/specs/2026-08-04-sky-and-first-person-entry-design.md`.
- **Тестового прогона во фронте нет** — ни vitest, ни jest, скрипты только `dev`, `build`, `lint`. Поэтому шлюз каждой задачи: `npm run build` (включает `tsc -b`), `npm run lint` и проверка глазами на стенде. Обычный цикл TDD здесь неприменим, и подменять его выдуманными тестами не нужно.
- Линтер сейчас даёт **39 ошибок**, все в файлах маршрутов и все существовали до этой работы. Число не должно вырасти; в новых файлах ошибок быть не должно.
- Комментарии и текст интерфейса — по-русски, как во всём проекте. Комментарий объясняет причину, а не пересказывает код.
- Скрипты конвейера карт запускаются питоном из стороннего инструмента: `D:/Awake/SC_Map_Dump-main/.venv/Scripts/python.exe`. Там уже стоят `scfile` 5.2.0 и Pillow 12.
- **Геометрию карт не трогать ни в каком виде** — правило из `tools/maps/README.md`, «Чего трогать нельзя»: столкновения считаются лучом по видимой геометрии, удаление блока делает дыру в полу.
- Работа ведётся в отдельной ветке. В репозитории на момент начала есть несохранённые правки по другим задачам — в коммиты этой работы должны попадать **только** перечисленные в задачах файлы, через явный `git add <путь>`.

---

### Task 1: Экспорт игрового скайбокса в шесть граней

**Files:**
- Create: `tools/maps/export_sky.py`
- Create: `frontend/awake-web/public/sky/{px,nx,py,ny,pz,nz}.webp` (результат работы скрипта)
- Modify: `tools/maps/README.md` (раздел «Отдельно»)

**Interfaces:**
- Consumes: ничего.
- Produces: шесть файлов `public/sky/px.webp`, `nx.webp`, `py.webp`, `ny.webp`, `pz.webp`, `nz.webp` — грани 1024×1024. Задача 2 грузит их по этим именам.

- [ ] **Step 1: Завести ветку**

```bash
git checkout -b feat/sky-and-first-person
```

- [ ] **Step 2: Написать скрипт экспорта**

Создать `tools/maps/export_sky.py`:

```python
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
```

- [ ] **Step 3: Запустить и проверить вес**

Run:
```bash
D:/Awake/SC_Map_Dump-main/.venv/Scripts/python.exe tools/maps/export_sky.py
```
Expected: шесть строк вида `px.webp: 45 КБ`, сумма около 273 КБ. Если сумма отличается в разы — грани прочитаны не с тех смещений, дальше идти нельзя.

- [ ] **Step 4: Посмотреть на грани глазами**

Открыть `frontend/awake-web/public/sky/py.webp` и `ny.webp` любым просмотрщиком.
Expected: `py` — небо с редкой дымкой (это зенит), `ny` — земля (это надир). Если наоборот или там боковые виды — порядок граней прочитан неверно.

- [ ] **Step 5: Дописать README конвейера**

В `tools/maps/README.md`, в раздел «Отдельно», добавить перед абзацем про `chunk_tiles.mjs`:

```markdown
`export_sky.py` — готовит небо для просмотрщика: берёт кубическую карту из
`gloomycore/sky/skybox`, вырезает шесть граней и кладёт их в
`frontend/awake-web/public/sky`. К экспорту локаций отношения не имеет и
запускается один раз на смену неба. По умолчанию берёт `Day_ClearSky_01`;
рядом в игре лежат ещё два десятка вариантов — день, ночь, рассвет, закат в
исполнениях «ясно», «облачно», «туман».
```

- [ ] **Step 6: Коммит**

```bash
git add tools/maps/export_sky.py tools/maps/README.md frontend/awake-web/public/sky
git commit -m "feat(world): выгрузить игровой скайбокс в шесть граней"
```

---

### Task 2: Небо в сцене

**Files:**
- Create: `frontend/awake-web/src/lib/sky.ts`
- Modify: `frontend/awake-web/src/components/world/WorldScene.tsx`

**Interfaces:**
- Consumes: файлы `public/sky/*.webp` из задачи 1.
- Produces: `loadSky(): Promise<THREE.CubeTexture>` из `@/lib/sky`; компонент `SkyBox` внутри `WorldScene.tsx` (наружу не выносится).

- [ ] **Step 1: Написать загрузчик неба**

Создать `frontend/awake-web/src/lib/sky.ts`:

```ts
import * as THREE from 'three'

/**
 * Небо локации — кубическая карта из самой игры, выгруженная
 * `tools/maps/export_sky.py`.
 *
 * Порядок имён обязателен и означает +X, −X, +Y, −Y, +Z, −Z: именно в таком
 * виде CubeTextureLoader раскладывает шесть картинок по граням. Перепутать их
 * местами — получить небо снизу и землю сбоку.
 */
const FACES = ['px.webp', 'nx.webp', 'py.webp', 'ny.webp', 'pz.webp', 'nz.webp']

export function loadSky(): Promise<THREE.CubeTexture> {
  return new Promise((resolve, reject) => {
    new THREE.CubeTextureLoader().setPath('/sky/').load(
      FACES,
      (texture) => {
        // без пометки картинки читаются как линейные и небо выцветает
        texture.colorSpace = THREE.SRGBColorSpace
        resolve(texture)
      },
      undefined,
      () => reject(new Error('не удалось загрузить небо')),
    )
  })
}
```

- [ ] **Step 2: Добавить компонент неба в сцену**

В `WorldScene.tsx` дописать импорты:

```ts
import { useThree } from '@react-three/fiber'
import { loadSky } from '@/lib/sky'
```

и рядом с `LocalAvatar` добавить компонент:

```tsx
/**
 * Небо ставится фоном сцены, а не отдельной моделью: фон рисуется без глубины
 * и не мешает ни отсечению, ни лучам столкновений.
 *
 * Грузится отдельно от карты и заметно раньше неё — двести с небольшим
 * килобайт против сотен мегабайт. Пока не приехало, фон остаётся чёрным.
 */
function SkyBox() {
  const scene = useThree((state) => state.scene)

  useEffect(() => {
    let cancelled = false
    let texture: THREE.CubeTexture | null = null

    void loadSky()
      .then((loaded) => {
        if (cancelled) {
          loaded.dispose()
          return
        }
        texture = loaded
        scene.background = loaded
      })
      .catch(() => {
        // без неба мир остаётся проходимым, просто фон чёрный как раньше
      })

    return () => {
      cancelled = true
      scene.background = null
      texture?.dispose()
    }
  }, [scene])

  return null
}
```

- [ ] **Step 3: Поставить компонент в холст**

В `WorldScene.tsx` внутри `<Canvas>` первой строкой, перед `<ambientLight>`:

```tsx
        <SkyBox />
```

- [ ] **Step 4: Собрать и проверить линтером**

Run:
```bash
cd frontend/awake-web && npm run build && npm run lint
```
Expected: сборка проходит; линтер даёт те же 39 ошибок, ни одной в `sky.ts` и `WorldScene.tsx`.

- [ ] **Step 5: Проверить ориентацию на стенде**

Поднять стенд (`dotnet run --project src/Awake.API --urls http://localhost:5001` и `npm run dev`), открыть любую локацию, осмотреться.

Expected: небо вокруг, земля внизу, горизонт сплошной. Признаки беды — перевёрнутая земля наверху, шов посреди горизонта, зеркальная картинка. Если так: править порядок `FACES` в `sky.ts`, а не в скрипте экспорта; при зеркальности добавить `texture.flipY` или перестановку осей — разбираться по факту, наугад не менять.

- [ ] **Step 6: Коммит**

```bash
git add frontend/awake-web/src/lib/sky.ts frontend/awake-web/src/components/world/WorldScene.tsx
git commit -m "feat(world): небо из игры фоном сцены"
```

---

### Task 3: Туман до горизонта

**Files:**
- Modify: `frontend/awake-web/src/components/world/WorldScene.tsx`

**Interfaces:**
- Consumes: `SkyBox` из задачи 2.
- Produces: поле `span` в объекте `view` — числовой размах карты. Нужен здесь же, для границ тумана; последующие задачи его не трогают.

- [ ] **Step 1: Вернуть размах карты наружу**

В `WorldScene.tsx` в `useMemo` для `view` (около строки 184) добавить `span` в возвращаемый объект:

```ts
    return {
      center: center.toArray() as [number, number, number],
      position: [center.x, center.y + span * 0.6, center.z + span * 0.9] as [number, number, number],
      far: span * 10,
      span,
      size,
    }
```

- [ ] **Step 2: Добавить постоянные тумана**

В `WorldScene.tsx` рядом с другими постоянными файла (перед `LocalAvatar`):

```ts
/**
 * Туман прячет стык карты с небом. Карта кончается ровным прямоугольным
 * обрывом, а за ним на скайбоксе нарисована уходящая к горизонту земля —
 * без тумана этот шов режет глаз.
 *
 * Цвет не подобран на глаз, а снят с самого скайбокса: среднее по полосе неба
 * над горизонтом на четырёх боковых гранях. Поэтому дальние блоки растворяются
 * ровно в тот тон, который за ними и нарисован. Сменится небо — пересчитать.
 *
 * Границы заданы долями размаха локации, а не в блоках: карты разного размера,
 * и постоянное расстояние на одной было бы у самого носа, на другой — за краем.
 */
const FOG_COLOR = 0x8099ac
const FOG_START = 0.45
const FOG_END = 1.05
```

- [ ] **Step 3: Поставить туман в холст**

В `WorldScene.tsx` внутри `<Canvas>`, сразу после `<SkyBox />`:

```tsx
        <fog attach="fog" args={[FOG_COLOR, view.span * FOG_START, view.span * FOG_END]} />
```

- [ ] **Step 4: Собрать и проверить линтером**

Run:
```bash
cd frontend/awake-web && npm run build && npm run lint
```
Expected: сборка проходит, ошибок линтера по-прежнему 39.

- [ ] **Step 5: Посмотреть на стенде**

Войти в режим ходьбы, посмотреть вдаль.
Expected: дальние блоки растворяются в тот же цвет, что и небо у горизонта, край карты не читается ступенькой. Ближние и средние дистанции чистые. Если туман начинается слишком близко — поднимать `FOG_START`, но не трогать `FOG_END`: за ним стоит отсечение камеры.

- [ ] **Step 6: Коммит**

```bash
git add frontend/awake-web/src/components/world/WorldScene.tsx
git commit -m "feat(world): туман до горизонта под цвет неба"
```

---

### Task 4: Вход сразу от первого лица

**Files:**
- Modify: `frontend/awake-web/src/components/world/WorldScene.tsx`
- Modify: `frontend/awake-web/src/i18n/ru.json`
- Modify: `frontend/awake-web/src/i18n/en.json`

**Interfaces:**
- Consumes: `view.span` из задачи 3.
- Produces: `WorldScene` без состояния `walking`; хук `usePointerLocked(): boolean` внутри `WorldScene.tsx`; ключ перевода `world.clickToLook`. Задача 5 добавляет к этому меню.

- [ ] **Step 1: Убрать состояние ходьбы и орбитальную камеру**

В `WorldScene.tsx`:

1. удалить импорт `OrbitControls` из `@react-three/drei` (строка 3);
2. удалить `const [walking, setWalking] = useState(false)`;
3. удалить `stopWalking` целиком вместе с веткой `if (event.code === 'Escape')` в обработчике клавиш. Esc временно не делает ничего — меню на него повесит задача 5, а выход из стройки и без него остаётся на клавише B;
4. в обработчике клавиш убрать условие `if (!walking) return` и зависимость `walking`;
5. в вызове `useWorldSession(location, playerRef, walking, ...)` передать `true` вместо `walking`;
6. блок `{walking ? (<>…</>) : (<OrbitControls …/>)}` заменить на его содержимое без обёртки и без `OrbitControls`;
7. во всех местах разметки убрать условия `walking &&` и `!walking &&`, оставив содержимое (`LayoutPanel`, счётчик игроков, прицел, подсказка). Кнопки «идти» и «лететь» удалить целиком.

Про `LayoutPanel` и кнопку закрытия сказать прямо: после этой задачи они висят поверх игры постоянно и мешают. Так и задумано — своё место они получат в задаче 5, а спрятать их раньше значило бы на один коммит остаться без выхода из локации и без общеклановых расстановок.

- [ ] **Step 2: Поставить камеру на точку появления**

В `WorldScene.tsx` заменить положение камеры в `<Canvas>`:

```tsx
      <Canvas camera={{ fov: 60, near: 0.5, far: view.far, position: spawn ?? view.center }}>
```

Причина — комментарием над `<Canvas>`:

```tsx
      {/* Камера ставится сразу на точку появления: Player доведёт её до земли
          в своём эффекте, но до первого кадра эффекты не срабатывают, и с
          обзорной позиции мелькнул бы вид издалека. */}
```

- [ ] **Step 3: Поправить признак режима и подсказку**

В `WorldScene.tsx`:

```tsx
    <div className="fixed inset-0 z-30 bg-black" data-mode={flying ? 'fly' : 'walk'}>
```

и подсказку внизу:

```tsx
        {flying ? t('world.flyHint') : t('world.walkHint')}
```

- [ ] **Step 4: Добавить хук и подсказку про захват курсора**

В `WorldScene.tsx` рядом с `SkyBox`:

```tsx
/**
 * Получен ли захват курсора.
 *
 * Браузер не выдаёт его без явного жеста, а входим мы теперь сразу от первого
 * лица — без клика. Клавиши при этом работают, а мышь нет, и без подсказки это
 * выглядит поломкой. Захват восстанавливается кликом по холсту, этим занят
 * usePointerLook.
 */
function usePointerLocked(): boolean {
  const [locked, setLocked] = useState(() => document.pointerLockElement !== null)

  useEffect(() => {
    const update = () => setLocked(document.pointerLockElement !== null)
    document.addEventListener('pointerlockchange', update)
    return () => document.removeEventListener('pointerlockchange', update)
  }, [])

  return locked
}
```

В теле `WorldScene` добавить `const locked = usePointerLocked()`, а в разметку — подсказку рядом с прицелом:

```tsx
      {!locked && (
        <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 rounded-md border border-accent/40 bg-card/90 px-4 py-2 text-sm text-accent">
          {t('world.clickToLook')}
        </div>
      )}
```

- [ ] **Step 5: Поправить переводы**

В `frontend/awake-web/src/i18n/ru.json`, раздел `world`: удалить ключи `orbitHint` и `walk`, добавить:

```json
    "clickToLook": "Щёлкните по карте, чтобы осмотреться",
```

То же в `en.json`:

```json
    "clickToLook": "Click the map to look around",
```

- [ ] **Step 6: Собрать и проверить линтером**

Run:
```bash
cd frontend/awake-web && npm run build && npm run lint
```
Expected: сборка проходит. `tsc` обязан ругнуться, если где-то остался `walking` — это и есть проверка, что состояние вычищено целиком. Ошибок линтера по-прежнему 39.

- [ ] **Step 7: Проверить на стенде**

Открыть локацию.
Expected: сразу первое лицо на точке появления, без кадра с видом издалека; подсказка про клик видна; после клика она исчезает и мышь смотрит; WASD, F, V, B работают; счётчик игроков виден с самого начала.

- [ ] **Step 8: Коммит**

```bash
git add frontend/awake-web/src/components/world/WorldScene.tsx frontend/awake-web/src/i18n/ru.json frontend/awake-web/src/i18n/en.json
git commit -m "feat(world): открывать локацию сразу от первого лица"
```

---

### Task 5: Меню по Esc

**Files:**
- Modify: `frontend/awake-web/src/components/world/Player.tsx:72-82`
- Modify: `frontend/awake-web/src/components/world/WorldScene.tsx`
- Modify: `frontend/awake-web/src/i18n/ru.json`
- Modify: `frontend/awake-web/src/i18n/en.json`

**Interfaces:**
- Consumes: `usePointerLocked` и разметку из задачи 4.
- Produces: у `Player` появляется необязательное свойство `look?: boolean` (по умолчанию `true`); ключи перевода `world.menu.title`, `world.menu.resume`.

- [ ] **Step 1: Дать Player выключаемый обзор**

В `Player.tsx` в список свойств (около строки 72) добавить:

```ts
  /** Обзор мышью. Выключается, когда поверх игры открыто меню: иначе клик по
      его кнопке тут же увёл бы курсор обратно в игру. */
  look?: boolean,
```

и заменить `usePointerLook(true)` (строка 82) на:

```ts
  usePointerLook(look)
```

добавив в разбор свойств `look = true`.

- [ ] **Step 2: Завести состояние меню**

В `WorldScene.tsx`:

```ts
  const [menu, setMenu] = useState(false)
```

В обработчике клавиш заменить обработку Esc:

```ts
      // Esc открывает и закрывает меню. Снятие захвата курсора при этом делает
      // сам браузер, независимо от нас, — поэтому здесь только переключение.
      if (event.code === 'Escape') setMenu((value) => !value)
      // при открытом меню игровые клавиши молчат: иначе набор в поле имени
      // расстановки переключал бы полёт и стройку
      if (menu) return
      if (event.code === 'KeyF') setFlying((value) => !value)
```

и добавить `menu` в зависимости эффекта.

- [ ] **Step 3: Передать признак в Player и признак режима**

```tsx
            <Player
              scene={scene}
              spawn={spawn}
              flying={flying}
              placed={placed}
              thirdPerson={thirdPerson}
              look={!menu}
              state={playerRef}
            />
```

и

```tsx
    <div className="fixed inset-0 z-30 bg-black" data-mode={menu ? 'menu' : flying ? 'fly' : 'walk'}>
```

- [ ] **Step 4: Собрать меню**

В `WorldScene.tsx` заменить разметку, показывавшую `LayoutPanel` и кнопку закрытия, на слой меню:

```tsx
      {menu && (
        <div className="absolute inset-0 z-40 flex items-start justify-center overflow-auto bg-black/70 p-6">
          <div className="w-full max-w-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">{t('world.menu.title')}</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFlying((value) => !value)}
                  className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground hover:bg-secondary"
                >
                  {flying ? t('world.flyOff') : t('world.flyOn')}
                </button>
                <button
                  type="button"
                  onClick={() => setMenu(false)}
                  className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent hover:bg-accent/20"
                >
                  {t('world.menu.resume')}
                </button>
                {onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground hover:bg-secondary"
                  >
                    {t('world.close')}
                  </button>
                )}
              </div>
            </div>
            {location && <LayoutPanel location={location} placed={placed} onLoad={setPlaced} />}
          </div>
        </div>
      )}
```

Прицел и подсказку про клик спрятать при открытом меню: в их условия добавить `!menu`.

- [ ] **Step 5: Добавить переводы**

В `ru.json`, раздел `world`:

```json
    "menu": {
      "title": "Пауза",
      "resume": "Вернуться в игру"
    },
```

В `en.json`:

```json
    "menu": {
      "title": "Paused",
      "resume": "Back to the map"
    },
```

- [ ] **Step 6: Собрать и проверить линтером**

Run:
```bash
cd frontend/awake-web && npm run build && npm run lint
```
Expected: сборка проходит, ошибок линтера 39.

- [ ] **Step 7: Проверить на стенде**

Expected по пунктам:
1. Esc открывает меню, курсор виден, мышь не крутит камеру;
2. в меню сохраняются, загружаются и удаляются общеклановые расстановки;
3. кнопка полёта переключает режим, подпись меняется;
4. Esc или «вернуться в игру» закрывают меню; после этого появляется подсказка про клик, а клик по холсту возвращает мышь;
5. «Закрыть карту» выходит в список локаций;
6. набор имени расстановки не переключает полёт и стройку.

- [ ] **Step 8: Коммит**

```bash
git add frontend/awake-web/src/components/world/Player.tsx frontend/awake-web/src/components/world/WorldScene.tsx frontend/awake-web/src/i18n/ru.json frontend/awake-web/src/i18n/en.json
git commit -m "feat(world): меню по Esc вместо обзорного режима"
```

---

### Task 6: Свести концы

**Files:**
- Modify: `STRUCTURE.md`
- Modify: `docs/superpowers/specs/2026-08-04-sky-and-first-person-entry-design.md` (только если по ходу работы что-то решили иначе)

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: ничего.

- [ ] **Step 1: Пройти проверку из спеки целиком**

Шесть пунктов раздела «Риски и проверка» подряд, на одной локации, не переоткрывая вкладку:

1. небо на месте, горизонт без шва, земля внизу;
2. дальние блоки растворяются в цвет горизонта;
3. вход — сразу первое лицо, без кадра издалека;
4. подсказка про клик появляется и уходит;
5. меню по Esc работает целиком;
6. заход на карту не стал мутным.

- [ ] **Step 2: Проверить на второй локации**

Повторить на карте другого размера («Небольшая Бердовка» после «Низины» или наоборот).
Причина: границы тумана заданы долями размаха, и ошибка в них видна только при сравнении карт разной величины.

- [ ] **Step 3: Дописать STRUCTURE.md**

В описание просмотрщика мира добавить абзац:

```markdown
Небо — кубическая карта из самой игры, выгруженная `tools/maps/export_sky.py` в
`public/sky`. Ставится фоном сцены, освещения не даёт. Туман под цвет горизонта
прячет стык карты с нарисованной на скайбоксе землёй; границы заданы долями
размаха локации. Обзорной камеры нет: локация открывается сразу от первого
лица, а панель расстановок и выход живут в меню по Esc.
```

- [ ] **Step 4: Коммит**

```bash
git add STRUCTURE.md docs/superpowers/specs/2026-08-04-sky-and-first-person-entry-design.md
git commit -m "docs: описать небо и вход от первого лица"
```

---

## Что осталось за пределами плана

- Потоковая подгрузка карты кусками — отдельная спека, отдельный план. Туман из задачи 3 ей понадобится, поэтому она делается после.

  Опорная величина для неё: **в самой игре дальность прогрузки 100–120 метров**, а блок равен метру. Туман этого плана намеренно вдесятеро дальше (на «Низине» конец на ~1460 блоках): карта грузится целиком, скрывать нечего, и туман здесь нужен только чтобы спрятать стык с нарисованной на небе землёй. Как только куски начнут догружаться на ходу, радиус загрузки и конец тумана должны сойтись около 120 блоков — иначе игрок будет видеть, как мир достраивается впереди.
- Заливка изменённых моделей локаций в R2 — висит с прошлой работы, к этому плану отношения не имеет.
- Гранаты по радиусу — замысел описан, работы не начаты.
