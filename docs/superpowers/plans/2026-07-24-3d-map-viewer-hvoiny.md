# 3D-вьюер локации «Хвойный» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать членам клана (Member+) походить от первого лица по 3D-модели локации «Хвойный» (арена `tournament_hvoiny`) прямо в браузере на новой вкладке сайта.

**Architecture:** Один сквозной пайплайн: офлайн-экспорт `.mdat` → `.glb` через сторонний `SC_Map_Dump-main/tools/mdat_obj_export.py` → оптимизация `gltf-transform` → файл коммитится в бэкенд как приватный ассет → бэкенд раздаёт его по авторизации (Member+) → фронтенд грузит и парсит `.glb` через `GLTFLoader`, рендерит в React Three Fiber + Rapier с капсульным персонажем от первого лица (гравитация, коллизии, pointer lock).

**Tech Stack:** Python (только для офлайн-экспорта, не часть деплоя), Node `@gltf-transform/cli` (только для офлайн-оптимизации), ASP.NET Core / MediatR / xUnit+Moq (бэкенд), React 19 + Vite + TanStack Router + `three` + `@react-three/fiber` + `@react-three/drei` + `@react-three/rapier` (фронтенд).

## Global Constraints

- Одна локация на первую версию — `tournament_hvoiny`, один хардкоженный бэкенд-эндпоинт, без БД и без списка локаций (спека, раздел «Бэкенд»).
- Файл модели коммитится в git внутри `src/Awake.API/MapAssets/` (не `wwwroot`, не внешнее хранилище, не git frontend) — спека, раздел «Хостинг».
- Раздача файла — только через `[RankAuthorize(UserRank.Member)]`-эндпоинт, JWT такой же, как во всех остальных контроллерах (заголовок `Authorization: Bearer`).
- Новый роут фронтенда — `_auth.world.tsx`, ранг-гейтинг на уровне компонента (`if (rank < UserRank.Member) return <Navigate to="/profile" />`), как в `_auth.boosts.tsx` — не новый механизм.
- Стек 3D — React Three Fiber + drei + `@react-three/rapier` (утверждено пользователем, вариант A из брейнсторминга).
- Персонаж — от первого лица, с гравитацией и коллизиями (капсульный rigid body), pointer lock по клику, WASD + прыжок на пробел.
- Фронтенд не имеет тестового раннера (нет `test`-скрипта в `package.json`) — проверка фронтенд-задач через `npm run build` (typecheck) и ручную проверку на дев-стенде, не через юнит-тесты.
- Бэкенд — юнит-тесты по существующей конвенции (xUnit + Moq + FluentAssertions, паттерн `Result<T>`, MediatR-хендлеры), см. `tests/Awake.Unit.Tests/Features/Squads/GetSquadReserveQueryHandlerTests.cs` как образец.
- `.NET` таргет — `net10.0`; фронтенд-сборка — `tsc -b && vite build`.

---

## Task 1: Экспорт и оптимизация 3D-модели «Хвойного»

Разовая офлайн-подготовка ассета. Не трогает код сайта, но результат (файл модели + JSON с координатой спавна) нужен следующим задачам.

**Статус: выполнено.** Изначально план предполагал один монолитный прогон экспортёра (шаги 4-9 ниже в исходной редакции). На практике сборка целой локации оказалась слишком тяжёлой для памяти и для лимита времени процесса в этой среде (см. «Что пошло не так» после шагов) — реально использован **тайловый пайплайн**: 12 независимых экспортов маленьких bbox → per-tile оптимизация → per-tile патч мировых координат → merge в один `.glb`. Итоговые интерфейсы (пути файлов, формат spawn.json) не изменились — Task 2-5 ничего не знают о тайлах и написаны корректно как есть.

**Files:**
- Create: `SC_Map_Dump-main/.venv/` (Python venv, не коммитится)
- Create: `SC_Map_Dump-main/tile_export.py`, `optimize_tiles.py`, `apply_tile_offsets.py`, `combine_scenes.py`, `compute_tile_offsets.py` (орchestration-скрипты тайлового пайплайна, не коммитятся — лежат в gitignored `SC_Map_Dump-main/`)
- Create: `SC_Map_Dump-main/tmp_export/tiles/tile_{r}_{c}.glb` (12 сырых тайлов, не коммитятся)
- Create: `SC_Map_Dump-main/tmp_export/tiles_opt/tile_{r}_{c}.glb` (12 оптимизированных тайлов, не коммитятся)
- Create: `SC_Map_Dump-main/tmp_export/tiles_world/tile_{r}_{c}.glb` (12 тайлов с исправленными мировыми координатами, не коммитятся)
- Create: `SC_Map_Dump-main/tmp_export/hvoiny.glb` (финальный смерженный файл, не коммитится)
- Create: `src/Awake.API/MapAssets/hvoiny.glb` (коммитится, 76.9 МБ)
- Create: `frontend/awake-web/src/components/world/hvoiny.spawn.json` (коммитится)
- Modify: `D:\Awake\.gitignore` (добавить `SC_Map_Dump-main/`)

**Interfaces:**
- Consumes: ничего (первая задача плана).
- Produces: `src/Awake.API/MapAssets/hvoiny.glb` — бинарный `.glb`-файл, потребляется Task 2 (раздача файла) и Task 3 (парсинг на фронтенде). `frontend/awake-web/src/components/world/hvoiny.spawn.json` — JSON вида `{"x": <число>, "y": <число>, "z": <число>}`, импортируется напрямую как модуль в Task 4 (`WorldScene.tsx`) — никто не должен вручную переписывать эти числа куда-либо, только импортировать файл.

- [x] **Шаг 1: Добавить `SC_Map_Dump-main/` в `.gitignore` и закоммитить**

Открой `D:\Awake\.gitignore`, добавь в конец новую секцию:

```
# ===== Сторонний инструмент экспорта карты (не часть сайта) =====
SC_Map_Dump-main/
```

```powershell
git add .gitignore
git commit -m "chore: игнорировать SC_Map_Dump-main (сторонний инструмент экспорта карты)"
```

- [x] **Шаг 2: Проверить, что инструмент и игра на месте**

```powershell
Test-Path "D:\Awake\SC_Map_Dump-main\tools\mdat_obj_export.py"
Test-Path "D:\SteamLibrary\steamapps\common\STALCRAFT\map_cache\5.0\tournament_hvoiny"
Test-Path "D:\SteamLibrary\steamapps\common\STALCRAFT\modassets\assets\stalcraft\textures\hrblockMap.texarr"
```

Ожидается: все три команды печатают `True`. Если хотя бы одна — `False`, дальше не идти, разобраться в чём разница путей.

- [x] **Шаг 3: Создать venv и поставить зависимости экспортёра**

```powershell
cd D:\Awake\SC_Map_Dump-main
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
```

Ожидается: `Successfully installed ... Pillow ... cryptography ... zstandard ...` без ошибок.

- [x] **Шаг 4 (реально выполнено иначе — тайловый экспорт): 12 независимых мини-экспортов вместо одного монолитного**

Прямой прогон без `--bbox` падает с `MemoryError` — у `tournament_hvoiny` 56.7 млн непустых блоков на 3058 чанков, из них ~85% (Y от 0 до ~55) — однородная сплошная заливка без видимой геометрии сверху. Добавление `--bbox 3328 55 -2496 4351 200 -1649` отсекло эту подложку, но даже так **целиком** локация оказалась экспортируема двумя разными способами провала:
1. `_serialize_glb` падала с `MemoryError` на склейке многогигабайтных буферов через `+=` — исправлено потоковой записью через `f.write(...)` (см. патч в `tools/mdat_obj_export.py`: добавлен `import shutil`, `GLTF_PRIMITIVE_FLUSH_THRESHOLD`, `GltfPrimitive` переписан на посегментную запись во временные scratch-файлы вместо накопления в памяти, `_serialize_glb` переписана в два прохода через диск).
2. Даже после фикса памяти единый экспорт **всей** локации не укладывался в лимит времени процесса этой среды (процесс гарантированно убивался в районе ~40-60 минут независимо от механизма запуска — `run_in_background`, PowerShell background job, `nohup`/`disown`).

Решение — разбить `--bbox` на сетку **3×4 = 12 тайлов** (`SC_Map_Dump-main/tile_export.py`), каждый — отдельный быстрый вызов `mdat_obj_export.py` с `--context-padding 3` (соседние блоки за пределами строгого bbox всё равно подгружаются для корректного face culling на границах тайлов, без видимых швов). Скрипт идемпотентен: пропускает уже готовые `tile_{r}_{c}.glb`, что даёт бесплатный resume при обрыве процесса — просто перезапустить тот же скрипт.

```powershell
cd D:\Awake\SC_Map_Dump-main
.\.venv\Scripts\python.exe tile_export.py
```

Ожидается: в `tmp_export/tiles/` появляются 12 файлов `tile_0_0.glb` … `tile_2_3.glb`.

- [x] **Шаг 5 (было — проверка сырого `.glb`; реально — проверка каждого тайла)**

```powershell
.\.venv\Scripts\python -c "from pathlib import Path; [print(p.name, 'OK') for p in Path('tmp_export/tiles').glob('*.glb') if Path(p).read_bytes()[:4] == b'glTF']"
```

- [x] **Шаг 6 (было — единая оптимизация; реально — per-tile оптимизация, потом merge)**

Мержить 12 сырых тайлов (суммарно ~3.1 ГБ) одним `gltf-transform merge` до сжатия — рискованно по памяти, поэтому сначала каждый тайл сжимается **отдельно** (`SC_Map_Dump-main/optimize_tiles.py`, тоже идемпотентный, пропускает готовые):

```powershell
cd D:\Awake\SC_Map_Dump-main
.\.venv\Scripts\python.exe optimize_tiles.py
```

**Важная ловушка gltf-transform CLI:** формат вывода определяется по расширению файла. Если писать во временный путь вида `tile.glb.tmp` (чтобы потом атомарно переименовать), CLI видит расширение `.tmp`, не узнаёт его и вместо бинарного `.glb` пишет голый JSON-документ (без BIN-чанка) — файл выглядит правдоподобно по размеру, но не является валидным GLB. Правильно — временный путь должен заканчиваться на `.glb` (`tile.tmp.glb`), а не наоборот.

Результат — `tmp_export/tiles_opt/tile_{r}_{c}.glb`, суммарно ~77 МБ вместо ~3.1 ГБ (сжатие `--compress meshopt --texture-size 1024`).

**Открытая проблема, требующая Шага 6.5 ниже:** `mdat_obj_export.py` центрирует вершины каждого экспорта вокруг локального центра его собственного bbox (`compute_center_offset`, ~строка 5158) — то есть у каждого из 12 тайлов вершины лежат в локальных координатах относительно СВОЕГО центра, а не в абсолютных мировых координатах. Это смещение нигде не сохраняется в `.glb` — при простом мерже все 12 тайлов легли бы друг на друга в районе нуля координат.

- [x] **Шаг 6.5 (не было в исходном плане): пересчитать и применить мировое смещение каждого тайла**

Смещение детерминировано (это центр bbox только реально загруженных блоков, `compute_center_offset(export_blocks.keys())` в `write_glb`), поэтому его можно восстановить, не повторяя полный экспорт геометрии — только загрузку блоков через `load_world` с тем же bbox и `empty_ids={0}` (дефолт `--empty-id`). Скрипт `SC_Map_Dump-main/compute_tile_offsets.py` делает это для всех 12 тайлов и пишет `tmp_export/tile_offsets.json`.

Затем `SC_Map_Dump-main/apply_tile_offsets.py` открывает каждый `tiles_opt/tile_{r}_{c}.glb`, находит mesh-ноду и прибавляет к её `translation` мировое смещение тайла (транспорт корректен, так как трансформация — чистые `translate + uniform-scale`, без ротации: `world = (T_quant + O_tile) + S_quant * v_normalized`). Результат — `tmp_export/tiles_world/tile_{r}_{c}.glb`.

```powershell
cd D:\Awake\SC_Map_Dump-main
.\.venv\Scripts\python.exe compute_tile_offsets.py
.\.venv\Scripts\python.exe apply_tile_offsets.py
```

- [x] **Шаг 6.6 (не было в исходном плане): merge тайлов**

```powershell
npx --yes @gltf-transform/cli merge tmp_export\tiles_world\tile_0_0.glb ... tmp_export\tiles_world\tile_2_3.glb tmp_export\hvoiny_raw_merge.glb
```

**Ещё одна ловушка:** флаг `--merge-scenes` у `gltf-transform merge` в этой версии (4.4.1) детерминированно теряет сцену **первого** входного файла — на выходе оказывается 11 нод из 12, `tile_0_0` пропадает без ошибок и предупреждений. Обходной путь — мержить **без** `--merge-scenes` (тогда все 12 сцен сохраняются, каждая как отдельный `Scene`), а затем самостоятельно объединить их в одну сцену (`SC_Map_Dump-main/combine_scenes.py` — читает JSON-чанк GLB, заменяет `scenes` на один объект со списком всех нод, `scene: 0`, переписывает файл; BIN-чанк не трогается).

```powershell
.\.venv\Scripts\python.exe combine_scenes.py tmp_export\hvoiny_raw_merge.glb tmp_export\hvoiny.glb
```

- [x] **Шаг 7 (было — сравнение размеров; реально — валидация финального смерженного файла)**

```powershell
.\.venv\Scripts\python -c "from pathlib import Path; data = Path('tmp_export/hvoiny.glb').read_bytes(); assert data[:4] == b'glTF'; assert int.from_bytes(data[4:8], 'little') == 2; print('OK size_mb=', round(len(data)/1_048_576, 2))"
```

Ожидается: `OK size_mb= 76.79` (или близко).

- [x] **Шаг 8: Вычислить bounding box модели и координату спавна**

**Критичное отличие от исходного плана:** после `--compress meshopt`, `POSITION`-аксессоры используют квантованные нормализованные компоненты (`componentType: 5122` = `SHORT`, `normalized: true`), а сама трансформация в мировые координаты — на уровне ноды (`node.translation` + `node.scale`). Значения `accessor.min`/`accessor.max` при этом хранятся как **сырые целые** (до ±32767), а не как нормализованные `[-1, 1]` float — использовать их напрямую (как в исходном плане, где предполагался несжатый `.glb` без квантования) даёт мусорный bounding box (там, где ожидались тысячи единиц, получаются миллионы). Правильная формула: `normalized = raw / 32767` (SNORM), затем `world = node.translation + node.scale * normalized`, по обоим угловым точкам `min`/`max` каждого аксессора, агрегируя по всем 12 нодам (ротации нет, так что углы локального AABB остаются углами и в мировом пространстве).

```powershell
.\.venv\Scripts\python -c "
import json, struct
from pathlib import Path

COMPONENT_DIVISOR = {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}

data = Path('tmp_export/hvoiny.glb').read_bytes()
json_len = struct.unpack_from('<I', data, 12)[0]
gltf = json.loads(data[20:20 + json_len])

overall_min = [float('inf')]*3
overall_max = [float('-inf')]*3
for node in gltf.get('nodes', []):
    if 'mesh' not in node: continue
    t = node.get('translation', [0.0,0.0,0.0])
    s = node.get('scale', [1.0,1.0,1.0])
    for prim in gltf['meshes'][node['mesh']]['primitives']:
        idx = prim['attributes'].get('POSITION')
        if idx is None: continue
        acc = gltf['accessors'][idx]
        if 'min' not in acc or 'max' not in acc: continue
        lo, hi = list(acc['min']), list(acc['max'])
        divisor = COMPONENT_DIVISOR.get(acc['componentType']) if acc.get('normalized') else None
        if divisor:
            lo = [max(v/divisor, -1.0) for v in lo]
            hi = [max(v/divisor, -1.0) for v in hi]
        for i in range(3):
            c0, c1 = t[i]+s[i]*lo[i], t[i]+s[i]*hi[i]
            overall_min[i] = min(overall_min[i], c0, c1)
            overall_max[i] = max(overall_max[i], c0, c1)

center = [(overall_min[i]+overall_max[i])/2 for i in range(3)]
spawn = {'x': center[0], 'y': overall_max[1]+2, 'z': center[2]}
print('min', overall_min); print('max', overall_max); print('spawn', spawn)
Path('tmp_export/hvoiny.spawn.json').write_text(json.dumps(spawn, indent=2), encoding='utf-8')
"
```

Ожидается: `min`/`max` близко к реальным мировым координатам bbox локации (X: ~3328-4352, Z: ~-2496..-1648, Y: ~55-197 для «Хвойного») — если min/max получаются в миллионах, значит нормализация по `componentType`/`normalized` не применена. Значение `y` в `spawn` — высота потолка/крыши плюс 2 метра запаса.

- [x] **Шаг 9: Скопировать готовые файлы в бэкенд/фронтенд и закоммитить** — закоммичено в `45c1688`.

```powershell
New-Item -ItemType Directory -Force -Path D:\Awake\src\Awake.API\MapAssets | Out-Null
New-Item -ItemType Directory -Force -Path D:\Awake\frontend\awake-web\src\components\world | Out-Null
Copy-Item D:\Awake\SC_Map_Dump-main\tmp_export\hvoiny.glb D:\Awake\src\Awake.API\MapAssets\hvoiny.glb
Copy-Item D:\Awake\SC_Map_Dump-main\tmp_export\hvoiny.spawn.json D:\Awake\frontend\awake-web\src\components\world\hvoiny.spawn.json
cd D:\Awake
git add src/Awake.API/MapAssets/hvoiny.glb frontend/awake-web/src/components/world/hvoiny.spawn.json
git commit -m "feat(world): 3D-модель локации «Хвойный» (оптимизированный glb + координата спавна)"
```

(Папка `frontend/awake-web/src/components/world/` пока пуста, кроме этого JSON — остальные файлы туда добавит Task 4. Это нормально: JSON — общие данные, используемые только фронтендом.)

Ожидается: `git commit` проходит успешно (двоичный файл будет закоммичен как есть — это осознанный компромисс из спеки, не бага). Если `.glb` больше нескольких сотен мегабайт — остановиться и вернуться к шагу 6 с более агрессивными флагами (например, ниже `--texture-size`), не коммитить файл такого размера не спросив пользователя.

---

## Task 2: Бэкенд — эндпоинт раздачи модели

**Files:**
- Create: `src/Awake.Application/Common/Interfaces/IMapAssetService.cs`
- Create: `src/Awake.Application/Features/Maps/Queries/GetHvoinyModel/GetHvoinyModelQuery.cs`
- Create: `src/Awake.Application/Features/Maps/Queries/GetHvoinyModel/GetHvoinyModelQueryHandler.cs`
- Create: `src/Awake.Infrastructure/ExternalServices/Maps/MapAssetService.cs`
- Modify: `src/Awake.Infrastructure/DependencyInjection.cs`
- Create: `src/Awake.API/Controllers/MapsController.cs`
- Modify: `src/Awake.API/Awake.API.csproj`
- Test: `tests/Awake.Unit.Tests/Features/Maps/GetHvoinyModelQueryHandlerTests.cs`

**Interfaces:**
- Consumes: `src/Awake.API/MapAssets/hvoiny.glb` (файл из Task 1, проверяется через `File.Exists`).
- Produces: `GET /api/maps/hvoiny/model` (`[RankAuthorize(UserRank.Member)]`) — отдаёт файл (`Content-Type: model/gltf-binary`) или `404`. Используется Task 3 (`mapsApi.getHvoinyModel`, путь `/maps/hvoiny/model`).

- [ ] **Шаг 1: Написать падающий тест хендлера**

Создать `tests/Awake.Unit.Tests/Features/Maps/GetHvoinyModelQueryHandlerTests.cs`:

```csharp
using Awake.Application.Common.Interfaces;
using Awake.Application.Features.Maps.Queries.GetHvoinyModel;
using FluentAssertions;
using Moq;

namespace Awake.Unit.Tests.Features.Maps;

public class GetHvoinyModelQueryHandlerTests
{
    private readonly Mock<IMapAssetService> _assets = new();

    private GetHvoinyModelQueryHandler BuildHandler() => new(_assets.Object);

    [Fact]
    public async Task Handle_ModelExists_ReturnsSuccessWithPath()
    {
        _assets.Setup(s => s.GetHvoinyModelPath()).Returns(@"C:\app\MapAssets\hvoiny.glb");

        var result = await BuildHandler().Handle(new GetHvoinyModelQuery(), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().Be(@"C:\app\MapAssets\hvoiny.glb");
    }

    [Fact]
    public async Task Handle_ModelMissing_ReturnsFailure()
    {
        _assets.Setup(s => s.GetHvoinyModelPath()).Returns((string?)null);

        var result = await BuildHandler().Handle(new GetHvoinyModelQuery(), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
    }
}
```

- [ ] **Шаг 2: Убедиться, что тест не компилируется (типов ещё нет)**

Run: `dotnet build tests/Awake.Unit.Tests`
Expected: FAIL — `IMapAssetService`, `GetHvoinyModelQuery`, `GetHvoinyModelQueryHandler` не найдены.

- [ ] **Шаг 3: Создать интерфейс `IMapAssetService`**

Создать `src/Awake.Application/Common/Interfaces/IMapAssetService.cs`:

```csharp
namespace Awake.Application.Common.Interfaces;

public interface IMapAssetService
{
    string? GetHvoinyModelPath();
}
```

- [ ] **Шаг 4: Создать запрос и хендлер**

Создать `src/Awake.Application/Features/Maps/Queries/GetHvoinyModel/GetHvoinyModelQuery.cs`:

```csharp
using Awake.Application.Common.Models;
using MediatR;

namespace Awake.Application.Features.Maps.Queries.GetHvoinyModel;

public record GetHvoinyModelQuery : IRequest<Result<string>>;
```

Создать `src/Awake.Application/Features/Maps/Queries/GetHvoinyModel/GetHvoinyModelQueryHandler.cs`:

```csharp
using Awake.Application.Common.Interfaces;
using Awake.Application.Common.Models;
using MediatR;

namespace Awake.Application.Features.Maps.Queries.GetHvoinyModel;

public class GetHvoinyModelQueryHandler(IMapAssetService mapAssetService)
    : IRequestHandler<GetHvoinyModelQuery, Result<string>>
{
    public Task<Result<string>> Handle(GetHvoinyModelQuery request, CancellationToken cancellationToken)
    {
        var path = mapAssetService.GetHvoinyModelPath();
        return Task.FromResult(path is not null
            ? Result<string>.Success(path)
            : Result<string>.Failure("Модель локации не найдена."));
    }
}
```

- [ ] **Шаг 5: Запустить тест и убедиться, что он проходит**

Run: `dotnet test tests/Awake.Unit.Tests --filter FullyQualifiedName~GetHvoinyModelQueryHandlerTests`
Expected: `Passed! - Failed: 0, Passed: 2`.

- [ ] **Шаг 6: Реализовать `IMapAssetService` в Infrastructure**

Создать `src/Awake.Infrastructure/ExternalServices/Maps/MapAssetService.cs`:

```csharp
using Awake.Application.Common.Interfaces;
using Microsoft.AspNetCore.Hosting;

namespace Awake.Infrastructure.ExternalServices.Maps;

public class MapAssetService(IWebHostEnvironment environment) : IMapAssetService
{
    public string? GetHvoinyModelPath()
    {
        var path = Path.Combine(environment.ContentRootPath, "MapAssets", "hvoiny.glb");
        return File.Exists(path) ? path : null;
    }
}
```

- [ ] **Шаг 7: Зарегистрировать сервис в DI**

В `src/Awake.Infrastructure/DependencyInjection.cs` добавить `using Awake.Infrastructure.ExternalServices.Maps;` к остальным `using`, и перед `return services;` добавить:

```csharp
        // Карта (3D-вьюер)
        services.AddSingleton<IMapAssetService, MapAssetService>();
```

- [ ] **Шаг 8: Создать контроллер**

Создать `src/Awake.API/Controllers/MapsController.cs`:

```csharp
using Awake.API.Filters;
using Awake.Application.Features.Maps.Queries.GetHvoinyModel;
using Awake.Domain.Enums;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Awake.API.Controllers;

[ApiController]
[Route("api/maps")]
[Authorize]
public class MapsController(ISender sender) : ControllerBase
{
    [HttpGet("hvoiny/model")]
    [RankAuthorize(UserRank.Member)]
    public async Task<IActionResult> GetHvoinyModel(CancellationToken ct)
    {
        var result = await sender.Send(new GetHvoinyModelQuery(), ct);
        if (!result.IsSuccess)
            return NotFound();

        return PhysicalFile(result.Value!, "model/gltf-binary", enableRangeProcessing: true);
    }
}
```

- [ ] **Шаг 9: Убедиться, что `MapAssets/hvoiny.glb` попадёт в publish-вывод**

В `src/Awake.API/Awake.API.csproj` добавить новый `<ItemGroup>` перед закрывающим `</Project>`:

```xml
  <ItemGroup>
    <None Include="MapAssets\**" CopyToOutputDirectory="PreserveNewest" CopyToPublishDirectory="PreserveNewest" />
  </ItemGroup>
```

- [ ] **Шаг 10: Собрать весь бэкенд и прогнать все тесты**

Run: `dotnet build`
Expected: `Build succeeded.`

Run: `dotnet test tests/Awake.Unit.Tests`
Expected: все тесты проходят (было 154 на момент этого плана — теперь на 2 больше).

- [ ] **Шаг 11: Коммит**

```bash
git add src/Awake.Application/Common/Interfaces/IMapAssetService.cs \
        src/Awake.Application/Features/Maps/ \
        src/Awake.Infrastructure/ExternalServices/Maps/ \
        src/Awake.Infrastructure/DependencyInjection.cs \
        src/Awake.API/Controllers/MapsController.cs \
        src/Awake.API/Awake.API.csproj \
        tests/Awake.Unit.Tests/Features/Maps/
git commit -m "feat(world): эндпоинт GET /api/maps/hvoiny/model для раздачи 3D-модели"
```

---

## Task 3: Фронтенд — зависимости, загрузка и парсинг модели

**Files:**
- Modify: `frontend/awake-web/package.json` (новые зависимости)
- Create: `frontend/awake-web/src/api/maps.ts`
- Create: `frontend/awake-web/src/lib/parseGltf.ts`

**Interfaces:**
- Consumes: `apiClient`-паттерн авторизации из `frontend/awake-web/src/api/client.ts` (`useAuthStore.getState().accessToken`, `ApiError`), эндпоинт `GET /api/maps/hvoiny/model` из Task 2.
- Produces: `mapsApi.getHvoinyModel(onProgress?: (ratio: number) => void): Promise<ArrayBuffer>` и `parseGltf(buffer: ArrayBuffer): Promise<THREE.Group>` — используются в Task 5 (`_auth.world.tsx`). `MapModel`/`Player`/`WorldScene` из Task 4 потребляют тип `THREE.Group`, который возвращает `parseGltf`.

- [ ] **Шаг 1: Поставить 3D-зависимости**

```powershell
cd D:\Awake\frontend\awake-web
npm install three @react-three/fiber @react-three/drei @react-three/rapier
npm install -D @types/three
```

Ожидается: `package.json` обновился, `npm install` завершился без ошибок.

- [ ] **Шаг 2: Создать `parseGltf.ts`**

Создать `frontend/awake-web/src/lib/parseGltf.ts`:

```ts
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

export function parseGltf(buffer: ArrayBuffer): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.parse(
      buffer,
      '',
      (gltf) => resolve(gltf.scene),
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    )
  })
}
```

- [ ] **Шаг 3: Создать `api/maps.ts` с загрузкой и прогрессом**

Создать `frontend/awake-web/src/api/maps.ts`:

```ts
import { useAuthStore } from '@/store/authStore'
import { ApiError } from './client'

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

async function fetchWithProgress(
  path: string,
  onProgress?: (ratio: number) => void,
): Promise<ArrayBuffer> {
  const token = useAuthStore.getState().accessToken
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const response = await fetch(`${BASE_URL}/api${path}`, { headers, credentials: 'include' })
  if (!response.ok || !response.body) {
    throw new ApiError(response.status, `HTTP ${response.status}`)
  }

  const total = Number(response.headers.get('Content-Length') ?? 0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total > 0) onProgress?.(received / total)
  }

  const buffer = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.length
  }
  onProgress?.(1)
  return buffer.buffer
}

export const mapsApi = {
  getHvoinyModel: (onProgress?: (ratio: number) => void): Promise<ArrayBuffer> =>
    fetchWithProgress('/maps/hvoiny/model', onProgress),
}
```

- [ ] **Шаг 4: Проверить сборку**

Run: `cd frontend/awake-web && npm run build`
Expected: `tsc -b && vite build` завершается без ошибок типов (новые файлы пока никем не импортируются, кроме друг друга — это ожидаемо).

- [ ] **Шаг 5: Коммит**

```bash
git add frontend/awake-web/package.json frontend/awake-web/package-lock.json \
        frontend/awake-web/src/api/maps.ts frontend/awake-web/src/lib/parseGltf.ts
git commit -m "feat(world): загрузка и парсинг 3D-модели на фронтенде"
```

---

## Task 4: Фронтенд — 3D-сцена и персонаж

**Files:**
- Modify: `frontend/awake-web/tsconfig.app.json` (включить `resolveJsonModule`)
- Create: `frontend/awake-web/src/hooks/useKeyboard.ts`
- Create: `frontend/awake-web/src/components/world/MapModel.tsx`
- Create: `frontend/awake-web/src/components/world/Player.tsx`
- Create: `frontend/awake-web/src/components/world/WorldScene.tsx`

**Interfaces:**
- Consumes: `THREE.Group`, который вернул `parseGltf` (Task 3); `frontend/awake-web/src/components/world/hvoiny.spawn.json` (Task 1) — импортируется напрямую как ES-модуль, без ручного переноса чисел.
- Produces: `<WorldScene scene={THREE.Group} />` — единственный публичный компонент, используется в Task 5 (`_auth.world.tsx`).

- [ ] **Шаг 1: Создать хук клавиатуры**

Создать `frontend/awake-web/src/hooks/useKeyboard.ts`:

```ts
import { useEffect, useRef } from 'react'

export function useKeyboard() {
  const keys = useRef(new Set<string>())

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      keys.current.add(e.code)
    }
    function onKeyUp(e: KeyboardEvent) {
      keys.current.delete(e.code)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  return keys.current
}
```

- [ ] **Шаг 2: Создать `MapModel.tsx`**

Создать `frontend/awake-web/src/components/world/MapModel.tsx`:

```tsx
import { RigidBody } from '@react-three/rapier'
import * as THREE from 'three'

export function MapModel({ scene }: { scene: THREE.Group }) {
  return (
    <RigidBody type="fixed" colliders="trimesh" friction={1}>
      <primitive object={scene} />
    </RigidBody>
  )
}
```

- [ ] **Шаг 3: Создать `Player.tsx`**

Создать `frontend/awake-web/src/components/world/Player.tsx`:

```tsx
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { useKeyboard } from '@/hooks/useKeyboard'

const SPEED = 4
const JUMP_VELOCITY = 5
const EYE_HEIGHT = 1.6
const CAPSULE_HALF_HEIGHT = 0.6
const CAPSULE_RADIUS = 0.35
const FALL_RESPAWN_Y = -50
const LOOK_SPEED = 0.0025

export interface PlayerHandle {
  respawn: () => void
}

export const Player = forwardRef<PlayerHandle, { spawn: [number, number, number] }>(
  function Player({ spawn }, ref) {
    const body = useRef<RapierRigidBody>(null)
    const { camera, gl } = useThree()
    const keys = useKeyboard()
    const yaw = useRef(0)
    const pitch = useRef(0)

    function respawn() {
      body.current?.setTranslation({ x: spawn[0], y: spawn[1], z: spawn[2] }, true)
      body.current?.setLinvel({ x: 0, y: 0, z: 0 }, true)
      yaw.current = 0
      pitch.current = 0
    }

    useImperativeHandle(ref, () => ({ respawn }))

    useEffect(() => {
      const canvas = gl.domElement
      function onClick() {
        void canvas.requestPointerLock()
      }
      function onMouseMove(e: MouseEvent) {
        if (document.pointerLockElement !== canvas) return
        yaw.current -= e.movementX * LOOK_SPEED
        pitch.current = Math.max(
          -Math.PI / 2 + 0.01,
          Math.min(Math.PI / 2 - 0.01, pitch.current - e.movementY * LOOK_SPEED),
        )
      }
      canvas.addEventListener('click', onClick)
      document.addEventListener('mousemove', onMouseMove)
      return () => {
        canvas.removeEventListener('click', onClick)
        document.removeEventListener('mousemove', onMouseMove)
      }
    }, [gl])

    useFrame(() => {
      const rb = body.current
      if (!rb) return

      const pos = rb.translation()
      if (pos.y < FALL_RESPAWN_Y) {
        respawn()
        return
      }

      const forward = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current))
      const right = new THREE.Vector3(-forward.z, 0, forward.x)
      const move = new THREE.Vector3()
      if (keys.has('KeyW')) move.add(forward)
      if (keys.has('KeyS')) move.sub(forward)
      if (keys.has('KeyD')) move.add(right)
      if (keys.has('KeyA')) move.sub(right)
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(SPEED)

      const vel = rb.linvel()
      rb.setLinvel({ x: move.x, y: vel.y, z: move.z }, true)

      if (keys.has('Space') && Math.abs(vel.y) < 0.05) {
        rb.setLinvel({ x: vel.x, y: JUMP_VELOCITY, z: vel.z }, true)
      }

      camera.position.set(pos.x, pos.y + EYE_HEIGHT, pos.z)
      camera.rotation.order = 'YXZ'
      camera.rotation.set(pitch.current, yaw.current, 0)
    })

    return (
      <RigidBody
        ref={body}
        position={spawn}
        colliders={false}
        enabledRotations={[false, false, false]}
        mass={1}
        friction={0}
      >
        <CapsuleCollider args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} />
      </RigidBody>
    )
  },
)
```

- [ ] **Шаг 4: Включить импорт JSON-модулей в TypeScript**

В `frontend/awake-web/tsconfig.app.json`, внутри `compilerOptions`, добавить `"resolveJsonModule": true,` (например, сразу после `"skipLibCheck": true,`) — иначе `tsc -b` не даст импортировать `hvoiny.spawn.json` напрямую в следующем шаге.

- [ ] **Шаг 5: Создать `WorldScene.tsx`**

Создать `frontend/awake-web/src/components/world/WorldScene.tsx`. Значения точки спавна берутся напрямую из `hvoiny.spawn.json`, созданного в Task 1 — файл лежит рядом, ничего вручную переносить не нужно:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { useTranslation } from 'react-i18next'
import * as THREE from 'three'
import { MapModel } from './MapModel'
import { Player, type PlayerHandle } from './Player'
import spawnPoint from './hvoiny.spawn.json'

const SPAWN: [number, number, number] = [spawnPoint.x, spawnPoint.y, spawnPoint.z]

export function WorldScene({ scene }: { scene: THREE.Group }) {
  const { t } = useTranslation()
  const playerRef = useRef<PlayerHandle>(null)
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    function onChange() {
      setLocked(document.pointerLockElement !== null)
    }
    document.addEventListener('pointerlockchange', onChange)
    return () => document.removeEventListener('pointerlockchange', onChange)
  }, [])

  return (
    <div className="fixed inset-0 z-30 bg-black">
      <Canvas camera={{ fov: 75, near: 0.1, far: 2000 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[50, 80, 30]} intensity={1.2} />
        <Physics gravity={[0, -9.81, 0]}>
          <MapModel scene={scene} />
          <Player ref={playerRef} spawn={SPAWN} />
        </Physics>
      </Canvas>

      {!locked && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
          <p className="rounded-md bg-card px-4 py-2 text-sm text-foreground">{t('world.clickToStart')}</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => playerRef.current?.respawn()}
        className="absolute bottom-4 right-4 rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground hover:bg-secondary"
      >
        {t('world.respawn')}
      </button>
    </div>
  )
}
```

- [ ] **Шаг 6: Проверить сборку**

Run: `cd frontend/awake-web && npm run build`
Expected: `tsc -b && vite build` без ошибок типов. Если ругается на отсутствие типов у `three/examples/jsm/...` — добавить в `frontend/awake-web/src/vite-env.d.ts` (или создать `src/types/three-examples.d.ts`, если `vite-env.d.ts` не подходит по конвенции репозитория) строку `declare module 'three/examples/jsm/libs/meshopt_decoder.module.js';` и аналогично для `GLTFLoader.js`, если `@types/three` их не покрывает.

- [ ] **Шаг 7: Коммит**

```bash
git add frontend/awake-web/tsconfig.app.json \
        frontend/awake-web/src/hooks/useKeyboard.ts \
        frontend/awake-web/src/components/world/
git commit -m "feat(world): 3D-сцена и персонаж от первого лица (React Three Fiber + Rapier)"
```

---

## Task 5: Фронтенд — роут, навигация, i18n, ручная проверка

**Files:**
- Create: `frontend/awake-web/src/routes/_auth.world.tsx`
- Modify: `frontend/awake-web/src/components/layout/Sidebar.tsx`
- Modify: `frontend/awake-web/src/components/layout/MobileTabBar.tsx`
- Modify: `frontend/awake-web/src/i18n/ru.json`
- Modify: `frontend/awake-web/src/i18n/en.json`

**Interfaces:**
- Consumes: `mapsApi.getHvoinyModel` и `parseGltf` (Task 3), `WorldScene` (Task 4), `useAuth()` (существующий хук, см. `_auth.boosts.tsx`).
- Produces: рабочая вкладка `/world`, доступная по клику из сайдбара/мобильного таббара.

- [ ] **Шаг 1: Добавить строки локализации (ru)**

В `frontend/awake-web/src/i18n/ru.json` после блока `"boosts": { ... }` (перед `"nav": { ... }`) добавить:

```json
  "world": {
    "loading": "Загрузка 3D-модели локации…",
    "loadError": "Не удалось загрузить 3D-модель",
    "noWebgl": "Ваш браузер не поддерживает WebGL — 3D-карта недоступна",
    "clickToStart": "Кликните, чтобы начать (WASD — движение, мышь — обзор, пробел — прыжок)",
    "respawn": "Вернуться на точку спавна"
  },
```

И внутри существующего блока `"nav": { ... }` добавить строку `"world": "Мир",` (например, сразу после `"boosts": "Бусты",`).

- [ ] **Шаг 2: Добавить строки локализации (en)**

В `frontend/awake-web/src/i18n/en.json` симметрично, после блока `"boosts": { ... }`:

```json
  "world": {
    "loading": "Loading the 3D location model…",
    "loadError": "Failed to load the 3D model",
    "noWebgl": "Your browser doesn't support WebGL — the 3D map is unavailable",
    "clickToStart": "Click to start (WASD to move, mouse to look, Space to jump)",
    "respawn": "Return to spawn point"
  },
```

И внутри `"nav": { ... }` добавить `"world": "World",` рядом с `"boosts": "Boosts",`.

- [ ] **Шаг 3: Создать роут `_auth.world.tsx`**

Создать `frontend/awake-web/src/routes/_auth.world.tsx`:

```tsx
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as THREE from 'three'
import { mapsApi } from '@/api/maps'
import { WorldScene } from '@/components/world/WorldScene'
import { useAuth } from '@/hooks/useAuth'
import { parseGltf } from '@/lib/parseGltf'
import { UserRank } from '@/types/api'

export const Route = createFileRoute('/_auth/world')({
  component: WorldPage,
})

function WorldPage() {
  const { t } = useTranslation()
  const { rank } = useAuth()
  const [progress, setProgress] = useState(0)
  const [scene, setScene] = useState<THREE.Group | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (rank < UserRank.Member) return
    let cancelled = false
    mapsApi
      .getHvoinyModel(setProgress)
      .then((buffer) => parseGltf(buffer))
      .then((loaded) => {
        if (!cancelled) setScene(loaded)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [rank])

  if (rank < UserRank.Member) return <Navigate to="/profile" />

  if (typeof WebGL2RenderingContext === 'undefined') {
    return <p className="text-destructive">{t('world.noWebgl')}</p>
  }

  if (error) {
    return (
      <p className="text-destructive">
        {t('world.loadError')}: {error}
      </p>
    )
  }

  if (!scene) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">{t('world.loading')}</p>
        <div className="h-2 w-64 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>
    )
  }

  return <WorldScene scene={scene} />
}
```

- [ ] **Шаг 4: Добавить пункт навигации в `Sidebar.tsx`**

В `frontend/awake-web/src/components/layout/Sidebar.tsx` добавить импорт иконки `Box` (или другую подходящую из `lucide-react`) в существующий `import { ... } from 'lucide-react'`, и в массив `navLinks` добавить новую строку сразу после `/boosts`:

```tsx
    ...(isMemberPlus ? [{ to: '/boosts' as const, label: t('nav.boosts'), icon: Zap }] : []),
    ...(isMemberPlus ? [{ to: '/world' as const, label: t('nav.world'), icon: Box }] : []),
```

- [ ] **Шаг 5: Добавить пункт в мобильный таббар**

В `frontend/awake-web/src/components/layout/MobileTabBar.tsx` вкладка `/world` не помещается в нижнюю панель из 4 вкладок — добавить её в лист «Ещё» (`moreOpen`). Добавить импорт `Box` в существующий `import { ... } from 'lucide-react'`, и после блока `{isMemberPlus && (<Link to="/boosts" ...>` добавить аналогичный блок:

```tsx
              {isMemberPlus && (
                <Link
                  to="/world"
                  onClick={() => setMoreOpen(false)}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Box size={16} />
                  {t('nav.world')}
                </Link>
              )}
```

- [ ] **Шаг 6: Собрать фронтенд**

Run: `cd frontend/awake-web && npm run build`
Expected: `tsc -b && vite build` завершается без ошибок.

- [ ] **Шаг 7: Ручная проверка на дев-стенде**

Поднять дев-стенд (бэкенд + `npm run dev` фронтенда), зайти под аккаунтом ранга Member+, открыть `/world`, и вручную проверить:
- Появляется прогресс загрузки, затем сцена (не бесконечный лоадер и не белый экран).
- Клик по канвасу включает pointer lock (курсор пропадает, подсказка "кликните, чтобы начать" исчезает).
- WASD двигает персонажа, мышь поворачивает камеру, пробел — прыжок.
- Персонаж стоит на полу арены (не проваливается сквозь геометрию, не висит в воздухе) — если точка спавна оказалась неудачной (в воздухе слишком высоко или внутри блока), скорректировать `SPAWN` в `WorldScene.tsx` вручную по результатам этой проверки.
- Стены останавливают движение (коллизии работают).
- Кнопка «Вернуться на точку спавна» телепортирует персонажа обратно.
- Esc выходит из pointer lock.

- [ ] **Шаг 8: Коммит**

```bash
git add frontend/awake-web/src/routes/_auth.world.tsx \
        frontend/awake-web/src/components/layout/Sidebar.tsx \
        frontend/awake-web/src/components/layout/MobileTabBar.tsx \
        frontend/awake-web/src/i18n/ru.json frontend/awake-web/src/i18n/en.json
git commit -m "feat(world): вкладка «Мир» — 3D-вьюер локации «Хвойный»"
```
