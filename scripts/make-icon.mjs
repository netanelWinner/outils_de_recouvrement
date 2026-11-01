// Génère build/icon.ico (16 → 256 px) sans dépendance : carré arrondi vert-bleu,
// document blanc et pastille dorée (« facture encaissée »).
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size, size)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// Dessin vectoriel simple, échantillonné (anticrénelage 4×4)
function sample(u, v) {
  const inRound = (x, y, x0, y0, x1, y1, r) => {
    const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r)
    return x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
  if (!inRound(u, v, 0.04, 0.04, 0.96, 0.96, 0.2)) return null
  // Pastille dorée avec coche blanche
  if ((u - 0.7) ** 2 + (v - 0.7) ** 2 < 0.17 ** 2) {
    const seg = (ax, ay, bx, by) => {
      const t = Math.max(0, Math.min(1, ((u - ax) * (bx - ax) + (v - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
      return Math.hypot(u - (ax + t * (bx - ax)), v - (ay + t * (by - ay)))
    }
    if (Math.min(seg(0.62, 0.71, 0.68, 0.77), seg(0.68, 0.77, 0.79, 0.63)) < 0.028) return [255, 255, 255]
    return [245, 176, 20]
  }
  // Document blanc avec lignes
  if (inRound(u, v, 0.24, 0.18, 0.66, 0.8, 0.04)) {
    for (const ly of [0.32, 0.43, 0.54]) if (v > ly && v < ly + 0.045 && u > 0.31 && u < (ly === 0.54 ? 0.5 : 0.59)) return [15, 118, 110]
    return [255, 255, 255]
  }
  const t = v // dégradé vertical
  return [Math.round(15 + (19 - 15) * t), Math.round(118 - 40 * t), Math.round(110 - 36 * t)]
}

function pixel(x, y, size) {
  let r = 0, g = 0, b = 0, a = 0
  const n = 4
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const c = sample(x + (i + 0.5) / (n * size), y + (j + 0.5) / (n * size))
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++ }
    }
  return a ? [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((a / (n * n)) * 255)] : [0, 0, 0, 0]
}

const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = sizes.map((s) => png(s, pixel))
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
let offset = 6 + 16 * sizes.length
const dir = sizes.map((s, i) => {
  const e = Buffer.alloc(16)
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e[2] = 0; e[3] = 0
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
  e.writeUInt32LE(images[i].length, 8); e.writeUInt32LE(offset, 12)
  offset += images[i].length
  return e
})
mkdirSync('build', { recursive: true })
writeFileSync('build/icon.ico', Buffer.concat([header, ...dir, ...images]))
writeFileSync('build/icon.png', images[images.length - 1])
console.log('build/icon.ico et build/icon.png générés')
