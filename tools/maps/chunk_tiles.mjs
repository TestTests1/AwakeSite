/**
 * Режет геометрию тайла на пространственные куски.
 *
 * Зачем. Экспортёр отдаёт тайл как ~200 примитивов, и каждый растянут на всю
 * площадь тайла (278x264 блока): примитив -- это все грани одного материала,
 * разбросанные по всему рельефу. Отсечение по пирамиде видимости на такой
 * геометрии бесполезно, любой примитив хоть краем да попадает в кадр и рисуется
 * целиком. От первого лица это значит, что мы всегда платим за весь тайл, хотя
 * видно от силы пятую часть.
 *
 * После нарезки каждый кусок -- это квадрат CHUNK x CHUNK блоков, и три.js
 * выбрасывает всё, что за спиной и за горизонтом, сам, без единой строчки
 * дополнительного кода.
 *
 * Число вызовов отрисовки при этом растёт, и это осознанно: замер показал, что
 * на этой сцене они ничего не стоят (138 против 3 -- одинаковый fps), а вот
 * лишняя геометрия в кадре стоит дорого.
 *
 * Использование:
 *   node chunk_tiles.mjs <вход.glb> <выход.glb> [размер куска в блоках]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const CHUNK_DEFAULT = 64;

async function main() {
  const [input, output, sizeArg] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: node chunk_tiles.mjs <in.glb> <out.glb> [chunk]');
    process.exit(1);
  }
  const chunk = Number(sizeArg ?? CHUNK_DEFAULT);

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });

  const document = await io.read(input);
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];

  let primsBefore = 0;
  let trisBefore = 0;
  const buckets = new Map(); // "cx,cz" -> Map(material -> {position, uv, color, indices})

  for (const node of scene.listChildren()) {
    const mesh = node.getMesh();
    if (!mesh) continue;

    // трансформация узла (квантование хранит масштаб и сдвиг именно тут)
    const matrix = node.getWorldMatrix();

    for (const prim of mesh.listPrimitives()) {
      primsBefore++;
      const position = prim.getAttribute('POSITION');
      const uv = prim.getAttribute('TEXCOORD_0');
      const color = prim.getAttribute('COLOR_0');
      const index = prim.getIndices();
      const material = prim.getMaterial();
      const count = index ? index.getCount() : position.getCount();
      trisBefore += count / 3;

      const world = new Float32Array(position.getCount() * 3);
      const tmp = [0, 0, 0];
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, tmp);
        // строчно-мажорная матрица gltf-transform хранится по столбцам
        world[i * 3] = matrix[0] * tmp[0] + matrix[4] * tmp[1] + matrix[8] * tmp[2] + matrix[12];
        world[i * 3 + 1] = matrix[1] * tmp[0] + matrix[5] * tmp[1] + matrix[9] * tmp[2] + matrix[13];
        world[i * 3 + 2] = matrix[2] * tmp[0] + matrix[6] * tmp[1] + matrix[10] * tmp[2] + matrix[14];
      }

      for (let t = 0; t < count; t += 3) {
        const a = index ? index.getScalar(t) : t;
        const b = index ? index.getScalar(t + 1) : t + 1;
        const c = index ? index.getScalar(t + 2) : t + 2;

        // куда попал треугольник, решает его центр
        const cx = (world[a * 3] + world[b * 3] + world[c * 3]) / 3;
        const cz = (world[a * 3 + 2] + world[b * 3 + 2] + world[c * 3 + 2]) / 3;
        const key = `${Math.floor(cx / chunk)},${Math.floor(cz / chunk)}`;

        let byMaterial = buckets.get(key);
        if (!byMaterial) buckets.set(key, (byMaterial = new Map()));
        let target = byMaterial.get(material);
        if (!target) {
          byMaterial.set(material, (target = {
            position: [], uv: uv ? [] : null, color: color ? [] : null,
            indices: [], seen: new Map(),
          }));
        }

        for (const v of [a, b, c]) {
          // вершины переиспользуются внутри куска, иначе размер вырастет втрое
          let mapped = target.seen.get(v);
          if (mapped === undefined) {
            mapped = target.position.length / 3;
            target.seen.set(v, mapped);
            target.position.push(world[v * 3], world[v * 3 + 1], world[v * 3 + 2]);
            if (uv) {
              uv.getElement(v, tmp);
              target.uv.push(tmp[0], tmp[1]);
            }
            if (color) {
              const rgba = [0, 0, 0, 1];
              color.getElement(v, rgba);
              target.color.push(rgba[0], rgba[1], rgba[2], color.getType() === 'VEC4' ? rgba[3] : 1);
            }
          }
          target.indices.push(mapped);
        }
      }
    }
  }

  // старую сцену выбрасываем целиком и собираем новую из кусков
  for (const node of scene.listChildren()) node.dispose();
  for (const mesh of root.listMeshes()) mesh.dispose();

  const buffer = root.listBuffers()[0];
  let primsAfter = 0;

  for (const [key, byMaterial] of buckets) {
    const mesh = document.createMesh(`chunk_${key}`);
    for (const [material, data] of byMaterial) {
      const prim = document.createPrimitive()
        .setMaterial(material)
        .setAttribute('POSITION', document.createAccessor()
          .setType('VEC3').setArray(new Float32Array(data.position)).setBuffer(buffer))
        .setIndices(document.createAccessor()
          .setType('SCALAR').setArray(new Uint32Array(data.indices)).setBuffer(buffer));
      if (data.uv) {
        prim.setAttribute('TEXCOORD_0', document.createAccessor()
          .setType('VEC2').setArray(new Float32Array(data.uv)).setBuffer(buffer));
      }
      if (data.color) {
        prim.setAttribute('COLOR_0', document.createAccessor()
          .setType('VEC4').setArray(new Float32Array(data.color)).setBuffer(buffer));
      }
      mesh.addPrimitive(prim);
      primsAfter++;
    }
    scene.addChild(document.createNode(`chunk_${key}`).setMesh(mesh));
  }

  await io.write(output, document);

  console.log(`${input}`);
  console.log(`  кусок              ${chunk} блоков`);
  console.log(`  примитивов было    ${primsBefore}`);
  console.log(`  кусков стало       ${buckets.size}`);
  console.log(`  примитивов стало   ${primsAfter}`);
  console.log(`  треугольников      ${trisBefore.toLocaleString('ru-RU')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
