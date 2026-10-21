import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  Mesh,
  SphereGeometry,
  Vector3,
  type MeshPhysicalMaterial,
} from 'three'
import { procPhysical } from '../gfx/proc'
import { FRUIT } from '../palette'
import { clamp, lerp, smoothstep } from '../util'

// 一个果子从头到尾就是这一张网格：整果 → 割口 → 开花 → 刮瓤 → 晒卷 → 润软 → 整片对折 → 压平。
// 每一帧按状态把顶点重算一遍（CPU 上两万来个点，很快）。
//
// 坐标：果蒂（底）在原点，果顶朝上（+y）。七瓣按方位角均分。
// 每瓣用 (α, v) 参数化：α 是从果蒂量起的经线角（0 在蒂、π 在顶），v 是瓣内横向（-1～1）。
// 闭合时就是一个球；张开时每瓣的中线按曲率积分"弯回去"，横截面按自己的弧度展平。
// 依据：2006 年地理标志公告"在果顶端开刀，往下切至 3/4 收刀"；七裂者对折"呈交错的 V 字形"。
// 对折是整片沿过中心的一条线折过来（refs/13、35：成品是扇形，一瓣外皮一瓣内面交替），
// 折线偏开四分之一个瓣角，两半的瓣正好错开、不叠在一起，这就是"交错"；没压之前两半张开成 V。

export const PEEL = {
  R: 3.8, // 鲜果半径（厘米）
  N: 7,
  NS: 72, // 沿经线的格数
  NV: 20, // 瓣内横向格数（偶数，中线在正中）
  ALPHA_C: Math.PI / 4, // 留着不切的那 1/4（从蒂量起）
  TH0: 1.0, // 刮之前的皮厚（含白瓤）
  TH1: 0.34, // 刮好以后
  GAP: 0.03, // 割开后切口两边各缩回的角度
}

const { R, N, NS, NV, ALPHA_C, TH0, TH1, GAP } = PEEL
const DTH = (Math.PI * 2) / N
const HALF = DTH / 2
const JC = NV / 2
const COLS = NV + 3 // 含左右各一列"影子列"，算法线用
const I0 = Math.ceil((ALPHA_C / Math.PI) * NS) // 第一行被切开的行
/** 五爪瓣尖往里折回多少（鲜皮尺寸，晒干缩过以后约 3 毫米） */
const TIP_FOLD = 0.42

export class PeelState {
  cut = new Float32Array(N) // 第 k 道口（第 k 瓣和第 k+1 瓣之间）割到哪了
  open = new Float32Array(N) // 每瓣张开
  cap = 0 // 底下连着的那块摊平
  scrape = new Float32Array(N) // 每瓣刮到哪了
  hub = 0 // 中间那块刮了没有
  dry = 0 // 晒/焙干：缩、卷
  soak = 0 // 润：卷回去、变软
  fold = 0 // 整片对折（0 摊平 → 1 折过来）
  press = 0 // 压平
  shrink = 0 // 0～1 → 缩到 72%
  copy(o: PeelState) {
    this.cut.set(o.cut)
    this.open.set(o.open)
    this.scrape.set(o.scrape)
    this.fold = o.fold
    this.cap = o.cap
    this.hub = o.hub
    this.dry = o.dry
    this.soak = o.soak
    this.press = o.press
    this.shrink = o.shrink
    return this
  }
  key() {
    return [...this.cut, ...this.open, ...this.scrape, this.fold, this.cap, this.hub, this.dry, this.soak, this.press, this.shrink]
      .map((v) => v.toFixed(4))
      .join(',')
  }
}

/** 果皮外观随阶段变：这几个直接进着色器 */
export interface PeelLook {
  blanch: number // 烫：转亮黄绿
  wetGloss: number // 湿亮
  dry: number // 橄榄色
  soak: number // 润湿的深色斑
  product: number // 成品色
  fuzz: number // 细绒
  press: number
  // 几瓣（算压平后哪里是空当用）
  n: number
  dth: number
  half: number
}

const sinc = (x: number) => (Math.abs(x) < 1e-4 ? 1 - (x * x) / 6 : Math.sin(x) / x)
const cosc = (x: number) => (Math.abs(x) < 1e-4 ? x / 2 : (1 - Math.cos(x)) / x)

function makeMaterial(seed: number) {
  const C = (h: string) => new Color(h)
  return procPhysical(
    { roughness: 0.6, metalness: 0, sheen: 1, sheenRoughness: 0.5, sheenColor: new Color('#ffffff'), clearcoat: 1, clearcoatRoughness: 0.28 },
    {
      uniforms: {
        uBlanch: { value: 0 },
        uWetGloss: { value: 0 },
        uDry: { value: 0 },
        uSoak: { value: 0 },
        uProduct: { value: 0 },
        uFuzz: { value: 1 },
        uPress: { value: 0 },
        uSeed: { value: seed },
        cSkin0: { value: C(FRUIT.skin[0]) },
        cSkin1: { value: C(FRUIT.skin[1]) },
        cSkin2: { value: C(FRUIT.skin[2]) },
        cBl0: { value: C(FRUIT.blanch[0]) },
        cBl1: { value: C(FRUIT.blanch[1]) },
        cBl2: { value: C(FRUIT.blanch[2]) },
        cPith0: { value: C(FRUIT.pith[0]) },
        cPith1: { value: C(FRUIT.pith[1]) },
        cIn0: { value: C(FRUIT.inner[0]) },
        cIn1: { value: C(FRUIT.inner[1]) },
        cOil: { value: C(FRUIT.oil) },
        cDry0: { value: C(FRUIT.dried[0]) },
        cDry1: { value: C(FRUIT.dried[1]) },
        cDry2: { value: C(FRUIT.dried[2]) },
        cDryIn: { value: C(FRUIT.driedInner) },
        cProd0: { value: C(FRUIT.product[0]) },
        cProd1: { value: C(FRUIT.product[1]) },
        cProd2: { value: C(FRUIT.product[2]) },
        cProdIn: { value: C(FRUIT.productInner) },
        cFuzz: { value: C('#E9EDDA') },
      },
      attributes: 'attribute vec4 aRest; attribute vec4 aInfo;',
      varyings: 'varying vec3 vRest; varying vec4 vInfo;',
      vertex: 'vRest = aRest.xyz; vInfo = aInfo;',
      color: /* glsl */ `
        vec3 rp = vRest;
        float surf = vInfo.x;
        float scr = vInfo.w;
        float mott = snoise(rp * 2.6 + uSeed) * 0.45 + snoise(rp * 7.3 + uSeed * 2.0) * 0.18;
        float outerMask = 0.0;
        vec3 col;
        float bump = 0.0;
        float wetN = snoise(rp * 4.2 + 11.0 + uSeed) * 0.5 + 0.5;
        float wet = smoothstep(wetN, wetN + 0.3, uSoak * 1.3);
        if (surf < 0.5) {
          outerMask = 1.0;
          vec3 gl = voronoi3(rp * 40.0 + uSeed);
          // 油点、细绒都比像素细的时候淡成平均色（不然远看会闪）
          float aaG = aaFade3(rp * 40.0);
          float gland = mix(0.12, 1.0 - smoothstep(0.1, 0.36, gl.x), aaG);
          float lo = smoothstep(-0.8, 0.25, mott);
          float hi = smoothstep(0.3, 1.0, mott);
          vec3 fresh = mix(mix(cSkin0, cSkin1, lo), cSkin2, hi * 0.55);
          vec3 bl = mix(mix(cBl0, cBl1, lo), cBl2, hi * 0.5);
          col = mix(fresh, bl, uBlanch);
          vec3 dr = mix(mix(cDry0, cDry1, lo), cDry2, hi * 0.45);
          col = mix(col, dr, uDry);
          vec3 pr = mix(mix(cProd0, cProd1, lo), cProd2, hi * 0.45);
          col = mix(col, pr, uProduct);
          col = mix(col, col * mix(1.16, 0.84, uDry), gland * 0.5);
          float hair = mix(0.2, step(0.8, hash13(floor(rp * 460.0))), aaFade3(rp * 460.0));
          col = mix(col, cFuzz, hair * 0.1 * uFuzz);
          float apex = 1.0 - smoothstep(0.035, 0.065, length(rp - vec3(0.0, 1.0, 0.0)));
          col = mix(col, vec3(0.36, 0.3, 0.17), apex * 0.85);
          bump = -gland * 0.018 + mott * 0.008;
          // 烫完挂着的水珠
          vec3 dv = voronoi3(rp * 13.0 + 5.0);
          float dropR = 0.16 + 0.12 * dv.z;
          float drop = max(0.0, dropR * dropR - dv.x * dv.x);
          bump += sqrt(drop) * 0.35 * uWetGloss * step(0.45, dv.z);
        } else if (surf < 1.5) {
          float sp = fbm3(rp * 22.0);
          vec3 pith = mix(cPith0, cPith1, 0.55 + 0.45 * sp);
          vec3 vo = voronoi3(rp * 70.0);
          pith *= 1.0 - mix(0.04, 1.0 - smoothstep(0.05, 0.22, vo.x), aaFade3(rp * 70.0)) * 0.07;
          vec3 inn = mix(cIn0, cIn1, 0.5 + 0.5 * snoise(rp * 6.0));
          float oilDot = mix(0.06, 1.0 - smoothstep(0.09, 0.19, voronoi3(rp * 30.0 + 3.0).x), aaFade3(rp * 30.0));
          inn = mix(inn, cOil, oilDot * smoothstep(0.55, 1.0, scr) * 0.85);
          col = mix(pith, inn, scr);
          vec3 dri = cDryIn * (0.88 + 0.16 * snoise(rp * 5.0));
          dri = mix(dri, dri * 0.82, oilDot * 0.6);
          col = mix(col, dri, uDry);
          vec3 pri = cProdIn * (0.92 + 0.1 * snoise(rp * 5.0));
          pri = mix(pri, pri * 0.88, oilDot * 0.5);
          col = mix(col, pri, uProduct);
          bump = sp * mix(0.05, 0.012, scr);
        } else {
          float d = vInfo.y;
          vec3 rim = mix(mix(cSkin0, cBl0, uBlanch), cDry0, uDry);
          rim = mix(rim, cProd0, uProduct);
          vec3 pth = mix(cPith1, cIn1, scr);
          pth = mix(pth, cDryIn, uDry);
          pth = mix(pth, cProdIn, uProduct);
          float rimW = mix(0.12, 0.3, scr);
          col = mix(rim, pth, smoothstep(rimW * 0.6, rimW, d));
          bump = 0.0;
        }
        col *= mix(1.0, 0.68, wet * (1.0 - uPress * 0.6));
        diffuseColor.rgb = col;
        procBump = bump;
      `,
      rough: /* glsl */ `
        float rOuter = mix(mix(0.6, 0.32, uWetGloss), 0.78, uDry);
        rOuter = mix(rOuter, 0.82, uProduct);
        float rr = surf < 0.5 ? rOuter : mix(0.92, 0.8, scr);
        roughnessFactor = mix(rr, 0.42, wet * 0.8);
      `,
      physical: /* glsl */ `
        #ifdef USE_SHEEN
          material.sheenColor = cFuzz * uFuzz * outerMask * 0.38;
          material.sheenRoughness = 0.7;
        #endif
        #ifdef USE_CLEARCOAT
          material.clearcoat = outerMask * uWetGloss * 0.75 + wet * 0.25;
          material.clearcoatRoughness = 0.26;
        #endif
      `,
      bump: true,
    },
  )
}

/** 一个果子的材质（外观参数）。几个网格共用同一份 */
export function peelMaterial(seed = 0) {
  return makeMaterial(seed)
}
export function setLook(mat: MeshPhysicalMaterial, look: Partial<PeelLook>) {
  const u = (mat.userData.proc as { uniforms: Record<string, { value: number }> }).uniforms
  if (look.blanch !== undefined) u.uBlanch.value = look.blanch
  if (look.wetGloss !== undefined) u.uWetGloss.value = look.wetGloss
  if (look.dry !== undefined) u.uDry.value = look.dry
  if (look.soak !== undefined) u.uSoak.value = look.soak
  if (look.product !== undefined) u.uProduct.value = look.product
  if (look.fuzz !== undefined) u.uFuzz.value = look.fuzz
  if (look.press !== undefined) u.uPress.value = look.press
}
export function copyLook(dst: MeshPhysicalMaterial, src: MeshPhysicalMaterial) {
  const a = (dst.userData.proc as { uniforms: Record<string, { value: unknown }> }).uniforms
  const b = (src.userData.proc as { uniforms: Record<string, { value: unknown }> }).uniforms
  for (const k of ['uBlanch', 'uWetGloss', 'uDry', 'uSoak', 'uProduct', 'uFuzz', 'uPress']) a[k].value = b[k].value
}

/** 整果（篮子里别的果子、树上的果子）：一个带同样属性的球，外观和主角一样 */
export function wholeFruitGeometry(r = R) {
  const g = new SphereGeometry(r, 48, 32)
  const pos = g.attributes.position
  const rest = new Float32Array(pos.count * 4)
  const info = new Float32Array(pos.count * 4)
  for (let i = 0; i < pos.count; i++) {
    rest[i * 4] = pos.getX(i) / r
    rest[i * 4 + 1] = pos.getY(i) / r
    rest[i * 4 + 2] = pos.getZ(i) / r
  }
  g.setAttribute('aRest', new BufferAttribute(rest, 4))
  g.setAttribute('aInfo', new BufferAttribute(info, 4))
  return g
}

const tmp = new Vector3()
const tmp2 = new Vector3()

/** 折线和瓣的中线错开四分之一个瓣角：折过来的瓣正好落在另一半两瓣中间 */
const FOLD_PSI = DTH / 4
/** 折痕的方向（果子本地坐标，水平面里）；成品扇形在折痕的 -m 一侧，m = (-FOLD_DIR.z, 0, FOLD_DIR.x) */
export const FOLD_DIR = new Vector3(Math.cos(FOLD_PSI), 0, Math.sin(FOLD_PSI))
/** 对折压平以后一片有多厚：两层刮好晒干的皮（晒干、压过各薄一些）+ 折痕的空隙。起伏每片都一样，叠起来能套住 */
export const PRESSED_THICKNESS = 2 * TH1 * (1 - 0.3) * (1 - 0.1) + 2 * 0.03

interface Fold {
  phi: number // 翻过来的角度，π 是完全折平
  c: number // 折线离原点多远（沿 m）：整片对折是 0，瓣尖内折是瓣尖往回一点
  fx: number // 折线方向（水平面里）
  fz: number
  ya: number // 折痕圆柱的轴离外表面多高（内弯半径 + 皮厚）
  rn: number // 中性层的弯曲半径
  sc: number // 晒干缩小的比例
  drop: number // 压平以后，上层悬空的地方往下贴多少
  press: number
  // 几瓣（算压平后哪里是空当用）
  n: number
  dth: number
  half: number
}

/**
 * 摊平的星形上，点 (x, z) 离最近的边有多远：负数在皮上，正数在瓣与瓣之间的空当里。
 * 和 build() 里摊平的算法一致：中心一块圆（蒂那 1/4），每瓣中线是径向的，半宽 = R·sin(α)·半瓣角。
 */
function starEdge(x: number, z: number, sc: number, n = N, dth = DTH, half = HALF) {
  const rho = Math.hypot(x, z)
  const hub = R * ALPHA_C * sc
  if (rho < hub) return rho - hub
  const th = Math.atan2(z, x)
  let best = Infinity
  for (let k = 0; k < n; k++) {
    let d = th - k * dth
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2
    const along = rho * Math.cos(d)
    if (along <= 0) continue
    const lat = Math.abs(rho * Math.sin(d))
    const a = along / (R * sc)
    let e = lat - R * Math.sin(Math.min(a, Math.PI)) * half * sc
    if (a > Math.PI) e = Math.max(e, along - Math.PI * R * sc)
    best = Math.min(best, e)
  }
  return best
}

/** 晒过的皮不是平的：一点点起伏（上下两层在同一处起伏一样，不会穿插） */
function wave(x: number, z: number) {
  const w = Math.sin(x * 1.3 + z * 0.7) * Math.sin(z * 1.1 - x * 0.4 + 1.7) + 0.5 * Math.sin(x * 2.9 - z * 2.3 + 0.4)
  return (w + 1.5) / 3 // 0～1：只往上拱，不往下钻（底下是竹匾、木板）
}

/**
 * 把数组 A 里第 o 个点按对折挪过去。平摊时外皮在 y = 0、内面朝上；
 * 折线那一边（s > 0）的点先沿圆柱弯过去，弯完的部分再平着搭回来。法线（如果给了）跟着转。
 */
function foldPoint(A: Float32Array, o: number, f: Fold, Nrm: Float32Array | null) {
  const x = A[o]
  const y = A[o + 1]
  const z = A[o + 2]
  const mx = -f.fz
  const mz = f.fx
  const sDist = x * mx + z * mz - f.c
  if (sDist <= 0) return
  const u = x * f.fx + z * f.fz
  const rho = Math.max(f.ya - y, 0.005)
  const L = f.rn * f.phi
  let a: number
  let s2: number
  let y2: number
  if (sDist < L) {
    a = sDist / f.rn
    s2 = rho * Math.sin(a)
    y2 = f.ya - rho * Math.cos(a)
  } else {
    a = f.phi
    const rem = sDist - L
    s2 = rho * Math.sin(a) + rem * Math.cos(a)
    y2 = f.ya - rho * Math.cos(a) + rem * Math.sin(a)
  }
  const nx2 = u * f.fx + (f.c + s2) * mx
  const nz2 = u * f.fz + (f.c + s2) * mz
  // 压平以后：折过来的那层底下要是空当（另一半的两瓣中间），就顺势贴下去，不悬着
  if (f.press > 0 && f.drop > 0 && sDist >= L) y2 -= f.drop * f.press * smoothstep(0, 0.45, starEdge(nx2, nz2, f.sc, f.n, f.dth, f.half))
  A[o] = nx2
  A[o + 1] = y2
  A[o + 2] = nz2
  if (Nrm) {
    const nx = Nrm[o]
    const ny = Nrm[o + 1]
    const nz = Nrm[o + 2]
    const nu = nx * f.fx + nz * f.fz
    const ns = nx * mx + nz * mz
    const c = Math.cos(a)
    const sn = Math.sin(a)
    const ns2 = ns * c - ny * sn
    const ny2 = ns * sn + ny * c
    Nrm[o] = nu * f.fx + ns2 * mx
    Nrm[o + 1] = ny2
    Nrm[o + 2] = nu * f.fz + ns2 * mz
  }
}

export class Peel {
  readonly group = new Group()
  readonly mesh: Mesh
  readonly pulp: Mesh
  readonly geometry = new BufferGeometry()
  readonly material: MeshPhysicalMaterial
  readonly state = new PeelState()
  private lastKey = ''

  // 每瓣算好的外表面、内表面、法线（含影子列）：[petal][row][col][xyz]
  private O: Float32Array
  private In: Float32Array
  private Nm: Float32Array
  private TH: Float32Array
  private LAT: Float32Array
  private SCR: Float32Array

  private pos: BufferAttribute
  private nrm: BufferAttribute
  private info: BufferAttribute
  private wallStart = 0

  /** 几瓣（七爪 7，大五爪 5） */
  readonly n: number
  readonly dth: number
  readonly half: number
  /** 五爪先把瓣尖往里折回约 3 毫米（截角），再整片对折；七爪直接整片对折 */
  readonly tipFold: boolean
  /** 整片对折的折痕方向（偏开四分之一个瓣角，两半的瓣正好错开） */
  readonly foldDir: Vector3

  constructor(material?: MeshPhysicalMaterial, petals = N) {
    this.material = material ?? makeMaterial(0)
    this.n = petals
    this.dth = (Math.PI * 2) / petals
    this.half = this.dth / 2
    this.tipFold = petals !== 7
    this.foldDir = new Vector3(Math.cos(this.dth / 4), 0, Math.sin(this.dth / 4))
    const cells = this.n * (NS + 1) * COLS
    this.O = new Float32Array(cells * 3)
    this.In = new Float32Array(cells * 3)
    this.Nm = new Float32Array(cells * 3)
    this.TH = new Float32Array(cells)
    this.LAT = new Float32Array(cells)
    this.SCR = new Float32Array(this.n * (NS + 1))
    const outerCount = this.n * (NS + 1) * (NV + 1)
    const wallRows = NS - I0 + 1
    const wallCount = this.n * 2 * wallRows * 2
    const count = outerCount * 2 + wallCount
    this.wallStart = outerCount * 2
    this.pos = new BufferAttribute(new Float32Array(count * 3), 3).setUsage(DynamicDrawUsage)
    this.nrm = new BufferAttribute(new Float32Array(count * 3), 3).setUsage(DynamicDrawUsage)
    this.info = new BufferAttribute(new Float32Array(count * 4), 4).setUsage(DynamicDrawUsage)
    const rest = new Float32Array(count * 4)
    const idx: number[] = []

    const vO = (k: number, i: number, j: number) => (k * (NS + 1) + i) * (NV + 1) + j
    const vI = (k: number, i: number, j: number) => outerCount + vO(k, i, j)
    const vW = (k: number, side: number, r: number, inner: number) => this.wallStart + ((k * 2 + side) * wallRows + r) * 2 + inner

    const restOf = (k: number, a: number, v: number, o: number) => {
      const th = k * this.dth + v * this.half
      rest[o] = Math.sin(a) * Math.cos(th)
      rest[o + 1] = -Math.cos(a)
      rest[o + 2] = Math.sin(a) * Math.sin(th)
      rest[o + 3] = k
    }
    const info = this.info.array as Float32Array
    for (let k = 0; k < this.n; k++) {
      for (let i = 0; i <= NS; i++) {
        const a = (Math.PI * i) / NS
        for (let j = 0; j <= NV; j++) {
          const v = -1 + (2 * j) / NV
          const o = vO(k, i, j)
          const ii = vI(k, i, j)
          restOf(k, a, v, o * 4)
          restOf(k, a, v, ii * 4)
          info[o * 4] = 0
          info[ii * 4] = 1
          info[o * 4 + 2] = i / NS
          info[ii * 4 + 2] = i / NS
        }
      }
      for (let i = 0; i < NS; i++) {
        for (let j = 0; j < NV; j++) {
          const a = vO(k, i, j)
          const b = vO(k, i + 1, j)
          const c = vO(k, i, j + 1)
          const d = vO(k, i + 1, j + 1)
          idx.push(a, b, c, b, d, c)
          const ai = vI(k, i, j)
          const bi = vI(k, i + 1, j)
          const ci = vI(k, i, j + 1)
          const di = vI(k, i + 1, j + 1)
          idx.push(ai, ci, bi, bi, ci, di)
        }
      }
      // 切口的两面墙
      for (let side = 0; side < 2; side++) {
        const v = side === 0 ? -1 : 1
        for (let r = 0; r < wallRows; r++) {
          const i = I0 + r
          const a = (Math.PI * i) / NS
          for (let inner = 0; inner < 2; inner++) {
            const o = vW(k, side, r, inner)
            restOf(k, a, v, o * 4)
            info[o * 4] = 2
            info[o * 4 + 1] = inner
            info[o * 4 + 2] = i / NS
          }
        }
        for (let r = 0; r < wallRows - 1; r++) {
          const o0 = vW(k, side, r, 0)
          const n0 = vW(k, side, r, 1)
          const o1 = vW(k, side, r + 1, 0)
          const n1 = vW(k, side, r + 1, 1)
          if (side === 0) idx.push(o0, n0, o1, n0, n1, o1)
          else idx.push(o0, o1, n0, n0, o1, n1)
        }
      }
    }
    const g = this.geometry
    g.setAttribute('position', this.pos)
    g.setAttribute('normal', this.nrm)
    g.setAttribute('aRest', new BufferAttribute(rest, 4))
    g.setAttribute('aInfo', this.info)
    g.setIndex(idx)

    this.mesh = new Mesh(g, this.material)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.mesh.frustumCulled = false
    this.group.add(this.mesh)

    // 果瓤：一个分瓣的小球，开花以后拿走
    const pr = R - TH0 - 0.04
    const pg = new SphereGeometry(pr, 40, 28)
    const pp = pg.attributes.position
    for (let i = 0; i < pp.count; i++) {
      tmp.fromBufferAttribute(pp, i)
      const az = Math.atan2(tmp.z, tmp.x)
      const seg = Math.abs(Math.cos(az * 6.5))
      const s = 1 - 0.045 * Math.pow(1 - seg, 6) * Math.sqrt(Math.max(0, 1 - (tmp.y / pr) ** 2))
      tmp.multiplyScalar(s)
      pp.setXYZ(i, tmp.x, tmp.y, tmp.z)
    }
    pg.computeVertexNormals()
    this.pulp = new Mesh(pg, pulpMaterial())
    this.pulp.position.set(0, R, 0)
    this.pulp.castShadow = true
    this.pulp.receiveShadow = true
    this.group.add(this.pulp)

    this.update()
  }

  private idx3(k: number, i: number, jj: number) {
    return ((k * (NS + 1) + i) * COLS + jj) * 3
  }

  /** 第 k 道割口在闭合果皮上 α 处的点（本地坐标） */
  seamPoint(k: number, a: number, out: Vector3, inset = 0) {
    const th = k * this.dth + this.half
    const r = R - inset
    return out.set(r * Math.sin(a) * Math.cos(th), R - r * Math.cos(a), r * Math.sin(a) * Math.sin(th))
  }

  /** 第 k 瓣中线在 α 处，内表面（白瓤那面）的当前位置和法线（本地坐标） */
  innerCenter(k: number, a: number, out: Vector3, normal?: Vector3) {
    const i = Math.round(clamp(a / Math.PI) * NS)
    const o = this.idx3(k, i, JC + 1)
    out.set(this.In[o], this.In[o + 1], this.In[o + 2])
    if (normal) normal.set(-this.Nm[o], -this.Nm[o + 1], -this.Nm[o + 2])
    return out
  }

  outerCenter(k: number, a: number, out: Vector3) {
    const i = Math.round(clamp(a / Math.PI) * NS)
    const o = this.idx3(k, i, JC + 1)
    return out.set(this.O[o], this.O[o + 1], this.O[o + 2])
  }

  update() {
    const key = this.state.key()
    if (key === this.lastKey) return
    this.lastKey = key
    this.build()
  }

  private build() {
    const st = this.state
    const O = this.O
    const In = this.In
    const Nm = this.Nm
    const sc = 1 - 0.28 * st.shrink
    const relax = st.soak
    const dryCurl = st.dry * (1 - relax) * (1 - st.press)
    const thScale = (1 - 0.3 * st.dry) * (1 + 0.12 * st.soak * (1 - st.press)) * (1 - 0.1 * st.press)

    // 对折的参数：折线方向、张角、折痕半径（压之前圆一点，压平后贴紧）
    const tFold = TH1 * thScale
    const rIn = lerp(0.35, 0.03, st.press)
    // 五爪：先折瓣尖（折的前一段），再整片对折
    const tipAmt = this.tipFold ? smoothstep(0, 0.35, st.fold) : 0
    const halfAmt = this.tipFold ? smoothstep(0.3, 1, st.fold) : st.fold
    const fold: Fold = {
      phi: Math.PI * halfAmt * (0.86 + 0.14 * st.press),
      c: 0,
      fx: this.foldDir.x,
      fz: this.foldDir.z,
      ya: rIn + tFold,
      rn: rIn + tFold / 2,
      sc,
      drop: 2 * rIn + tFold,
      press: st.press * halfAmt,
      n: this.n,
      dth: this.dth,
      half: this.half,
    }
    const waveAmp = 0.14 * st.dry * (1 - 0.75 * st.press) // 压过以后平了不少

    const rowB = new Float32Array(NS + 1)
    const rowX = new Float32Array(NS + 1)
    const rowY = new Float32Array(NS + 1)

    for (let k = 0; k < this.n; k++) {
      const thk = k * this.dth
      const dx = Math.cos(thk)
      const dz = Math.sin(thk)
      const ex = -Math.sin(thk)
      const ez = Math.cos(thk)
      const open = st.open[k]
      const kPrev = (k + this.n - 1) % this.n

      // 中线：按曲率逐段积分（每段曲率不变，用精确的圆弧）
      let beta = 0
      let cx = 0
      let cy = 0
      const curv = (a: number) => {
        if (a <= ALPHA_C) return (1 - st.cap) / R
        const tip = dryCurl * smoothstep(Math.PI * 0.55, Math.PI, a) * (0.9 / R)
        return (1 - open) / R + tip
      }
      let kPrevC = curv(0)
      rowB[0] = 0
      rowX[0] = 0
      rowY[0] = 0
      for (let i = 1; i <= NS; i++) {
        const a0 = (Math.PI * (i - 1)) / NS
        const a1 = (Math.PI * i) / NS
        const kc = curv(a1)
        const kb = 0.5 * (kPrevC + kc)
        kPrevC = kc
        const ds = R * (a1 - a0)
        const b1 = beta + kb * ds
        if (Math.abs(kb) < 1e-6) {
          cx += Math.cos(beta) * ds
          cy += Math.sin(beta) * ds
        } else {
          cx += (Math.sin(b1) - Math.sin(beta)) / kb
          cy += (Math.cos(beta) - Math.cos(b1)) / kb
        }
        beta = b1
        rowB[i] = beta
        rowX[i] = cx
        rowY[i] = cy
      }

      const cutFront = (seam: number) => Math.PI - (Math.PI - ALPHA_C) * st.cut[seam]
      const fR = cutFront(k)
      const fL = cutFront(kPrev)
      const gapAt = (a: number, front: number, c: number) => {
        if (c <= 0) return 0
        const g = smoothstep(front - 0.02, front + 0.12, a) * smoothstep(ALPHA_C - 0.01, ALPHA_C + 0.2, a)
        return GAP * g * (0.6 + 0.8 * (a - ALPHA_C) / (Math.PI - ALPHA_C)) * (1 - open * 0.7)
      }

      // 刮瓤：从瓣根往瓣尖推。一瓣一瓣刮只刮割开的那一截（两边有切口的墙）——
      // 底下连着的那块各瓣共用接缝，一瓣刮薄了、旁边一瓣还厚，接缝那里一高一低裂开一条缝，能看见底下的砧板
      const sp = st.scrape[k]
      for (let i = 0; i <= NS; i++) {
        const a = (Math.PI * i) / NS
        const front = lerp(ALPHA_C * 0.85, Math.PI + 0.25, sp)
        let s = sp > 0 ? smoothstep(front + 0.05, front - 0.2, a) * smoothstep(ALPHA_C, ALPHA_C + 0.12, a) : 0
        // 连着的那块最后一起刮：同一圈上每瓣一样厚，接缝对得上
        s = Math.max(s, st.hub * (1 - smoothstep(ALPHA_C + 0.02, ALPHA_C + 0.2, a)))
        this.SCR[k * (NS + 1) + i] = s
      }

      for (let i = 0; i <= NS; i++) {
        const a = (Math.PI * i) / NS
        const b = rowB[i]
        const cb = Math.cos(b)
        const sb = Math.sin(b)
        // t = cb d + sb up ;  n = -sb d + cb up
        const nX = -sb * dx
        const nY = cb
        const nZ = -sb * dz
        const Cx = rowX[i] * dx
        const Cy = rowY[i]
        const Cz = rowX[i] * dz
        const rho = rowX[i]
        const rlat = R * Math.sin(a)
        const w = smoothstep(ALPHA_C - 0.05, ALPHA_C + 0.3, a)
        const latCurl = (dryCurl * 0.42) / Math.max(rlat * this.half, 0.35)
        // 横截面摊平多少：瓣根那一截（挨着连着的那块）等瓣快张平了才一起摊平——
        // 半开的时候提前摊平，瓣根变宽，相邻两瓣的边会互相插进去（中间那块看着穿模）
        const lat = lerp(smoothstep(0.75, 1, open), open, smoothstep(ALPHA_C, ALPHA_C + 0.6, a))
        const kx = (1 - lat) / Math.max(rlat, 1e-4) + latCurl * smoothstep(ALPHA_C, ALPHA_C + 0.4, a)
        // 横截面往哪边卷：闭合时朝轴心（-d），张开后朝内表面那侧（n）
        let mX = lerp(-dx, nX, lat)
        let mY = lerp(0, nY, lat)
        let mZ = lerp(-dz, nZ, lat)
        const ml = Math.hypot(mX, mY, mZ) || 1
        mX /= ml
        mY /= ml
        mZ /= ml
        const gR = gapAt(a, fR, st.cut[k])
        const gL = gapAt(a, fL, st.cut[kPrev])
        const scr = this.SCR[k * (NS + 1) + i]
        const th = lerp(TH0, TH1, scr) * thScale

        for (let jj = 0; jj < COLS; jj++) {
          const v = -1 + (2 * (jj - 1)) / NV
          const half = this.half - (v > 0 ? gR : gL)
          const d = v * half
          // 底下连着的那块：水平的圆
          const hs = Math.sin(d)
          const hc = Math.cos(d) - 1
          const hx = Cx + rho * (hs * ex + hc * dx)
          const hy = Cy
          const hz = Cz + rho * (hs * ez + hc * dz)
          // 瓣：横截面按自己的弧度
          const l = rlat * d
          const tx = l * kx
          const s1 = l * sinc(tx)
          const s2 = l * cosc(tx)
          const px = Cx + s1 * ex + s2 * mX
          const py = Cy + s2 * mY
          const pz = Cz + s1 * ez + s2 * mZ
          const o = this.idx3(k, i, jj)
          O[o] = lerp(hx, px, w) * sc
          O[o + 1] = lerp(hy, py, w) * sc
          O[o + 2] = lerp(hz, pz, w) * sc
          this.TH[o / 3] = th
          this.LAT[o / 3] = Math.abs(l) * sc
        }
      }

      // 法线：网格上的中心差分（左右影子列让相邻瓣的接缝法线一致）
      for (let i = 0; i <= NS; i++) {
        for (let jj = 1; jj <= NV + 1; jj++) {
          const o = this.idx3(k, i, jj)
          const ia = this.idx3(k, Math.min(NS, i + 1), jj)
          const ib = this.idx3(k, Math.max(0, i - 1), jj)
          const ja = this.idx3(k, i, jj + 1)
          const jb = this.idx3(k, i, jj - 1)
          const ax = O[ia] - O[ib]
          const ay = O[ia + 1] - O[ib + 1]
          const az = O[ia + 2] - O[ib + 2]
          const bx = O[ja] - O[jb]
          const by = O[ja + 1] - O[jb + 1]
          const bz = O[ja + 2] - O[jb + 2]
          let nx = ay * bz - az * by
          let ny = az * bx - ax * bz
          let nz = ax * by - ay * bx
          const l = Math.hypot(nx, ny, nz)
          if (l < 1e-9) {
            // 退化的点（几个格点挤在一处）：借上一行的法线，不能是零（零法线会算出坏像素，整片闪黑）
            const prev = i > 0 ? this.idx3(k, i - 1, jj) : -1
            if (prev >= 0 && Nm[prev] * Nm[prev] + Nm[prev + 1] * Nm[prev + 1] + Nm[prev + 2] * Nm[prev + 2] > 0.5) {
              nx = Nm[prev]
              ny = Nm[prev + 1]
              nz = Nm[prev + 2]
            } else {
              nx = 0
              ny = i > 0 ? 1 : -1
              nz = 0
            }
          } else {
            nx /= l
            ny /= l
            nz /= l
          }
          Nm[o] = nx
          Nm[o + 1] = ny
          Nm[o + 2] = nz
        }
      }
      // 两头是尖（蒂、果顶），法线借相邻一行
      for (let jj = 1; jj <= NV + 1; jj++) {
        const o0 = this.idx3(k, 0, jj)
        Nm[o0] = 0
        Nm[o0 + 1] = -1
        Nm[o0 + 2] = 0
        const oT = this.idx3(k, NS, jj)
        const oP = this.idx3(k, NS - 1, jj)
        Nm[oT] = Nm[oP]
        Nm[oT + 1] = Nm[oP + 1]
        Nm[oT + 2] = Nm[oP + 2]
      }
      // 内表面 = 外表面沿法线往里退一个皮厚
      for (let i = 0; i <= NS; i++) {
        for (let jj = 1; jj <= NV + 1; jj++) {
          const o = this.idx3(k, i, jj)
          const th = this.TH[o / 3]
          In[o] = O[o] - Nm[o] * th
          In[o + 1] = O[o + 1] - Nm[o + 1] * th
          In[o + 2] = O[o + 2] - Nm[o + 2] * th
        }
      }

      // 瓣尖往里折回（五爪）：每瓣离尖约 3 毫米的地方横着折一道，尖翻到内面上贴着，成截角；然后再整片对折
      if (tipAmt > 0) {
        const tip: Fold = {
          phi: Math.PI * tipAmt * (0.9 + 0.1 * st.press),
          fx: Math.sin(thk),
          fz: -Math.cos(thk),
          c: (Math.PI * R - TIP_FOLD) * sc,
          ya: lerp(0.12, 0.02, st.press) + tFold,
          rn: lerp(0.12, 0.02, st.press) + tFold / 2,
          sc,
          drop: 0,
          press: 0,
          n: this.n,
          dth: this.dth,
          half: this.half,
        }
        for (let i = 0; i <= NS; i++) {
          for (let jj = 1; jj <= NV + 1; jj++) {
            const o = this.idx3(k, i, jj)
            foldPoint(O, o, tip, Nm)
            foldPoint(In, o, tip, null)
          }
        }
      }
      // 整片对折：折线那一边的点绕着折线翻到上面来（内面对内面），折痕处按圆柱弯过去，不会穿插
      if (fold.phi > 0) {
        for (let i = 0; i <= NS; i++) {
          for (let jj = 1; jj <= NV + 1; jj++) {
            const o = this.idx3(k, i, jj)
            foldPoint(O, o, fold, Nm)
            foldPoint(In, o, fold, null)
          }
        }
      }
      if (waveAmp > 0) {
        for (let i = 0; i <= NS; i++) {
          for (let jj = 1; jj <= NV + 1; jj++) {
            const o = this.idx3(k, i, jj)
            // 上下两层用外皮那一点的位置算起伏，同一处起伏一样
            const wv = waveAmp * wave(O[o], O[o + 2])
            O[o + 1] += wv
            In[o + 1] += wv
          }
        }
      }
    }

    // 写进缓冲
    const P = this.pos.array as Float32Array
    const Nn = this.nrm.array as Float32Array
    const info = this.info.array as Float32Array
    const outerCount = this.n * (NS + 1) * (NV + 1)
    for (let k = 0; k < this.n; k++) {
      for (let i = 0; i <= NS; i++) {
        const scr = this.SCR[k * (NS + 1) + i]
        for (let j = 0; j <= NV; j++) {
          const src = this.idx3(k, i, j + 1)
          const vo = (k * (NS + 1) + i) * (NV + 1) + j
          const vi = outerCount + vo
          P[vo * 3] = O[src]
          P[vo * 3 + 1] = O[src + 1]
          P[vo * 3 + 2] = O[src + 2]
          Nn[vo * 3] = Nm[src]
          Nn[vo * 3 + 1] = Nm[src + 1]
          Nn[vo * 3 + 2] = Nm[src + 2]
          P[vi * 3] = In[src]
          P[vi * 3 + 1] = In[src + 1]
          P[vi * 3 + 2] = In[src + 2]
          Nn[vi * 3] = -Nm[src]
          Nn[vi * 3 + 1] = -Nm[src + 1]
          Nn[vi * 3 + 2] = -Nm[src + 2]
          info[vo * 4 + 3] = scr
          info[vi * 4 + 3] = scr
        }
      }
    }
    const wallRows = NS - I0 + 1
    for (let k = 0; k < this.n; k++) {
      for (let side = 0; side < 2; side++) {
        const j = side === 0 ? 1 : NV + 1
        const jIn = side === 0 ? 2 : NV
        for (let r = 0; r < wallRows; r++) {
          const i = I0 + r
          const src = this.idx3(k, i, j)
          const srcIn = this.idx3(k, i, jIn)
          // 墙的法线：沿着表面往瓣外指
          tmp.set(O[src] - O[srcIn], O[src + 1] - O[srcIn + 1], O[src + 2] - O[srcIn + 2])
          tmp2.set(Nm[src], Nm[src + 1], Nm[src + 2])
          tmp.addScaledVector(tmp2, -tmp.dot(tmp2))
          if (tmp.lengthSq() < 1e-12) tmp.copy(tmp2)
          tmp.normalize()
          const scr = this.SCR[k * (NS + 1) + i]
          for (let inner = 0; inner < 2; inner++) {
            const v = this.wallStart + ((k * 2 + side) * wallRows + r) * 2 + inner
            const S = inner ? In : O
            P[v * 3] = S[src]
            P[v * 3 + 1] = S[src + 1]
            P[v * 3 + 2] = S[src + 2]
            Nn[v * 3] = tmp.x
            Nn[v * 3 + 1] = tmp.y
            Nn[v * 3 + 2] = tmp.z
            info[v * 4 + 3] = scr
          }
        }
      }
    }
    this.pos.needsUpdate = true
    this.nrm.needsUpdate = true
    this.info.needsUpdate = true
  }

  /** 把当前形状拷成一份静态网格（成品那一摞用） */
  snapshot() {
    const g = new BufferGeometry()
    for (const name of ['position', 'normal', 'aRest', 'aInfo']) g.setAttribute(name, this.geometry.attributes[name].clone())
    g.setIndex(this.geometry.index!.clone())
    g.computeBoundingSphere()
    return g
  }
}

function pulpMaterial() {
  return procPhysical(
    { roughness: 0.45, metalness: 0, sheen: 0.6, sheenColor: new Color('#FFF6DA'), sheenRoughness: 0.4 },
    {
      uniforms: { uPulp: { value: new Color(FRUIT.pulp) }, uPith: { value: new Color(FRUIT.pith[1]) } },
      color: /* glsl */ `
        vec3 p = normalize(vPos);
        float az = atan(p.z, p.x);
        float seg = abs(cos(az * 6.5));
        float mem = 1.0 - smoothstep(0.0, 0.16, seg);
        float vesicle = voronoi3(vPos * 3.2).x;
        vec3 col = uPulp * (0.9 + 0.12 * smoothstep(0.1, 0.5, vesicle));
        col = mix(col, uPith, mem * 0.85);
        float fluff = fbm3(vPos * 2.2) * 0.5 + 0.5;
        col = mix(col, uPith, smoothstep(0.55, 0.8, fluff) * 0.5);
        diffuseColor.rgb = col;
        procBump = (1.0 - smoothstep(0.1, 0.45, vesicle)) * 0.03 - mem * 0.05;
      `,
      emissive: /* glsl */ `totalEmissiveRadiance += diffuseColor.rgb * 0.05;`,
      bump: true,
    },
  )
}
