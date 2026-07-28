import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as THREE from 'three'
import { MAP_LOCATIONS, mapsApi, type MapLocation } from '@/api/maps'
import { WorldScene } from '@/components/world/WorldScene'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'
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

function WorldPage() {
  const { t } = useTranslation()
  const { rank } = useAuth()

  const [location, setLocation] = useState<MapLocation | null>(null)
  const [progress, setProgress] = useState(0)
  const [scene, setScene] = useState<THREE.Group | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sceneRef = useRef<THREE.Group | null>(null)

  useEffect(() => {
    sceneRef.current = scene
  }, [scene])

  useEffect(() => {
    return () => {
      if (sceneRef.current) disposeScene(sceneRef.current)
    }
  }, [])

  useEffect(() => {
    if (location === null || rank < UserRank.Member) return

    let cancelled = false
    setError(null)
    setProgress(0)

    mapsApi
      .getMapModel(location, (ratio) => {
        if (!cancelled) setProgress(ratio)
      })
      .then(parseGltf)
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
  }, [location, rank])

  const close = useCallback(() => {
    if (sceneRef.current) disposeScene(sceneRef.current)
    setScene(null)
    setLocation(null)
    setProgress(0)
  }, [])

  if (rank < UserRank.Member) return <Navigate to="/profile" />

  if (typeof WebGL2RenderingContext === 'undefined') {
    return <p className="text-destructive">{t('world.noWebgl')}</p>
  }

  if (scene) return <WorldScene scene={scene} onClose={close} />

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-foreground">{t('world.title')}</h1>

      {error && (
        <p className="mb-4 text-destructive">
          {t('world.loadError')}: {error}
        </p>
      )}

      {location === null ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {MAP_LOCATIONS.map((loc) => (
            <Card key={loc}>
              <CardContent className="pt-5 pb-5">
                <button
                  type="button"
                  onClick={() => setLocation(loc)}
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
      ) : (
        <div className="flex h-64 flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">
            {t('world.loading')} — {t(`world.maps.${location}`)}
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
