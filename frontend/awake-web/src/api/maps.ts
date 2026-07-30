import { useAuthStore } from '@/store/authStore'
import { apiClient, ApiError } from './client'

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

/** Набор совпадает с белым списком в MapAssetService на бэкенде. */
export const MAP_LOCATIONS = ['hvoiny', 'small_berdovka', 'nizina'] as const
export type MapLocation = (typeof MAP_LOCATIONS)[number]

/**
 * Модели весят сотни мегабайт, поэтому тело читается потоком, а не через
 * response.arrayBuffer() — иначе прогресс показать нечем и пользователь
 * минуту смотрит на пустой экран.
 */
async function fetchWithProgress(
  url: string,
  onProgress?: (ratio: number) => void,
  authenticated = true,
): Promise<ArrayBuffer> {
  const headers: Record<string, string> = {}
  if (authenticated) {
    const token = useAuthStore.getState().accessToken
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  // credentials: 'omit' намеренно. Запрос модели может закончиться
  // перенаправлением во внешнее хранилище, а браузер разрешает запрос с
  // учётными данными на чужой домен только если тот вернёт точный
  // Access-Control-Allow-Origin; публичные хранилища отдают '*', и загрузка
  // сорвалась бы. Доступ держится на заголовке Authorization, который от этого
  // режима не зависит и при переходе на чужой домен отбрасывается — что и
  // правильно, туда его отдавать незачем.
  const response = await fetch(url, { headers, credentials: 'omit' })
  if (!response.ok || !response.body) {
    throw new ApiError(response.status, `HTTP ${response.status}`)
  }

  // Заголовка может не быть (chunked) — тогда прогресс просто не двигается
  const total = Number(response.headers.get('Content-Length') ?? 0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total > 0) onProgress?.(received / total)
  }

  const buffer = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.length
  }
  onProgress?.(1)
  return buffer.buffer as ArrayBuffer
}

/**
 * Отдельные тайлы Низины из public/tiles — только для локальных замеров
 * производительности перед тем, как строить стриминг. В прод-сборке кнопок,
 * которые сюда ходят, нет.
 */
export const DEBUG_TILES = [
  'tile_0_2',
  'tile_0_3',
  'tile_0_3_chunked',
  'tile_2_2',
  'tile_2_2_chunked',
] as const

export interface MapLayoutSummary {
  id: string
  location: string
  name: string
  authorId: string
  authorName: string
  propCount: number
  updatedAt: string
}

export interface MapLayout extends MapLayoutSummary {
  props: string
  createdAt: string
}

export const mapsApi = {
  getMapModel: (
    location: MapLocation,
    onProgress?: (ratio: number) => void,
  ): Promise<ArrayBuffer> =>
    fetchWithProgress(`${BASE_URL}/api/maps/${location}/model`, onProgress),

  getDebugTile: (
    tile: (typeof DEBUG_TILES)[number],
    onProgress?: (ratio: number) => void,
  ): Promise<ArrayBuffer> => fetchWithProgress(`/tiles/${tile}.glb`, onProgress, false),

  getLayouts: (location: MapLocation) =>
    apiClient.get<MapLayoutSummary[]>(`/maps/${location}/layouts`),

  getLayout: (id: string) => apiClient.get<MapLayout>(`/maps/layouts/${id}`),

  saveLayout: (location: MapLocation, name: string, props: string) =>
    apiClient.put<MapLayout>(`/maps/${location}/layouts`, { name, props }),

  deleteLayout: (id: string) => apiClient.delete<void>(`/maps/layouts/${id}`),
}
