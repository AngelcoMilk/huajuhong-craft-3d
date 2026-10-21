import {
  CatmullRomCurve3,
  Color,
  Group,
  Mesh,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
  type MeshPhysicalMaterial,
} from 'three'
import { procStandard } from '../gfx/proc'
import { P } from '../palette'
import { clamp, rng, smoothstep } from '../util'
import { FOLD_DIR, peelMaterial, PRESSED_THICKNESS, setLook } from './peel'

// 结尾：十片一扎。每片是对折压平的扇形（折痕那条直边在一侧，瓣扇开），十片码齐叠起来。
// 捆法照用户给的两张成品照片（七爪、大五爪一样）：结打在扇形的根上（折痕正中，蒂那儿），
// 从结拉出四股，贴着面往外，各走到相邻两瓣分开的豁口，从豁口穿到底下，贴着底下拉回根部，
// 绕过折痕那条边上来回到结——每股是一圈，四圈都收在结上。
// 前九片是成品的静态拷贝，第十片就是主角自己。片与片之间的间距按成品的实际厚度算，不会互相插进去。

/** 绳的半径 */
const STRING_R = 0.1
/** 底下那段绳的中心高度（第一片离盘面抬起 0.3，绳从中间过） */
const UNDER_Y = 0.15

function stringMat() {
  return procStandard(
    { roughness: 0.75, metalness: 0 },
    {
      uniforms: { uRed: { value: new Color(P.red) } },
      varyings: 'varying vec2 vTubeUv;',
      vertex: 'vTubeUv = uv;',
      color: /* glsl */ `
        float tw = mix(0.5, sin(vTubeUv.x * 900.0 + vTubeUv.y * 6.2832 * 2.0) * 0.5 + 0.5, aaFade(vec2(vTubeUv.x * 900.0 / 6.2832, vTubeUv.y * 2.0)));
        diffuseColor.rgb = uRed * (0.72 + 0.36 * tw);
        procBump = tw * 0.015;
      `,
      bump: true,
    },
  )
}

/**
 * 一片成品从上往下看：每个小格里皮的最高点（没有皮是 -Infinity）。
 * 绳贴在哪、豁口在哪都查这张图（比对着几万个三角形一条条打射线快得多）。
 */
class Footprint {
  private h: Float32Array
  private n: number
  constructor(
    geo: BufferGeometry,
    private half = 14,
    private cell = 0.08,
  ) {
    const n = (this.n = Math.ceil((2 * half) / cell))
    const h = (this.h = new Float32Array(n * n).fill(-Infinity))
    const pos = geo.attributes.position
    const idx = geo.index!
    const a = new Vector3()
    const b = new Vector3()
    const c = new Vector3()
    const cellOf = (v: number) => Math.floor((v + half) / cell)
    for (let t = 0; t < idx.count; t += 3) {
      a.fromBufferAttribute(pos, idx.getX(t))
      b.fromBufferAttribute(pos, idx.getX(t + 1))
      c.fromBufferAttribute(pos, idx.getX(t + 2))
      const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z)
      // 竖着的面（切口的墙）从上面看是一条线，跳过
      if (Math.abs(det) < 1e-9) continue
      const i0 = Math.max(0, cellOf(Math.min(a.x, b.x, c.x)))
      const i1 = Math.min(n - 1, cellOf(Math.max(a.x, b.x, c.x)))
      const j0 = Math.max(0, cellOf(Math.min(a.z, b.z, c.z)))
      const j1 = Math.min(n - 1, cellOf(Math.max(a.z, b.z, c.z)))
      for (let i = i0; i <= i1; i++) {
        const x = -half + (i + 0.5) * cell
        for (let j = j0; j <= j1; j++) {
          const z = -half + (j + 0.5) * cell
          const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det
          const l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det
          const l3 = 1 - l1 - l2
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue
          const y = l1 * a.y + l2 * b.y + l3 * c.y
          const k = i * n + j
          if (y > h[k]) h[k] = y
        }
      }
    }
  }
  /** (x, z) 处皮的最高点（片自己的坐标），没有皮是 -Infinity */
  at(x: number, z: number) {
    const i = Math.floor((x + this.half) / this.cell)
    const j = Math.floor((z + this.half) / this.cell)
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -Infinity
    return this.h[i * this.n + j]
  }
}

/** 绳拉紧了贴在面上：只碰得到凸出来的地方，凹下去的地方直着跨过去（上凸包） */
function taut(s: number[], y: number[]) {
  const hull: number[] = []
  for (let i = 0; i < s.length; i++) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2]
      const b = hull[hull.length - 1]
      if ((s[b] - s[a]) * (y[i] - y[a]) - (y[b] - y[a]) * (s[i] - s[a]) >= 0) hull.pop()
      else break
    }
    hull.push(i)
  }
  const out = y.slice()
  let k = 0
  for (let i = 0; i < s.length; i++) {
    while (k < hull.length - 2 && s[hull[k + 1]] < s[i]) k++
    const a = hull[k]
    const b = hull[Math.min(k + 1, hull.length - 1)]
    out[i] = a === b ? y[a] : y[a] + ((y[b] - y[a]) * (s[i] - s[a])) / (s[b] - s[a])
  }
  return out
}

export class Bundle {
  readonly group = new Group()
  readonly pieces: Mesh[] = []
  readonly loops: Mesh[] = []
  readonly knot = new Group()
  readonly stackH: number
  readonly spacing: number
  /** 第一片底面离成品竹盘盘面多高（底下要让出绳子） */
  readonly lift = 0.3
  readonly rots: number[] = []
  /** 成品网格的原点（蒂）离它最低点多高 */
  readonly y0: number

  constructor(finalGeo: BufferGeometry, foldDir: Vector3 = FOLD_DIR, petals = 7) {
    finalGeo.computeBoundingBox()
    const bb = finalGeo.boundingBox!
    this.y0 = -bb.min.y
    // 一片的厚度（对折压平以后）+ 一点余量。每片形状一样（连起伏都一样），所以按皮厚叠，不按外框高度叠
    // 五爪瓣尖折回来那一圈多两层，间距留宽一点
    this.spacing = PRESSED_THICKNESS + (petals === 7 ? 0.03 : 0.12)
    const r = rng(77)
    for (let i = 0; i < 9; i++) {
      const mat = peelMaterial(10 + i * 7)
      setLook(mat, { blanch: 1, dry: 1, product: 1, fuzz: 0.85, press: 1 })
      const m = new Mesh(finalGeo, mat)
      m.castShadow = true
      m.receiveShadow = true
      // 码齐了再捆，只差一点点
      const rot = (r() - 0.5) * 0.05
      this.rots.push(rot)
      m.rotation.y = rot
      m.position.y = this.y0 + this.pieceY(i)
      this.pieces.push(m)
      this.group.add(m)
    }
    this.rots.push(0)
    this.stackH = this.lift + 10 * this.spacing

    const mat = stringMat()
    const { curves, knot } = this.tie(finalGeo, foldDir, petals)
    for (const c of curves) {
      const tube = new Mesh(new TubeGeometry(c, 420, STRING_R, 6, false), mat)
      tube.castShadow = true
      this.loops.push(tube)
      this.group.add(tube)
    }
    // 结：一个扁疙瘩，两个线头顺着折痕那边垂下来（照片上结底下就是一束绳）
    const k = new Mesh(new SphereGeometry(0.4, 12, 8), mat)
    k.scale.set(1.25, 0.75, 1.05)
    this.knot.add(k)
    for (const side of [-1, 1]) {
      const c = new CatmullRomCurve3([
        new Vector3(0, 0, 0),
        new Vector3(0.35 * side, 0.02, 0.45),
        new Vector3(0.62 * side, -0.3, 1.1),
        new Vector3(0.72 * side, -1.2, 1.25),
        new Vector3(0.78 * side, -1.9, 1.27),
      ])
      const tube = new Mesh(new TubeGeometry(c, 30, 0.1, 6, false), mat)
      tube.castShadow = true
      this.knot.add(tube)
    }
    this.knot.position.copy(knot).add(new Vector3(0, 0.12, 0))
    // 本地 x 顺着折痕，本地 z 朝折痕外面（m）
    this.knot.rotation.y = Math.atan2(-foldDir.z, foldDir.x)
    this.group.add(this.knot)
  }

  /**
   * 算四圈绳的走法。坐标都在整摞的组里：蒂（扇形的根）在原点，折痕顺着 foldDir，扇形在 -m 那边。
   * 七爪扇面上七瓣、六个豁口，用中间四个（两头的豁口贴着折痕，捆不住）；五爪五瓣四个豁口全用。
   */
  private tie(geo: BufferGeometry, foldDir: Vector3, petals: number) {
    const fd = foldDir.clone().setY(0).normalize()
    const m = new Vector3(-fd.z, 0, fd.x)
    const fp = new Footprint(geo)
    const heroY = this.heroY
    const rots = this.rots
    const p = new Vector3()
    /** 整摞最上面（主角）在 (x, z) 处的面高；没有皮是 null */
    const topAt = (x: number, z: number) => {
      const h = fp.at(x, z)
      return h === -Infinity ? null : h + heroY
    }
    /** (x, z) 这一竖条上，十片里有没有哪一片有皮 */
    const covered = (x: number, z: number) => {
      for (const a of rots) {
        const c = Math.cos(a)
        const s = Math.sin(a)
        // 片绕竖轴转了 a：把点转回片自己的坐标
        if (fp.at(c * x - s * z, s * x + c * z) > -Infinity) return true
      }
      return false
    }

    // 折过以后各瓣中线朝哪（折线那边的照折线翻过来），按离折痕的角度（0～π，朝 -m 量）排好
    const dth = (Math.PI * 2) / petals
    const ang: number[] = []
    for (let k = 0; k < petals; k++) {
      const d = new Vector3(Math.cos(k * dth), 0, Math.sin(k * dth))
      const s = d.dot(m)
      if (s > 0) d.addScaledVector(m, -2 * s)
      ang.push(Math.atan2(-d.dot(m), d.dot(fd)))
    }
    ang.sort((a, b) => a - b)
    const notches: number[] = []
    for (let j = 0; j + 1 < ang.length; j++) notches.push((ang[j] + ang[j + 1]) / 2)
    const use = petals === 7 ? notches.slice(1, 5) : notches.slice(0, 4)
    const dirOf = (a: number) => fd.clone().multiplyScalar(Math.cos(a)).addScaledVector(m, -Math.sin(a))

    // 结：在根上，离折痕往扇面里一点
    const K = m.clone().multiplyScalar(-0.55)
    K.y = (topAt(K.x, K.z) ?? this.stackH) + STRING_R
    // 折痕那条边：主角折过来那一层的圆边最高处
    let creaseTop = -Infinity
    for (let s = -0.7; s <= 0.35; s += 0.05) {
      for (const o of [-0.4, 0, 0.4]) {
        p.copy(m).multiplyScalar(s).addScaledVector(fd, o)
        creaseTop = Math.max(creaseTop, topAt(p.x, p.z) ?? -Infinity)
      }
    }
    if (creaseTop === -Infinity) creaseTop = this.stackH
    creaseTop += STRING_R
    /** 绳在折痕外面竖着走的位置（离折痕；折过来的圆边最多鼓出去两毫米多） */
    const OUT = 0.42

    const curves: CatmullRomCurve3[] = []
    use.forEach((a, j) => {
      const u = dirOf(a)
      const side = new Vector3(-u.z, 0, u.x)
      // 豁口：顺着两瓣中间往外找，头一处上下整摞都没有皮、左右也让得开绳的地方
      let rn = 9
      for (let rho = 1.5; rho < 12; rho += 0.04) {
        let free = true
        for (const o of [-0.2, 0, 0.2]) {
          p.copy(u).multiplyScalar(rho).addScaledVector(side, o)
          if (covered(p.x, p.z)) {
            free = false
            break
          }
        }
        if (free) {
          rn = rho + 0.12
          break
        }
      }
      const N = u.clone().multiplyScalar(rn)
      // 面上那段：从结直着拉到豁口，贴着面（拉紧了，凹处跨过去）
      const L = Math.hypot(N.x - K.x, N.z - K.z)
      const ss: number[] = []
      const ys: number[] = []
      let last = K.y
      for (let s = 0; s <= L; s += 0.12) {
        const f = s / L
        const h = topAt(K.x + (N.x - K.x) * f, K.z + (N.z - K.z) * f)
        if (h !== null) last = h + STRING_R
        ss.push(s)
        ys.push(h !== null ? h + STRING_R : -Infinity)
      }
      // 豁口上方：绳从瓣边上折下去，高度按最后碰到的皮
      if (L - ss[ss.length - 1] > 0.02) {
        ss.push(L)
        ys.push(last)
      } else ys[ys.length - 1] = last
      ys[0] = Math.max(ys[0], K.y)
      const yt = taut(ss, ys.map((y) => (y === -Infinity ? 0 : y)))
      const pts: Vector3[] = []
      for (let i = 0; i < ss.length; i++) {
        const f = ss[i] / L
        pts.push(new Vector3(K.x + (N.x - K.x) * f, Math.max(yt[i], ys[i]), K.z + (N.z - K.z) * f))
      }
      // 从豁口穿下去，到底下
      const yTop = pts[pts.length - 1].y
      for (const f of [0.15, 0.5, 0.85]) pts.push(new Vector3(N.x, yTop + (UNDER_Y - yTop) * f, N.z))
      pts.push(N.clone().setY(UNDER_Y))
      // 底下拉回根部：几股在折痕外面并排上去（挨个错开一点，不重在一处）
      const o = (j - (use.length - 1) / 2) * 0.24
      const Cb = m.clone().multiplyScalar(OUT).addScaledVector(fd, o)
      for (const f of [0.3, 0.6, 0.85]) pts.push(new Vector3(N.x + (Cb.x - N.x) * f, UNDER_Y, N.z + (Cb.z - N.z) * f))
      pts.push(Cb.clone().setY(UNDER_Y))
      // 折痕外面竖着上去
      for (const f of [0.15, 0.5, 0.85]) pts.push(Cb.clone().setY(UNDER_Y + (creaseTop - 0.15 - UNDER_Y) * f))
      // 翻过折痕的圆边，回到结
      const over = (s: number, y: number) => m.clone().multiplyScalar(s).addScaledVector(fd, o * (s + 0.55) / (OUT + 0.55)).setY(y)
      pts.push(over(OUT - 0.02, creaseTop - 0.02))
      pts.push(over(0.2, creaseTop + 0.02))
      pts.push(over(-0.15, Math.max(creaseTop, K.y) + 0.01))
      pts.push(K.clone())
      curves.push(new CatmullRomCurve3(pts, false, 'centripetal'))
    })
    return { curves, knot: K }
  }

  /** 第 i 片（0 在最下面）的底面在组里的高度：主角是第 10 片（i = 9） */
  pieceY(i: number) {
    return this.lift + i * this.spacing
  }
  /** 主角（第 10 片）的原点在组里的高度 */
  get heroY() {
    return this.y0 + this.pieceY(9)
  }

  /** stack：前九片落下来的进度（0～9），tie：绳子绕好的进度 0～1 */
  update(stack: number, tie: number, heroLook: MeshPhysicalMaterial | null) {
    void heroLook
    this.pieces.forEach((m, i) => {
      const t = clamp(stack - i)
      m.visible = t > 0
      // 一片片从上面落下，带一点旋
      const drop = (1 - smoothstep(0, 1, t)) * 14
      m.position.y = this.y0 + this.pieceY(i) + drop
      m.rotation.y = this.rots[i] + (1 - t) * 0.6
    })
    // 一圈一圈绕：每圈从结出发，拉到豁口、穿下去、从底下绕回来
    const n = this.loops.length
    this.loops.forEach((m, i) => {
      const a = (0.84 * i) / n
      const p = clamp((tie - a) / (0.84 / n))
      const g = m.geometry as TubeGeometry
      const total = g.index!.count
      const per = 6 * 6
      m.geometry.setDrawRange(0, Math.floor((total / per) * p) * per)
      m.visible = p > 0
    })
    const kt = clamp((tie - 0.84) / 0.16)
    this.knot.visible = kt > 0
    this.knot.scale.setScalar(Math.max(0.001, smoothstep(0, 1, kt)))
  }
}
