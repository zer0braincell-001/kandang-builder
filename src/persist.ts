// Serialisasi model + persistence localStorage.
// Set/Map tidak boleh di-JSON.stringify langsung (jadi objek kosong) —
// selalu lewat serialize/deserialize di sini.

import { parseCubeKey } from './coords'
import type { PanelType } from './store'

export const STORAGE_KEY = 'kandang-model'

const PANEL_TYPE_VALUES: readonly string[] = ['jeruji', 'pintu', 'tutup', 'kosong']

export interface ModelSnapshot {
  version: 1
  cubes: string[]
  panelTypes: [string, PanelType][]
}

export interface ModelData {
  cubes: Set<string>
  panelTypes: Map<string, PanelType>
}

export function serialize(model: ModelData): ModelSnapshot {
  return {
    version: 1,
    cubes: [...model.cubes],
    panelTypes: [...model.panelTypes.entries()],
  }
}

// Validasi longgar tapi cukup: version benar, cubes array key integer
// valid dan tidak kosong, panelTypes array pasangan [string, tipe dikenal].
export function deserialize(data: unknown): ModelData | null {
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (d.version !== 1) return null
  if (!Array.isArray(d.cubes) || !Array.isArray(d.panelTypes)) return null

  const cubes = new Set<string>()
  for (const k of d.cubes) {
    if (typeof k !== 'string' || !parseCubeKey(k).every(Number.isInteger)) return null
    cubes.add(k)
  }
  if (cubes.size === 0) return null

  const panelTypes = new Map<string, PanelType>()
  for (const entry of d.panelTypes) {
    if (!Array.isArray(entry) || entry.length !== 2) return null
    const [key, tipe] = entry
    if (typeof key !== 'string' || typeof tipe !== 'string') return null
    if (!PANEL_TYPE_VALUES.includes(tipe)) return null
    panelTypes.set(key, tipe as PanelType)
  }

  return { cubes, panelTypes }
}

// Guard typeof: modul store juga dievaluasi di luar browser (test/build)

export function saveToLocalStorage(model: ModelData): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize(model)))
  } catch {
    // localStorage penuh/diblokir — auto-save gagal diam-diam, app tetap jalan
  }
}

export function loadFromLocalStorage(): ModelData | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    return deserialize(JSON.parse(raw))
  } catch {
    return null
  }
}

export function clearLocalStorage(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}
