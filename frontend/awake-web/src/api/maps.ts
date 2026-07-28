import { useAuthStore } from '@/store/authStore'
import { ApiError } from './client'

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
  path: string,
  onProgress?: (ratio: number) => void,
): Promise<ArrayBuffer> {
  const token = useAuthStore.getState().accessToken
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const response = await fetch(`${BASE_URL}/api${path}`, { headers, credentials: 'include' })
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

export const mapsApi = {
  getMapModel: (
    location: MapLocation,
    onProgress?: (ratio: number) => void,
  ): Promise<ArrayBuffer> => fetchWithProgress(`/maps/${location}/model`, onProgress),
}
