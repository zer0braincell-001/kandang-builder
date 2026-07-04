import { create } from 'zustand'
import { cubeKey, parseCubeKey, panelKey, parsePanelKey, oppositeDir, DIRS, FACE_DIRS, type Dir } from './coords'
import { clearLocalStorage, loadFromLocalStorage, saveToLocalStorage, type ModelData } from './persist'

export type PanelType = 'jeruji' | 'pintu' | 'tutup' | 'kosong'

export type Mode = 'bangun' | 'cat'

export interface WallSlot {
  key: string
  x: number
  y: number
  z: number
  dir: Dir
  tipe: PanelType
  internal: boolean
}

interface CageState {
  cubes: Set<string>
  // Override tipe panel saja; sisi kepapar diturunkan dari cubes,
  // tidak pernah disimpan mentah. Tanpa override = 'jeruji'.
  // Override sengaja tidak dihapus saat sisi jadi internal ('inget').
  panelTypes: Map<string, PanelType>
  mode: Mode
  selectedPanel: string | null
  addCube: (key: string) => void
  removeCube: (key: string) => void
  setMode: (mode: Mode) => void
  selectPanel: (key: string | null) => void
  setPanelType: (key: string, tipe: PanelType) => void
  loadModel: (model: ModelData) => void
  resetModel: () => void
}

const defaultModel = (): ModelData => ({
  cubes: new Set([cubeKey(0, 0, 0)]),
  panelTypes: new Map(),
})

const saved = loadFromLocalStorage()

export const useCageStore = create<CageState>((set) => ({
  cubes: saved?.cubes ?? defaultModel().cubes,
  panelTypes: saved?.panelTypes ?? defaultModel().panelTypes,
  mode: 'bangun',
  selectedPanel: null,

  loadModel: (model) =>
    set({ cubes: model.cubes, panelTypes: model.panelTypes, selectedPanel: null }),

  resetModel: () => {
    set({ ...defaultModel(), selectedPanel: null })
    clearLocalStorage()
  },

  setMode: (mode) =>
    set(() => (mode === 'bangun' ? { mode, selectedPanel: null } : { mode })),

  selectPanel: (key) => set({ selectedPanel: key }),

  setPanelType: (key, tipe) =>
    set((state) => {
      const panelTypes = new Map(state.panelTypes)
      panelTypes.set(key, tipe)
      return { panelTypes }
    }),

  addCube: (key) =>
    set((state) => {
      if (state.cubes.has(key)) return state
      // Tidak boleh membangun di bawah lantai
      if (parseCubeKey(key)[1] < 0) return state
      const cubes = new Set(state.cubes)
      cubes.add(key)
      return { cubes }
    }),

  removeCube: (key) =>
    set((state) => {
      if (!state.cubes.has(key)) return state

      const candidate = new Set(state.cubes)
      candidate.delete(key)

      // Cegah set kosong: kubus terakhir tidak boleh dihapus
      if (candidate.size === 0) return state

      // Flood-fill dari satu anggota candidate lewat tetangga sisi (6 arah).
      // Sentuhan sudut/tepi tidak dihitung terhubung.
      const start: string = candidate.values().next().value!
      const visited = new Set([start])
      const queue = [start]
      while (queue.length > 0) {
        const [x, y, z] = parseCubeKey(queue.pop()!)
        for (const [dx, dy, dz] of Object.values(FACE_DIRS)) {
          const neighbor = cubeKey(x + dx, y + dy, z + dz)
          if (candidate.has(neighbor) && !visited.has(neighbor)) {
            visited.add(neighbor)
            queue.push(neighbor)
          }
        }
      }

      // Terpisah jadi lebih dari satu komponen → tolak
      if (visited.size !== candidate.size) return state

      // Mengambang (tidak ada kubus di lantai y=0) → tolak
      const grounded = [...candidate].some((k) => parseCubeKey(k)[1] === 0)
      if (!grounded) return state

      // Penghapusan commit → bersihkan override yatim: tembok "x,y,z,dir"
      // mengapit sel (x,y,z) dan tetangganya di arah dir. Kalau KEDUA sel
      // sudah tidak ada, override tak bisa kepapar lagi → buang. Satu sel
      // masih ada → pertahankan (perilaku 'inget').
      const panelTypes = new Map(state.panelTypes)
      for (const pk of state.panelTypes.keys()) {
        const [x, y, z, dir] = parsePanelKey(pk)
        const [dx, dy, dz] = FACE_DIRS[dir]
        if (!candidate.has(cubeKey(x, y, z)) && !candidate.has(cubeKey(x + dx, y + dy, z + dz))) {
          panelTypes.delete(pk)
        }
      }
      if (panelTypes.size === state.panelTypes.size) {
        return { cubes: candidate }
      }
      return { cubes: candidate, panelTypes }
    }),
}))

// Auto-save: tiap model (cubes/panelTypes) berubah, snapshot ke localStorage.
// resetModel menghapus key-nya lagi setelah set (listener jalan sinkron).
useCageStore.subscribe((state, prev) => {
  if (state.cubes !== prev.cubes || state.panelTypes !== prev.panelTypes) {
    saveToLocalStorage(state)
  }
})

// BOM: tally per tipe dari daftar tembok kanonik (sudah dedupe — sekat
// internal dicat terhitung tepat sekali). 'kosong' bukan barang, diabaikan.
export type BomType = Exclude<PanelType, 'kosong'>

export function tallyWallSlots(slots: WallSlot[]): Record<BomType, number> {
  const tally: Record<BomType, number> = { jeruji: 0, pintu: 0, tutup: 0 }
  for (const w of slots) {
    if (w.tipe !== 'kosong') tally[w.tipe]++
  }
  return tally
}

// Selector turunan: satu slot per tembok kanonik.
// - Sisi kepapar (tetangga kosong): satu slot per sisi, default 'jeruji'.
// - Sisi internal (kedua sel terisi): satu tembok fisik = SATU slot,
//   diwakili sisi berarah positif; override dibaca dari kedua sisi
//   (key kanonik menang). Default 'kosong' → interior menyatu.
export function getWallSlots(state: Pick<CageState, 'cubes' | 'panelTypes'>): WallSlot[] {
  const slots: WallSlot[] = []
  for (const k of state.cubes) {
    const [x, y, z] = parseCubeKey(k)
    for (const dir of DIRS) {
      const [dx, dy, dz] = FACE_DIRS[dir]
      const neighborFilled = state.cubes.has(cubeKey(x + dx, y + dy, z + dz))
      if (!neighborFilled) {
        const key = panelKey(x, y, z, dir)
        slots.push({ key, x, y, z, dir, tipe: state.panelTypes.get(key) ?? 'jeruji', internal: false })
      } else if (dir[0] === '+') {
        const key = panelKey(x, y, z, dir)
        const mirror = panelKey(x + dx, y + dy, z + dz, oppositeDir(dir))
        const tipe = state.panelTypes.get(key) ?? state.panelTypes.get(mirror) ?? 'kosong'
        slots.push({ key, x, y, z, dir, tipe, internal: true })
      }
    }
  }
  return slots
}
