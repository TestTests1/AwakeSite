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

    // Координаты читаются ЧЕРЕЗ матрицу узла, а не из вершин напрямую.
    // quantize() нормирует вершины в -1..1, а мировое положение уносит в
    // матрицу: у куска c_107_73 в POSITION лежит 0,±1, а место на карте
    // (6912, 93, 4712) хранится отдельно. Отрисовке и столкновениям это не
    // мешает — three.js матрицу применяет сам, — но проверка без неё мерит
    // не то и ругается на каждый кусок.
    const x0 = entry.x * CHUNK, z0 = entry.z * CHUNK;
    outside: for (const node of document.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      const matrix = node.getWorldMatrix();
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        const element = [0, 0, 0];
        for (let i = 0; i < position.getCount(); i++) {
          position.getElement(i, element);
          applyMatrix(matrix, element);
          const [x, , z] = element;
          if (x < x0 - 0.5 || x > x0 + CHUNK + 0.5 || z < z0 - 0.5 || z > z0 + CHUNK + 0.5) {
            console.error(`${entry.file}: вершина (${x.toFixed(1)}, ${z.toFixed(1)}) вне клетки`);
            problems++;
            break outside; // одной жалобы на кусок достаточно
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

  // Порядковый номер примитива на весь документ. Индексы вершин (a, b, c
  // ниже) уникальны только ВНУТРИ своего примитива — у любых двух
  // примитивов вершина 0 существует независимо. Один и тот же материал
  // часто встречается в нескольких узлах модели (два разных плейсмента
  // одной и той же CTM-накладки), и если оба попадают в одну клетку, их
  // индексы окажутся в одном bucket.remap. Без этого номера в ключе вторая
  // вершина-с-индексом-0 совпала бы по ключу с первой и получила бы её
  // мировые координаты — треугольник остался бы на месте по счёту, но с
  // чужой вершиной, растянутой на полкарты.
  let primitiveSerial = 0;

  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const matrix = node.getWorldMatrix();

    for (const primitive of mesh.listPrimitives()) {
      primitiveSerial++;
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
          const remapKey = `${primitiveSerial}:${vertex}`;
          let mapped = bucket.remap.get(remapKey);
          if (mapped === undefined) {
            mapped = bucket.remap.size;
            bucket.remap.set(remapKey, mapped);
            for (let s = 0; s < semantics.length; s++) {
              // Слот в бакете ищем ПО ИМЕНИ семантики, а не по номеру s: у
              // одного материала разные тайлы могут перечислять атрибуты в
              // разном порядке (например POSITION вторым в одном примитиве
              // и первым в другом). Бакет фиксирует порядок по первому
              // примитиву, а совпадение по номеру s для второго примитива
              // было бы случайным — TEXCOORD_0 (0..1) тогда записывался бы
              // в слот POSITION, а мировые координаты в слот TEXCOORD_0.
              // Именно так родился кусок с вершиной на полкарты от клетки:
              // счётчик треугольников подмену не заметил бы (индексов
              // столько же), а --verify ловит её по выходу за границы.
              const slot = bucket.semantics.indexOf(semantics[s]);
              if (slot === -1) continue; // семантики, которой не было у первого примитива, в бакете нет
              if (s === positionIndex) {
                bucket.data[slot].push(world[vertex * 3], world[vertex * 3 + 1], world[vertex * 3 + 2]);
                bucket.minY = Math.min(bucket.minY, world[vertex * 3 + 1]);
                bucket.maxY = Math.max(bucket.maxY, world[vertex * 3 + 1]);
              } else {
                const value = [];
                attributes[s].getElement(vertex, value);
                bucket.data[slot].push(...value);
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
