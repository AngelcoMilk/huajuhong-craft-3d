import { Color, Euler, ExtrudeGeometry, Group, Matrix4, Mesh, Quaternion, Shape, Vector3, type BufferGeometry, type Object3D } from 'three'
import type { Blanch } from '../acts/blanch'
import { procPhysical } from '../gfx/proc'
import { P } from '../palette'
import type { Stage } from '../stage'
import { hash1, smoothstep } from '../util'

// 篮子里的几片柚子叶：摘果时从树上带下来的，散在果堆上（贴在几个果子上，不是插在果子中间）。
//
// 叶子是真几何：挤出厚度 + 主脉对折 + 叶缘上卷 + 叶尖下垂 + 沿叶轴微扭；材质里主脉和侧脉做了一点凹凸。
// 落位按真实支撑算：叶面三角面上的采样点逐个问"底下这颗果子（球）多高"，
// 整片贴着顶上那颗果子**球面的切面**躺下，再垂直抬到所有采样点都不低于果面 —— 于是叶子真的搁在果子上。
//
// 倒果那一下（烫果段篮子在锅边倾倒）叶子逐片脱离：从脱离那一刻的篮位出发，
// 横向被倒出去一点，然后飘着往下落、一边慢慢转、一边淡出，两秒多后消失。
// 全程只由时间 T 决定，拖进度、倒着看都对。

const L = 8.6 // 叶身长（厘米）
const HALF = 2.8 // 半宽
const TH = 0.09 // 叶片厚
const LIFT = 0.05 // 底面离支撑留一点（小果曲率大，留 0.5mm 兜住采样间隙）
const COUNT = 3
const UP = new Vector3(0, 1, 0)

/** 从篮子里滑出去、到淡完消失（相对烫果段开头，秒） */
const RELEASE0 = 8.65
const RELEASE_SPAN = 0.4
const FADE_IN = 0.85 // 离开后多久开始淡
const FADE_LEN = 1.5 // 淡多久（合计约 2.35 秒收完，正好还在锅沿上方）

function leafGeometry(seed: number) {
  const len = L * (0.9 + 0.2 * hash1(seed))
  const half = HALF * (0.9 + 0.2 * hash1(seed + 5))
  const w = (t: number) => Math.max(0.06, half * Math.sin(Math.PI * Math.min(1, t * 1.06)) ** 0.78 * (1 - 0.22 * t))
  const sh = new Shape()
  sh.moveTo(-0.16, -1.25)
  const N = 20
  for (let i = 0; i <= N; i++) {
    const t = i / N
    sh.lineTo(w(t), t * len)
  }
  sh.lineTo(0, len + 0.22)
  for (let i = N; i >= 0; i--) {
    const t = i / N
    sh.lineTo(-w(t), t * len)
  }
  sh.lineTo(0.16, -1.25)
  sh.closePath()

  const g = new ExtrudeGeometry(sh, { depth: TH, bevelEnabled: false, steps: 1 })
  g.rotateX(-Math.PI / 2) // 叶片躺平：厚度朝 +y，叶身沿 -z

  const cup = 0.2 + 0.09 * hash1(seed + 11)
  const droop = 0.22 + 0.12 * hash1(seed + 13)
  const twist = (hash1(seed + 17) - 0.5) * 0.26
  const pa = g.attributes.position
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i)
    const z = pa.getZ(i)
    const y0 = pa.getY(i)
    const t = Math.min(1, Math.max(0, -z / len))
    const a = twist * t
    const c = Math.cos(a)
    const s = Math.sin(a)
    const xx = x * c - y0 * s
    const edge = Math.abs(x) / half
    const yy = x * s + y0 * c + cup * Math.abs(x) * (0.55 + 0.45 * edge) * (0.75 + 0.25 * t) - droop * t * t
    pa.setXYZ(i, xx, yy, z)
  }
  pa.needsUpdate = true
  g.computeVertexNormals()
  g.computeBoundingBox()
  g.translate(0, -(g.boundingBox?.min.y ?? 0), 0)
  g.computeBoundingBox()
  return g
}

function leafMaterial(tint: number) {
  const leaf = new Color(P.leaf).offsetHSL(0.005 * tint, 0.04 * tint, 0.03 * tint)
  return procPhysical(
    { roughness: 0.55, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.6, side: 2, transparent: true },
    {
      uniforms: {
        uLeaf: { value: leaf },
        uVein: { value: new Color('#93AD5E') },
        uHalf: { value: HALF },
      },
      bump: true,
      color: /* glsl */ `
        float mid = 1.0 - smoothstep(0.0, 0.14, abs(vPos.x));
        float lat = sin((vPos.z + abs(vPos.x) * 1.35) * 2.5);
        float vein = smoothstep(0.86, 1.0, abs(lat)) * 0.22;
        float mott = snoise(vPos * 0.7) * 0.5 + 0.5;
        float edge = smoothstep(0.72, 1.0, abs(vPos.x) / uHalf);
        vec3 col = mix(uLeaf * (0.8 + 0.3 * mott), uVein, mid * 0.38 + vein);
        diffuseColor.rgb = mix(col, uLeaf * 0.55, edge * 0.55);
        // 主脉、侧脉真的凸一点，光扫过去会有筋
        procBump = 0.035 * mid + 0.02 * vein;
      `,
    },
  )
}

interface Leaf {
  mesh: Mesh
  mat: ReturnType<typeof leafMaterial>
  /** 在篮子本地坐标里的位姿 */
  local: Matrix4
  /** 脱离时刻（烫果段本地时间） */
  release: number
  fall: number
  phase: number
  /** 脱离那一刻的世界位置（算一次，之后固定） */
  spawn: Vector3 | null
}

export class BasketLeaves {
  readonly group = new Group()
  private readonly leaves: Leaf[] = []
  /** 已经放好的叶子的三角面（篮子本地坐标），后放的叶子要搁在它们上面而不是穿过去 */
  private readonly placed: number[][] = []
  private readonly m = new Matrix4()
  private readonly p = new Vector3()
  private readonly q = new Quaternion()
  private readonly s = new Vector3()
  private readonly e = new Euler()

  /** 舞台建好以后调一次：按这条线的果位、果径把叶子摆到果堆上 */
  build(stage: Stage) {
    const slots = stage.layout.basket
    // 小果篮（橘红胎）果子小、可放叶子的面积也小，少放一片，免得互相挤
    const count = stage.w.tai ? COUNT - 1 : COUNT
    const radius = (i: number) => stage.layout.lift(i)
    // 果堆最高的那几个果子，叶子往它们身上搁
    // 只挑"靠中间、又顶得高"的果子：叶子横着出去最多 9.5cm，篮口半径 18，
    // 顶果离轴超过 5.6 就有叶尖捅出篮口的风险（小果线尤其）
    const order = slots
      .map((_, i) => i)
      .sort((a, b) => slots[b].y + radius(b) - (slots[a].y + radius(a)))
    const near = order.filter((i) => Math.hypot(slots[i].x, slots[i].z) <= 5.6)
    const tops = (near.length >= count ? near : order).slice(0, count)
    for (let k = 0; k < count; k++) {
      const seed = 11 + k * 23
      const geo = leafGeometry(seed)
      const base = slots[tops[k % tops.length]]
      const off = 0.6 + 0.8 * hash1(seed + 3)
      const ang = hash1(seed + 7) * Math.PI * 2
      const lx = base.x + Math.cos(ang) * off
      const lz = base.z + Math.sin(ang) * off
      const yaw = hash1(seed + 9) * Math.PI * 2
      const rest = restOn(slots, radius, this.placed, geo, lx, lz, yaw)
      const local = new Matrix4().compose(new Vector3(lx, rest.y + LIFT, lz), rest.q, new Vector3(1, 1, 1))
      this.placed.push(localTris(geo, local))
      const mat = leafMaterial(k % 2 ? 1 : -1)
      const mesh = new Mesh(geo, mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.group.add(mesh)
      this.leaves.push({
        mesh,
        mat,
        local,
        release: RELEASE0 + hash1(seed + 13) * RELEASE_SPAN,
        fall: 14 + 5 * hash1(seed + 19),
        phase: hash1(seed + 29) * Math.PI * 2,
        spawn: null,
      })
    }
  }

  /** 每帧：T 决定叶子在篮里、还是已经飘出去了 */
  update(T: number, basket: Object3D, blanch: Blanch | undefined) {
    basket.updateWorldMatrix(true, false)
    const bt = blanch ? T - blanch.start : -1e9
    for (const lf of this.leaves) {
      if (!blanch || bt < lf.release) {
        // 还躺在篮里：跟着篮子（叶子搁在果子上的，篮子动它当然动）
        this.m.multiplyMatrices(basket.matrixWorld, lf.local)
        this.m.decompose(this.p, this.q, this.s)
        lf.mesh.position.copy(this.p)
        lf.mesh.quaternion.copy(this.q)
        lf.mesh.visible = true
        lf.mat.opacity = 1
        continue
      }
      // 脱离：从那一刻篮子的位姿算起点（只算一次）
      if (!lf.spawn) {
        blanch.basketPose(lf.release, this.p, this.q)
        this.m.compose(this.p, this.q, this.s.set(1, 1, 1)).multiply(lf.local)
        lf.spawn = new Vector3().setFromMatrixPosition(this.m)
      }
      const dt = bt - lf.release
      const out = 9 + 4 * hash1(lf.phase * 40)
      const sway = Math.sin(dt * 2.3 + lf.phase)
      // 倒出去的方向略偏镜头这一侧：别整片掉进锅上那柱蒸汽里被洗掉
      lf.mesh.position.set(
        lf.spawn.x - out * 0.55 * dt + sway * dt * 0.9,
        lf.spawn.y - lf.fall * dt,
        lf.spawn.z + out * 0.85 * dt + Math.cos(dt * 1.8 + lf.phase) * 1.5 * dt,
      )
      this.e.set(dt * 1.3 + lf.phase, dt * 1.1, dt * 0.8 + lf.phase)
      lf.mesh.quaternion.setFromEuler(this.e)
      const fade = 1 - smoothstep(FADE_IN, FADE_IN + FADE_LEN, dt)
      lf.mat.opacity = fade
      lf.mesh.visible = fade > 0.004
    }
  }
}

/** 让叶子贴着"叶心下顶得最高的那颗果子"的球面躺下，再抬到不穿任何果子 */
function restOn(slots: Vector3[], radius: (i: number) => number, placed: number[][], geo: BufferGeometry, lx: number, lz: number, yaw: number) {
  const qyaw = new Quaternion().setFromEuler(new Euler(0, yaw, 0))
  // 本地采样点（叶面顶点 + 重心）先只按 yaw 摊开，求个叶心
  const local = localSamples(geo)
  let mx = 0
  let mz = 0
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  for (const [x, , z] of local) {
    mx += x * c + z * s
    mz += -x * s + z * c
  }
  mx /= local.length
  mz /= local.length
  // 叶心下顶得最高的那颗果子：取那一点球面的法线，叶子就贴这个切面
  let nx = 0
  let ny = 1
  let nz = 0
  let best = -1e9
  for (let i = 0; i < slots.length; i++) {
    const o = slots[i]
    const r = radius(i)
    const dx = lx + mx - o.x
    const dz = lz + mz - o.z
    const d2 = dx * dx + dz * dz
    if (d2 >= r * r) continue
    const up = Math.sqrt(r * r - d2)
    const h = o.y + up
    if (h <= best) continue
    best = h
    nx = dx / r
    ny = up / r
    nz = dz / r
  }
  // 球面法线太斜就把倾角压回来（叶子不会被顶得立起来，斜上限约 38°）
  const n = new Vector3(nx, ny, nz)
  if (n.y < 0.78) {
    n.y = 0.78
    n.normalize()
  }
  const q = best > -1e8 ? new Quaternion().setFromUnitVectors(UP, n.normalize()).multiply(qyaw) : qyaw
  // 垂直抬到"所有采样点都不低于果子表面"
  let y = 0
  const v = new Vector3()
  for (const [sx, sy, sz] of local) {
    v.set(sx, sy, sz).applyQuaternion(q)
    const need = supportLocal(slots, radius, placed, lx + v.x, lz + v.z) - v.y
    if (need > y) y = need
  }
  return { q, y }
}

/** 篮里那些果子（球）在本地 (x,z) 处顶到多高 */
function supportLocal(slots: Vector3[], radius: (i: number) => number, placed: number[][], x: number, z: number) {
  let h = 0 // 没有果子顶着就是篮底
  for (let i = 0; i < slots.length; i++) {
    const o = slots[i]
    const r = radius(i)
    const dx = x - o.x
    const dz = z - o.z
    const d2 = dx * dx + dz * dz
    if (d2 < r * r) {
      const top = o.y + Math.sqrt(r * r - d2)
      if (top > h) h = top
    }
  }
  // 先落下的叶子：取它们三角面在这一点的高度（顶面更高，正好当"上一片"的支撑）
  for (const t of placed) {
    for (let i = 0; i < t.length; i += 9) {
      const y = heightInTriangle(t, i, x, z)
      if (y > h) h = y
    }
  }
  return h
}

/** 点 (x,z) 落在三角形里的高度；不在里面（或竖着的边）给 -Infinity */
function heightInTriangle(t: number[], i: number, x: number, z: number) {
  const ax = t[i]
  const az = t[i + 2]
  const bx = t[i + 3]
  const bz = t[i + 5]
  const cx = t[i + 6]
  const cz = t[i + 8]
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
  if (Math.abs(d) < 1e-6) return -Infinity
  const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d
  const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d
  const w = 1 - u - v
  if (u < -0.0005 || v < -0.0005 || w < -0.0005) return -Infinity
  return u * t[i + 1] + v * t[i + 4] + w * t[i + 7]
}

/** 一片叶子在篮子本地坐标里的三角面 */
function localTris(geo: BufferGeometry, m: Matrix4) {
  const pa = geo.attributes.position
  const v = new Vector3()
  const pts: { x: number; y: number; z: number }[] = []
  for (let i = 0; i < pa.count; i++) {
    v.set(pa.getX(i), pa.getY(i), pa.getZ(i)).applyMatrix4(m)
    pts.push({ x: v.x, y: v.y, z: v.z })
  }
  const idx = geo.index
  const n = idx ? idx.count : pa.count
  const out: number[] = []
  for (let i = 0; i < n; i += 3) {
    const a = pts[idx ? idx.getX(i) : i]
    const b = pts[idx ? idx.getX(i + 1) : i + 1]
    const d = pts[idx ? idx.getX(i + 2) : i + 2]
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z)
  }
  return out
}

/** 叶面上的采样点（三角形顶点 + 重心），本地坐标 */
function localSamples(geo: BufferGeometry) {
  const out: [number, number, number][] = []
  const pa = geo.attributes.position
  const idx = geo.index
  const n = idx ? idx.count : pa.count
  for (let i = 0; i < n; i += 3) {
    const a = idx ? idx.getX(i) : i
    const b = idx ? idx.getX(i + 1) : i + 1
    const d = idx ? idx.getX(i + 2) : i + 2
    out.push([pa.getX(a), pa.getY(a), pa.getZ(a)], [pa.getX(b), pa.getY(b), pa.getZ(b)], [pa.getX(d), pa.getY(d), pa.getZ(d)])
    // 三边中点 + 重心：小果曲率大，光靠三个角会漏进去
    out.push(
      [(pa.getX(a) + pa.getX(b)) / 2, (pa.getY(a) + pa.getY(b)) / 2, (pa.getZ(a) + pa.getZ(b)) / 2],
      [(pa.getX(b) + pa.getX(d)) / 2, (pa.getY(b) + pa.getY(d)) / 2, (pa.getZ(b) + pa.getZ(d)) / 2],
      [(pa.getX(d) + pa.getX(a)) / 2, (pa.getY(d) + pa.getY(a)) / 2, (pa.getZ(d) + pa.getZ(a)) / 2],
    )
    out.push([
      (pa.getX(a) + pa.getX(b) + pa.getX(d)) / 3,
      (pa.getY(a) + pa.getY(b) + pa.getY(d)) / 3,
      (pa.getZ(a) + pa.getZ(b) + pa.getZ(d)) / 3,
    ])
  }
  return out
}
