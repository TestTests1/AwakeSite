import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { mapsApi, type MapLocation } from '@/api/maps'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PlacedProp } from '@/lib/props'

/**
 * Общеклановые расстановки заграждений: сохранение под именем, загрузка, удаление.
 *
 * Показывается только вне режима ходьбы — там курсор захвачен холстом и до
 * кнопок всё равно не добраться. Текущая расстановка при этом продолжает
 * автоматически храниться в браузере, так что несохранённое не пропадает.
 */
export function LayoutPanel({
  location,
  placed,
  onLoad,
}: {
  location: MapLocation
  placed: PlacedProp[]
  onLoad: (props: PlacedProp[]) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const layouts = useQuery({
    queryKey: ['map-layouts', location],
    queryFn: () => mapsApi.getLayouts(location),
  })

  const save = useMutation({
    mutationFn: () => mapsApi.saveLayout(location, name.trim(), JSON.stringify(placed)),
    onSuccess: () => {
      setName('')
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['map-layouts', location] })
    },
    onError: (cause: Error) => setError(cause.message),
  })

  const load = useMutation({
    mutationFn: (id: string) => mapsApi.getLayout(id),
    onSuccess: (layout) => {
      try {
        onLoad(JSON.parse(layout.props) as PlacedProp[])
        setError(null)
      } catch {
        setError('Расстановка повреждена и не открылась.')
      }
    },
    onError: (cause: Error) => setError(cause.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => mapsApi.deleteLayout(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['map-layouts', location] }),
    onError: (cause: Error) => setError(cause.message),
  })

  return (
    <div className="absolute left-4 bottom-4 w-72 rounded-md border border-border bg-card/95 p-3">
      <p className="mb-2 text-xs font-medium text-foreground">Расстановки клана</p>

      <div className="mb-2 flex gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Название"
          className="h-8 text-xs"
        />
        <Button
          size="sm"
          className="h-8 shrink-0 text-xs"
          disabled={name.trim().length === 0 || save.isPending}
          onClick={() => save.mutate()}
        >
          Сохранить
        </Button>
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Сейчас на карте: {placed.length}. Имя существующей расстановки перезапишет её.
      </p>

      {error && <p className="mb-2 text-[11px] text-destructive">{error}</p>}

      <div className="max-h-48 space-y-1 overflow-y-auto">
        {layouts.isLoading && <p className="text-[11px] text-muted-foreground">Загрузка…</p>}
        {layouts.data?.length === 0 && (
          <p className="text-[11px] text-muted-foreground">Пока ничего не сохранено.</p>
        )}
        {layouts.data?.map((layout) => (
          <div key={layout.id} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => load.mutate(layout.id)}
              className="flex-1 rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <span className="block truncate text-foreground">{layout.name}</span>
              <span className="block text-[10px]">
                {layout.authorName} · {layout.propCount} шт.
              </span>
            </button>
            <button
              type="button"
              onClick={() => remove.mutate(layout.id)}
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title="Удалить"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
