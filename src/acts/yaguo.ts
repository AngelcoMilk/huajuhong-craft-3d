import { Group, InstancedMesh, Matrix4, Mesh, Object3D, Plane, Quaternion, Vector3, type BufferGeometry } from 'three'
import type { AddSound } from '../audio/sound'
import type { AddShot } from '../camera'
import type { LightName } from '../gfx/env'
import type { Stage } from '../stage'
import { clamp, hop, keys, lerp, rng, seg, smooth, smoother, smoothstep } from '../util'
import { cakeShape, sliceGeometry } from '../world/cake'
import { CUTTER } from '../world/cutter'
import { LAYOUT } from '../world/layout'
import { Act } from './act'
import { placePress, pressSounds, type PressCue } from './press'

// 压果片：烫过的整果压扁（压一夜、半夜翻一次），上焙炉烘，再压一回，用切药刀切成 2～4 毫米的片，摊在簸箕里。
// 资料：木板 + 重物压一夜，中途翻一次；压扁成形是压果；切片 2～4 mm，个人做法用手工刀（菜刀或中药切药刀）。

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
const UP = new Vector3(0, 1, 0)
const XAX = new Vector3(1, 0, 0)
const ZAX = new Vector3(0, 0, 1)

/** 十个压果在压板底板上的位置：后排四个、中间三个、前排三个，错开一点；0 是主角（前排正中） */
const PRESS_SLOTS: { x: number; z: number; yaw: number }[] = (() => {
  const r = rng(301)
  const j = () => (r() - 0.5) * 1.1
  const s: { x: number; z: number; yaw: number }[] = [{ x: 0, z: 14, yaw: 0.4 }]
  for (const x of [-14, 14]) s.push({ x: x + j(), z: 14 + j(), yaw: r() * 6.28 })
  for (const x of [-14, 0, 14]) s.push({ x: x + j(), z: j(), yaw: r() * 6.28 })
  for (const x of [-21, -7, 7, 21]) s.push({ x: x + j() * 0.6, z: -14 + j(), yaw: r() * 6.28 })
  return s
})()

/** 焙炉竹筛上：正中一个（主角），外面一圈九个 */
const OVEN_SLOTS: { x: number; z: number; yaw: number }[] = (() => {
  const r = rng(303)
  const s = [{ x: 0, z: 0, yaw: 0.2 }]
  for (let k = 0; k < 9; k++) {
    const a = ((10 + 40 * k) * Math.PI) / 180 + (r() - 0.5) * 0.12
    const rr = 20 + (r() - 0.5) * 1.6
    s.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, yaw: r() * 6.28 })
  }
  return s
})()

/** 第 i 个压果的朝向：只绕竖轴转，翻过面就再绕 x 转半圈 */
function cakeQ(yaw: number, flip: number, out: Quaternion) {
  return out.setFromAxisAngle(UP, yaw).premultiply(new Quaternion().setFromAxisAngle(XAX, flip * Math.PI))
}

// ———— 压果（一夜）/ 复压 ————

export class PressCakes extends Act {
  private night: boolean
  private cues: PressCue[]
  private q = new Quaternion()

  constructor(s: Stage, night: boolean, id: string) {
    super(s, id, night ? 38 : 18)
    this.night = night
    const gap = (t: number) => 2 * cakeShape(this.pressAt(t)).b + 0.04
    this.cues = night
      ? [
          { board: [3, 4.6, 5.4, 14.6, 15.4, 16.6], stone: [5.6, 7.0, 13.4, 14.6], gap },
          { board: [18.8, 20.2, 21.0, 30.2, 31.0, 32.2], stone: [21.2, 22.4, 29.0, 30.2], gap },
        ]
      : [{ board: [1.5, 3.0, 3.8, 12.2, 13.0, 14.2], stone: [4.0, 5.2, 11.0, 12.2], gap }]
  }

  /** 压到什么程度：一夜那回从整果压到扁饼；复压那回再压实一点 */
  private pressAt(t: number) {
    if (!this.night) return keys(t, [[3.4, 1], [3.8, 1.04], [5.2, 1.04], [6.2, 1.08]])
    return keys(t, [
      [5.0, 0],
      [5.4, 0.45],
      [7.0, 0.45],
      [7.5, 0.56],
      [14.6, 0.8],
      [20.6, 0.8],
      [21.0, 0.86],
      [22.4, 0.88],
      [30, 1],
    ])
  }
  /** 半夜翻面（每个错开一点） */
  private flipAt(i: number, t: number) {
    if (!this.night) return 0
    return smoother(seg(t, 16.8 + i * 0.12, 17.6 + i * 0.12))
  }
  private nightAt(t: number) {
    return this.night ? smoothstep(7, 10, t) * (1 - smoothstep(28, 32, t)) : 0
  }

  lights(): [number, LightName][] {
    return this.night
      ? [
          [0, 'golden'],
          [5, 'dusk'],
          [10, 'night'],
          [27, 'night'],
          [32, 'morning'],
          [38, 'forenoon'],
        ]
      : [
          [0, 'afternoon'],
          [17, 'afternoon'],
        ]
  }

  carry(t: number) {
    const s = this.s
    if (t < 0) return
    s.look.press = Math.max(s.look.press, this.pressAt(t))
    s.look.wet *= 1 - smoothstep(6, 26, t)
    if (t < this.dur) {
      const n = this.nightAt(t)
      s.carry.bulb = Math.max(s.carry.bulb, n)
      s.carry.interior = Math.max(s.carry.interior, n)
    }
    s.carry.fireLow = true
    if (this.night) s.carry.lapse = Math.max(s.carry.lapse, 900 * smoothstep(5, 33, t))
  }

  shots(add: AddShot) {
    const L = LAYOUT
    const s = this.s
    const pr = v(L.press.x, L.press.y + 4, L.press.z)
    if (this.night) {
      add(0, 7.6, { target: pr, dist: 96, az: 30, el: 30, fov: 30, ap: 0.12 }, { target: pr, dist: 86, az: 38, el: 32, fov: 30, ap: 0.13 })
      add(7.6, 14.6, { target: v(pr.x - 10, pr.y + 6, pr.z + 4), dist: 150, az: 42, el: 24, fov: 34, ap: 0.08 }, { target: v(pr.x - 10, pr.y + 6, pr.z + 4), dist: 136, az: 50, el: 26, fov: 34, ap: 0.08 }, 1.4)
      add(14.6, 21.4, { target: pr, dist: 82, az: 20, el: 40, fov: 30, ap: 0.12 }, { target: pr, dist: 76, az: 12, el: 42, fov: 30, ap: 0.13 }, 1.2)
      add(21.4, 31.6, { target: v(pr.x - 10, pr.y + 6, pr.z + 4), dist: 140, az: 54, el: 26, fov: 34, ap: 0.08 }, { target: v(pr.x - 10, pr.y + 6, pr.z + 4), dist: 128, az: 46, el: 28, fov: 34, ap: 0.08 }, 1.4)
      add(31.6, 38, { target: s.fruitCenter, dist: 34, az: 14, el: 34, fov: 30, ap: 0.32 }, { target: s.fruitCenter, dist: 27, az: 30, el: 28, fov: 30, ap: 0.36 }, 1.2)
    } else {
      add(0, 12.6, { target: pr, dist: 92, az: 26, el: 30, fov: 30, ap: 0.12 }, { target: pr, dist: 82, az: 36, el: 32, fov: 30, ap: 0.13 })
      add(12.6, 18, { target: s.fruitCenter, dist: 32, az: 20, el: 36, fov: 30, ap: 0.32 }, { target: s.fruitCenter, dist: 27, az: 4, el: 32, fov: 30, ap: 0.36 }, 1.2)
    }
  }

  sounds(add: AddSound) {
    const L = LAYOUT
    for (const c of this.cues) pressSounds(add, c)
    if (!this.night) return
    const at = v(L.press.x, L.press.y + 3, L.press.z)
    // 整果压扁；半夜掀开一个个翻面，落回板上
    add(5.05, 'squish', { dur: 1.5, gain: 0.4, at })
    add(20.7, 'squish', { dur: 0.8, gain: 0.18, at })
    for (let i = 0; i < 10; i++) add(17.6 + i * 0.12 - 0.02, 'thud', { gain: 0.28, pitch: 1.1, at })
  }

  pose(t: number) {
    const s = this.s
    const L = LAYOUT
    const c = s.w.cakes!
    const p = this.pressAt(t)
    const lift = cakeShape(p).b + 0.03
    const pos = new Vector3()
    for (let i = 0; i < 10; i++) {
      const sl = PRESS_SLOTS[i]
      const f = this.flipAt(i, t)
      pos.set(L.press.x + sl.x, L.press.y + lift + Math.sin(Math.PI * f) * 7.5, L.press.z + sl.z)
      cakeQ(sl.yaw, f, this.q)
      if (i === 0) {
        s.setHeroByCenter(pos, this.q)
        s.applyHero()
      } else c.setFruit(i, pos, this.q)
    }
    c.show(true)
    placePress(s, t, this.cues.length > 1 && t > 17.7 ? this.cues[1] : this.cues[0])
  }
}

// ———— 烘 ————

export class CakeOven extends Act {
  private q = new Quaternion()

  constructor(s: Stage, id = 'cakeOven') {
    super(s, id, 28)
  }

  lights(): [number, LightName][] {
    return [
      [0, 'forenoon'],
      [14, 'noon'],
      [27, 'afternoon'],
    ]
  }

  carry(t: number) {
    const s = this.s
    const c = s.carry
    if (t < 0) return
    s.look.dry = Math.max(s.look.dry, smoothstep(2, 24, t))
    if (t < this.dur) {
      c.ovenOn = Math.max(c.ovenOn, smoothstep(0, 1.5, t))
      c.haze = Math.max(c.haze, smoothstep(0.5, 2.5, t) * (1 - smoothstep(this.dur - 1, this.dur, t)) * 0.8)
      c.bloom = 0.32
    }
  }

  shots(add: AddShot) {
    const L = LAYOUT
    const s = this.s
    const O = v(L.oven.x, L.ovenTop + 1, L.oven.z)
    add(0, 10, { target: O, dist: 112, az: 18, el: 32, fov: 32, ap: 0.09 }, { target: O, dist: 98, az: 28, el: 34, fov: 32, ap: 0.1 })
    add(10, 19, { target: s.fruitCenter, dist: 32, az: 24, el: 40, fov: 30, ap: 0.3 }, { target: s.fruitCenter, dist: 26, az: 8, el: 44, fov: 30, ap: 0.34 }, 1.2)
    add(19, 28, { target: O, dist: 72, az: -4, el: 50, fov: 32, ap: 0.12 }, { target: O, dist: 64, az: 10, el: 52, fov: 32, ap: 0.13 }, 1.2)
  }

  sounds(add: AddSound) {
    const L = LAYOUT
    const at = v(L.oven.x, L.ovenTop, L.oven.z)
    add(0.5, 'hiss', { dur: 5, gain: 0.45, at })
    for (let i = 0; i < 10; i++) add(13.2 + i * 0.1 - 0.02, 'tap', { gain: 0.28, pitch: 0.7, at })
  }

  pose(t: number) {
    const s = this.s
    const L = LAYOUT
    const c = s.w.cakes!
    const lift = cakeShape(s.look.press).b + 0.03
    const pos = new Vector3()
    for (let i = 0; i < 10; i++) {
      const sl = OVEN_SLOTS[i]
      const f = smoother(seg(t, 12 + i * 0.1, 13.2 + i * 0.1))
      pos.set(L.oven.x + sl.x, L.ovenTop + lift + Math.sin(Math.PI * f) * 7.5, L.oven.z + sl.z)
      cakeQ(sl.yaw, f, this.q)
      if (i === 0) {
        s.setHeroByCenter(pos, this.q)
        s.applyHero()
      } else c.setFruit(i, pos, this.q)
    }
    c.show(true)
    // 湿饼刚上筛冒一点热气
    s.w.batchSteam.set(v(L.oven.x, L.ovenTop + 3, L.oven.z), 0.45 * smoothstep(0.5, 2.5, t) * (1 - smoothstep(5, 9, t)))
  }
}

// ———— 切片 ————

const D = 0.3 // 片厚（厘米）
/** 一刀的节奏：推、压、抬 */
const CHOP = 0.9
const CHOP0 = 4.2
/** 实时切的刀数，之后切得快一点（镜头拉远），把这一个切完 */
const LIVE = 16
const FAST0 = CHOP0 + LIVE * CHOP
const FAST = 0.32
/** 簸箕里的片：每种形状一组 */
const VARIANTS = [0.1, 0.3, 0.5, 0.65, 0.8, 0.92]

/** 一片平躺时占地多大：半宽（截面的宽）、半深（压果在那一刀处的厚） */
function sliceFoot(zc: number) {
  const { a, b, n } = cakeShape(1.08)
  const u = Math.min(0.999, Math.abs(zc) / a)
  return { hw: Math.sqrt(Math.max(0.01, a * a - zc * zc)), hd: Math.max(0.15, b * Math.pow(1 - Math.pow(u, n), 1 / n)) }
}

/**
 * 片一片片落下来堆着：每片按它平躺时占的那块地（转过的长方形），找底下已经堆了多高，搁在最高处上面。
 * 这样片和片不会插在一起，也不会两片停在同一高度叠着（那样会闪）。
 */
class Heap {
  private h: Float32Array
  private n: number
  constructor(
    private x0: number,
    private z0: number,
    size: number,
    private floor: number,
    private cell = 0.4,
  ) {
    this.n = Math.ceil(size / cell)
    this.h = new Float32Array(this.n * this.n).fill(floor)
  }
  /** 放一片（中心 cx、cz，转 yaw，半宽 hw、半深 hd，厚 th），返回它底面的高度 */
  place(cx: number, cz: number, yaw: number, hw: number, hd: number, th: number) {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    const R = Math.hypot(hw, hd)
    const cells: number[] = []
    let top = this.floor
    const i0 = Math.max(0, Math.floor((cx - R - this.x0) / this.cell))
    const i1 = Math.min(this.n - 1, Math.ceil((cx + R - this.x0) / this.cell))
    const j0 = Math.max(0, Math.floor((cz - R - this.z0) / this.cell))
    const j1 = Math.min(this.n - 1, Math.ceil((cz + R - this.z0) / this.cell))
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const dx = this.x0 + (i + 0.5) * this.cell - cx
        const dz = this.z0 + (j + 0.5) * this.cell - cz
        // 转回片自己的坐标看在不在长方形里（片的长边沿 x，转了 yaw）
        const lx = dx * c - dz * s
        const lz = dx * s + dz * c
        if (Math.abs(lx) <= hw + this.cell * 0.5 && Math.abs(lz) <= hd + this.cell * 0.5) {
          const k = i * this.n + j
          cells.push(k)
          top = Math.max(top, this.h[k])
        }
      }
    }
    const base = top + 0.012
    for (const k of cells) this.h[k] = base + th
    return base
  }
}

/**
 * 簸箕里的片：一片片撒下去，落在哪就顺着底下的东西躺下——底下平就平躺，一头搭在别的片上就斜着靠过去
 * （像一块木板搁在高低不平的地上：重心在中间，靠在中间两边最高的两个支点上）。
 * 每片撒的时候比几个地方，落到最低的那个（簸箕一颠，片会往空当里走），所以先铺满底、再搭着叠，不会一摞摞堆高。
 */
class Settle {
  private h: Float32Array
  private n: number
  private covered = 0
  constructor(
    private x0: number,
    private z0: number,
    size: number,
    readonly floor: number,
    private cell = 0.25,
  ) {
    this.n = Math.ceil(size / cell)
    this.h = new Float32Array(this.n * this.n).fill(floor)
  }

  /** 片底下压着的格子：(格子号, 片上纵向 s, 横向 u) */
  private cells(x: number, z: number, yaw: number, hw: number, hd: number) {
    const c = Math.cos(yaw)
    const sn = Math.sin(yaw)
    const R = Math.hypot(hw, hd)
    const out: [number, number, number][] = []
    const i0 = Math.max(0, Math.floor((x - R - this.x0) / this.cell))
    const i1 = Math.min(this.n - 1, Math.ceil((x + R - this.x0) / this.cell))
    const j0 = Math.max(0, Math.floor((z - R - this.z0) / this.cell))
    const j1 = Math.min(this.n - 1, Math.ceil((z + R - this.z0) / this.cell))
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const dx = this.x0 + (i + 0.5) * this.cell - x
        const dz = this.z0 + (j + 0.5) * this.cell - z
        const u = dx * c - dz * sn
        const w = dx * sn + dz * c
        if (Math.abs(u) <= hw && Math.abs(w) <= hd) out.push([i * this.n + j, u, w])
      }
    }
    return out
  }

  /** 一条板搁在一串高度上（按位置排好）：重心在 0，找它靠着的那条线（上凸包跨过 0 的那段） */
  private static lean(pts: [number, number][], maxSlope: number) {
    const hull: [number, number][] = []
    for (const p of pts) {
      while (hull.length >= 2) {
        const [ax, ay] = hull[hull.length - 2]
        const [bx, by] = hull[hull.length - 1]
        if ((bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax) >= 0) hull.pop()
        else break
      }
      hull.push(p)
    }
    let k = 0
    while (k < hull.length - 2 && hull[k + 1][0] < 0) k++
    const [ax, ay] = hull[k]
    const [bx, by] = hull[Math.min(k + 1, hull.length - 1)]
    let slope = bx > ax ? (by - ay) / (bx - ax) : 0
    slope = clamp(slope, -maxSlope, maxSlope)
    // 斜度封了顶就整条抬到碰得到最高点
    let base = -Infinity
    for (const [x, y] of pts) base = Math.max(base, y - slope * x)
    return { base, slope }
  }

  /** 片落在 (x, z)、转 yaw 时怎么躺：底面中心高度、纵向和横向的斜度 */
  rest(x: number, z: number, yaw: number, hw: number, hd: number) {
    const cs = this.cells(x, z, yaw, hw, hd)
    const bin = this.cell
    const along = new Map<number, number>()
    for (const [k, u] of cs) {
      const b = Math.round(u / bin)
      along.set(b, Math.max(along.get(b) ?? -Infinity, this.h[k]))
    }
    const pa = [...along.entries()].sort((p, q) => p[0] - q[0]).map(([b, y]) => [b * bin, y] as [number, number])
    const L = Settle.lean(pa, 0.6)
    const across = new Map<number, number>()
    for (const [k, u, w] of cs) {
      const b = Math.round(w / bin)
      across.set(b, Math.max(across.get(b) ?? -Infinity, this.h[k] - (L.base + L.slope * u)))
    }
    const pc = [...across.entries()].sort((p, q) => p[0] - q[0]).map(([b, y]) => [b * bin, y] as [number, number])
    const C = Settle.lean(pc, 0.5)
    return { y: L.base + C.base, b: L.slope, c: C.slope, cells: cs }
  }

  /** 片躺下了：它盖住的格子抬到片的上表面 */
  add(r: { y: number; b: number; c: number; cells: [number, number, number][] }, th: number) {
    const t = th * Math.hypot(1, r.b, r.c)
    for (const [k, u, w] of r.cells) {
      if (this.h[k] <= this.floor + 1e-4) this.covered++
      this.h[k] = Math.max(this.h[k], r.y + r.b * u + r.c * w + t)
    }
  }
  /** 底面盖住了多少（格子数） */
  get coveredCells() {
    return this.covered
  }
}

interface Spot {
  /** 片的中心（平躺以后） */
  c: Vector3
  /** 平躺的朝向 */
  q: Quaternion
  /** 这片在压果上的位置（片的几何按压果坐标建，挪的时候要减掉） */
  zc: number
}

/** 平躺：片的厚度方向（本地 z）转到竖直，再绕竖轴转 yaw */
function layQ(yaw: number, out = new Quaternion()) {
  return out.setFromAxisAngle(XAX, -Math.PI / 2).premultiply(new Quaternion().setFromAxisAngle(UP, yaw))
}
/** 按片中心和朝向摆片（片的几何原点在压果中心） */
function placeSlice(o: { position: Vector3; quaternion: Quaternion }, center: Vector3, q: Quaternion, zc: number) {
  o.quaternion.copy(q)
  o.position.copy(center).sub(new Vector3(0, 0, zc).applyQuaternion(q))
}

export class Slice extends Act {
  readonly group = new Group()
  /** 主角压果切下来的每一片（只切这一个：片堆稍微堆起来一点就够，不把十个果的片都堆上） */
  private slices: Mesh[] = []
  private caps = new Map<number, BufferGeometry>()
  private cap!: Mesh
  private spots: Spot[] = []
  private plane = new Plane(new Vector3(0, 0, -1), 0)
  /** 还连在压果上的片只画刀面外面那一截（和压果的裁面对上，不重叠） */
  private liveClip = new Plane(new Vector3(0, 0, 1), 0)
  private q = new Quaternion()
  private total: number
  private a: number

  private built = false

  constructor(s: Stage, id = 'slice') {
    super(s, id, 38)
    this.a = cakeShape(1.08).a
    this.total = Math.floor((2 * this.a) / D)
  }

  prepare() {
    this.build()
    // 主角压果切片时带裁切面，是另一份着色器：预热时也编上
    this.s.w.cakes!.matHero.clippingPlanes = [this.plane]
    this.slices[0].material = this.s.w.cakes!.matSliceClip
    this.group.visible = true
  }

  /** 片、裁口、片堆第一次用到的时候再建（入口页只算时长，不建模型） */
  private build() {
    if (this.built) return
    this.built = true
    const s = this.s
    const c = s.w.cakes!
    const p = 1.08
    const mat = c.matSlice
    this.liveClip.set(new Vector3(0, 0, 1), -(this.base().z + CUTTER.bladeZ))
    c.matSliceClip.clippingPlanes = [this.liveClip]
    for (let k = 0; k < this.total; k++) {
      const m = new Mesh(sliceGeometry(p, this.a - (k + 0.5) * D, D * 0.96), mat)
      m.castShadow = true
      m.receiveShadow = true
      this.slices.push(m)
      this.group.add(m)
    }
    this.cap = new Mesh(sliceGeometry(p, this.a - D, 0.02), mat)
    c.heroGroup.add(this.cap)
    // 每片落在哪：从刀口翻下来，落在木座前面不远，大多顺着刀口横躺；一片片按落下的先后堆起来，堆得稍高一点
    const b = this.base()
    const heap = new Heap(b.x - 30, b.z - 2, 60, LAYOUT.press.y)
    const r = rng(311)
    for (let i = 0; i < this.total; i++) {
      const zc = this.a - (i + 0.5) * D
      const { hw, hd } = sliceFoot(zc)
      const cx = b.x + 4 + (r() * 2 - 1) * 7
      const cz = b.z + 4.5 + r() * 6
      const yaw = (r() - 0.5) * 1.6
      const y = heap.place(cx, cz, yaw, hw, hd, D * 0.96)
      this.spots.push({ c: new Vector3(cx, y + D * 0.48, cz), q: layQ(yaw), zc })
    }
    s.w.scene.add(this.group)
  }

  sounds(add: AddSound) {
    const b = this.base()
    const at = v(b.x + 4, b.y, b.z)
    add(2.58, 'knock', { gain: 0.3, pitch: 1.6, at })
    // 每一刀：刀压到底那一下脆响，切下来的片翻倒落在刀前
    for (let i = 0; i < this.total; i++) {
      const live = i < LIVE
      const hit = live ? CHOP0 + (i + 0.58) * CHOP : FAST0 + (i - LIVE + 0.58) * FAST
      add(hit, 'chop', { gain: live ? 0.7 : 0.45, pitch: 0.95 + 0.025 * ((i * 7) % 5), at })
      add(this.offAt(i) + (live ? 0.5 : 0.36), 'tap', { gain: live ? 0.2 : 0.12, pitch: 1.2, at })
    }
  }

  /** 木座摆在压板底板上：前沿朝外（+z） */
  private base() {
    const L = LAYOUT
    return v(L.press.x, L.press.y + CUTTER.height, L.press.z - 4)
  }

  /** 第 i 片什么时候断开（刀压到底那一下） */
  private offAt(i: number) {
    return i < LIVE ? CHOP0 + (i + 0.55) * CHOP : FAST0 + (i - LIVE + 0.55) * FAST
  }

  /** t 时刻切了几片（含小数：这一刀进行到哪） */
  private cutsAt(t: number) {
    if (t < CHOP0) return 0
    if (t < FAST0) return (t - CHOP0) / CHOP
    return Math.min(this.total, LIVE + (t - FAST0) / FAST)
  }

  hide() {
    if (!this.built) return
    this.group.visible = false
    this.cap.visible = false
    const c = this.s.w.cutter
    if (c) c.group.visible = false
  }

  lights(): [number, LightName][] {
    return [
      [0, 'afternoon'],
      [30, 'golden'],
    ]
  }

  shots(add: AddShot) {
    const b = this.base()
    const edge = v(b.x + 4, b.y + 1.5, b.z + 0.5)
    add(0, 4.2, { target: v(b.x, b.y, b.z + 4), dist: 76, az: 24, el: 30, fov: 30, ap: 0.12 }, { target: v(b.x, b.y, b.z + 4), dist: 64, az: 30, el: 30, fov: 30, ap: 0.14 })
    add(4.2, 12, { target: edge, dist: 30, az: 34, el: 24, fov: 30, ap: 0.34 }, { target: edge, dist: 26, az: 42, el: 22, fov: 30, ap: 0.36 }, 1.0)
    add(12, FAST0 + 1, { target: v(b.x + 2, b.y - 1, b.z + 6), dist: 22, az: 12, el: 40, fov: 30, ap: 0.42 }, { target: v(b.x + 2, b.y - 1.5, b.z + 7), dist: 19, az: 0, el: 46, fov: 30, ap: 0.44 }, 1.2)
    add(FAST0 + 1, 31, { target: v(b.x, b.y, b.z + 2), dist: 70, az: 28, el: 30, fov: 30, ap: 0.12 }, { target: v(b.x, b.y, b.z + 2), dist: 62, az: 18, el: 34, fov: 30, ap: 0.13 }, 1.2)
    add(31, 38, { target: v(b.x, b.y - 4, b.z + 9), dist: 30, az: 10, el: 56, fov: 30, ap: 0.3 }, { target: v(b.x, b.y - 4, b.z + 9), dist: 25, az: -6, el: 60, fov: 30, ap: 0.32 }, 1.2)
  }

  pose(t: number) {
    const s = this.s
    const w = s.w
    const L = LAYOUT
    const c = w.cakes!
    const cut = w.cutter!
    this.build()
    const b = this.base()
    cut.group.visible = true
    cut.group.position.copy(b)
    this.group.visible = true

    const n = this.cutsAt(t)
    const k = Math.floor(n)
    const u = n - k
    // 刀：每一刀先抬着等推，压下去，再抬起来；快进的时候一直在动
    const open = u < 0.3 ? 0.62 : u < 0.6 ? lerp(0.62, 0, smooth((u - 0.3) / 0.3)) : lerp(0, 0.62, smooth((u - 0.6) / 0.4))
    cut.setOpen(t < CHOP0 ? 0.62 : k >= this.total ? 0.62 : open)

    // 主角压果：躺在木座上，前沿伸出刀面 (k + 推进) 片的厚度
    const push = k + smoother(clamp(u / 0.3))
    const lift = cakeShape(1.08).b + 0.02
    const cutZ = b.z + CUTTER.bladeZ
    const hp = v(b.x + 4, b.y + lift, cutZ - this.a + Math.min(push, this.total) * D)
    // 开头从竹盘上那一摞的最上面拿过来
    const stackTop = v(L.tray.x, L.tableTop + 0.45 + lift + 9 * (lift * 2 + 0.06), L.tray.z)
    if (t < 2.6) hop(hp, stackTop, hp.clone(), smoother(seg(t, 0.4, 2.6)), 12)
    s.setHeroByCenter(hp, this.q.identity())
    s.applyHero()
    const done = k >= this.total
    c.heroGroup.visible = !done
    // 切下去的那部分裁掉（裁面在刀面上），裁口盖一片
    this.plane.set(new Vector3(0, 0, -1), cutZ)
    c.matHero.clippingPlanes = t >= CHOP0 ? [this.plane] : null
    this.cap.visible = !done && t >= CHOP0
    // 裁口的盖片比刀面往里让 0.5 毫米：不和伸出去那片的背面贴在同一个面上（贴在一起会闪）
    if (this.cap.visible) this.cap.geometry = this.capGeo(Math.round((cutZ - 0.05 - hp.z) * 100) / 100)

    // 另外九个：摞在案上的竹盘里等着（这一段只切主角这一个）
    const pos = new Vector3()
    for (let i = 1; i < 10; i++) {
      pos.set(L.tray.x, L.tableTop + 0.45 + lift + (i - 1) * (lift * 2 + 0.06), L.tray.z)
      c.setFruit(i, pos, this.q.setFromAxisAngle(UP, i * 0.7))
    }
    c.show(true)

    // 切下的片：伸出去的时候贴着压果（只画刀面外面那一截，看着就是压果伸出去的那一截），
    // 刀压到底那一下断开，翻倒、平躺落在木座前面的片堆上
    for (let i = 0; i < this.total; i++) {
      const m = this.slices[i]
      const sp = this.spots[i]
      m.visible = push > i
      if (!m.visible) continue
      const age = t - this.offAt(i)
      if (age < 0) {
        m.material = c.matSliceClip
        m.position.copy(hp)
        m.quaternion.identity()
        continue
      }
      m.material = c.matSlice
      const f = smooth(clamp(age / (i < LIVE ? 0.5 : 0.36)))
      const from = v(hp.x, hp.y, hp.z + sp.zc)
      const center = hop(new Vector3(), from, sp.c, f, 1.5)
      const q = new Quaternion().slerp(sp.q, f)
      placeSlice(m, center, q, sp.zc)
    }
  }

  private capGeo(z: number) {
    let g = this.caps.get(z)
    if (!g) {
      g = sliceGeometry(1.08, z, 0.02)
      this.caps.set(z, g)
    }
    return g
  }
}

// ———— 结尾：一簸箕果片 ————

export class Winnowed extends Act {
  readonly group = new Group()
  private pile: InstancedMesh[] = []

  private built = false

  constructor(s: Stage, id = 'winnow') {
    super(s, id, 28)
  }

  prepare() {
    this.build()
  }

  private build() {
    if (this.built) return
    this.built = true
    const s = this.s
    const c = s.w.cakes!
    const r = rng(331)
    const a = cakeShape(1.08).a
    const wn = s.w.winnow!
    // 撒到簸箕底铺了六成左右就停：不堆成一摞，底下的竹编从缝里看得见
    const th = D * 0.96
    const inside = (x: number, z: number) => Math.abs(x) < wn.halfW - 1.2 && z < wn.front - 1 && z > wn.back + 1 && (z > -1 || Math.hypot(x, (z + 1) / 0.9) < 21.5)
    let floorCells = 0
    for (let x = -wn.halfW + 0.125; x < wn.halfW; x += 0.25) for (let z = wn.back + 0.125; z < wn.front; z += 0.25) if (inside(x, z)) floorCells++
    const pile = new Settle(-wn.halfW, wn.back, wn.halfW * 2, 0.62)
    const spots: { vi: number; m: Matrix4 }[] = []
    const d = new Object3D()
    const q = new Quaternion()
    const qa = new Quaternion()
    for (let i = 0; i < 160 && pile.coveredCells < floorCells * 0.6; i++) {
      const vi = i % VARIANTS.length
      const zc = a * VARIANTS[vi]
      const { hw, hd } = sliceFoot(zc)
      // 比几个落点，落到最低的那个（往空当里走）
      let best: (ReturnType<Settle['rest']> & { x: number; z: number; yaw: number }) | null = null
      for (let k = 0, tries = 0; k < 4 && tries < 40; tries++) {
        const x = (r() * 2 - 1) * (wn.halfW - 1.5)
        const z = lerp(wn.back + 1.5, wn.front - 1.5, r())
        const yaw = r() * Math.PI * 2
        const c0 = Math.cos(yaw)
        const s0 = Math.sin(yaw)
        let ok = true
        for (const [u, w] of [[hw, hd], [hw, -hd], [-hw, hd], [-hw, -hd]]) if (!inside(x + u * c0 + w * s0, z - u * s0 + w * c0)) ok = false
        if (!ok) continue
        k++
        const rest = pile.rest(x, z, yaw, hw, hd)
        if (!best || rest.y < best.y) best = { ...rest, x, z, yaw }
      }
      if (!best) continue
      pile.add(best, th)
      // 朝向：先平躺（长边沿 x），横向、纵向各斜一点，再转 yaw
      q.setFromAxisAngle(XAX, -Math.PI / 2)
      q.premultiply(qa.setFromAxisAngle(XAX, -Math.atan(best.c)))
      q.premultiply(qa.setFromAxisAngle(ZAX, Math.atan(best.b)))
      q.premultiply(qa.setFromAxisAngle(UP, best.yaw))
      const n = new Vector3(0, 0, 1).applyQuaternion(q)
      placeSlice(d, new Vector3(best.x, best.y, best.z).addScaledVector(n, th * 0.5), q, zc)
      d.updateMatrix()
      spots.push({ vi, m: d.matrix.clone() })
    }
    VARIANTS.forEach((f, vi) => {
      const mine = spots.filter((p) => p.vi === vi)
      const im = new InstancedMesh(sliceGeometry(1.08, a * f, th), c.matSlice, Math.max(1, mine.length))
      im.castShadow = true
      im.receiveShadow = true
      im.frustumCulled = false
      mine.forEach((p, k) => im.setMatrixAt(k, p.m))
      im.count = mine.length
      this.pile.push(im)
      this.group.add(im)
    })
    wn.group.add(this.group)
  }

  hide() {
    const wn = this.s.w.winnow
    if (wn) wn.group.visible = false
  }

  lights(): [number, LightName][] {
    return [
      [0, 'golden'],
      [14, 'dusk'],
      [27, 'evening'],
    ]
  }

  sounds(add: AddSound) {
    add(14, 'click', { gain: 0.5, at: LAYOUT.bulb })
  }

  carry(t: number) {
    const c = this.s.carry
    c.bulb = Math.max(c.bulb, smoothstep(14, 14.3, t))
    c.interior = Math.max(c.interior, smoothstep(14.2, 15.4, t))
  }

  shots(add: AddShot) {
    const L = LAYOUT
    const w = v(L.press.x, L.press.y + 3, L.press.z)
    add(0, 9, { target: w, dist: 34, az: 8, el: 58, fov: 30, ap: 0.3 }, { target: w, dist: 28, az: 22, el: 52, fov: 30, ap: 0.34 })
    add(9, this.dur + 2, { target: w, dist: 52, az: 24, el: 44, fov: 30, ap: 0.24 }, { target: v(w.x + 10, w.y + 30, w.z - 30), dist: 170, az: 60, el: 18, fov: 34, ap: 0.12 }, 1.6, smooth)
  }

  pose() {
    this.build()
    const s = this.s
    const wn = s.w.winnow!
    const L = LAYOUT
    wn.group.visible = true
    wn.group.position.set(L.press.x, L.press.y + 0.02, L.press.z + 1)
    // 主角：最后一片也在簸箕里，镜头跟着压果切完以后就不看它了（藏起来）
    s.w.cakes!.heroGroup.visible = false
  }
}
