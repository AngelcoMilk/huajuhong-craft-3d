import { Quaternion, Vector2, Vector3 } from 'three'
import { rng } from '../util'
import { BASKET_SLOTS, BATCH, POUR_ORDER, STRAINER_SLOTS } from './batch'
import { STRAINER_DEPTH, STRAINER_R } from './stove'
import type { TaiBatch } from './tai'

// 一批整果怎么摆：篮里、倒进锅的先后、浮在锅里、分几勺捞、勺里、摊在焙炉竹筛上。
// 七爪、大五爪、压果片是十个大果（原来那一套位置，一点没动）；橘红胎是三十个大小不一的小果，位置按"往下落、挤不下就叠上去"现排。

export interface FruitSet {
  readonly count: number
  setFruit(i: number, center: Vector3, q: Quaternion): void
  show(on: boolean): void
  /** 第 i 个（≥1）果自己固定的朝向 */
  rot(i: number): Quaternion
}

export interface FruitLayout {
  count: number
  /** 第 i 个果放在平面上时果心离平面多高 */
  lift(i: number): number
  /** 篮里的果心（篮子本地坐标） */
  basket: Vector3[]
  /** 倒进锅的先后（只有要烫的） */
  pour: number[]
  /** 浮在锅里的位置（相对锅心，xz） */
  float: Vector2[]
  /** 摊在焙炉竹筛上的位置（相对焙炉中心，xz） */
  sieve: Vector2[]
  /** 几勺，各捞哪几个 */
  scoops: number[][]
  /** 摊在竹筛上时的朝向（不给就是落下来什么样就什么样） */
  restRot?: (i: number) => Quaternion
  /** 在一勺里排第 g 个（这一勺共 n 个）的第 i 个果，在笊篱本地坐标里的果心 */
  strainer(n: number, g: number, i: number, out: Vector3): Vector3
}

/**
 * 十个大果：篮里、倒的先后、笊篱里的位置照原来那一套；
 * 锅里漂着、竹筛上摊开的位置随手散开（不排成一圈一圈），分三勺按锅里挨得近的捞。
 */
export function bigLayout(R: number): FruitLayout {
  const radii = Array.from({ length: BATCH }, () => R)
  const order = Array.from({ length: BATCH }, (_, i) => i)
  const float = scatter(radii, order, (x, z, r) => Math.hypot(x, z) + r < 22.5, 23, 1.3, 5, new Vector2(1.5, 1))
  const sieve = scatter(radii, order, (x, z, r) => Math.hypot(x, z) + r < 31, 31, 1.4, 7, new Vector2(2, 3))
  // 三勺：主角那一勺带上离它最近的三个，第二勺从剩下的里挑挨在一起的三个，其余第三勺
  const near = (from: number, pool: number[], k: number) => [...pool].sort((a, b) => float[a].distanceTo(float[from]) - float[b].distanceTo(float[from])).slice(0, k)
  const rest0 = order.filter((i) => i !== 0)
  const s1 = [0, ...near(0, rest0, 3)]
  const rest1 = rest0.filter((i) => !s1.includes(i))
  const far = [...rest1].sort((a, b) => float[b].distanceTo(float[0]) - float[a].distanceTo(float[0]))[0]
  const s2 = [far, ...near(far, rest1.filter((i) => i !== far), 2)]
  const s3 = rest1.filter((i) => !s2.includes(i))
  return {
    count: BATCH,
    lift: () => R,
    basket: BASKET_SLOTS,
    pour: POUR_ORDER,
    float,
    sieve,
    scoops: [s1, s2, s3],
    strainer: (n, g, _i, out) => out.copy(STRAINER_SLOTS[n][g]),
  }
}

/** 笊篱兜底（椭圆的四分之一转出来）在离中心 h 处的高度 */
function bowlY(h: number) {
  const x = Math.min(0.98, h / STRAINER_R)
  return STRAINER_DEPTH * (1 - Math.sqrt(1 - x * x))
}

/** 篮子内壁在高度 y 处的半径（和 table.ts 里篮子的轮廓一致） */
function basketWall(y: number) {
  const prof: [number, number][] = [
    [0, 13],
    [1.5, 14.6],
    [9, 17.2],
    [12, 18],
  ]
  for (let i = 1; i < prof.length; i++) {
    const [y0, r0] = prof[i - 1]
    const [y1, r1] = prof[i]
    if (y <= y1) return r0 + ((r1 - r0) * Math.max(0, y - y0)) / (y1 - y0)
  }
  return 18
}

/** 往一堆里放一个半径 r 的果：在候选点里挑落下去最低的那个（落在底上，或者搁在别的果上） */
export function drop(placed: { p: Vector3; r: number }[], r: number, cands: Vector2[], floorY: number, fits: (x: number, z: number, y: number) => boolean) {
  let best: Vector3 | null = null
  for (const c of cands) {
    let y = floorY + r
    for (const q of placed) {
      const d = Math.hypot(c.x - q.p.x, c.y - q.p.z)
      const s = r + q.r + 0.05
      if (d < s) y = Math.max(y, q.p.y + Math.sqrt(s * s - d * d))
    }
    if (!fits(c.x, c.y, y)) continue
    if (!best || y < best.y - 1e-6) best = new Vector3(c.x, y, c.y)
  }
  return best
}

/** 平面上不重叠地撒开（半径各不同），区域由 inside 定 */
function scatter(radii: number[], order: number[], inside: (x: number, z: number, r: number) => boolean, extent: number, gap: number, seed: number, first?: Vector2): Vector2[] {
  // 随手撒，撒不下就换一把重撒（种子固定，每次结果一样）
  for (let k = 0; k < 40; k++) {
    const out = scatterOnce(radii, order, inside, extent, gap, seed + k * 101, first)
    if (out) return out
  }
  throw new Error('摆不下')
}

function scatterOnce(radii: number[], order: number[], inside: (x: number, z: number, r: number) => boolean, extent: number, gap: number, seed: number, first?: Vector2) {
  const r = rng(seed)
  const out: Vector2[] = []
  const placed: { x: number; z: number; r: number }[] = []
  for (const i of order) {
    let ok: Vector2 | null = null
    for (let tries = 0; tries < 4000 && !ok; tries++) {
      const c = tries === 0 && first && i === order[0] ? first.clone() : new Vector2((r() * 2 - 1) * extent, (r() * 2 - 1) * extent)
      if (!inside(c.x, c.y, radii[i])) continue
      if (placed.every((q) => Math.hypot(q.x - c.x, q.z - c.y) > q.r + radii[i] + gap)) ok = c
    }
    if (!ok) return null
    out[i] = ok
    placed.push({ x: ok.x, z: ok.y, r: radii[i] })
  }
  return out
}

/** 三十个小果：一半烫、一半直接烘 */
export function taiLayout(b: TaiBatch): FruitLayout {
  const n = b.count
  const rad = (i: number) => b.radius[i] * b.stretch[i]
  const radii = Array.from({ length: n }, (_, i) => b.radius[i])
  // 篮里：大的先放，落在最低处；主角最后放在靠镜头那边的上面
  const r = rng(71)
  const placed: { p: Vector3; r: number }[] = []
  const basket: Vector3[] = []
  const order = Array.from({ length: n - 1 }, (_, i) => i + 1).sort((a, c) => radii[c] - radii[a])
  const fits = (rr: number) => (x: number, z: number, y: number) => Math.hypot(x, z) + rr < basketWall(y) - 0.4 && y < 11
  for (const i of [...order, 0]) {
    const cands: Vector2[] = []
    if (i === 0) for (let k = 0; k < 60; k++) cands.push(new Vector2(3.2 + (r() - 0.5) * 3, 5.4 + (r() - 0.5) * 3))
    else for (let k = 0; k < 160; k++) cands.push(new Vector2((r() * 2 - 1) * 14, (r() * 2 - 1) * 14))
    const p = drop(placed, rad(i), cands, 0.06, fits(rad(i)))
    if (!p) throw new Error('篮里放不下')
    placed.push({ p, r: rad(i) })
    basket[i] = p
  }
  const blanched = Array.from({ length: n }, (_, i) => i).filter((i) => b.blanched[i])
  const raw = Array.from({ length: n }, (_, i) => i).filter((i) => !b.blanched[i])
  // 倒的先后：篮子朝 -x 倒，靠 -x 的、上面的先出来
  const pour = [...blanched].sort((a, c) => basket[a].x - basket[a].y * 0.3 - (basket[c].x - basket[c].y * 0.3))
  // 锅里：主角在正中，其余的散开
  const float = scatter(radii, [0, ...blanched.filter((i) => i > 0)], (x, z, rr) => Math.hypot(x, z) + rr < 17, 17, 0.5, 81, new Vector2(0, 0))
  // 焙炉竹筛：直接烘的摊在左半边（-x），烫过的摊在右半边，中间空一道
  const sieve: Vector2[] = []
  const left = scatter(radii, raw, (x, z, rr) => x < -2.2 - rr && Math.hypot(x, z) + rr < 30.5, 31, 0.7, 91)
  const right = scatter(radii, blanched, (x, z, rr) => x > 2.2 + rr && Math.hypot(x, z) + rr < 30.5, 31, 0.7, 93, new Vector2(12, 8))
  for (const i of raw) sieve[i] = left[i]
  for (const i of blanched) sieve[i] = right[i]
  // 两勺：主角那一勺八个，按锅里离主角近的挑
  const others = blanched.filter((i) => i > 0).sort((a, c) => float[a].length() - float[c].length())
  const s1 = [0, ...others.slice(0, 7)]
  const s2 = others.slice(7)
  const ringR = (k: number) => (k >= 8 ? 5.0 : 4.6)
  return {
    count: n,
    lift: (i) => b.lift(i),
    basket,
    pour,
    float,
    sieve,
    scoops: [s1, s2],
    // 侧躺着，果蒂朝旁边（不扎进竹筛）
    restRot: (i) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), i * 1.3).multiply(b.rot(i)),
    strainer: (cnt, g, i, out) => {
      if (g === 0) return out.set(0, bowlY(0) + rad(i) + 0.08, 0)
      const a = ((g - 1) / (cnt - 1)) * Math.PI * 2 + 0.3
      const h = ringR(cnt)
      return out.set(Math.cos(a) * h, bowlY(h) + rad(i) * 1.04 + 0.12, Math.sin(a) * h)
    },
  }
}
