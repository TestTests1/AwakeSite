"""
Собирает анимации аватара из исходника v1.blend и кладёт готовый glb.

Запуск:
    blender -b v1.blend -P make_animations.py -- out.glb [preview.mp4]

Делает два клипа: `run` — цикл бега на два шага, и `idle` — спокойное стояние,
без него персонаж на месте застывал бы в позе шага.

Про риг. Модель вынута из игры вместе со штатным скелетом: 72 кости с
именованием Rigify, скиннинг уже настроен. Знаки поворотов держатся на осях
покоя, снятых с самого рига:
  * бедро и голень смотрят вниз, локальный X совпадает с мировым +X, поэтому
    «плюс» уводит ногу назад, «минус» — вперёд, а сгиб колена всегда «плюс»;
  * у плеча и предплечья локальный X направлен в -X, и там всё наоборот:
    «плюс» выносит руку вперёд;
  * позвоночник наклоняется вперёд «плюсом»;
  * у большой руки V2 предплечье сгибается «минусом» — ось развёрнута.

Ещё две особенности файла, на которых легко обжечься. В нём сохранена поза,
отличная от позы покоя, и габариты меша её не показывают — bound_box берётся до
модификаторов, поэтому позу сбрасываем руками. И `spine` в Rigify — это таз, к
нему подвешены бёдра: наклонять корпус надо грудным отделом, иначе туловище
утащит ноги за собой.
"""
import os
import sys
from math import radians, sin, pi

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
VIDEO = args[1] if len(args) > 1 else None

FPS = 30

arm = bpy.data.objects['v1_combined']
mesh_obj = bpy.data.objects['v1_mdl']
scene = bpy.context.scene
scene.render.fps = FPS


def reset_pose():
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
        pb.location = (0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def curves(act):
    """В Blender 4.4+ кривые лежат в слоях действия, а не прямо в нём."""
    if hasattr(act, 'fcurves'):
        return list(act.fcurves)
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                out.extend(bag.fcurves)
    return out


def lowest_point():
    """Нижняя точка меша уже после скиннинга, в мировых единицах."""
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    ev = mesh_obj.evaluated_get(deps)
    me = ev.to_mesh()
    z = min((mesh_obj.matrix_world @ v.co).z for v in me.vertices)
    ev.to_mesh_clear()
    return z


def build(name, keys):
    """
    Собирает действие из ключевых поз.

    keys — список (кадр, повороты в градусах, желаемая высота нижней точки).
    Высоту таза не задаём вручную: она жёстко связана с длиной ног и сгибом
    колена, поэтому ставим позу, меряем меш и опускаем корень ровно настолько,
    чтобы обувь легла на заданный уровень. Ноль — стопа на земле, больше нуля —
    фаза полёта.
    """
    reset_pose()
    arm.animation_data_create()
    arm.animation_data.action = None

    for frame, rot, _target in keys:
        for bone, degrees in rot.items():
            pb = arm.pose.bones.get(bone)
            if pb is None:
                raise KeyError(f'нет кости {bone!r}')
            pb.rotation_euler.x = radians(degrees)
            pb.keyframe_insert('rotation_euler', index=0, frame=frame)

    action = arm.animation_data.action
    action.name = name
    action.use_fake_user = True

    scene.frame_start = keys[0][0]
    scene.frame_end = keys[-1][0]

    root = arm.pose.bones['metarig']
    scene.frame_set(keys[0][0])
    root.location.z = 0.0
    base = lowest_point()
    root.location.z = 0.1
    factor = (lowest_point() - base) / 0.1
    root.location.z = 0.0

    for frame, _rot, target in keys:
        scene.frame_set(frame)
        root.location.z = 0.0
        root.location.z = (target - lowest_point()) / factor
        root.keyframe_insert('location', index=2, frame=frame)

    fcurves = curves(action)
    for fc in fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'
        fc.update()

    print(f'{name}: кривых {len(fcurves)}, кадры {scene.frame_start}..{scene.frame_end}')
    return action


# ── бег ───────────────────────────────────────────────────────────────────
STEP = 3
# Фазы одного шага. Ведущая нога — та, что впереди и принимает вес.
RUN_PHASES = [
    # касание: нога выброшена вперёд, вторая вытянута назад, корпус подан вперёд
    dict(thighLead=-38, shinLead=12, footLead=-8,
         thighTrail=42, shinTrail=35, footTrail=22,
         armFwd=48, armBack=-38, lean=14, lift=0.0),
    # амортизация: колено опорной ноги гасит удар
    dict(thighLead=-18, shinLead=45, footLead=2,
         thighTrail=28, shinTrail=58, footTrail=15,
         armFwd=35, armBack=-25, lean=16, lift=0.0),
    # толчок: опорная нога распрямляется, вторая проносится коленом вперёд
    dict(thighLead=2, shinLead=22, footLead=28,
         thighTrail=-8, shinTrail=80, footTrail=5,
         armFwd=10, armBack=-5, lean=13, lift=0.0),
    # полёт: обе ноги в воздухе, руки меняются местами
    dict(thighLead=32, shinLead=30, footLead=30,
         thighTrail=-42, shinTrail=88, footTrail=-5,
         armFwd=-20, armBack=28, lean=12, lift=0.35),
]


def run_pose(phase, lead):
    trail = 'R' if lead == 'L' else 'L'
    p = RUN_PHASES[phase]
    rot = {
        f'thigh.{lead}': p['thighLead'],
        f'shin.{lead}': p['shinLead'],
        f'foot.{lead}': p['footLead'],
        f'thigh.{trail}': p['thighTrail'],
        f'shin.{trail}': p['shinTrail'],
        f'foot.{trail}': p['footTrail'],
        # рука работает противофазно ноге: впереди та, что напротив ведущей
        f'upper_arm.{trail}': p['armFwd'],
        f'upper_arm.{lead}': p['armBack'],
        f'forearm.{trail}': 95,
        f'forearm.{lead}': 70,
        'spine': p['lean'] * 0.15,
        'spine.001': p['lean'] * 0.5,
        'spine.002': p['lean'] * 0.35,
        'spine.003': -p['lean'] * 0.2,
        # большая рука V2 висит на левом плече: качаем её вполсилы
        'big bicept': (p['armFwd'] if lead == 'R' else p['armBack']) * 0.45,
        'big forearm': -35,
    }
    return rot, p['lift']


run_keys = []
for i in range(9):
    lead = 'L' if (i // 4) % 2 == 0 else 'R'
    rot, lift = run_pose(i % 4, lead)
    run_keys.append((1 + i * STEP, rot, lift))

# ── покой ─────────────────────────────────────────────────────────────────
# Двухсекундная петля: чуть заметное дыхание и перенос веса. Ноги почти прямые,
# руки висят вдоль корпуса. Без этого клипа стоящий персонаж застывал бы в позе
# шага, а с выключенной анимацией — в позе покоя скелета, что ещё хуже.
IDLE_FRAMES = 61
idle_keys = []
for i in range(5):
    frame = 1 + i * (IDLE_FRAMES - 1) // 4
    t = sin(2 * pi * i / 4)
    idle_keys.append((frame, {
        'thigh.L': -1, 'shin.L': 3, 'foot.L': -1,
        'thigh.R': 1, 'shin.R': 3, 'foot.R': -1,
        'upper_arm.L': -4 + t * 1.5, 'upper_arm.R': -4 - t * 1.5,
        'forearm.L': 12 + t * 2, 'forearm.R': 12 - t * 2,
        'spine': 1, 'spine.001': 2 + t * 1.2, 'spine.002': 1,
        'spine.003': -1 - t * 0.8,
        'big bicept': -3, 'big forearm': -30,
    }, 0.0))

build('run', run_keys)
run_action = bpy.data.actions['run']
build('idle', idle_keys)
idle_action = bpy.data.actions['idle']

# ── проверка опоры ────────────────────────────────────────────────────────
print('\nконтроль опоры (нижняя точка меша, мировые единицы)')
for name, action, keys in (('run', run_action, run_keys), ('idle', idle_action, idle_keys)):
    arm.animation_data.action = action
    lows = []
    for frame, _rot, _t in keys:
        scene.frame_set(frame)
        lows.append(lowest_point())
    print(f'  {name}: ' + ' '.join(f'{v:.3f}' for v in lows))

# ── экспорт ───────────────────────────────────────────────────────────────
scene.frame_start = 1
scene.frame_end = max(k[0] for k in run_keys)
arm.animation_data.action = run_action
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_apply=False,
    export_skins=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_bake_animation=True,
    export_yup=True,
)
print('ЭКСПОРТ:', OUT)

if not VIDEO:
    raise SystemExit

# ── превью ────────────────────────────────────────────────────────────────
floor_mesh = bpy.data.meshes.new('floor')
# плита, а не плоскость: камера стоит у пола и плоскость видна с ребра
floor_mesh.from_pydata(
    [(-6, -6, -0.08), (6, -6, -0.08), (6, 6, -0.08), (-6, 6, -0.08),
     (-6, -6, 0), (6, -6, 0), (6, 6, 0), (-6, 6, 0)], [],
    [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6)])
floor = bpy.data.objects.new('floor', floor_mesh)
scene.collection.objects.link(floor)

cam_data = bpy.data.cameras.new('preview')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 5.4
cam = bpy.data.objects.new('preview', cam_data)
scene.collection.objects.link(cam)
cam.location = (10, 2.5, 2.1)
cam.rotation_euler = (Vector((0, 0, 2.0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam

scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x, scene.render.resolution_y = 420, 480
# в Blender 5 список форматов фильтруется по media_type, его меняем первым
scene.render.image_settings.media_type = 'VIDEO'
scene.render.image_settings.file_format = 'FFMPEG'
scene.render.ffmpeg.format = 'MPEG4'
scene.render.ffmpeg.codec = 'H264'
scene.render.ffmpeg.constant_rate_factor = 'HIGH'

for name, action, length in (('run', run_action, 24), ('idle', idle_action, 60)):
    arm.animation_data.action = action
    # зацикливаем кривые модификатором: экспорт уже позади, на glb это не влияет
    for fc in curves(action):
        if not fc.modifiers:
            fc.modifiers.new('CYCLES')
        fc.update()
    scene.frame_start = 1
    scene.frame_end = length * 2
    scene.render.filepath = os.path.join(os.path.dirname(VIDEO), f'{name}_')
    bpy.ops.render.render(animation=True)
    print('ВИДЕО:', name)
