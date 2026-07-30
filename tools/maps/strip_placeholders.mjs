/**
 * Убирает из тайлов геометрию с материалами-заглушками.
 *
 * Убирается только stc_missing_* — материал, которым экспортёр помечает блок,
 * когда не нашёл для него текстуру. Он непрозрачный и залит пурпурным, так что
 * в модели это видно как яркие кубы посреди рельефа.
 *
 * Что НЕ трогаем, хотя оно тоже без картинки:
 *
 *   stc_invisible_*  -- барьеры самой игры. Alpha 0, то есть их не видно, но
 *                       геометрия настоящая и для лучей столкновений твёрдая —
 *                       именно так они и работают в игре, ограничивая, куда
 *                       можно зайти. Убрать их значит открыть проход туда, где
 *                       в игре стена. Их много: на «Небольшой Бердовке» это
 *                       семь десятых всей геометрии локации.
 *   stc_tex_customitems_black -- непрозрачный чёрный с нормальным цветом, то
 *                       есть настоящая поверхность, а не поломка.
 *
 * Правит тайлы в tiles_world на месте; собрать модель заново после этого —
 * rebuild_map.py. Тайлы восстановимы из tiles_opt через apply_tile_offsets.py,
 * так что правка обратима.
 *
 * Запуск (из папки SC_Map_Dump, там node_modules):
 *   node strip_placeholders.mjs <папка с тайлами> [--dry]
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/** Что считаем заглушкой. Только потерянная текстура — барьеры не трогаем. */
const STRIP = [/^stc_missing/];

const isPlaceholder = (name) => STRIP.some((re) => re.test(name));

async function main() {
  const [dir, ...flags] = process.argv.slice(2);
  if (!dir) {
    console.error('использование: node strip_placeholders.mjs <папка с тайлами> [--dry]');
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

  let totalPrims = 0;
  let totalTris = 0;
  const byMaterial = new Map();

  for (const file of tiles) {
    const path = join(dir, file);
    const before = statSync(path).size;
    const document = await io.read(path);

    let prims = 0;
    let tris = 0;

    for (const mesh of document.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        const name = primitive.getMaterial()?.getName() ?? '';
        if (!isPlaceholder(name)) continue;

        const count = primitive.getIndices()?.getCount()
          ?? primitive.getAttribute('POSITION')?.getCount()
          ?? 0;
        prims += 1;
        tris += Math.floor(count / 3);
        byMaterial.set(name, (byMaterial.get(name) ?? 0) + Math.floor(count / 3));

        mesh.removePrimitive(primitive);
        primitive.dispose();
      }
    }

    totalPrims += prims;
    totalTris += tris;

    if (prims === 0) {
      console.log(`${file}: чисто`);
      continue;
    }

    if (dry) {
      console.log(`${file}: нашлось ${prims} примитивов, ${tris.toLocaleString('ru-RU')} треугольников`);
      continue;
    }

    // prune убирает осиротевшие материалы, аксессоры и текстуры, иначе они
    // остались бы в файле мёртвым грузом
    await document.transform(prune());
    await io.write(path, document);
    const after = statSync(path).size;
    console.log(
      `${file}: убрано ${prims} примитивов, ${tris.toLocaleString('ru-RU')} треугольников, ` +
      `${(before / 1048576).toFixed(1)} -> ${(after / 1048576).toFixed(1)} МБ`,
    );
  }

  console.log('\nпо материалам:');
  for (const [name, tris] of [...byMaterial].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(56)} ${tris.toLocaleString('ru-RU').padStart(12)}`);
  }
  console.log(`\nвсего: ${totalPrims} примитивов, ${totalTris.toLocaleString('ru-RU')} треугольников`);
  if (dry) console.log('(сухой прогон, файлы не тронуты)');
}

await main();
