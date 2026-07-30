import { createFileRoute, Navigate } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as THREE from 'three'
import { DEBUG_TILES, MAP_LOCATIONS, mapsApi, type MapLocation } from '@/api/maps'
import { WorldScene } from '@/components/world/WorldScene'
import hvoinySpawn from '@/components/world/hvoiny.spawn.json'
import nizinaSpawn from '@/components/world/nizina.spawn.json'
import berdovkaSpawn from '@/components/world/small_berdovka.spawn.json'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'
import { detectRenderer } from '@/lib/detectRenderer'
import { parseGltf } from '@/lib/parseGltf'
import { UserRank } from '@/types/api'

export const Route = createFileRoute('/_auth/world')({
  component: WorldPage,
})

/**
 * Геометрия карты занимает сотни мегабайт в видеопамяти, а сборщик мусора
 * WebGL-ресурсы не трогает — без явного dispose переключение между картами
 * копит их до отказа вкладки.
 */
function disposeScene(scene: THREE.Group) {
  // после слияния текстуры живут одним массивом в униформе шейдера, обходом
  // свойств материала его не найти
  const textureArray: unknown = scene.userData.textureArray
  if (textureArray instanceof THREE.DataArrayTexture) textureArray.dispose()

  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    obj.geometry?.dispose()
    const materials: THREE.Material[] = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const material of materials) {
      if (!material) continue
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      material.dispose()
    }
  })
}

/**
 * Точки появления посчитаны экспортёром: центр карты, поднятый до поверхности.
 * У отдельных тайлов их нет — там персонаж встаёт по центру и падает на землю.
 */
const SPAWNS: Record<MapLocation, [number, number, number]> = {
  hvoiny: [hvoinySpawn.x, hvoinySpawn.y, hvoinySpawn.z],
  small_berdovka: [berdovkaSpawn.x, berdovkaSpawn.y, berdovkaSpawn.z],
  nizina: [nizinaSpawn.x, nizinaSpawn.y, nizinaSpawn.z],
}

/** Что грузим: целую карту или один тайл (замеры, только в dev-сборке). */
type Target =
  | { kind: 'map'; location: MapLocation }
  | { kind: 'tile'; tile: (typeof DEBUG_TILES)[number] }

function WorldPage() {
  const { t } = useTranslation()
  const { rank } = useAuth()

  const [target, setTarget] = useState<Target | null>(null)
  // выключено: слияние теряет текстуры, разбираться отдельно
  const [merge, setMerge] = useState(false)
  const [progress, setProgress] = useState(0)
  const [scene, setScene] = useState<THREE.Group | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sceneRef = useRef<THREE.Group | null>(null)

  // проверка создаёт временный WebGL-контекст, поэтому строго один раз
  const renderer = useMemo(() => detectRenderer(), [])

  useEffect(() => {
    sceneRef.current = scene
  }, [scene])

  useEffect(() => {
    return () => {
      if (sceneRef.current) disposeScene(sceneRef.current)
    }
  }, [])

  useEffect(() => {
    if (target === null || rank < UserRank.Member) return

    let cancelled = false
    setError(null)
    setProgress(0)

    const onProgress = (ratio: number) => {
      if (!cancelled) setProgress(ratio)
    }
    const request =
      target.kind === 'map'
        ? mapsApi.getMapModel(target.location, onProgress)
        : mapsApi.getDebugTile(target.tile, onProgress)

    request
      .then((buffer) => parseGltf(buffer, merge))
      .then((loaded) => {
        if (cancelled) {
          disposeScene(loaded)
          return
        }
        setScene(loaded)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [target, rank, merge])

  const close = useCallback(() => {
    if (sceneRef.current) disposeScene(sceneRef.current)
    setScene(null)
    setTarget(null)
    setProgress(0)
  }, [])

  if (rank < UserRank.Member) return <Navigate to="/profile" />

  if (!renderer.available) {
    return <p className="text-destructive">{t('world.noWebgl')}</p>
  }

  if (scene) {
    return (
      <WorldScene
        scene={scene}
        spawn={target?.kind === 'map' ? SPAWNS[target.location] : undefined}
        mapKey={target?.kind === 'map' ? target.location : (target?.tile ?? 'default')}
        location={target?.kind === 'map' ? target.location : undefined}
        onClose={close}
      />
    )
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-foreground">{t('world.title')}</h1>

      {error && (
        <p className="mb-4 text-destructive">
          {t('world.loadError')}: {error}
        </p>
      )}

      {/* Предупреждение показывается только тем, у кого ускорение реально
          выключено, — остальным этот текст не нужен и только мешает */}
      {renderer.software && (
        <div className="mb-6 rounded-md border border-yellow-400/30 bg-yellow-400/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-yellow-400" />
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">{t('world.software.title')}</p>
              <p className="text-sm text-muted-foreground">{t('world.software.body')}</p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>{t('world.software.chrome')}</li>
                <li>{t('world.software.edge')}</li>
              </ul>
              {renderer.name && (
                <p className="font-mono text-xs text-muted-foreground">
                  {t('world.software.detected', { name: renderer.name })}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {target === null ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {MAP_LOCATIONS.map((loc) => (
              <Card key={loc}>
                <CardContent className="pt-5 pb-5">
                  <button
                    type="button"
                    onClick={() => setTarget({ kind: 'map', location: loc })}
                    className="w-full text-left"
                  >
                    <span className="block text-sm font-medium text-foreground">
                      {t(`world.maps.${loc}`)}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {t('world.open')}
                    </span>
                  </button>
                </CardContent>
              </Card>
            ))}
          </div>

          {import.meta.env.DEV && (
            <div className="mt-8">
              <p className="mb-2 text-xs text-muted-foreground">
                Замер производительности — отдельные тайлы Низины
              </p>
              <label className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={merge}
                  onChange={(e) => setMerge(e.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                слияние в массив текстур (≈200 draw calls → 2–3, ломает текстуры)
              </label>
              <div className="flex flex-wrap gap-2">
                {DEBUG_TILES.map((tile) => (
                  <button
                    key={tile}
                    type="button"
                    onClick={() => setTarget({ kind: 'tile', tile })}
                    className="rounded-md border border-border px-3 py-1.5 font-mono text-xs text-muted-foreground hover:bg-secondary"
                  >
                    {tile}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex h-64 flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">
            {t('world.loading')} —{' '}
            {target.kind === 'map' ? t(`world.maps.${target.location}`) : target.tile}
          </p>
          <div className="h-2 w-64 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            {Math.round(progress * 100)}%
          </p>
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
          >
            {t('world.cancel')}
          </button>
        </div>
      )}
    </div>
  )
}
