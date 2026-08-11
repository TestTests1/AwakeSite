/**
 * Режет готовую модель локации на куски для потоковой подгрузки.
 *
 * Кусок — колонна 64×64 блока во всю высоту карты. По вертикали не режем:
 * карты низкие (78–147 блоков), и с дальностью видимости 120 м колонна всё
 * равно видна целиком — вертикальная нарезка утроила бы число файлов без
 * единого выигранного байта.
 *
 * Треугольник целиком уходит в тот кусок, где лежит его центр. Большинство не
 * длиннее блока, но не все — в «Низине» замерено до 4 м (заглушки текстуры),
 * и вершина такого треугольника может свеситься в соседнюю клетку на несколько
 * метров. Это не страшно: кусок — 64 метра, дальность прогрузки — 120 метров,
 * так что соседняя клетка всегда рядом в сцене и щели не возникает (подробнее
 * — у допуска в --verify). Треугольники НЕ делятся и НЕ теряются: столкновения
 * считаются лучом по этой же геометрии, и недостача означала бы дыру в полу.
 * Режим --verify проверяет это счётом.
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
 * Геометрия цела, если:
 *   1. сумма треугольников по кускам равна исходной;
 *   2. каждое имя материала из куска есть в materials.glb;
 *   3. ни одна вершина куска не выходит за его клетку больше чем на три метра.
 *
 * Три метра, а не полметра, как задумывалось: замер исходника «Низины» показал
 * 1 425 500 треугольников крупнее блока (8.7% из 16 456 206), самый крупный —
 * 4.01 м. Треугольник, приписанный клетке по своему центру, может свесить
 * вершину метра на три. Это безвредно: кусок 64 м, дальность загрузки 120 м,
 * значит соседние клетки всегда в сцене вместе — ни щели не видно, ни дыры в
 * полу. Число сведено из замера, а не взято на глаз: сменится экспортёр —
 * перемерить.
 *
 * Манифест — интерфейс для трёх следующих задач, и они читают его поля не
 * глядя в сами файлы кусков, поэтому проверяются и поля:
 *   4. entry.tris совпадает с реальным числом треугольников в файле куска;
 *   5. entry.minY/maxY совпадают с реальным диапазоном Y вершин куска — клиент
 *      режет кусок по пирамиде видимости именно по ним, не разбирая файл, и
 *      заниженный maxY срежет кусок, на котором стоит игрок;
 *   6. bounds манифеста равны объединению границ всех кусков;
 *   7. у каждого примитива в каждом куске все атрибуты содержат столько же
 *      элементов, сколько POSITION — рассинхрон здесь означает битый glTF
 *      (three.js читает индекс за концом короткого атрибута) и ловит заодно
 *      весь класс багов вроде несовпадения набора семантик у двух примитивов
 *      одного бакета (см. комментарий у fail-loud проверки в bucketTriangles).
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

  // Объединение границ кусков — для сверки с manifest.bounds (пункт 6).
  // Считается независимо от того, как bounds посчитан в split(), той же
  // формулой по entry.x/z/minY/maxY — иначе проверка просто повторила бы
  // возможную ошибку split() и ничего бы не поймала.
  let boundsMin = [Infinity, Infinity, Infinity];
  let boundsMax = [-Infinity, -Infinity, -Infinity];

  const OVERHANG = 3; // см. пояснение в шапке функции

  let actual = 0;
  let problems = 0;
  for (const entry of manifest.chunks) {
    const document = await io.read(join(outDir, entry.file));
    const tris = countTriangles(document);
    actual += tris;

    if (tris !== entry.tris) {
      console.error(`${entry.file}: манифест обещал ${entry.tris} треугольников, в файле ${tris}`);
      problems++;
    }

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
    let chunkMinY = Infinity, chunkMaxY = -Infinity;
    let boundaryReported = false; // одной жалобы на кусок о выходе за клетку достаточно
    for (const node of document.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      const matrix = node.getWorldMatrix();
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');

        // У всех атрибутов примитива должно быть поровну элементов. Если
        // нет — где-то в bucketTriangles записали не столько же вершин в
        // атрибут, сколько в POSITION (см. fail-loud проверку там же): три.js
        // читает по единому индексу во все атрибуты разом и уйдёт за конец
        // короткого массива.
        for (const semantic of primitive.listSemantics()) {
          const count = primitive.getAttribute(semantic).getCount();
          if (count !== position.getCount()) {
            console.error(`${entry.file}: у «${semantic}» ${count} элементов, у POSITION ${position.getCount()}`);
            problems++;
          }
        }

        const element = [0, 0, 0];
        for (let i = 0; i < position.getCount(); i++) {
          position.getElement(i, element);
          applyMatrix(matrix, element);
          const [x, y, z] = element;
          chunkMinY = Math.min(chunkMinY, y);
          chunkMaxY = Math.max(chunkMaxY, y);
          if (!boundaryReported &&
            (x < x0 - OVERHANG || x > x0 + CHUNK + OVERHANG || z < z0 - OVERHANG || z > z0 + CHUNK + OVERHANG)) {
            console.error(`${entry.file}: вершина (${x.toFixed(1)}, ${z.toFixed(1)}) вне клетки`);
            problems++;
            boundaryReported = true; // не break — ниже досчитываем minY/maxY
          }
        }
      }
    }

    if (Math.floor(chunkMinY) !== entry.minY || Math.ceil(chunkMaxY) !== entry.maxY) {
      console.error(`${entry.file}: манифест обещал minY=${entry.minY} maxY=${entry.maxY}, ` +
        `в файле ${Math.floor(chunkMinY)}..${Math.ceil(chunkMaxY)}`);
      problems++;
    }

    boundsMin = [
      Math.min(boundsMin[0], entry.x * CHUNK),
      Math.min(boundsMin[1], entry.minY),
      Math.min(boundsMin[2], entry.z * CHUNK),
    ];
    boundsMax = [
      Math.max(boundsMax[0], (entry.x + 1) * CHUNK),
      Math.max(boundsMax[1], entry.maxY),
      Math.max(boundsMax[2], (entry.z + 1) * CHUNK),
    ];
  }

  if (boundsMin.some((v, i) => v !== manifest.bounds.min[i]) ||
    boundsMax.some((v, i) => v !== manifest.bounds.max[i])) {
    console.error(`манифест: bounds не совпадает с объединением кусков — ` +
      `в манифесте [${manifest.bounds.min}]..[${manifest.bounds.max}], ` +
      `по кускам [${boundsMin}]..[${boundsMax}]`);
    problems++;
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
 * Диапазон Y по всем примитивам документа — через матрицу узла.
 *
 * Вызывать ПОСЛЕ quantize()/meshopt(), а не по сырым данным бакетов: те же
 * функции, что сжимают X/Z, чуть сдвигают и Y, и на границе целого числа
 * этого сдвига хватает, чтобы значение перескочило через неё. Досчитанный
 * заранее (по бакетам, до сжатия) minY/maxY в манифесте тогда разойдётся
 * с тем, что реально лежит в файле, — а manifest.minY/maxY клиент использует
 * для отсечения по пирамиде видимости без разбора файла: заниженный maxY
 * срежет кусок, на котором стоит игрок. Эта же функция используется в
 * --verify, чтобы проверка и запись мерили Y одинаково.
 */
function computeYExtent(document) {
  let min = Infinity, max = -Infinity;
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const matrix = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      const element = [0, 0, 0];
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, element);
        applyMatrix(matrix, element);
        min = Math.min(min, element[1]);
        max = Math.max(max, element[1]);
      }
    }
  }
  return { min, max };
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

      // Свой scratch-массив на каждую семантику примитива, переиспользуется для
      // всех его вершин ниже. Без этого «Хвойный» (геометрии в разы больше, чем
      // у «Низины», которая уже требует всю 12-гигабайтную кучу) плодил бы по
      // новому [] на каждую пару вершина-семантика — десятки миллионов лишних
      // аллокаций. Размер каждого элемента scratch фиксирован под свою семантику
      // (getElementSize не меняется), поэтому getElement переписывает его
      // целиком и старые значения не просачиваются.
      const scratch = attributes.map((a) => new Array(a.getElementSize()));

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
            types: attributes.map((a) => a.getType()), // реальный тип из источника, не догадка — см. buildChunk
            remap: new Map(),
            indices: [],
            data: semantics.map(() => []),
            seenPrimitives: new Set([primitiveSerial]),
          };
          buckets.set(key, bucket);
        } else if (!bucket.seenPrimitives.has(primitiveSerial)) {
          bucket.seenPrimitives.add(primitiveSerial);
          // ЖЁСТКАЯ проверка, не тихий пропуск. Бакет зафиксировал набор
          // атрибутов по первому примитиву, который его создал. Если у ЭТОГО
          // примитива не хватает какой-то из них, для его вершин ниже
          // bucket.data[slot] той семантики не пополнится, а для вершин
          // первого примитива — уже пополнился: у атрибута в куске окажется
          // МЕНЬШЕ элементов, чем у POSITION. buildChunk запишет аксессоры
          // разной длины на один примитив — невалидный glTF, а three.js в
          // рантайме читает по общему индексу и уйдёт за конец короткого
          // массива. Обратное — у ЭТОГО примитива атрибут, которого бакет не
          // знает, — безопасно и разрешено (см. slot === -1 ниже, просто не
          // переносим); опасно именно недостающее у бакета, поэтому проверяем
          // только эту сторону. Модель собрана из тайлов, оптимизированных
          // независимо (optimize_tiles.py — отдельный процесс на тайл), и
          // gltf-transform не гарантирует одинаковый порядок и набор
          // атрибутов между независимыми прогонами — на «Низине» порядок уже
          // расходился (баг 2 в отчёте задачи), набор — пока нет. На другой
          // карте набор тоже может разойтись; пусть тогда падает здесь, а не
          // тихо портит кусок.
          const missing = bucket.semantics.filter((need) => !semantics.includes(need));

          // Заодно сверяем ТИП совпадающих семантик, не только имя: COLOR_0
          // бывает и VEC3, и VEC4 (см. buildChunk), и если два примитива в
          // одном бакете разойдутся по типу — плоский bucket.data[slot]
          // получит вперемешку записи по 3 и по 4 числа, а элемент-размер
          // аксессора зафиксирован один. Тот же класс поломки, что и с
          // недостающей семантикой, поэтому падаем той же проверкой.
          const mismatched = bucket.semantics
            .filter((need) => !missing.includes(need))
            .filter((need) => attributes[semantics.indexOf(need)].getType() !== bucket.types[bucket.semantics.indexOf(need)]);

          if (missing.length > 0 || mismatched.length > 0) {
            throw new Error(
              `bucketTriangles: клетка ${gx},${gz}, материал «${materialName}» — примитив #${primitiveSerial} ` +
              `несёт атрибуты [${semantics.join(', ')}], а бакет уже собран по примитиву с ` +
              `[${bucket.semantics.join(', ')}].` +
              (missing.length > 0 ? ` Не хватает: ${missing.join(', ')}.` : '') +
              (mismatched.length > 0 ? ` Разный тип у: ${mismatched.join(', ')}.` : ''),
            );
          }
        }

        for (const vertex of [a, b, c]) {
          // Числовой ключ вместо строкового: primitiveSerial * 1e7 + vertex
          // остаётся точным числом (в пределах 2^53) при разумных размерах
          // примитивов и не аллоцирует строку на каждую вершину каждого
          // треугольника — на «Хвойном» это десятки миллионов строк меньше.
          // 1e7 — запас на количество вершин в одном примитиве; больше в
          // этой модели не встречается ни у одного примитива.
          const remapKey = primitiveSerial * 1e7 + vertex;
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
              } else {
                const value = scratch[s];
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
      // Тип берём с bucket.types — он записан в bucketTriangles с реального
      // аксессора источника, не угадан по имени семантики. Угаданная таблица
      // (была раньше) хардкодила COLOR_0 как VEC4, а glTF разрешает и VEC3:
      // на VEC3-цвете getElement вернул бы 3 компоненты на вершину, а
      // setType('VEC4') заставил бы аксессор считать count по 4 — на четверть
      // меньше вершин, чем в POSITION, и смещённые цвета по всей карте.
      primitive.setAttribute(
        bucket.semantics[s],
        document.createAccessor().setType(bucket.types[s]).setArray(new Float32Array(bucket.data[s])),
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

    // minY/maxY — из уже сжатого document (после quantize/meshopt), а не из
    // сырых мировых координат до сжатия: см. пояснение у computeYExtent.
    const { min: yMin, max: yMax } = computeYExtent(document);

    const [gx, gz] = key.split('_').map(Number);
    entries.push({
      x: gx,
      z: gz,
      file,
      minY: Math.floor(yMin),
      maxY: Math.ceil(yMax),
      tris: list.reduce((sum, b) => sum + b.indices.length / 3, 0),
    });

    // Тяжёлые поля ведёрок этого куска больше не нужны: entries выше уже
    // забрал все числа, что попадут в манифест, а сам кусок уже записан на
    // диск. buildChunk копирует данные в собственные типизированные массивы
    // документа, так что оригиналы можно отпускать сразу. buckets/byChunk
    // живут до конца split() (те же объекты, что и в list), и без явной
    // очистки вся геометрия карты держалась бы в памяти дважды сразу —
    // «Низина» (16.5 млн треугольников, 156 МБ) это пережила впритык на
    // 12 ГБ кучи, а «Хвойный» тяжелее в разы и без этой очистки в ту же
    // кучу не поместится.
    for (const bucket of list) {
      bucket.data = null;
      bucket.indices = null;
      bucket.remap = null;
      bucket.seenPrimitives = null;
    }

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
