/**
 * Чинит материалы, испорченные экспортом. Геометрию не трогает вовсе.
 *
 * Два правила, оба про цвет:
 *
 *   1. stc_missing_*  -- заглушка потерянной текстуры, залита пурпуром.
 *                       Перекрашивается в серый камень.
 *   2. stc_invisible_*_packed_body -- барьер, которому забыли погасить заливку:
 *                       розовый (0.70, 0.25, 0.70) или зелёный с alpha 0.30.
 *                       Остальные части того же барьера идут с alpha 0, эта
 *                       выбивается и висит на карте цветным маревом.
 *                       Прозрачность выставляется в ноль, как у соседей.
 *
 * Экспортёр помечает материалом stc_missing_* блок, для которого не нашёл
 * текстуру, и заливает его чистым пурпуром (baseColorFactor = 1,0,1). В модели
 * это видно как ядовитые кубы посреди рельефа.
 *
 * Раньше заглушки вырезались примитивами целиком — и это было ошибкой. Блок не
 * декорация: столкновения в просмотрщике считаются лучом по той же геометрии,
 * которую видно, другого источника у них нет. Вырезанный блок оставлял дыру в
 * полу, и игрок через неё проваливался за карту. На «Низине» так пропало 15
 * примитивов, на «Небольшой Бердовке» — один.
 *
 * Поэтому геометрия остаётся нетронутой, меняется только цвет материала.
 * Столкновения при этом совпадают с исходной картой до треугольника, а дыр не
 * возникает по построению — латать нечего, ничего и не удалялось. То же и с
 * барьером: погасить заливку можно, убрать стену — нет.
 *
 * Текстуры у заглушек нет вовсе (проверено: baseColorTexture пуст, из атрибутов
 * только POSITION и COLOR_0), а COLOR_0 хранит затенение граней — значения от
 * 0.71 до 1.0 по всем каналам. Значит весь цвет приходит из baseColorFactor, и
 * одной его замены достаточно.
 *
 * Что НЕ трогаем:
 *
 *   stc_invisible_* (кроме заливки) -- барьеры самой игры. Геометрия настоящая
 *                       и для лучей столкновений твёрдая — именно так они и
 *                       работают в игре, ограничивая, куда можно зайти. Их
 *                       много: на «Небольшой Бердовке» это семь десятых всей
 *                       геометрии локации.
 *   stc_tex_customitems_black -- непрозрачный чёрный с нормальным цветом, то
 *                       есть настоящая поверхность, а не поломка.
 *
 * Правит тайлы в tiles_world на месте; собрать модель заново после этого —
 * rebuild_map.py. Повторный запуск безопасен: цвет просто выставится тот же.
 *
 * Запуск (из tools/maps, там node_modules):
 *   node fix_materials.mjs <папка с тайлами> [--dry]
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/**
 * Правила: как узнать материал и во что перекрасить его baseColorFactor.
 *
 * Серый для заглушек задан в линейном пространстве, а не в sRGB: 0.25 линейных
 * дают на экране примерно #898989. Осознанно неяркий и без оттенка — блок
 * должен читаться как обычная поверхность и не притягивать взгляд, раз уж
 * настоящей текстуры для него нет.
 *
 * Барьеру ставим ровно тот же цвет, что у остальных частей набора: белый с
 * нулевой прозрачностью. Режим смешивания у материала уже BLEND, поэтому ноль в
 * альфе и означает «не видно».
 */
const RULES = [
  { match: /^stc_missing/, color: [0.25, 0.24, 0.23, 1], what: 'заглушка' },
  { match: /^stc_invisible_.*_packed_body$/, color: [1, 1, 1, 0], what: 'барьер' },
];

const ruleFor = (name) => RULES.find((r) => r.match.test(name)) ?? null;

const sameColor = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

async function main() {
  const [dir, ...flags] = process.argv.slice(2);
  if (!dir) {
    console.error('использование: node fix_materials.mjs <папка с тайлами> [--dry]');
    process.exit(1);
  }
  const dry = flags.includes('--dry');

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });

  const tiles = readdirSync(dir)
    .filter((f) => f.endsWith('.glb') && !f.endsWith('.tmp.glb'))
    .sort();

  let totalMaterials = 0;
  let totalPrims = 0;
  let totalTris = 0;
  const byMaterial = new Map();

  for (const file of tiles) {
    const path = join(dir, file);
    const document = await io.read(path);

    const patched = new Map();
    for (const material of document.getRoot().listMaterials()) {
      const rule = ruleFor(material.getName());
      if (rule) patched.set(material, rule);
    }
    if (patched.size === 0) {
      console.log(`${file}: чисто`);
      continue;
    }

    // Треугольники считаем только чтобы показать масштаб правки — сама она
    // геометрию не трогает
    let prims = 0;
    let tris = 0;
    for (const mesh of document.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        const material = primitive.getMaterial();
        const rule = material && patched.get(material);
        if (!rule) continue;
        const count = primitive.getIndices()?.getCount()
          ?? primitive.getAttribute('POSITION')?.getCount()
          ?? 0;
        prims += 1;
        tris += Math.floor(count / 3);
        const key = `${material.getName()} (${rule.what})`;
        byMaterial.set(key, (byMaterial.get(key) ?? 0) + Math.floor(count / 3));
      }
    }

    const already = [...patched].every(([m, rule]) => sameColor(m.getBaseColorFactor(), rule.color));
    totalMaterials += patched.size;
    totalPrims += prims;
    totalTris += tris;

    if (dry || already) {
      const note = already && !dry ? 'уже залатано' : 'найдено';
      console.log(
        `${file}: ${note} — ${patched.size} материалов, ${prims} примитивов, ` +
        `${tris.toLocaleString('ru-RU')} треугольников`,
      );
      continue;
    }

    for (const [material, rule] of patched) material.setBaseColorFactor(rule.color);

    await io.write(path, document);
    console.log(
      `${file}: залатано ${patched.size} материалов, ${prims} примитивов, ` +
      `${tris.toLocaleString('ru-RU')} треугольников, ${(statSync(path).size / 1048576).toFixed(1)} МБ`,
    );
  }

  console.log('\nпо материалам:');
  for (const [name, tris] of [...byMaterial].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(56)} ${tris.toLocaleString('ru-RU').padStart(12)}`);
  }
  console.log(
    `\nвсего: ${totalMaterials} материалов, ${totalPrims} примитивов, ` +
    `${totalTris.toLocaleString('ru-RU')} треугольников`,
  );
  if (dry) console.log('(сухой прогон, файлы не тронуты)');
}

await main();
