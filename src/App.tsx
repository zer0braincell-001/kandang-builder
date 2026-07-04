import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import { DoubleSide, Mesh } from 'three'
import {
  getWallSlots,
  tallyWallSlots,
  useCageStore,
  type BomType,
  type Mode,
  type PanelType,
  type WallSlot,
} from './store'
import { cubeKey, cubeToWorld, panelToWorld, parseCubeKey, type Dir } from './coords'
import { getPanelTextures } from './textures'
import { deserialize, serialize } from './persist'

// Ganti raycast secara eksplisit (bukan undefined) supaya perilaku
// deterministik saat prop berubah antar mode.
const noRaycast = () => null
const defaultRaycast = Mesh.prototype.raycast

// Tap-hold hapus (sentuh): ambang tahan, toleransi geser, dan mulai
// tampilnya indikator sebagai fraksi ambang
const HOLD_MS = 500
const HOLD_MOVE_TOLERANCE_PX = 8
const HOLD_INDICATOR_START = 0.3

function Cube({ id }: { id: string }) {
  const addCube = useCageStore((s) => s.addCube)
  const removeCube = useCageStore((s) => s.removeCube)
  const mode = useCageStore((s) => s.mode)
  // Koordinat kubus datang dari key-nya sendiri (closure),
  // bukan dihitung balik dari posisi dunia mesh.
  const [x, y, z] = parseCubeKey(id)

  // Progres tahan 0..1; pembersihan timer/listener dipegang lewat ref
  // supaya bisa dibatalkan dari mana pun (lepas, geser, unmount)
  const [holdProgress, setHoldProgress] = useState(0)
  const holdCleanup = useRef<(() => void) | null>(null)
  const suppressClick = useRef(false)

  const cancelHold = () => {
    holdCleanup.current?.()
    holdCleanup.current = null
    setHoldProgress(0)
  }

  // Kubus bisa unmount saat masih menahan (hapus berhasil) — bereskan
  useEffect(() => () => holdCleanup.current?.(), [])

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (mode !== 'bangun' || e.nativeEvent.pointerType !== 'touch') return
    suppressClick.current = false
    cancelHold()

    const startX = e.nativeEvent.clientX
    const startY = e.nativeEvent.clientY
    const startTime = performance.now()

    // SATU sumber waktu untuk visual DAN penghapusan: loop yang sama yang
    // menggambar progres juga memicu removeCube saat ambang penuh. Jangan
    // pisah ke setTimeout — pembatalan yang mendarat di sela keduanya
    // (mis. pointercancel dari long-press browser) bikin visual jalan
    // penuh tapi hapus tak pernah tereksekusi.
    let raf = requestAnimationFrame(function tick() {
      const progress = Math.min((performance.now() - startTime) / HOLD_MS, 1)
      setHoldProgress(progress)
      if (progress >= 1) {
        // Hold penuh: hapus, dan telan click yang menyusul saat jari lepas
        suppressClick.current = true
        cancelHold()
        removeCube(id)
        return
      }
      raf = requestAnimationFrame(tick)
    })
    const onMove = (ev: PointerEvent) => {
      // Geser melebihi toleransi = niatnya orbit, bukan hapus
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > HOLD_MOVE_TOLERANCE_PX) {
        cancelHold()
      }
    }
    const onEnd = () => cancelHold()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    holdCleanup.current = () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    // Click susulan setelah hold-hapus: jangan ikut menambah kubus
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (e.shiftKey) {
      removeCube(id)
      return
    }
    if (!e.face) return
    const nx = Math.round(e.face.normal.x)
    const ny = Math.round(e.face.normal.y)
    const nz = Math.round(e.face.normal.z)
    addCube(cubeKey(x + nx, y + ny, z + nz))
  }

  const indicatorOpacity =
    holdProgress > HOLD_INDICATOR_START
      ? 0.15 + 0.45 * ((holdProgress - HOLD_INDICATOR_START) / (1 - HOLD_INDICATOR_START))
      : 0

  return (
    <group position={cubeToWorld(x, y, z)}>
      <mesh
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        raycast={mode === 'bangun' ? defaultRaycast : noRaycast}
      >
        <boxGeometry args={[1, 1, 1]} />
        {/* Tak terlihat tapi tetap raycastable — jangan visible=false,
            itu mematikan raycast dan merusak tambah/hapus kubus */}
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      {holdProgress > 0 && (
        <mesh raycast={noRaycast} scale={1.03}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial
            color="#ff5544"
            transparent
            opacity={indicatorOpacity}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  )
}

// Rotasi supaya normal planeGeometry (default +z) searah dir panel
const DIR_ROTATIONS: Record<Dir, [number, number, number]> = {
  '+x': [0, Math.PI / 2, 0],
  '-x': [0, -Math.PI / 2, 0],
  '+y': [-Math.PI / 2, 0, 0],
  '-y': [Math.PI / 2, 0, 0],
  '+z': [0, 0, 0],
  '-z': [0, Math.PI, 0],
}

function Panel({ panel }: { panel: WallSlot }) {
  const mode = useCageStore((s) => s.mode)
  const selectPanel = useCageStore((s) => s.selectPanel)
  const selected = useCageStore((s) => s.selectedPanel) === panel.key

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    selectPanel(panel.key)
  }

  if (panel.tipe === 'kosong') {
    // Di luar mode cat: kosong benar-benar bersih, tidak dirender.
    if (mode !== 'cat') return null
    // Mode cat: ghost semi-transparan yang tetap raycastable
    // supaya slot kosong (termasuk tembok internal) bisa dicat ulang.
    return (
      <mesh
        position={panelToWorld(panel.x, panel.y, panel.z, panel.dir)}
        rotation={DIR_ROTATIONS[panel.dir]}
        onClick={handleClick}
        raycast={defaultRaycast}
      >
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial
          color="#9fb4c8"
          transparent
          opacity={selected ? 0.35 : 0.18}
          depthWrite={false}
          side={DoubleSide}
          emissive={selected ? '#ffffff' : '#000000'}
          emissiveIntensity={selected ? 0.5 : 0}
          polygonOffset
          polygonOffsetFactor={-1}
        />
      </mesh>
    )
  }

  const highlight = {
    emissive: selected ? '#ffffff' : '#000000',
    emissiveIntensity: selected ? 0.45 : 0,
  } as const

  // Tembok internal berbagi bidang persis dengan dua muka kubus tetangganya;
  // bias depth lebih kuat menjaga stabil dari sudut kamera landai
  const depthBias = {
    polygonOffset: true,
    polygonOffsetFactor: panel.internal ? -2 : -1,
    polygonOffsetUnits: panel.internal ? -2 : 0,
  } as const

  return (
    <mesh
      // Remount saat ganti tipe supaya swap geometry/material selalu bersih
      key={panel.tipe}
      position={panelToWorld(panel.x, panel.y, panel.z, panel.dir)}
      rotation={DIR_ROTATIONS[panel.dir]}
      onClick={handleClick}
      // Interaktif hanya di mode cat; di mode bangun klik menembus ke kubus
      raycast={mode === 'cat' ? defaultRaycast : noRaycast}
    >
      {panel.tipe === 'tutup' ? (
        <>
          {/* Plat solid sedikit tebal, berpusat di bidang muka kubus */}
          <boxGeometry args={[1, 1, 0.06]} />
          <meshStandardMaterial color="#a7b0b8" {...highlight} {...depthBias} />
        </>
      ) : (
        <>
          <planeGeometry args={[1, 1]} />
          <meshStandardMaterial
            map={getPanelTextures()[panel.tipe].map}
            alphaMap={getPanelTextures()[panel.tipe].alphaMap}
            transparent
            alphaTest={0.4}
            side={DoubleSide}
            {...highlight}
            {...depthBias}
          />
        </>
      )}
    </mesh>
  )
}

const uiButton = (active: boolean): CSSProperties => ({
  padding: '6px 14px',
  border: '1px solid ' + (active ? '#8ab4f8' : '#3a3f45'),
  borderRadius: 6,
  background: active ? '#2b4a75' : '#22262b',
  color: active ? '#fff' : '#aab2ba',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 14,
})

const PALETTE: { tipe: PanelType; label: string }[] = [
  { tipe: 'jeruji', label: 'Jeruji' },
  { tipe: 'pintu', label: 'Pintu' },
  { tipe: 'tutup', label: 'Tutup' },
  { tipe: 'kosong', label: 'Kosong' },
]

function saveToFile() {
  const { cubes, panelTypes } = useCageStore.getState()
  const json = JSON.stringify(serialize({ cubes, panelTypes }), null, 2)
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'kandang.json'
  a.click()
  URL.revokeObjectURL(url)
}

function Overlay() {
  const mode = useCageStore((s) => s.mode)
  const setMode = useCageStore((s) => s.setMode)
  const selectedPanel = useCageStore((s) => s.selectedPanel)
  const panelTypes = useCageStore((s) => s.panelTypes)
  const setPanelType = useCageStore((s) => s.setPanelType)
  const loadModel = useCageStore((s) => s.loadModel)
  const resetModel = useCageStore((s) => s.resetModel)
  const fileInput = useRef<HTMLInputElement>(null)

  const openFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Kosongkan supaya file yang sama bisa dibuka ulang
    e.target.value = ''
    if (!file) return
    let model = null
    try {
      model = deserialize(JSON.parse(await file.text()))
    } catch {
      // JSON rusak — jatuh ke pesan tolak di bawah
    }
    if (model === null) {
      alert('File model tidak valid.')
      return
    }
    // localStorage ikut terbarui lewat subscription auto-save
    loadModel(model)
  }

  const selectedType: PanelType | null =
    selectedPanel !== null ? (panelTypes.get(selectedPanel) ?? 'jeruji') : null

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', gap: 6 }}>
        {(['bangun', 'cat'] as Mode[]).map((m) => (
          <button key={m} type="button" style={uiButton(mode === m)} onClick={() => setMode(m)}>
            {m === 'bangun' ? 'Bangun' : 'Cat'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" style={uiButton(false)} onClick={saveToFile}>
          Save
        </button>
        <button type="button" style={uiButton(false)} onClick={() => fileInput.current?.click()}>
          Open
        </button>
        <button type="button" style={uiButton(false)} onClick={resetModel}>
          Reset
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={openFile}
        />
      </div>

      {mode === 'cat' && selectedPanel !== null && (
        <div style={{ display: 'flex', gap: 6 }}>
          {PALETTE.map(({ tipe, label }) => (
            <button
              key={tipe}
              type="button"
              style={uiButton(selectedType === tipe)}
              onClick={() => setPanelType(selectedPanel, tipe)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    setMatches(mql.matches)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

// Layar sempit ATAU perangkat sentuh → BOM pindah ke bawah
const COMPACT_QUERY = '(max-width: 640px), (pointer: coarse)'

const BOM_ROWS: { tipe: BomType; label: string }[] = [
  { tipe: 'jeruji', label: 'Jeruji' },
  { tipe: 'pintu', label: 'Pintu' },
  { tipe: 'tutup', label: 'Tutup' },
]

const rp = (n: number) => 'Rp ' + n.toLocaleString('id-ID')

function Bom({ panels }: { panels: WallSlot[] }) {
  const counts = useMemo(() => tallyWallSlots(panels), [panels])
  const [prices, setPrices] = useState<Record<BomType, number>>({ jeruji: 0, pintu: 0, tutup: 0 })
  const compact = useMediaQuery(COMPACT_QUERY)
  const [open, setOpen] = useState(false)
  const total = BOM_ROWS.reduce((sum, r) => sum + counts[r.tipe] * prices[r.tipe], 0)

  const setPrice = (tipe: BomType) => (e: ChangeEvent<HTMLInputElement>) => {
    const value = Math.max(0, Number(e.target.value) || 0)
    setPrices((p) => ({ ...p, [tipe]: value }))
  }

  // Rincian yang sama untuk kedua layout — hitungan/harga tidak beda jalur
  const detail = (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 34px 100px 1fr', gap: '6px 8px', alignItems: 'center' }}>
        {BOM_ROWS.map(({ tipe, label }) => (
          <div key={tipe} style={{ display: 'contents' }}>
            <span>{label}</span>
            <span style={{ textAlign: 'right' }}>{counts[tipe]}×</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              Rp
              <input
                type="number"
                min={0}
                value={prices[tipe]}
                onChange={setPrice(tipe)}
                style={{
                  width: '100%',
                  padding: '3px 6px',
                  border: '1px solid #3a3f45',
                  borderRadius: 4,
                  background: '#1a1d21',
                  color: '#cdd3d9',
                  font: 'inherit',
                }}
              />
            </span>
            <span style={{ textAlign: 'right' }}>{rp(counts[tipe] * prices[tipe])}</span>
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 10,
          paddingTop: 8,
          borderTop: '1px solid #3a3f45',
          fontWeight: 600,
          color: '#fff',
        }}
      >
        <span>Total</span>
        <span>{rp(total)}</span>
      </div>
    </>
  )

  if (!compact) {
    return (
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          width: 300,
          padding: '12px 14px',
          background: '#22262bee',
          border: '1px solid #3a3f45',
          borderRadius: 8,
          color: '#cdd3d9',
          fontSize: 14,
          userSelect: 'none',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Bill of Materials</div>
        {detail}
      </div>
    )
  }

  // Layar sempit/sentuh: panel bawah buka-tutup. Saat collapsed cuma bar
  // ringkas satu baris — kanvas dapat tinggi maksimal, tombol mode di
  // kiri-atas tidak tertutup.
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        background: '#22262bf5',
        borderTop: '1px solid #3a3f45',
        color: '#cdd3d9',
        fontSize: 14,
        userSelect: 'none',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          background: 'none',
          border: 'none',
          color: 'inherit',
          font: 'inherit',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <span>BOM {open ? '▾' : '▴'}</span>
        <span>{rp(total)}</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 12px', maxHeight: '45vh', overflowY: 'auto' }}>{detail}</div>
      )}
    </div>
  )
}

export default function App() {
  const cubes = useCageStore((s) => s.cubes)
  const panelTypes = useCageStore((s) => s.panelTypes)
  const panels = useMemo(() => getWallSlots({ cubes, panelTypes }), [cubes, panelTypes])

  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%' }}
      // Long-press sentuh memicu contextmenu browser (lalu pointercancel
      // di Android) yang membatalkan tap-hold tepat di ambang — cegah.
      // Bonus: right-drag pan desktop tak lagi memunculkan menu klik kanan.
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas camera={{ position: [4, 4, 6], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 10, 7]} intensity={1.2} />

        {[...cubes].map((key) => (
          <Cube key={key} id={key} />
        ))}
        {panels.map((p) => (
          <Panel key={p.key} panel={p} />
        ))}

        <Grid infiniteGrid cellSize={1} sectionSize={5} fadeDistance={40} />
        <OrbitControls makeDefault />
      </Canvas>
      <Overlay />
      <Bom panels={panels} />
    </div>
  )
}
