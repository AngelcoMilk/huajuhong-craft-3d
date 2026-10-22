import type { LineId } from '../lines/types'
import { rng } from '../util'

// 入口页四条屏上的成品白描：每一根线都是算出来的（不用图片）。
// 每条线 pathLength=1，悬停时按 --d 的先后一笔笔勾出来；带底色的块晚一点铺上，把后面的线盖住。

interface Stroke {
  d: string
  /** 线宽 */
  w: number
  /** 底色：paper 正面、back 内面（暗一点），不给就不铺 */
  fill?: 'paper' | 'back'
  /** 淡一点的线 */
  soft?: boolean
  /** 红头绳 */
  red?: boolean
}

const n = (x: number) => x.toFixed(1)
const P = (cx: number, cy: number, r: number, a: number) => `${n(cx + r * Math.cos(a))} ${n(cy - r * Math.sin(a))}`
const dot = (x: number, y: number, r: number) => `M${n(x - r)} ${n(y)}a${r} ${r} 0 1 0 ${n(2 * r)} 0a${r} ${r} 0 1 0 ${n(-2 * r)} 0`
const rad = (deg: number) => (deg * Math.PI) / 180

/** 一闭合曲线：半径随角度变（r(θ)），用折线逼近 */
function blob(cx: number, cy: number, r: (a: number) => number, steps = 72, sx = 1, sy = 1) {
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const rr = r(a)
    d += `${i ? 'L' : 'M'}${n(cx + Math.cos(a) * rr * sx)} ${n(cy - Math.sin(a) * rr * sy)}`
  }
  return d + 'Z'
}

/** 对折压平的扇形：七爪 7 瓣、五爪 5 瓣（瓣尖折回，看上去是截角） */
function fan(petals: number, cut: boolean): Stroke[] {
  const out: Stroke[] = []
  const cx = 100
  const cy = 146
  const R = 112
  // 一扎十片：底下再错开描两道外廓
  for (const dy of [9, 4.5]) out.push({ d: `M${n(cx - R * 0.97)} ${n(cy + dy)}A${R} ${R * 0.98} 0 0 1 ${n(cx + R * 0.97)} ${n(cy + dy)}`, w: 1.1, soft: true })
  const a0 = cut ? 22 : 13
  const a1 = 180 - a0
  const step = (a1 - a0) / (petals - 1)
  const w = rad(step) * 0.62
  const lobe = (deg: number, front: boolean) => {
    const a = rad(deg)
    const r0 = 12
    const Rr = front ? R : R * 0.93
    const left = `M${P(cx, cy, r0, a + w)}C${P(cx, cy, Rr * 0.42, a + w * 1.18)} ${P(cx, cy, Rr * 0.84, a + w * 0.82)} `
    if (cut) {
      const t1 = P(cx, cy, Rr * 0.95, a + w * 0.3)
      const t2 = P(cx, cy, Rr * 0.95, a - w * 0.3)
      return `${left}${t1}L${t2}C${P(cx, cy, Rr * 0.84, a - w * 0.82)} ${P(cx, cy, Rr * 0.42, a - w * 1.18)} ${P(cx, cy, r0, a - w)}Z`
    }
    const tip = P(cx, cy, Rr, a)
    return `${left}${tip}C${P(cx, cy, Rr * 0.84, a - w * 0.82)} ${P(cx, cy, Rr * 0.42, a - w * 1.18)} ${P(cx, cy, r0, a - w)}Z`
  }
  // 内面那一层（错开半瓣）先画，外皮那一层盖在上面
  for (let i = 1; i < petals; i += 2) out.push({ d: lobe(a0 + i * step, false), w: 1.5, fill: 'back', soft: true })
  const r = rng(petals * 31)
  for (let i = 0; i < petals; i += 2) {
    const deg = a0 + i * step
    out.push({ d: lobe(deg, true), w: 2.1, fill: 'paper' })
    // 外皮上的油点
    let dots = ''
    for (const k of [0.38, 0.52, 0.66, 0.78]) {
      const a = rad(deg) + (r() - 0.5) * w * 0.7
      const [x, y] = P(cx, cy, R * k, a).split(' ').map(Number)
      dots += dot(x, y, 1.1 + r() * 0.6)
    }
    out.push({ d: dots, w: 1, soft: true })
  }
  // 折痕：整片对折的那条直边
  out.push({ d: `M${n(cx - R * 0.99)} ${cy}Q${cx} ${cy + 3} ${n(cx + R * 0.99)} ${cy}`, w: 2.4 })
  // 根上红头绳打的结
  out.push({ d: `${dot(cx, cy - 5, 4.2)}M${cx - 2} ${cy - 1.5}q-6 9 -12 12M${cx + 2} ${cy - 1.5}q5 8 13 10`, w: 1.8, red: true })
  return out
}

/** 压果片：三片叠着，外皮一圈、白瓤一圈、压实的果肉上几道裂纹 */
function slices(): Stroke[] {
  const out: Stroke[] = []
  const list = [
    { x: 70, y: 98, R: 44, seed: 3 },
    { x: 118, y: 74, R: 42, seed: 7 },
    { x: 128, y: 120, R: 40, seed: 11 },
  ]
  for (const s of list) {
    const r = rng(s.seed)
    const p1 = r() * 6
    const p2 = r() * 6
    const edge = (k: number) => (a: number) => s.R * k * (1 + 0.045 * Math.sin(3 * a + p1) + 0.03 * Math.sin(5 * a + p2))
    out.push({ d: blob(s.x, s.y, edge(1), 72, 1, 0.94), w: 2.1, fill: 'paper' })
    out.push({ d: blob(s.x, s.y, edge(0.9), 72, 1, 0.94), w: 1.1, soft: true })
    const wav = (a: number) => edge(0.7)(a) * (1 + 0.05 * Math.sin(9 * a + p2))
    out.push({ d: blob(s.x, s.y, wav, 90, 1, 0.94), w: 1.4 })
    let cracks = ''
    const nc = 6 + Math.floor(r() * 3)
    for (let i = 0; i < nc; i++) {
      const a = (i / nc) * Math.PI * 2 + r() * 0.5
      const r0 = s.R * (0.08 + r() * 0.08)
      const r1 = s.R * (0.36 + r() * 0.22)
      const bend = (r() - 0.5) * 0.4
      cracks += `M${P(s.x, s.y, r0, a)}Q${P(s.x, s.y, (r0 + r1) / 2, a + bend)} ${P(s.x, s.y, r1, a + bend * 0.5)}`
    }
    out.push({ d: cracks, w: 1, soft: true })
  }
  return out
}

/** 橘红胎：小圆果，果蒂明显、顶部稍凹，一身白绒 */
function fruit(): Stroke[] {
  const out: Stroke[] = []
  const one = (cx: number, cy: number, R: number, seed: number, front: boolean) => {
    const dip = (a: number) => R * (1 - 0.09 * Math.exp(-(((a - Math.PI / 2) / 0.28) ** 2)) + 0.012 * Math.sin(7 * a + seed))
    out.push({ d: blob(cx, cy, dip, 90, 1.04, 0.95), w: front ? 2.1 : 1.6, fill: 'paper', soft: !front })
    // 果蒂：一圈小托盘 + 一截蒂
    const top = cy - R * 0.95 * 0.91
    out.push({ d: `M${n(cx - 6)} ${n(top + 1)}Q${cx} ${n(top + 4.5)} ${n(cx + 6)} ${n(top + 1)}M${cx} ${n(top + 2)}q1 -7 5 -11`, w: front ? 1.8 : 1.3 })
    // 绒毛：沿着轮廓往外一根根短毛
    const r = rng(seed)
    let fuzz = ''
    const nf = front ? 64 : 40
    for (let i = 0; i < nf; i++) {
      const a = (i / nf) * Math.PI * 2 + r() * 0.05
      const rr = dip(a)
      const tilt = (r() - 0.5) * 0.25
      const x0 = cx + Math.cos(a) * rr * 1.04
      const y0 = cy - Math.sin(a) * rr * 0.95
      const l = 2.4 + r() * 2.6
      fuzz += `M${n(x0)} ${n(y0)}l${n(Math.cos(a + tilt) * l)} ${n(-Math.sin(a + tilt) * l)}`
    }
    out.push({ d: fuzz, w: 0.8, soft: true })
    if (front) {
      // 左上一道受光的弧
      out.push({ d: `M${P(cx, cy, R * 0.72, rad(160))}A${R * 0.72} ${R * 0.68} 0 0 1 ${P(cx, cy, R * 0.72, rad(112))}`, w: 1, soft: true })
    }
  }
  one(66, 116, 30, 5, false)
  one(114, 98, 48, 9, true)
  out.push({ d: 'M20 152Q100 147 182 151', w: 1.2, soft: true })
  return out
}

const ART: Record<LineId, () => Stroke[]> = {
  qizhua: () => fan(7, false),
  wuzhua: () => fan(5, true),
  yaguo: slices,
  tai: fruit,
}

/** 一幅白描的 SVG：线按先后编号（--d），悬停时依次勾出 */
export function productArt(id: LineId) {
  const strokes = ART[id]()
  const total = 1.5
  const step = total / Math.max(1, strokes.length)
  const paths = strokes
    .map((s, i) => {
      const cls = [s.fill ? 'f-' + s.fill : '', s.soft ? 'soft' : '', s.red ? 'red' : ''].filter(Boolean).join(' ')
      return `<path d="${s.d}" pathLength="1" class="${cls}" style="--d:${(0.15 + i * step).toFixed(2)}s;stroke-width:${s.w}"/>`
    })
    .join('')
  return `<svg class="art" viewBox="0 0 200 170" aria-hidden="true">${paths}</svg>`
}
