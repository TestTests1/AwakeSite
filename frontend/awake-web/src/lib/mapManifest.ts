import { fetchChunkFile } from '@/api/maps'

/** Один кусок карты. x и z — номера клеток сетки, не метры. */
export interface ChunkEntry {
  x: number
  z: number
  file: string
  minY: number
  maxY: number
  tris: number
}

/**
 * Опись нарезанной карты. Пишется `tools/maps/split_chunks.mjs`; поля обязаны
 * совпадать с тем, что кладёт он.
 */
export interface MapManifest {
  version: number
  location: string
  chunkSize: number
  bounds: { min: [number, number, number]; max: [number, number, number] }
  spawn: [number, number, number]
  materials: string
  chunks: ChunkEntry[]
}

export async function loadManifest(baseUrl: string): Promise<MapManifest> {
  const buffer = await fetchChunkFile(`${baseUrl}manifest.json`)
  const manifest = JSON.parse(new TextDecoder().decode(buffer)) as MapManifest
  if (manifest.version !== 2) {
    throw new Error(`не тот формат нарезки: ${manifest.version}`)
  }
  return manifest
}
