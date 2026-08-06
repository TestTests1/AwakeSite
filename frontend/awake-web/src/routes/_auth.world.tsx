import { createFileRoute, Navigate } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MAP_LOCATIONS, mapsApi, type MapLocation } from '@/api/maps'
import { WorldScene } from '@/components/world/WorldScene'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'
import { detectRenderer } from '@/lib/detectRenderer'
import { loadManifest, type MapManifest } from '@/lib/mapManifest'
import { UserRank } from '@/types/api'

export const Route = createFileRoute('/_auth/world')({
  component: WorldPage,
})

/** Что грузим: только целая карта — отдельные тайлы остались в прошлом, до стриминга. */
type Target = { kind: 'map'; location: MapLocation }

function WorldPage() {
  const { t } = useTranslation()
  const { rank } = useAuth()

  const [target, setTarget] = useState<Target | null>(null)
  const [entry, setEntry] = useState<{ baseUrl: string; manifest: MapManifest } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // проверка создаёт временный WebGL-контекст, поэтому строго один раз
  const renderer = useMemo(() => detectRenderer(), [])

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

  const close = useCallback(() => {
    setEntry(null)
    setTarget(null)
  }, [])

  if (rank < UserRank.Member) return <Navigate to="/profile" />

  if (!renderer.available) {
    return <p className="text-destructive">{t('world.noWebgl')}</p>
  }

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
      ) : (
        // Заглушка тут короткая: это только время на адрес хранилища и опись
        // манифеста, оба лёгкие. Сами куски карты грузятся уже внутри
        // WorldScene, там у входа своя полоса прогресса с честным счётом кусков.
        <div className="flex h-64 flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">
            {t('world.loading')} — {t(`world.maps.${target.location}`)}
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
