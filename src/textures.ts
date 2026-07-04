// Tekstur panel dibangun sekali via canvas 2D, di-cache module-level.
// map = warna (latar sel transparan), alphaMap = coverage yang sama
// dalam grayscale (diturunkan dari kanal alpha map, jadi selalu sejajar).

import { CanvasTexture, SRGBColorSpace } from 'three'

const SIZE = 256
const CELLS = 9
// Kawat terang supaya kontras di background gelap
const WIRE_COLOR = '#dde3e8'
// Kawat pintu: sama terangnya, tapi ber-tint amber supaya beda sekilas
const DOOR_WIRE_COLOR = '#f0cc96'
const WIRE_WIDTH = 5
const DOOR_COLOR = '#f09b3e'

function drawGrid(ctx: CanvasRenderingContext2D, color: string = WIRE_COLOR) {
  const step = SIZE / CELLS
  ctx.strokeStyle = color
  ctx.lineWidth = WIRE_WIDTH
  ctx.beginPath()
  for (let i = 0; i <= CELLS; i++) {
    // Garis tepi di-clamp ke dalam supaya bingkai tidak terpotong setengah
    const p = Math.min(Math.max(i * step, WIRE_WIDTH / 2), SIZE - WIRE_WIDTH / 2)
    ctx.moveTo(p, 0)
    ctx.lineTo(p, SIZE)
    ctx.moveTo(0, p)
    ctx.lineTo(SIZE, p)
  }
  ctx.stroke()
}

function drawDoor(ctx: CanvasRenderingContext2D) {
  drawGrid(ctx, DOOR_WIRE_COLOR)
  // Daun pintu: persegi lebih kecil berbingkai lebih tebal
  const inset = SIZE * 0.2
  ctx.strokeStyle = DOOR_COLOR
  ctx.lineWidth = 12
  ctx.strokeRect(inset, inset, SIZE - 2 * inset, SIZE - 2 * inset)
  // Tanda engsel di sisi kiri (hingeSide masih stub — posisi tetap dulu)
  ctx.fillStyle = DOOR_COLOR
  const hw = 14
  const hh = 24
  const hx = inset - hw
  ctx.fillRect(hx, SIZE * 0.28, hw, hh)
  ctx.fillRect(hx, SIZE * 0.72 - hh, hw, hh)
}

// Salin kanal alpha jadi grayscale (alphaMap three.js membaca kanal hijau)
function alphaCanvasFrom(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const image = src.getContext('2d')!.getImageData(0, 0, src.width, src.height)
  const d = image.data
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]
    d[i] = d[i + 1] = d[i + 2] = a
    d[i + 3] = 255
  }
  out.getContext('2d')!.putImageData(image, 0, 0)
  return out
}

export interface PanelTexture {
  map: CanvasTexture
  alphaMap: CanvasTexture
}

function build(draw: (ctx: CanvasRenderingContext2D) => void): PanelTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  draw(canvas.getContext('2d')!)
  const map = new CanvasTexture(canvas)
  map.colorSpace = SRGBColorSpace
  const alphaMap = new CanvasTexture(alphaCanvasFrom(canvas))
  return { map, alphaMap }
}

let cache: { jeruji: PanelTexture; pintu: PanelTexture } | null = null

export function getPanelTextures() {
  if (!cache) {
    cache = { jeruji: build(drawGrid), pintu: build(drawDoor) }
  }
  return cache
}
