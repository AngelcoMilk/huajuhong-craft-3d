import {
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  ExtrudeGeometry,
  Group,
  Mesh,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type MeshPhysicalMaterial,
  type Plane,
} from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { procPhysical } from '../gfx/proc'
import { FRUIT } from '../palette'
import { lerp, rng } from '../util'
import type { FruitSet } from './fruitset'
import { PEEL } from './peel'

// 压果片用的果：整果烫过以后用木板压扁成饼（边鼓起来、几道裂口），烘干、再压，最后切成 2～4 毫米的片。
// 资料里压果的大小没有记载，按体积推：直径 7.6 厘米的果压到 2.5 厘米左右厚，大约是直径 11～13 厘米的扁饼。
// 十个果压的程度一样，共用一份网格（CPU 上按压的程度重算）；主角另有一份材质（切片时要裁掉切下去的部分）。
// 果的原点就在果心。

const R = PEEL.R

/** 压的程度 p（0 整果 → 1 压透）对应的饼：半厚 b、半径 a、截面指数 n（2 是圆，越大越方） */
export function cakeShape(p: number) {
  const b = lerp(R, 1.25, p)
  const n = lerp(2, 3.4, Math.min(1, p * 1.2))
  // 体积大致不变（椭球 a²b = R³），截面变方以后体积变大，半径收一点
  const a = Math.sqrt((R * R * R) / b) * lerp(1, 0.86, p)
  return { a, b, n }
}

/** 截面（ρ, y）在压扁的饼上：单位圆上的 (cosθ, sinθ) 变成超椭圆 */
function profile(c: number, s: number, n: number) {
  const e = 2 / n
  return [Math.sign(c) * Math.pow(Math.abs(c), e), Math.sign(s) * Math.pow(Math.abs(s), e)]
}

/** 压果的材质：外皮和果皮一样随烫、干变色；压过以后边上几道裂口；切面（aCut=1）看得见外皮一圈、白瓤、压实的果肉 */
export function cakeMaterial(seed = 0) {
  const C = (h: string) => new Color(h)
  return procPhysical(
    { roughness: 0.6, metalness: 0, sheen: 1, sheenRoughness: 0.5, sheenColor: new Color('#ffffff'), clearcoat: 1, clearcoatRoughness: 0.3 },
    {
      uniforms: {
        uBlanch: { value: 0 },
        uWet: { value: 0 },
        uDry: { value: 0 },
        uPress: { value: 0 },
        uSeed: { value: seed },
        uA: { value: R },
        uB: { value: R },
        uN: { value: 2 },
        cSkin0: { value: C(FRUIT.skin[0]) },
        cSkin1: { value: C(FRUIT.skin[1]) },
        cBl0: { value: C(FRUIT.blanch[0]) },
        cBl1: { value: C(FRUIT.blanch[1]) },
        cDry0: { value: C('#4E4628') },
        cDry1: { value: C('#7A6336') },
        cPith: { value: C(FRUIT.pith[1]) },
        cPithDry: { value: C('#CDB98A') },
        cPulp: { value: C(FRUIT.pulp) },
        cPulpDry: { value: C('#B89A62') },
        cFuzz: { value: C('#E9EDDA') },
      },
      attributes: 'attribute vec3 aRest; attribute float aCut;',
      varyings: 'varying vec3 vRest; varying float vCut;',
      vertex: 'vRest = aRest; vCut = aCut;',
      color: /* glsl */ `
        vec3 rp = vRest;
        float mott = snoise(rp * 2.6 + uSeed) * 0.45 + snoise(rp * 7.3 + uSeed * 2.0) * 0.18;
        float lo = smoothstep(-0.8, 0.25, mott);
        vec3 col;
        float bump = 0.0;
        float outer = 1.0;
        if (vCut < 0.5) {
          vec3 fresh = mix(cSkin0, cSkin1, lo);
          vec3 bl = mix(cBl0, cBl1, lo);
          col = mix(fresh, bl, uBlanch);
          col = mix(col, mix(cDry0, cDry1, lo), uDry);
          vec3 gl = voronoi3(rp * 40.0 + uSeed);
          float gland = mix(0.12, 1.0 - smoothstep(0.1, 0.36, gl.x), aaFade3(rp * 40.0));
          col *= 1.0 - gland * 0.12;
          // 压过的饼：鼓起来的边上几道裂口（顺着经线），裂口里露出发白的瓤
          float rim = 1.0 - smoothstep(0.25, 0.75, abs(rp.y));
          float az = atan(rp.z, rp.x);
          float cr = abs(sin(az * 3.0 + uSeed * 1.7 + 0.6 * snoise(rp * 3.0)));
          float crack = (1.0 - smoothstep(0.0, 0.05, cr)) * rim * smoothstep(0.35, 0.9, uPress) * step(0.2, hash11(floor(az * 0.95 + 3.0) + uSeed));
          col = mix(col, mix(cPith, cPithDry, uDry) * 0.8, crack * 0.85);
          bump = -gland * 0.016 + mott * 0.008 - crack * 0.12;
          float hair = mix(0.2, step(0.8, hash13(floor(rp * 460.0))), aaFade3(rp * 460.0));
          col = mix(col, cFuzz, hair * 0.08 * (1.0 - uBlanch * 0.6));
        } else {
          // 切面：按离外表面多深分层（e 是超椭圆半径，1 在外表面）
          outer = 0.0;
          float rho = length(vPos.xz);
          float e = pow(pow(rho / uA, uN) + pow(abs(vPos.y) / uB, uN), 1.0 / uN);
          float skin = smoothstep(0.955, 0.975, e);
          float pith = smoothstep(0.84, 0.87, e);
          // 压实的果肉：一层层波浪似的囊衣
          float wph = (vPos.y / uB) * 9.0 + snoise(vPos * 0.9) * 2.0;
          float wav = mix(0.64, abs(sin(wph)), aaFade(vec2(wph / 3.1416)));
          vec3 pulp = mix(cPulp, cPulpDry, uDry) * (0.86 + 0.18 * smoothstep(0.0, 0.3, wav));
          col = mix(pulp, mix(cPith, cPithDry, uDry), pith);
          col = mix(col, mix(mix(cBl0, cDry0, uDry), cSkin0, 0.2), skin);
          bump = (1.0 - wav) * 0.01;
        }
        diffuseColor.rgb = col;
        procBump = bump;
      `,
      rough: /* glsl */ `roughnessFactor = outer > 0.5 ? mix(mix(0.6, 0.34, uWet), 0.8, uDry) : 0.85;`,
      physical: /* glsl */ `
        #ifdef USE_SHEEN
          material.sheenColor = cFuzz * outer * 0.25 * (1.0 - uDry * 0.5);
          material.sheenRoughness = 0.6;
        #endif
        #ifdef USE_CLEARCOAT
          material.clearcoat = outer * uWet * 0.75;
          material.clearcoatRoughness = 0.28;
        #endif
      `,
      bump: true,
    },
  )
}

export interface CakeLook {
  blanch: number
  wet: number
  dry: number
  press: number
}
export function setCakeLook(mat: MeshPhysicalMaterial, k: Partial<CakeLook>) {
  const u = (mat.userData.proc as { uniforms: Record<string, { value: number }> }).uniforms
  if (k.blanch !== undefined) u.uBlanch.value = k.blanch
  if (k.wet !== undefined) u.uWet.value = k.wet
  if (k.dry !== undefined) u.uDry.value = k.dry
  if (k.press !== undefined) {
    u.uPress.value = k.press
    const c = cakeShape(k.press)
    u.uA.value = c.a
    u.uB.value = c.b
    u.uN.value = c.n
  }
}

/** 一个压果（可压扁的整果）：单位球按 cakeShape 变形 */
class CakeGeometry {
  readonly geo: BufferGeometry
  private unit: Float32Array
  private last = -1
  constructor() {
    const s = new SphereGeometry(1, 64, 40)
    s.deleteAttribute('uv')
    s.deleteAttribute('normal')
    const g = mergeVertices(s)
    this.unit = (g.attributes.position.array as Float32Array).slice()
    ;(g.attributes.position as BufferAttribute).setUsage(DynamicDrawUsage)
    g.setAttribute('aRest', new BufferAttribute(this.unit.slice(), 3))
    g.setAttribute('aCut', new BufferAttribute(new Float32Array(g.attributes.position.count), 1))
    g.computeVertexNormals()
    this.geo = g
    this.set(0)
  }
  set(p: number) {
    if (Math.abs(p - this.last) < 1e-4) return
    this.last = p
    const { a, b, n } = cakeShape(p)
    const P = this.geo.attributes.position.array as Float32Array
    const U = this.unit
    for (let i = 0; i < U.length; i += 3) {
      const x = U[i]
      const y = U[i + 1]
      const z = U[i + 2]
      const rho = Math.hypot(x, z)
      const [pr, py] = profile(rho, y, n)
      const k = rho > 1e-6 ? (pr * a) / rho : 0
      P[i] = x * k
      P[i + 1] = py * b
      P[i + 2] = z * k
    }
    this.geo.attributes.position.needsUpdate = true
    this.geo.computeVertexNormals()
    this.geo.computeBoundingSphere()
  }
}

/** 一片：压果在 z = zc 处切下的一片（厚 d），截面形状按 cakeShape(p) 算 */
export function sliceGeometry(p: number, zc: number, d: number) {
  const { a, b, n } = cakeShape(p)
  const shape = new Shape()
  const M = 40
  const pts: [number, number][] = []
  const rho0 = Math.min(Math.abs(zc), a * 0.999)
  for (let i = 0; i <= M; i++) {
    // 沿截面边缘：ρ 从 |zc| 到 a 再回来；y 按超椭圆
    const t = i / M
    const rho = lerp(rho0, a, Math.sin((t * Math.PI) / 2))
    const yy = b * Math.pow(Math.max(0, 1 - Math.pow(rho / a, n)), 1 / n)
    pts.push([Math.sqrt(Math.max(0, rho * rho - zc * zc)), yy])
  }
  // 右上 → 右下 → 左下 → 左上（四个象限对称）
  const ring: [number, number][] = [...pts.map(([x, y]) => [x, y] as [number, number]), ...pts.slice().reverse().map(([x, y]) => [x, -y] as [number, number])]
  const full: [number, number][] = [...ring, ...ring.slice().reverse().map(([x, y]) => [-x, y] as [number, number])]
  shape.moveTo(full[0][0], full[0][1])
  for (let i = 1; i < full.length; i++) shape.lineTo(full[i][0], full[i][1])
  const g = new ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, curveSegments: 1 })
  g.translate(0, 0, -d / 2)
  // 片的本地坐标：x 横、y 上下、z 是切的方向。着色器按压果本地坐标算层次，所以 aRest 用压果坐标
  const pos = g.attributes.position
  const rest = new Float32Array(pos.count * 3)
  const cut = new Float32Array(pos.count).fill(1)
  for (let i = 0; i < pos.count; i++) {
    rest[i * 3] = pos.getX(i) / a
    rest[i * 3 + 1] = pos.getY(i) / b
    rest[i * 3 + 2] = (zc + pos.getZ(i)) / a
  }
  g.setAttribute('aRest', new BufferAttribute(rest, 3))
  g.setAttribute('aCut', new BufferAttribute(cut, 1))
  // vPos 要按压果坐标（z 方向加上 zc），着色器里用 vPos 算离外表面多深
  g.translate(0, 0, zc)
  return g
}

/** 十个压果：主角（0）和另外九个共用一份形状 */
export class CakeSet implements FruitSet {
  readonly count = 10
  readonly group = new Group()
  readonly heroGroup = new Group()
  readonly hero: Mesh
  readonly others: Mesh[] = []
  readonly shape = new CakeGeometry()
  readonly matHero: MeshPhysicalMaterial
  readonly matOthers: MeshPhysicalMaterial
  /** 切下来的片 */
  readonly matSlice: MeshPhysicalMaterial
  /** 还连在压果上、只画刀面外面那截的片 */
  readonly matSliceClip: MeshPhysicalMaterial
  readonly rots: Quaternion[] = []
  /** 主角切片时裁掉切下去的那部分（世界坐标的平面） */
  clip: Plane[] = []

  constructor() {
    this.matHero = cakeMaterial(0)
    this.matOthers = cakeMaterial(3)
    this.matSlice = cakeMaterial(5)
    this.matSliceClip = cakeMaterial(5)
    this.hero = new Mesh(this.shape.geo, this.matHero)
    this.hero.castShadow = true
    this.hero.receiveShadow = true
    this.heroGroup.add(this.hero)
    const r = rng(41)
    this.rots.push(new Quaternion())
    for (let i = 1; i < this.count; i++) {
      const m = new Mesh(this.shape.geo, this.matOthers)
      m.castShadow = true
      m.receiveShadow = true
      m.visible = false
      this.others.push(m)
      this.group.add(m)
      this.rots.push(new Quaternion().setFromAxisAngle(new Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), r() * Math.PI * 2))
    }
  }
  rot(i: number) {
    return this.rots[i]
  }
  setFruit(i: number, center: Vector3, q: Quaternion) {
    const m = this.others[i - 1]
    m.position.copy(center)
    m.quaternion.copy(q)
  }
  show(on: boolean) {
    for (const m of this.others) m.visible = on
  }
  /** 压的程度（十个一起） */
  press(p: number) {
    this.shape.set(p)
  }
  /** 果心离平面多高（压扁以后就是半厚） */
  lift(p: number) {
    return cakeShape(p).b
  }
}
