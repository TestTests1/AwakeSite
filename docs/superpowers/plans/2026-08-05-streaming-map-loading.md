# Потоковая подгрузка карты кусками — план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** грузить и держать в памяти только то, что в 120 метрах вокруг игрока, вместо всей модели локации целиком.

**Architecture:** конвейер режет готовую модель на колонны 64×64 блока и выносит все текстуры в один общий файл; клиент грузит общие текстуры один раз, а куски геометрии — по мере подхода, выбрасывая ушедшие за спину; туман закрывает границу загруженного.

**Tech Stack:** Node + `@gltf-transform` (нарезка), C# ASP.NET Core (манифест), React 19 + three.js + `@react-three/fiber` (клиент), Cloudflare R2 (хранилище).

## Global Constraints

- **Геометрию не удаляем — ни одну, ни по какой причине.** Столкновения считаются лучом по нарисованной геометрии, другого источника нет; недостача означает дыру в полу, сквозь которую игрок проваливается за карту (`tools/maps/README.md`, раздел «Чего трогать нельзя»). Нарезка обязана сохранить каждый треугольник ровно в одном куске.
- **Кусок — колонна 64×64 блока во всю высоту карты.** По вертикали не режем.
- **Дальность загрузки 120 метров, выгрузки — 160.** Блок равен метру.
- **Туман: полное растворение на 120 м, начало на 70 м.** Цвет `0x8099ac` остаётся прежним — он снят со скайбокса.
- **Текстуры внутрь кусков не кладём.** Кусок несёт материалы одними именами, клиент подставляет загруженные из `materials.glb`.
- **Выгрузка куска освобождает только геометрию.** Текстуры общие и живут до выхода из мира.
- **Тестовых прогонов на фронте нет.** В `frontend/awake-web/package.json` только `dev`, `build`, `lint`; в `tools/maps/package.json` тестов нет тоже. Проверка фронта и конвейера — сборка, линтер и собственный режим `--verify` у скрипта нарезки. Бэкенд проверяется xUnit: `dotnet test`.
- **В линтере фронта 39 ошибок до нашей работы**, две из них в `Player.tsx` (`react-hooks/purity`, `react-hooks/immutability`). Новых добавлять нельзя; старые не чиним.
- **Комментарии по-русски и объясняют «почему», а не «что».** Так написан весь код вокруг — держим единообразие.
- **В коммит идут только явно названные файлы** (`git add <путь>`, никогда `git add -A` и никогда `git add` папки целиком). В рабочем дереве лежат посторонние правки человека, и подобрать их означает испортить чужую работу.
- **Путь к моделям:** `D:/Awake/SC_Map_Dump-main/tmp_export/<карта>/<карта>.glb`. Скрипты конвейера запускаются из `tools/maps` — там лежат `node_modules`.
- **Новый префикс хранилища `maps/v2/`.** Поверх `v1` класть нельзя: кэш там `immutable` на год.

---

### Task 1: Нарезка модели на куски

Скрипт режет готовую модель на колонны, выносит текстуры в общий файл и пишет манифест. Проверка встроена в сам скрипт: другого способа убедиться, что ни один треугольник не потерян, у нас нет.

**Files:**
- Create: `tools/maps/split_chunks.mjs`
- Modify: `tools/maps/README.md` (раздел «Порядок стадий», после пункта 8)

**Interfaces:**
- Consumes: ничего из других задач.
- Produces: папка `<карта>_chunks/` рядом с моделью, в ней `manifest.json`, `materials.glb` и файлы `c_<x>_<z>.glb`. Формат манифеста задан в шаге 1 — на него опираются задачи 2, 4 и 6.

- [ ] **Step 1: Записать формат манифеста в комментарии-шапке скрипта**

Создать `tools/maps/split_chunks.mjs` с одной только шапкой — формат должен быть зафиксирован до кода, потому что на него завязаны ещё три задачи.

```js
/**
 * Режет готовую модель локации на куски для потоковой подгрузки.
 *
 * Кусок — колонна 64×64 блока во всю высоту карты. По вертикали не режем:
 * карты низкие (78–147 блоков), и с дальностью видимости 120 м колонна всё
 * равно видна целиком — вертикальная нарезка утроила бы число файлов без
 * единого выигранного байта.
 *
 * Треугольник целиком уходит в тот кусок, где лежит его центр. Он не длиннее
 * блока, то есть метра, а кусок — 64 метра; свес по краю не больше полуметра.
 * Треугольники НЕ делятся и НЕ теряются: столкновения считаются лучом по этой
 * же геометрии, и недостача означала бы дыру в полу. Режим --verify проверяет
 * это счётом.
 *
 * Текстуры выносятся в общий materials.glb: они одни на всю карту (у «Хвойного»
 * 412 штук, все различны), и класть их в каждый кусок значило бы повторить ту
 * самую беду, из-за которой сумма тайлов «Низины» (439 МБ) больше слитого файла
 * (156 МБ). Кусок несёт материалы одними именами.
 *
 * Манифест:
 * {
 *   "version": 2,
 *   "location": "nizina",
 *   "chunkSize": 64,
 *   "bounds": { "min": [x, y, z], "max": [x, y, z] },   // мировые координаты
 *   "spawn":  [x, y, z],                                 // из <карта>.spawn.json
 *   "materials": "materials.glb",
 *   "chunks": [
 *     { "x": 108, "z": 73, "file": "c_108_73.glb",
 *       "minY": 56, "maxY": 140, "tris": 41200 }
 *   ]
 * }
 *
 * x и z — номера клеток сетки, floor(мировая координата / 64). Отрицательные
 * бывают: «Бердовка» и «Хвойный» лежат в минусах по обеим осям.
 *
 * minY и maxY нужны клиенту, чтобы отсекать кусок по пирамиде видимости, не
 * разбирая файл.
 *
 * Запуск (из tools/maps, там node_modules; куче нужно много — модель
 * разворачивается в память целиком):
 *   node --max-old-space-size=12288 split_chunks.mjs <путь к .glb> [--verify]
 */
```

- [ ] **Step 2: Написать проверку — она пишется первой и сначала не проходит**

Дописать в тот же файл. Проверка считает треугольники в исходной модели и в нарезке и сверяет; пока нарезки нет, она обязана сказать, что папки нет.

```js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, quantize } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const CHUNK = 64;

function makeIO() {
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });
}

/** Треугольников в документе: по индексам, а без них — по вершинам. */
function countTriangles(document) {
  let total = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const count = primitive.getIndices()?.getCount()
        ?? primitive.getAttribute('POSITION')?.getCount()
        ?? 0;
      total += Math.floor(count / 3);
    }
  }
  return total;
}

/**
 * Сверяет нарезку с исходником.
 *
 * Проверяется три вещи, и все три — про то, что геометрия цела:
 *   1. сумма треугольников по кускам равна исходной;
 *   2. каждое имя материала из куска есть в materials.glb;
 *   3. ни одна вершина куска не выходит за его клетку больше чем на полметра.
 */
async function verify(sourcePath, outDir) {
  if (!existsSync(outDir)) {
    console.error(`нарезки нет: ${outDir}`);
    process.exit(1);
  }

  const io = makeIO();
  const expected = countTriangles(await io.read(sourcePath));
  const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));

  const shared = new Set(
    (await io.read(join(outDir, manifest.materials)))
      .getRoot().listMaterials().map((m) => m.getName()),
  );

  let actual = 0;
  let problems = 0;
  for (const entry of manifest.chunks) {
    const document = await io.read(join(outDir, entry.file));
    actual += countTriangles(document);

    for (const material of document.getRoot().listMaterials()) {
      if (!shared.has(material.getName())) {
        console.error(`${entry.file}: материала «${material.getName()}» нет в общем файле`);
        problems++;
      }
    }

    const x0 = entry.x * CHUNK, z0 = entry.z * CHUNK;
    for (const mesh of document.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        const element = [0, 0, 0];
        for (let i = 0; i < position.getCount(); i++) {
          position.getElement(i, element);
          const [x, , z] = element;
          if (x < x0 - 0.5 || x > x0 + CHUNK + 0.5 || z < z0 - 0.5 || z > z0 + CHUNK + 0.5) {
            console.error(`${entry.file}: вершина (${x.toFixed(1)}, ${z.toFixed(1)}) вне клетки`);
            problems++;
            i = position.getCount(); // одной жалобы на кусок достаточно
          }
        }
      }
    }
  }

  console.log(`треугольников: исходник ${expected.toLocaleString('ru-RU')}, ` +
    `куски ${actual.toLocaleString('ru-RU')}`);
  if (actual !== expected) {
    console.error(`РАСХОЖДЕНИЕ: потеряно ${(expected - actual).toLocaleString('ru-RU')}`);
    problems++;
  }
  if (problems > 0) {
    console.error(`проверка не пройдена: ${problems} замечаний`);
    process.exit(1);
  }
  console.log('проверка пройдена');
}
```

- [ ] **Step 3: Прогнать проверку и убедиться, что она падает**

```bash
cd tools/maps
node --max-old-space-size=12288 split_chunks.mjs D:/Awake/SC_Map_Dump-main/tmp_export/nizina/nizina.glb --verify
```

Ожидается: `нарезки нет: ...nizina_chunks` и код возврата 1. Если скрипт падает на разборе аргументов — это ещё не та ошибка, которая нужна; довести до сообщения про отсутствующую нарезку.

- [ ] **Step 4: Написать саму нарезку**

Дописать в тот же файл. Читается модель, каждый треугольник раскладывается по клеткам, затем на каждую клетку собирается документ.

```js
/** Умножение точки на матрицу 4×4 из gltf-transform (по столбцам). */
function applyMatrix(m, out) {
  const [x, y, z] = out;
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}

/**
 * Раскладывает треугольники по клеткам сетки.
 *
 * Ключ ведёрка — клетка плюс материал: в одном куске у каждого материала свой
 * примитив, иначе пришлось бы дробить ещё и по материалам при сборке.
 *
 * Вершины пересобираются заново на каждое ведёрко: исходный треугольник
 * ссылается на вершины, разбросанные по всему буферу тайла, и тащить их целиком
 * значило бы положить в кусок половину карты.
 */
function bucketTriangles(document) {
  const buckets = new Map();

  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const matrix = node.getWorldMatrix();

    for (const primitive of mesh.listPrimitives()) {
      const semantics = primitive.listSemantics();
      const attributes = semantics.map((s) => primitive.getAttribute(s));
      const indices = primitive.getIndices();
      const count = indices ? indices.getCount() : attributes[0].getCount();
      const materialName = primitive.getMaterial()?.getName() ?? '';

      // мировые координаты каждой вершины считаем один раз на примитив
      const positionIndex = semantics.indexOf('POSITION');
      const world = new Float32Array(attributes[positionIndex].getCount() * 3);
      const element = [0, 0, 0];
      for (let v = 0; v < attributes[positionIndex].getCount(); v++) {
        attributes[positionIndex].getElement(v, element);
        applyMatrix(matrix, element);
        world[v * 3] = element[0];
        world[v * 3 + 1] = element[1];
        world[v * 3 + 2] = element[2];
      }

      for (let t = 0; t < count; t += 3) {
        const a = indices ? indices.getScalar(t) : t;
        const b = indices ? indices.getScalar(t + 1) : t + 1;
        const c = indices ? indices.getScalar(t + 2) : t + 2;

        // клетка по центру треугольника — так он не делится и не теряется
        const cx = (world[a * 3] + world[b * 3] + world[c * 3]) / 3;
        const cz = (world[a * 3 + 2] + world[b * 3 + 2] + world[c * 3 + 2]) / 3;
        const gx = Math.floor(cx / CHUNK);
        const gz = Math.floor(cz / CHUNK);

        const key = `${gx}|${gz}|${materialName}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = {
            gx, gz, materialName,
            semantics,
            remap: new Map(),
            indices: [],
            data: semantics.map(() => []),
            minY: Infinity,
            maxY: -Infinity,
          };
          buckets.set(key, bucket);
        }

        for (const vertex of [a, b, c]) {
          let mapped = bucket.remap.get(vertex);
          if (mapped === undefined) {
            mapped = bucket.remap.size;
            bucket.remap.set(vertex, mapped);
            for (let s = 0; s < semantics.length; s++) {
              if (s === positionIndex) {
                bucket.data[s].push(world[vertex * 3], world[vertex * 3 + 1], world[vertex * 3 + 2]);
                bucket.minY = Math.min(bucket.minY, world[vertex * 3 + 1]);
                bucket.maxY = Math.max(bucket.maxY, world[vertex * 3 + 1]);
              } else {
                const value = [];
                attributes[s].getElement(vertex, value);
                bucket.data[s].push(...value);
              }
            }
          }
          bucket.indices.push(mapped);
        }
      }
    }
  }

  return buckets;
}
```

- [ ] **Step 5: Написать сборку файлов и общий вход**

Дописать в тот же файл.

```js
const TYPE_BY_SEMANTIC = {
  POSITION: 'VEC3',
  NORMAL: 'VEC3',
  TEXCOORD_0: 'VEC2',
  COLOR_0: 'VEC4',
  TANGENT: 'VEC4',
};

/** Собирает один кусок из его ведёрок. Материалы — одними именами. */
function buildChunk(bucketsOfChunk) {
  const document = new Document();
  document.createBuffer();
  const scene = document.createScene();
  const materials = new Map();

  for (const bucket of bucketsOfChunk) {
    let material = materials.get(bucket.materialName);
    if (!material) {
      // ни текстур, ни цвета: всё это придёт из общего materials.glb по имени
      material = document.createMaterial(bucket.materialName);
      materials.set(bucket.materialName, material);
    }

    const primitive = document.createPrimitive().setMaterial(material);
    for (let s = 0; s < bucket.semantics.length; s++) {
      const semantic = bucket.semantics[s];
      const type = TYPE_BY_SEMANTIC[semantic];
      if (!type) continue; // незнакомую семантику не переносим — её тут не бывает
      primitive.setAttribute(
        semantic,
        document.createAccessor().setType(type).setArray(new Float32Array(bucket.data[s])),
      );
    }
    primitive.setIndices(document.createAccessor().setArray(new Uint32Array(bucket.indices)));

    scene.addChild(document.createNode().setMesh(document.createMesh().addPrimitive(primitive)));
  }

  return document;
}

/**
 * Общий файл: все материалы и текстуры карты, геометрии ноль.
 *
 * Исходный документ правится на месте, а не клонируется: клон удвоил бы и без
 * того тяжёлую кучу (у «Хвойного» модель разворачивается в 868 МБ). Вызывать
 * только после того, как треугольники разложены по клеткам, — после этого
 * геометрия исходника больше не нужна.
 */
function stripGeometry(document) {
  const root = document.getRoot();
  for (const scene of root.listScenes()) scene.dispose();
  for (const node of root.listNodes()) node.dispose();
  for (const mesh of root.listMeshes()) mesh.dispose();
  for (const accessor of root.listAccessors()) accessor.dispose();
  return document;
}

async function split(sourcePath, outDir) {
  const io = makeIO();
  console.log(`читаю ${basename(sourcePath)}`);
  const source = await io.read(sourcePath);

  mkdirSync(outDir, { recursive: true });

  console.log('раскладываю треугольники по клеткам');
  const buckets = bucketTriangles(source);

  const byChunk = new Map();
  for (const bucket of buckets.values()) {
    const key = `${bucket.gx}_${bucket.gz}`;
    if (!byChunk.has(key)) byChunk.set(key, []);
    byChunk.get(key).push(bucket);
  }
  console.log(`кусков: ${byChunk.size}`);

  const entries = [];
  for (const [key, list] of [...byChunk].sort()) {
    const document = buildChunk(list);
    // Квантование и сжатие как у остальных стадий конвейера: без них кусок
    // весит втрое больше. Клиент это понимает — parseGltf уже подключает
    // MeshoptDecoder ради EXT_meshopt_compression в целых моделях.
    await document.transform(quantize(), meshopt({ encoder: MeshoptEncoder }));
    const file = `c_${key}.glb`;
    await io.write(join(outDir, file), document);

    const [gx, gz] = key.split('_').map(Number);
    entries.push({
      x: gx,
      z: gz,
      file,
      minY: Math.floor(Math.min(...list.map((b) => b.minY))),
      maxY: Math.ceil(Math.max(...list.map((b) => b.maxY))),
      tris: list.reduce((sum, b) => sum + b.indices.length / 3, 0),
    });
    process.stdout.write(`\r  записано ${entries.length}/${byChunk.size}`);
  }
  process.stdout.write('\n');

  // после этой строки геометрия исходника уничтожена — ничего, что её читает,
  // ниже быть не должно
  await io.write(join(outDir, 'materials.glb'), stripGeometry(source));

  // точка появления посчитана раньше, compute_spawn.py — берём как есть
  const spawnPath = sourcePath.replace(/\.glb$/, '.spawn.json');
  const spawn = JSON.parse(readFileSync(spawnPath, 'utf8'));

  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const entry of entries) {
    min = [Math.min(min[0], entry.x * CHUNK), Math.min(min[1], entry.minY), Math.min(min[2], entry.z * CHUNK)];
    max = [Math.max(max[0], (entry.x + 1) * CHUNK), Math.max(max[1], entry.maxY), Math.max(max[2], (entry.z + 1) * CHUNK)];
  }

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({
    version: 2,
    location: basename(sourcePath, '.glb'),
    chunkSize: CHUNK,
    bounds: { min, max },
    spawn: [spawn.x, spawn.y, spawn.z],
    materials: 'materials.glb',
    chunks: entries,
  }, null, 2));

  console.log(`готово: ${outDir}`);
}

async function main() {
  const [sourcePath, ...flags] = process.argv.slice(2);
  if (!sourcePath) {
    console.error('использование: node split_chunks.mjs <путь к .glb> [--verify]');
    process.exit(1);
  }
  const outDir = join(dirname(sourcePath), `${basename(sourcePath, '.glb')}_chunks`);

  if (flags.includes('--verify')) await verify(sourcePath, outDir);
  else await split(sourcePath, outDir);
}

await main();
```

- [ ] **Step 6: Нарезать «Низину» и прогнать проверку**

```bash
cd tools/maps
node --max-old-space-size=12288 split_chunks.mjs D:/Awake/SC_Map_Dump-main/tmp_export/nizina/nizina.glb
node --max-old-space-size=12288 split_chunks.mjs D:/Awake/SC_Map_Dump-main/tmp_export/nizina/nizina.glb --verify
```

Ожидается: около 370 кусков, затем `проверка пройдена` и совпадение числа треугольников до единицы. **Расхождение — это провал задачи, а не мелочь: пропавший треугольник означает дыру в полу.** Если числа не сошлись, искать причину в раскладке (`bucketTriangles`), а не подгонять проверку.

- [ ] **Step 7: Дописать раздел в README конвейера**

В `tools/maps/README.md` после пункта 8 списка «Порядок стадий» добавить пункт 9:

```markdown
9. `split_chunks.mjs` — режет готовую модель на куски для потоковой подгрузки:
   колонны 64×64 блока, общий `materials.glb` со всеми текстурами и манифест.
   Треугольник уходит в кусок по своему центру и не делится — режим `--verify`
   сверяет их число с исходником. Запускать с большой кучей:
   `node --max-old-space-size=12288 split_chunks.mjs <путь к .glb>`.
```

- [ ] **Step 8: Закоммитить**

```bash
git add tools/maps/split_chunks.mjs tools/maps/README.md
git commit -m "feat(maps): нарезка модели локации на куски для стриминга"
```

Только эти два пути. В рабочем дереве есть посторонние правки — `git add` папки подберёт их и испортит чужую работу.

---

### Task 2: Манифест и адрес кусков из API

Клиент должен узнать, где лежат куски, и получить манифест — под проверкой ранга, как сейчас модель. Сами куски он потом тянет из R2 напрямую.

**Files:**
- Modify: `src/Awake.Application/Common/Interfaces/IMapAssetService.cs`
- Create: `src/Awake.Application/Features/Maps/Queries/GetMapChunks/GetMapChunksQuery.cs`
- Create: `src/Awake.Application/Features/Maps/Queries/GetMapChunks/GetMapChunksQueryHandler.cs`
- Modify: `src/Awake.Infrastructure/ExternalServices/Maps/MapAssetService.cs`
- Modify: `src/Awake.API/Controllers/MapsController.cs`
- Test: `tests/Awake.Unit.Tests/Features/Maps/GetMapChunksQueryHandlerTests.cs`

**Interfaces:**
- Consumes: формат манифеста из задачи 1.
- Produces: `GET /api/maps/{location}/chunks` → `{ "baseUrl": "https://models.stalcraftclans.cc/maps/v2/nizina" }`. На стенде — `"/api/maps/nizina/chunks/"`, и файлы отдаёт `GET /api/maps/{location}/chunks/{file}`. Клиент из задачи 4 склеивает `baseUrl + "manifest.json"` и `baseUrl + entry.file`.

- [ ] **Step 1: Написать падающие тесты обработчика**

Создать `tests/Awake.Unit.Tests/Features/Maps/GetMapChunksQueryHandlerTests.cs`:

```csharp
using Awake.Application.Common.Interfaces;
using Awake.Application.Features.Maps.Queries.GetMapChunks;
using FluentAssertions;
using Moq;

namespace Awake.Unit.Tests.Features.Maps;

public class GetMapChunksQueryHandlerTests
{
    private readonly Mock<IMapAssetService> _assets = new();

    private GetMapChunksQueryHandler BuildHandler() => new(_assets.Object);

    [Fact]
    public async Task Handle_KnownLocation_ReturnsBaseUrl()
    {
        _assets.Setup(s => s.GetChunkBaseUrl("nizina"))
            .Returns("https://models.example.com/maps/v2/nizina");

        var result = await BuildHandler().Handle(new GetMapChunksQuery("nizina"), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().Be("https://models.example.com/maps/v2/nizina");
    }

    [Fact]
    public async Task Handle_UnknownLocation_ReturnsFailure()
    {
        _assets.Setup(s => s.GetChunkBaseUrl(It.IsAny<string>())).Returns((string?)null);

        var result = await BuildHandler().Handle(new GetMapChunksQuery("pripyat"), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Handle_PassesLocationThroughUnchanged()
    {
        _assets.Setup(s => s.GetChunkBaseUrl(It.IsAny<string>())).Returns("url");

        await BuildHandler().Handle(new GetMapChunksQuery("small_berdovka"), CancellationToken.None);

        _assets.Verify(s => s.GetChunkBaseUrl("small_berdovka"), Times.Once);
    }
}
```

- [ ] **Step 2: Прогнать и убедиться, что не собирается**

```bash
dotnet test tests/Awake.Unit.Tests --filter GetMapChunksQueryHandlerTests
```

Ожидается: ошибка сборки — нет ни `GetMapChunksQuery`, ни `GetChunkBaseUrl`.

- [ ] **Step 3: Добавить метод в интерфейс**

В `src/Awake.Application/Common/Interfaces/IMapAssetService.cs` дописать в `IMapAssetService`:

```csharp
    /// <summary>
    /// Адрес папки с кусками локации, либо null для неизвестной локации.
    ///
    /// Отдаётся клиенту, и дальше он ходит за манифестом и кусками сам: гонять
    /// через API сотни файлов незачем, а проверка ранга остаётся здесь — адрес
    /// узнаёт только тот, кого сюда пустили. Ровно так же устроена и отдача
    /// целой модели.
    /// </summary>
    string? GetChunkBaseUrl(string location);
```

- [ ] **Step 4: Написать запрос и обработчик**

Создать `src/Awake.Application/Features/Maps/Queries/GetMapChunks/GetMapChunksQuery.cs`:

```csharp
using Awake.Application.Common.Models;
using MediatR;

namespace Awake.Application.Features.Maps.Queries.GetMapChunks;

public record GetMapChunksQuery(string Location) : IRequest<Result<string>>;
```

Создать `src/Awake.Application/Features/Maps/Queries/GetMapChunks/GetMapChunksQueryHandler.cs`:

```csharp
using Awake.Application.Common.Interfaces;
using Awake.Application.Common.Models;
using MediatR;

namespace Awake.Application.Features.Maps.Queries.GetMapChunks;

public class GetMapChunksQueryHandler(IMapAssetService mapAssetService)
    : IRequestHandler<GetMapChunksQuery, Result<string>>
{
    public Task<Result<string>> Handle(GetMapChunksQuery request, CancellationToken cancellationToken)
    {
        var baseUrl = mapAssetService.GetChunkBaseUrl(request.Location);
        return Task.FromResult(baseUrl is not null
            ? Result<string>.Success(baseUrl)
            : Result<string>.Failure("Куски локации не найдены."));
    }
}
```

- [ ] **Step 5: Реализовать в MapAssetService**

В `src/Awake.Infrastructure/ExternalServices/Maps/MapAssetService.cs` дописать в класс:

```csharp
    /// <summary>
    /// Адрес нарезки под куски. Отдельный ключ, а не производный от
    /// MapAssets:BaseUrl: тот указывает на папку v1 с целыми моделями, и она
    /// обязана продолжать работать, пока стриминг не проверен на всех трёх
    /// картах. Считать один адрес из другого значило бы сломать старый путь той
    /// же правкой, которой чиним новый.
    /// </summary>
    private string? ChunkBaseUrl
    {
        get
        {
            var value = configuration["MapAssets:ChunkBaseUrl"];
            return string.IsNullOrWhiteSpace(value) ? null : value.TrimEnd('/');
        }
    }

    /// <summary>
    /// Папка с кусками локации. На стенде хранилища нет, поэтому куски отдаёт
    /// само приложение.
    /// </summary>
    public string? GetChunkBaseUrl(string location)
    {
        if (!KnownLocations.TryGetValue(location, out var canonical))
            return null;

        var baseUrl = ChunkBaseUrl;
        return baseUrl is not null
            ? $"{baseUrl}/{canonical}/"
            : $"/api/maps/{canonical}/chunks/";
    }

    /// <summary>
    /// Путь к файлу куска на диске, либо null.
    ///
    /// Имя файла приходит из запроса, поэтому проверяется образцом, а не
    /// чисткой строки: подходит только манифест, общий файл материалов и кусок
    /// вида c_&lt;число&gt;_&lt;число&gt;.glb. Всё остальное — не существует.
    /// </summary>
    public string? GetChunkFilePath(string location, string file)
    {
        if (!KnownLocations.TryGetValue(location, out var canonical))
            return null;
        if (!ChunkFileName.IsMatch(file))
            return null;

        var path = Path.Combine(environment.ContentRootPath, AssetDirectory, "v2", canonical, file);
        return File.Exists(path) ? path : null;
    }

    private static readonly System.Text.RegularExpressions.Regex ChunkFileName =
        new(@"^(manifest\.json|materials\.glb|c_-?\d+_-?\d+\.glb)$",
            System.Text.RegularExpressions.RegexOptions.Compiled);
```

И объявить `GetChunkFilePath` в `IMapAssetService.cs` рядом с `GetChunkBaseUrl`:

```csharp
    /// <summary>
    /// Путь к файлу куска на диске для раздачи со стенда, либо null. На боевом
    /// не используется: там клиент ходит прямо в хранилище.
    /// </summary>
    string? GetChunkFilePath(string location, string file);
```

- [ ] **Step 6: Прогнать тесты — теперь проходят**

```bash
dotnet test tests/Awake.Unit.Tests --filter GetMapChunksQueryHandlerTests
```

Ожидается: 3 из 3 проходят.

- [ ] **Step 7: Добавить два эндпоинта в контроллер**

В `src/Awake.API/Controllers/MapsController.cs` после `GetModel` вставить:

```csharp
    /// <summary>Адрес папки с кусками локации для потоковой подгрузки.</summary>
    [HttpGet("{location}/chunks")]
    [RankAuthorize(UserRank.Member)]
    public async Task<IActionResult> GetChunks(string location, CancellationToken ct)
    {
        var result = await sender.Send(new GetMapChunksQuery(location), ct);
        return result.IsSuccess ? Ok(new { baseUrl = result.Value }) : NotFound();
    }

    /// <summary>
    /// Отдаёт файл куска с диска — только для стенда, где внешнего хранилища
    /// нет. Куски неизменяемы по построению: правка карты рождает новую
    /// нарезку, а не переписывает старую, поэтому кэш годичный.
    /// </summary>
    [HttpGet("{location}/chunks/{file}")]
    [RankAuthorize(UserRank.Member)]
    public IActionResult GetChunkFile(string location, string file, [FromServices] IMapAssetService assets)
    {
        var path = assets.GetChunkFilePath(location, file);
        if (path is null) return NotFound();

        Response.Headers.CacheControl = "private, max-age=31536000, immutable";
        return PhysicalFile(path, file.EndsWith(".json") ? "application/json" : "model/gltf-binary");
    }
```

Добавить в шапку файла:

```csharp
using Awake.Application.Features.Maps.Queries.GetMapChunks;
```

- [ ] **Step 8: Прогнать весь набор тестов**

```bash
dotnet test
```

Ожидается: всё проходит, включая 219 модульных и 25 интеграционных, что были до нас. Если API занял порт и держит DLL — остановить его перед прогоном.

- [ ] **Step 9: Закоммитить**

```bash
git add src/Awake.Application/Common/Interfaces/IMapAssetService.cs \
        src/Awake.Application/Features/Maps/Queries/GetMapChunks/GetMapChunksQuery.cs \
        src/Awake.Application/Features/Maps/Queries/GetMapChunks/GetMapChunksQueryHandler.cs \
        src/Awake.Infrastructure/ExternalServices/Maps/MapAssetService.cs \
        src/Awake.API/Controllers/MapsController.cs \
        tests/Awake.Unit.Tests/Features/Maps/GetMapChunksQueryHandlerTests.cs
git commit -m "feat(maps): адрес и раздача кусков локации"
```

---

### Task 3: Общие материалы и разбор куска

Кусок приезжает с материалами-пустышками, у которых есть только имя. Здесь появляется общий набор материалов и подстановка их в кусок.

**Files:**
- Create: `frontend/awake-web/src/lib/chunkMaterials.ts`
- Modify: `frontend/awake-web/src/api/maps.ts`

**Interfaces:**
- Consumes: `materials.glb` и `c_<x>_<z>.glb` из задачи 1; `baseUrl` из задачи 2.
- Produces:
  - `mapsApi.getChunkBase(location): Promise<string>` — адрес папки;
  - `loadChunkMaterials(baseUrl): Promise<ChunkMaterials>`, где `ChunkMaterials = { get(name: string): THREE.Material | undefined; dispose(): void }`;
  - `loadChunk(url: string, materials: ChunkMaterials): Promise<THREE.Group>`.

- [ ] **Step 1: Добавить запросы в api/maps.ts**

В `frontend/awake-web/src/api/maps.ts` дописать в объект `mapsApi` (после `getDebugTile`):

```ts
  /**
   * Адрес папки с кусками локации. На боевом ведёт в хранилище, на стенде — в
   * само приложение. Ранг проверяется здесь же, поэтому запрос идёт через
   * apiClient с обычной авторизацией.
   */
  getChunkBase: (location: MapLocation) =>
    apiClient.get<{ baseUrl: string }>(`/maps/${location}/chunks`).then((r) => r.baseUrl),
```

И там же, рядом с `fetchWithProgress`, экспортировать её для кусков — она уже умеет всё нужное, но кускам не нужна авторизация (они уезжают в хранилище):

```ts
/** Скачивает файл куска. Куски лежат в хранилище, авторизация туда не едет. */
export const fetchChunkFile = (url: string, onProgress?: (ratio: number) => void) =>
  fetchWithProgress(url, onProgress, !url.startsWith('http'))
```

- [ ] **Step 2: Написать загрузку общих материалов**

Создать `frontend/awake-web/src/lib/chunkMaterials.ts`:

```ts
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { fetchChunkFile } from '@/api/maps'
import { optimizeMaterials } from './optimizeMaterials'
import { improveTextureFiltering } from './textureFiltering'

/**
 * Материалы карты, общие для всех её кусков.
 *
 * Текстур на карту 200–400 штук и 14–29 МБ, а кусков — сотни. Класть текстуры в
 * каждый кусок значило бы повторить ту беду, из-за которой сумма тайлов больше
 * слитого файла. Поэтому они приезжают один раз отдельным файлом, а кусок несёт
 * материалы одними именами.
 */
export interface ChunkMaterials {
  get(name: string): THREE.Material | undefined
  dispose(): void
}

function parse(buffer: ArrayBuffer): Promise<THREE.Group> {
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

/**
 * Материалы в общем файле не висят ни на одном меше — геометрии там нет вовсе,
 * и обходом сцены их не найти. Поэтому забираем их из parser.json через
 * штатную загрузку материала по номеру.
 */
export async function loadChunkMaterials(baseUrl: string): Promise<ChunkMaterials> {
  const buffer = await fetchChunkFile(`${baseUrl}materials.glb`)

  const gltf = await new Promise<{ scene: THREE.Group; parser: import('three/examples/jsm/loaders/GLTFLoader.js').GLTFParser }>(
    (resolve, reject) => {
      const loader = new GLTFLoader()
      loader.setMeshoptDecoder(MeshoptDecoder)
      loader.parse(buffer, '', (result) => resolve(result), (error) =>
        reject(error instanceof Error ? error : new Error(String(error))),
      )
    },
  )

  const definitions: { name?: string }[] = gltf.parser.json.materials ?? []
  const loaded = await Promise.all(definitions.map((_, index) => gltf.parser.getDependency('material', index)))

  // Держим их на временной сцене: optimizeMaterials и improveTextureFiltering
  // ходят обходом по мешам, а не по списку материалов.
  const holder = new THREE.Group()
  for (const material of loaded as THREE.Material[]) {
    holder.add(new THREE.Mesh(new THREE.BufferGeometry(), material))
  }
  optimizeMaterials(holder)
  improveTextureFiltering(holder)

  const byName = new Map<string, THREE.Material>()
  for (const child of holder.children) {
    if (!(child instanceof THREE.Mesh)) continue
    const material = child.material as THREE.Material
    byName.set(material.name, material)
    child.geometry.dispose()
  }

  return {
    get: (name) => byName.get(name),
    dispose: () => {
      for (const material of byName.values()) {
        const map = (material as THREE.MeshLambertMaterial).map
        map?.dispose()
        material.dispose()
      }
      byName.clear()
    },
  }
}
```

- [ ] **Step 3: Написать разбор куска с подстановкой материалов**

Дописать в тот же файл:

```ts
/**
 * Разбирает кусок и подставляет ему общие материалы.
 *
 * Материалы внутри куска — пустышки с одним именем: ни текстуры, ни цвета. Их
 * надо освободить сразу после подмены, иначе на каждый загруженный кусок в
 * памяти остаётся сотня мёртвых материалов.
 *
 * Кусок, чьего материала нет в общем файле, не выбрасывается: геометрия важнее
 * вида, по ней считаются столкновения. Такой меш получает серую заглушку.
 */
export async function loadChunk(url: string, materials: ChunkMaterials): Promise<THREE.Group> {
  const buffer = await fetchChunkFile(url)
  const scene = await parse(buffer)

  const fallback = new THREE.MeshLambertMaterial({ color: 0x898989 })
  let usedFallback = false

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.material) return
    const own = object.material as THREE.Material
    const shared = materials.get(own.name)
    if (shared) {
      object.material = shared
    } else {
      object.material = fallback
      usedFallback = true
    }
    own.dispose()
  })

  if (!usedFallback) fallback.dispose()
  return scene
}
```

- [ ] **Step 4: Собрать и проверить линтером**

```bash
cd frontend/awake-web
npm run build
npm run lint
```

Ожидается: сборка проходит; в линтере ровно 39 ошибок, как и до работы. Новых быть не должно.

- [ ] **Step 5: Закоммитить**

```bash
git add frontend/awake-web/src/lib/chunkMaterials.ts frontend/awake-web/src/api/maps.ts
git commit -m "feat(world): общие материалы карты и разбор куска"
```

---

### Task 4: Управляющий кусками

Решает, что грузить и что выбрасывать, по положению игрока.

**Files:**
- Create: `frontend/awake-web/src/components/world/useChunkStream.ts`
- Create: `frontend/awake-web/src/lib/mapManifest.ts`

**Interfaces:**
- Consumes: `loadChunkMaterials`, `loadChunk`, `ChunkMaterials` из задачи 3; формат манифеста из задачи 1.
- Produces:
  - `MapManifest` — тип манифеста, и `loadManifest(baseUrl): Promise<MapManifest>`;
  - `useChunkStream({ baseUrl, manifest, playerRef, group })` → `{ ready: boolean; loaded: number; total: number; onChunkChange }`. `ready` становится `true`, когда пришли материалы и кусок под точкой появления.

- [ ] **Step 1: Описать манифест**

Создать `frontend/awake-web/src/lib/mapManifest.ts`:

```ts
import { fetchChunkFile } from '@/api/maps'

/** Один кусок карты. x и z — номера клеток сетки, не метры. */
export interface ChunkEntry {
  x: number
  z: number
  file: string
  minY: number
  maxY: number
  tris: number
}

/**
 * Опись нарезанной карты. Пишется `tools/maps/split_chunks.mjs`; поля обязаны
 * совпадать с тем, что кладёт он.
 */
export interface MapManifest {
  version: number
  location: string
  chunkSize: number
  bounds: { min: [number, number, number]; max: [number, number, number] }
  spawn: [number, number, number]
  materials: string
  chunks: ChunkEntry[]
}

export async function loadManifest(baseUrl: string): Promise<MapManifest> {
  const buffer = await fetchChunkFile(`${baseUrl}manifest.json`)
  const manifest = JSON.parse(new TextDecoder().decode(buffer)) as MapManifest
  if (manifest.version !== 2) {
    throw new Error(`не тот формат нарезки: ${manifest.version}`)
  }
  return manifest
}
```

- [ ] **Step 2: Написать управляющего**

Создать `frontend/awake-web/src/components/world/useChunkStream.ts`:

```ts
import { useEffect, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'
import { loadChunk, loadChunkMaterials, type ChunkMaterials } from '@/lib/chunkMaterials'
import type { ChunkEntry, MapManifest } from '@/lib/mapManifest'
import type { PlayerReport } from './RenderStats'

/**
 * Дальность загрузки — как в самой игре, где прогрузка 100–120 метров, а блок
 * равен метру.
 */
const LOAD_RADIUS = 120
/**
 * Выбрасываем не на той же черте, а дальше. Без этого зазора игрок, шагающий
 * вдоль границы куска, гонял бы его туда-сюда каждым шагом.
 */
const KEEP_RADIUS = 160
/** Больше шести одновременных запросов браузер всё равно не пустит. */
const MAX_PARALLEL = 6
/** Пересчёт не каждый кадр, а когда игрок ушёл на полкуска. */
const RECHECK_DISTANCE = 32

/** Расстояние от точки до клетки по горизонтали; внутри клетки — ноль. */
function distanceToChunk(entry: ChunkEntry, size: number, x: number, z: number): number {
  const dx = Math.max(entry.x * size - x, 0, x - (entry.x + 1) * size)
  const dz = Math.max(entry.z * size - z, 0, z - (entry.z + 1) * size)
  return Math.hypot(dx, dz)
}

export interface ChunkStream {
  /** Пришли материалы и кусок под точкой появления: можно входить в мир. */
  ready: boolean
  loaded: number
  /** Сколько кусков нужно для готовности — для полоски прогресса. */
  needed: number
  failed: number
}

/**
 * Держит в сцене только те куски, что рядом с игроком.
 *
 * Куски кладутся прямо в переданную группу, минуя React: их сотни, и
 * перерисовывать дерево компонентов на каждый пришедший кусок значило бы
 * ронять кадры ровно тогда, когда игрок идёт вперёд.
 */
export function useChunkStream({
  baseUrl,
  manifest,
  playerRef,
  group,
  onAdd,
  onRemove,
}: {
  baseUrl: string
  manifest: MapManifest
  playerRef: RefObject<PlayerReport | null>
  group: THREE.Group
  /** Кусок встал в сцену: подключить к столкновениям. */
  onAdd?: (chunk: THREE.Group) => void
  /** Кусок уходит из сцены: снять со столкновений до освобождения геометрии. */
  onRemove?: (chunk: THREE.Group) => void
}): ChunkStream {
  const [state, setState] = useState<ChunkStream>({
    ready: false,
    loaded: 0,
    needed: 0,
    failed: 0,
  })

  // всё живое состояние — в ref: этот цикл крутится вне React
  const live = useRef({
    materials: null as ChunkMaterials | null,
    inScene: new Map<string, THREE.Group>(),
    loading: new Set<string>(),
    failed: new Map<string, number>(),
    lastAt: new THREE.Vector3(Infinity, 0, Infinity),
    stopped: false,
  })

  useEffect(() => {
    const self = live.current
    self.stopped = false

    const key = (entry: ChunkEntry) => `${entry.x}_${entry.z}`

    /** Где стоит игрок; до первого кадра — точка появления из манифеста. */
    const playerAt = () => playerRef.current?.position ?? {
      x: manifest.spawn[0],
      z: manifest.spawn[2],
    }

    const pump = () => {
      if (self.stopped || !self.materials) return
      const at = playerAt()

      // выгрузка: сначала освобождаем, потом грузим — так пик памяти ниже
      for (const [id, chunk] of self.inScene) {
        const [x, z] = id.split('_').map(Number)
        const entry = { x, z } as ChunkEntry
        if (distanceToChunk(entry, manifest.chunkSize, at.x, at.z) <= KEEP_RADIUS) continue

        onRemove?.(chunk)
        group.remove(chunk)
        // только геометрия: материалы общие, освобождать их здесь значит
        // погасить текстуры на всей карте разом
        chunk.traverse((object) => {
          if (object instanceof THREE.Mesh) object.geometry.dispose()
        })
        self.inScene.delete(id)
      }

      const wanted = manifest.chunks
        .map((entry) => ({ entry, distance: distanceToChunk(entry, manifest.chunkSize, at.x, at.z) }))
        .filter(({ entry, distance }) =>
          distance <= LOAD_RADIUS
          && !self.inScene.has(key(entry))
          && !self.loading.has(key(entry))
          && (self.failed.get(key(entry)) ?? 0) < 3)
        .sort((a, b) => a.distance - b.distance)

      for (const { entry } of wanted) {
        if (self.loading.size >= MAX_PARALLEL) break
        const id = key(entry)
        self.loading.add(id)

        void loadChunk(`${baseUrl}${entry.file}`, self.materials)
          .then((chunk) => {
            self.loading.delete(id)
            if (self.stopped) {
              chunk.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
              return
            }
            // пока качался, игрок мог уйти — тогда кусок уже не нужен
            const at2 = playerAt()
            if (distanceToChunk(entry, manifest.chunkSize, at2.x, at2.z) > KEEP_RADIUS) {
              chunk.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
              return
            }
            group.add(chunk)
            self.inScene.set(id, chunk)
            onAdd?.(chunk)
            publish()
            pump()
          })
          .catch(() => {
            self.loading.delete(id)
            self.failed.set(id, (self.failed.get(id) ?? 0) + 1)
            publish()
            pump()
          })
      }
    }

    /**
     * Готовность — это материалы и кусок под ногами. Ждать все ближние куски
     * незачем: остальное догрузится за туманом, пока игрок оглядывается.
     */
    const publish = () => {
      if (self.stopped) return
      const spawnKey = `${Math.floor(manifest.spawn[0] / manifest.chunkSize)}_${Math.floor(manifest.spawn[2] / manifest.chunkSize)}`
      const needed = manifest.chunks.filter((entry) =>
        distanceToChunk(entry, manifest.chunkSize, manifest.spawn[0], manifest.spawn[2]) <= LOAD_RADIUS,
      ).length
      setState({
        ready: self.materials !== null && self.inScene.has(spawnKey),
        loaded: self.inScene.size,
        needed,
        failed: self.failed.size,
      })
    }

    void loadChunkMaterials(baseUrl)
      .then((materials) => {
        if (self.stopped) {
          materials.dispose()
          return
        }
        self.materials = materials
        publish()
        pump()
      })
      .catch(() => publish())

    // опрос вместо подписки: положение игрока лежит в ref и меняется каждый
    // кадр, а нам хватает четырёх проверок в секунду
    const timer = window.setInterval(() => {
      const at = playerAt()
      if (Math.hypot(at.x - self.lastAt.x, at.z - self.lastAt.z) < RECHECK_DISTANCE) return
      self.lastAt.set(at.x, 0, at.z)
      pump()
    }, 250)

    return () => {
      self.stopped = true
      window.clearInterval(timer)
      for (const chunk of self.inScene.values()) {
        onRemove?.(chunk)
        group.remove(chunk)
        chunk.traverse((object) => {
          if (object instanceof THREE.Mesh) object.geometry.dispose()
        })
      }
      self.inScene.clear()
      self.loading.clear()
      self.failed.clear()
      self.materials?.dispose()
      self.materials = null
    }
  }, [baseUrl, manifest, group, playerRef, onAdd, onRemove])

  return state
}
```

- [ ] **Step 3: Собрать и проверить линтером**

```bash
cd frontend/awake-web
npm run build
npm run lint
```

Ожидается: сборка проходит, ошибок линтера ровно 39.

- [ ] **Step 4: Закоммитить**

```bash
git add frontend/awake-web/src/lib/mapManifest.ts frontend/awake-web/src/components/world/useChunkStream.ts
git commit -m "feat(world): управляющий подгрузкой кусков карты"
```

---

### Task 5: Столкновения с меняющейся сценой

Коллайдер сейчас собирается один раз в конструкторе. Со стримингом куски приходят и уходят, а провалиться сквозь незагруженный пол нельзя.

**Files:**
- Modify: `frontend/awake-web/src/lib/collision.ts`
- Modify: `frontend/awake-web/src/components/world/Player.tsx`

**Interfaces:**
- Consumes: `onAdd`/`onRemove` из задачи 4.
- Produces:
  - `TerrainCollider.addPart(root: THREE.Object3D): void` и `removePart(root: THREE.Object3D): void`;
  - у `Player` новое необязательное свойство `bounds?: THREE.Box3` — границы карты из манифеста вместо замера пустой сцены.

- [ ] **Step 1: Научить коллайдер принимать и отдавать куски**

В `frontend/awake-web/src/lib/collision.ts` заменить конструктор и дописать два метода:

```ts
  constructor(scene?: THREE.Object3D) {
    if (scene) this.addPart(scene)
    this.raycaster.firstHitOnly = true
  }

  /**
   * Подключает кусок карты к лучам.
   *
   * Дерево здесь не строится: оно строится лениво в prepare, и только рядом с
   * игроком. Кусок, пришедший на краю дальности, игроку не нужен ещё секунды —
   * а построение дерева на его геометрию стоит кадра.
   */
  addPart(root: THREE.Object3D): void {
    root.updateMatrixWorld(true)
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.geometry) return
      this.parts.push({ mesh: object, box: new THREE.Box3().setFromObject(object) })
    })
  }

  /**
   * Снимает кусок с лучей и освобождает его деревья.
   *
   * Вызывать обязательно до dispose геометрии: иначе в списке остаётся меш с
   * освобождённым буфером, и первый же луч по нему падает.
   */
  removePart(root: THREE.Object3D): void {
    const inside = new Set<THREE.Object3D>()
    root.traverse((object) => inside.add(object))
    for (let i = this.parts.length - 1; i >= 0; i--) {
      if (!inside.has(this.parts[i].mesh)) continue
      this.parts[i].mesh.geometry.disposeBoundsTree?.()
      this.parts.splice(i, 1)
    }
  }
```

Поле `parts` объявлено `readonly` — это про саму ссылку, `splice` и `push` по ней разрешены, менять объявление не нужно.

- [ ] **Step 2: Взять границы карты из манифеста**

В `frontend/awake-web/src/components/world/Player.tsx` добавить свойство в `PlayerProps` (после `scene`):

```ts
  /**
   * Границы карты. Со стримингом сцена в начале пуста, и замерить её нечем:
   * Box3.setFromObject вернул бы пустую коробку, а по ней точка появления
   * оказалась бы в нуле координат, и персонаж полетел бы в пустоту.
   */
  bounds?: THREE.Box3
```

Заменить строку 124:

```ts
  const bounds = useMemo(() => new THREE.Box3().setFromObject(scene), [scene])
```

на:

```ts
  const bounds = useMemo(
    () => boundsProp ?? new THREE.Box3().setFromObject(scene),
    [boundsProp, scene],
  )
```

и принять свойство в сигнатуре под другим именем:

```ts
export function Player({
  scene,
  bounds: boundsProp,
  spawn,
  flying = false,
  placed = [],
  thirdPerson = false,
  active = true,
  state,
}: PlayerProps) {
```

- [ ] **Step 3: Не ронять игрока в незагруженное**

В том же файле, в `useFrame`, заменить блок поиска опоры (строки 305–323) на:

```ts
    origin.current.copy(feet.current).setY(feet.current.y + STEP_UP)
    const toGround = collider.cast(origin.current, DOWN, STEP_UP + FALL_LIMIT)
    if (toGround !== null) {
      const groundY = origin.current.y - toGround
      if (feet.current.y <= groundY) {
        // сюда же попадает шаг на блок вверх: опора оказалась выше ног
        feet.current.y = groundY
        velocityY.current = 0
        grounded.current = true
      } else {
        grounded.current = false
      }
      missingGround.current = false
    } else {
      grounded.current = false
      // Опоры нет — но со стримингом это значит не «пропасть», а «кусок ещё не
      // приехал». Отличаем по высоте: настоящая пропасть начинается ниже карты,
      // а на её уровне пола просто нет. Во втором случае замираем на месте:
      // уронить игрока сквозь незагруженный пол хуже, чем задержать на миг.
      const insideMap = feet.current.y > bounds.min.y
      if (insideMap && !missingGround.current) {
        missingGround.current = true
      }
      if (insideMap) {
        feet.current.y = beforeGravity.current
        velocityY.current = 0
      }
    }

    // провалился мимо карты — возвращаем на точку появления, иначе падение
    // бесконечно и выбраться из него нечем
    if (feet.current.y < bounds.min.y - 30) placeAtSpawn()
```

Объявить два новых ref рядом с `grounded` (строка 110):

```ts
  /** Под ногами нет геометрии: кусок ещё не приехал, а не пропасть. */
  const missingGround = useRef(false)
  /** Высота до применения гравитации в этом кадре — к ней и откатываемся. */
  const beforeGravity = useRef(0)
```

И запомнить высоту до гравитации — перед строкой `velocityY.current -= GRAVITY * delta`:

```ts
    beforeGravity.current = feet.current.y
```

- [ ] **Step 4: Собрать и проверить линтером**

```bash
cd frontend/awake-web
npm run build
npm run lint
```

Ожидается: сборка проходит; в линтере по-прежнему 39 ошибок, две из них в `Player.tsx` и они предсуществовали.

- [ ] **Step 5: Закоммитить**

```bash
git add frontend/awake-web/src/lib/collision.ts frontend/awake-web/src/components/world/Player.tsx
git commit -m "feat(world): столкновения с приходящими и уходящими кусками"
```

---

### Task 6: Сцена и вход в мир через стриминг

Здесь всё сходится: сцена собирается из кусков, туман встаёт на границу загрузки, вкладка «Мир» перестаёт качать модель целиком.

**Files:**
- Modify: `frontend/awake-web/src/components/world/WorldScene.tsx`
- Modify: `frontend/awake-web/src/components/world/Player.tsx` (только приём общего коллайдера, шаг 2)
- Modify: `frontend/awake-web/src/routes/_auth.world.tsx`
- Modify: `frontend/awake-web/src/locales/ru.json`
- Modify: `frontend/awake-web/src/locales/en.json`

**Interfaces:**
- Consumes: `useChunkStream` из задачи 4, `loadManifest` и `MapManifest` из задачи 4, `mapsApi.getChunkBase` из задачи 3, `TerrainCollider.addPart/removePart` и `Player bounds` из задачи 5.
- Produces: ничего для следующих задач.

- [ ] **Step 1: Перевести туман в метры**

В `frontend/awake-web/src/components/world/WorldScene.tsx` заменить константы (строки 93–95) и комментарий над ними:

```ts
/**
 * Туман прячет границу загруженного. Раньше он прятал край карты и потому
 * считался долями её размаха; теперь карта грузится кусками, и прятать надо
 * место, где куски кончаются, — а оно на одном и том же расстоянии на любой
 * карте.
 *
 * Цвет не подобран на глаз, а снят с самого скайбокса: среднее по полосе неба
 * над горизонтом на четырёх боковых гранях. Поэтому дальние блоки растворяются
 * ровно в тот тон, который за ними и нарисован. Сменится небо — пересчитать.
 *
 * Конец совпадает с дальностью загрузки из useChunkStream: отодвинуть его
 * дальше значит показать пустоту за последним куском.
 */
const FOG_COLOR = 0x8099ac
const FOG_START = 70
const FOG_END = 120
```

И применение (строка 271):

```tsx
        <fog attach="fog" args={[FOG_COLOR, FOG_START, FOG_END]} />
```

- [ ] **Step 2: Принять манифест и собирать сцену из кусков**

Добавить в шапку `WorldScene.tsx`:

```ts
import { TerrainCollider } from '@/lib/collision'
import type { MapManifest } from '@/lib/mapManifest'
import { useChunkStream } from './useChunkStream'
```

В том же файле заменить свойства компонента и расчёт `view`.

Сигнатура (строки 118–132) — вместо `scene: THREE.Group` принимаем манифест и адрес:

```tsx
export function WorldScene({
  baseUrl,
  manifest,
  mapKey = 'default',
  location,
  onClose,
}: {
  baseUrl: string
  manifest: MapManifest
  /** Ключ карты: к нему привязана черновая расстановка в браузере. */
  mapKey?: string
  /** Локация для общеклановых расстановок. У отдельных тайлов её нет. */
  location?: MapLocation
  onClose?: () => void
}) {
```

Вместо `view` из замера сцены (строки 250–261):

```tsx
  /**
   * Сцена, в которую управляющий кладёт куски. Создаётся один раз и живёт
   * дольше любого куска — три.js не даёт добавлять объекты в ещё не собранную
   * сцену, а куски начинают приходить до первого кадра.
   */
  const group = useMemo(() => new THREE.Group(), [])

  /**
   * Границы и размах берутся из манифеста, а не из сцены: сцена в начале пуста,
   * и замер вернул бы нулевую коробку.
   */
  const view = useMemo(() => {
    const min = new THREE.Vector3(...manifest.bounds.min)
    const max = new THREE.Vector3(...manifest.bounds.max)
    const bounds = new THREE.Box3(min, max)
    const size = max.clone().sub(min)
    return { bounds, size, far: Math.max(size.x, size.y, size.z) * 10 }
  }, [manifest])

  /**
   * Коллайдер живёт рядом со сценой, а не внутри Player: куски приходят и
   * уходят независимо от того, перерисовался ли Player.
   */
  const collider = useMemo(() => new TerrainCollider(), [])
  useEffect(() => () => collider.dispose(), [collider])

  const addChunk = useCallback((chunk: THREE.Group) => collider.addPart(chunk), [collider])
  const removeChunk = useCallback((chunk: THREE.Group) => collider.removePart(chunk), [collider])

  const stream = useChunkStream({
    baseUrl,
    manifest,
    playerRef,
    group,
    onAdd: addChunk,
    onRemove: removeChunk,
  })
```

Заменить использования `scene` в разметке: `<MapModel scene={scene} />` → `<MapModel scene={group} />`; `<Builder scene={group} …>`; `<RenderTuning scene={group} />`. Строку с размерами в подсказке (строка 308) оставить как есть — `view.size` там уже есть.

**Точка появления больше не приходит свойством** — она в манифесте. Заменить строку камеры (строка 269):

```tsx
      <Canvas camera={{ fov: 60, near: 0.5, far: view.far, position: manifest.spawn }}>
```

Прежнее `view.center` из расчёта ушло, и подставлять его больше некуда — при стриминге сцена в первом кадре пуста, а центр карты всё равно не то место, где стоит игрок.

И сам `Player` (строки 277–285):

```tsx
        <Player
          scene={group}
          bounds={view.bounds}
          collider={collider}
          spawn={manifest.spawn}
          flying={flying}
          placed={placed}
          thirdPerson={thirdPerson}
          active={!menu}
          state={playerRef}
        />
```

Проброс `collider` в `Player` требует ещё одного свойства в `PlayerProps`:

```ts
  /**
   * Общий коллайдер. Со стримингом он переживает перерисовки Player и знает про
   * куски, пришедшие, пока Player не перемонтировался.
   */
  collider?: TerrainCollider
```

и в теле `Player` заменить строку 95:

```ts
  const collider = useMemo(() => colliderProp ?? new TerrainCollider(scene), [colliderProp, scene])
  // свой коллайдер освобождаем, чужой — нет: им распоряжается тот, кто создал
  useEffect(() => () => { if (!colliderProp) collider.dispose() }, [collider, colliderProp])
```

- [ ] **Step 3: Показать ожидание входа**

В том же файле, сразу после `<Canvas>…</Canvas>`, до `RenderStatsOverlay`, добавить заслонку:

```tsx
      {!stream.ready && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black">
          <p className="text-sm text-muted-foreground">{t('world.streaming')}</p>
          <div className="h-2 w-64 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.min(100, Math.round((stream.loaded / Math.max(stream.needed, 1)) * 100))}%` }}
            />
          </div>
          {stream.failed > 0 && (
            <p className="text-xs text-destructive">{t('world.chunkErrors', { count: stream.failed })}</p>
          )}
        </div>
      )}
```

- [ ] **Step 4: Добавить переводы**

В `frontend/awake-web/src/locales/ru.json` в раздел `world`:

```json
    "streaming": "Загружаем окрестности…",
    "chunkErrors": "Не удалось загрузить участков: {{count}}",
```

В `frontend/awake-web/src/locales/en.json` в тот же раздел:

```json
    "streaming": "Loading the surroundings…",
    "chunkErrors": "Failed to load {{count}} area(s)",
```

- [ ] **Step 5: Перевести вкладку «Мир» на стриминг**

В `frontend/awake-web/src/routes/_auth.world.tsx` заменить загрузку модели. Вместо эффекта, качающего `.glb` (строки 86–117), и состояний `scene`/`progress`:

```tsx
  const [entry, setEntry] = useState<{ baseUrl: string; manifest: MapManifest } | null>(null)

  useEffect(() => {
    if (target === null || target.kind !== 'map' || rank < UserRank.Member) return

    let cancelled = false
    setError(null)

    mapsApi
      .getChunkBase(target.location)
      .then(async (baseUrl) => ({ baseUrl, manifest: await loadManifest(baseUrl) }))
      .then((loaded) => {
        if (!cancelled) setEntry(loaded)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [target, rank])
```

`disposeScene` и `sceneRef` из файла уходят целиком: сценой теперь распоряжается `useChunkStream`, и он же освобождает геометрию при выходе. Функция `close` становится:

```tsx
  const close = useCallback(() => {
    setEntry(null)
    setTarget(null)
  }, [])
```

Отрисовка:

```tsx
  if (entry) {
    return (
      <WorldScene
        baseUrl={entry.baseUrl}
        manifest={entry.manifest}
        mapKey={target?.kind === 'map' ? target.location : 'default'}
        location={target?.kind === 'map' ? target.location : undefined}
        onClose={close}
      />
    )
  }
```

Кнопки отладочных тайлов (`DEBUG_TILES`, строки 200–227) убрать вместе с состоянием `merge`: они грузили целый тайл старым путём, которого больше нет.

Из файла при этом уходит целый пласт, и оставленный хвост поймает не сборка, а линтер. Убрать полностью:

| что | почему |
|---|---|
| `disposeScene` и `sceneRef` | сценой распоряжается `useChunkStream` |
| `SPAWNS` и три импорта `*.spawn.json` | точка появления теперь в манифесте |
| `Target` — вариант `{ kind: 'tile' }` | остаётся только `{ kind: 'map'; location }` |
| состояния `merge`, `progress`, `scene` | ими никто больше не пользуется |
| импорты `parseGltf`, `DEBUG_TILES`, `* as THREE` | не остаётся ни одного применения |

Добавить импорты `loadManifest`, `MapManifest` из `@/lib/mapManifest`.

Тип `Target` после уборки сводится к одному варианту, и его можно заменить прямо на `MapLocation | null` — но это уже вкусовщина, а не требование: оставить как есть тоже верно.

- [ ] **Step 6: Собрать и проверить линтером**

```bash
cd frontend/awake-web
npm run build
npm run lint
```

Ожидается: сборка проходит. Ошибок линтера должно стать **не больше 39** — часть старых могла уйти вместе с удалённым кодом, это нормально; новых быть не должно.

- [ ] **Step 7: Посмотреть на стенде**

Положить нарезку «Низины» туда, откуда её отдаёт стенд:

```bash
mkdir -p src/Awake.API/MapAssets/v2
cp -r D:/Awake/SC_Map_Dump-main/tmp_export/nizina/nizina_chunks src/Awake.API/MapAssets/v2/nizina
```

Поднять стенд (API на 5001, `vite.config.ts` проксирует туда) и открыть «Низину». Смотреть:

1. вход быстрее прежнего и не роняет сквозь пол;
2. швов между кусками нет — пройти карту насквозь;
3. туман закрывает границу, за ней не видно пустоты;
4. при быстром беге дыры не появляются;
5. на возврате в пройденное место карта не мигает заново.

**Это шаг для человека.** Исполнителю его не выполнить; если работу ведёт агент — доложить, что шаг остался за человеком, и не отмечать его сделанным.

- [ ] **Step 8: Закоммитить**

```bash
git add frontend/awake-web/src/components/world/WorldScene.tsx \
        frontend/awake-web/src/components/world/Player.tsx \
        frontend/awake-web/src/routes/_auth.world.tsx \
        frontend/awake-web/src/locales/ru.json \
        frontend/awake-web/src/locales/en.json
git commit -m "feat(world): вход в локацию через потоковую подгрузку"
```

---

### Task 7: Нарезать остальные карты и выложить в хранилище

**Files:**
- Modify: `frontend/awake-web/src/api/maps.ts` (комментарий про `DEBUG_TILES`, если он остался)
- Modify: `docs/STRUCTURE.md`

**Interfaces:**
- Consumes: `split_chunks.mjs` из задачи 1.
- Produces: три нарезки в R2 под `maps/v2/<локация>/`.

- [ ] **Step 1: Нарезать «Бердовку» и «Хвойный» и проверить обе**

```bash
cd tools/maps
for m in small_berdovka hvoiny; do
  node --max-old-space-size=12288 split_chunks.mjs D:/Awake/SC_Map_Dump-main/tmp_export/$m/$m.glb
  node --max-old-space-size=12288 split_chunks.mjs D:/Awake/SC_Map_Dump-main/tmp_export/$m/$m.glb --verify
done
```

Ожидается: у обеих `проверка пройдена`. «Хвойный» самый тяжёлый — если куче не хватит, поднять до 16384.

- [ ] **Step 2: Замерить, что получилось**

```bash
cd tools/maps
node -e "
const {readdirSync,statSync,readFileSync}=require('node:fs');
const {join}=require('node:path');
for(const m of ['nizina','small_berdovka','hvoiny']){
  const d='D:/Awake/SC_Map_Dump-main/tmp_export/'+m+'/'+m+'_chunks';
  const files=readdirSync(d).filter(f=>f.startsWith('c_'));
  const total=files.reduce((s,f)=>s+statSync(join(d,f)).size,0);
  const mat=statSync(join(d,'materials.glb')).size;
  const man=JSON.parse(readFileSync(join(d,'manifest.json'),'utf8'));
  console.log(m,'| кусков:',files.length,'| геометрия:',(total/1048576).toFixed(0),'МБ',
    '| материалы:',(mat/1048576).toFixed(1),'МБ','| средний кусок:',(total/files.length/1048576).toFixed(2),'МБ',
    '| сетка:',man.chunkSize);
}
"
```

Записать вывод — он пойдёт в `STRUCTURE.md` шагом 4. Ожидается порядок: 220–380 кусков на карту, средний кусок 0.4–1.2 МБ.

- [ ] **Step 3: Выложить в R2**

Три нарезки уезжают под `maps/v2/<локация>/`. Заливка — дело человека: ключей от хранилища у исполнителя нет.

Настройка добавляется **новым ключом**, а старый не трогается:

```
MapAssets:BaseUrl       = https://models.stalcraftclans.cc/maps/v1   (как было)
MapAssets:ChunkBaseUrl  = https://models.stalcraftclans.cc/maps/v2   (новый)
```

Так старый путь с целой моделью продолжает работать, пока стриминг не проверен на всех трёх картах.

**Это шаг для человека.** Если работу ведёт агент — подготовить список файлов и точную команду `wrangler`, доложить и не отмечать шаг сделанным.

- [ ] **Step 4: Описать в STRUCTURE.md**

В `docs/STRUCTURE.md`, в разделе про мир и карты, добавить абзац:

```markdown
Карта грузится не целиком, а кусками: колонны 64×64 блока во всю высоту,
общий файл текстур на локацию и манифест с описью. Клиент держит в сцене
только то, что в 120 метрах вокруг игрока, и выбрасывает ушедшее за 160;
туман встаёт ровно на границу загруженного. Нарезку делает
`tools/maps/split_chunks.mjs`, результат лежит в R2 под `maps/v2/<локация>/`.
Мера: «Хвойный» весил 268 МБ файлом и 868 МБ в памяти, стало ~62 и ~136 МБ.
```

- [ ] **Step 5: Закоммитить**

```bash
git add docs/STRUCTURE.md
git commit -m "docs: описать потоковую подгрузку карты"
```

---

## Что осталось за пределами плана

- **Старый путь с целым файлом.** `GET /api/maps/{location}/model`, `mapsApi.getMapModel` и `MapAssets/*.glb` живы: снимать их можно только после того, как человек посмотрит все три карты на стриминге. Отдельная уборка.
- **Барьеры «Бердовки»** — 353 МБ из 714 на невидимых стенах. Удалять нельзя (столкновения), но и рисовать незачем. Отдельная работа.
- **Четырёхбайтные индексы** — примерно пятая часть веса моделей. Лечится дроблением примитивов под 65536 вершин, но это добавляет draw calls.
- **Уровни детализации вдали** — если 120 метров окажется мало для разбора расстановок.

## Самопроверка плана

Сверено со спекой раздел за разделом:

- источник и формат нарезки — задача 1;
- манифест и права — задача 2;
- общий файл текстур и подстановка по имени — задача 3;
- круг 120 м, запас 160 м, шесть запросов, отмена ушедших, два повтора — задача 4;
- выгрузка только геометрии — задача 4, шаг 2, и явно в комментарии;
- сторож от падения сквозь незагруженное — задача 5;
- туман 70–120 м — задача 6, шаг 1;
- ожидание входа и полоска прогресса — задача 6, шаг 3;
- выкатка по одной карте — задача 6 (Низина) и задача 7 (остальные);
- машинные проверки из спеки — задача 1, шаг 2 (все три пункта);
- проверки глазами — задача 6, шаг 7.
