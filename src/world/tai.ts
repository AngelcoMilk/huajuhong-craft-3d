import {
  BufferAttribute,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
} from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { procPhysical, procStandard } from '../gfx/proc'
import { FRUIT } from '../palette'
import { rng, smoothstep } from '../util'
import type { FruitSet } from './fruitset'
import { woodMat } from './materials'

// 橘红胎：疏下来的小幼果，整个烘干。
// 形态照《化州县志》：圆球形或近似圆球柱形，直径约 1–5 厘米，表面青褐色或黄棕色，披白色密绒毛，果蒂明显，顶部稍凹。
// 一个果的网格按半径 1 做（果蒂朝下，果心在原点），每个果自己的大小、长圆一点、颜色偏向都不一样。

/** 小果的平均半径（厘米） */
export const TAI_R = 2.0

/** 半径 1 的小果：顶上微凹，底下一个凸起的果蒂和一小截果柄。aPart：0 果皮，1 果蒂 */
export function taiGeometry() {
  const sph = new SphereGeometry(1, 40, 28)
  sph.deleteAttribute('uv')
  sph.deleteAttribute('normal')
  const g0 = mergeVertices(sph)
  const p = g0.attributes.position
  const v = new Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const r = Math.hypot(v.x, v.z)
    // 顶部稍凹：顶上一小圈往下压
    if (v.y > 0) v.y -= 0.13 * (1 - smoothstep(0, 0.42, r)) * smoothstep(0.6, 1, v.y)
    // 底下靠果蒂那一圈微微收一点
    if (v.y < 0) {
      const k = smoothstep(-0.7, -1, v.y)
      v.x *= 1 - 0.06 * k
      v.z *= 1 - 0.06 * k
    }
    p.setXYZ(i, v.x, v.y, v.z)
  }
  g0.computeVertexNormals()
  // 果蒂：一块凸起的圆盘（萼片的痕）+ 一小截果柄
  const disc = new CylinderGeometry(0.17, 0.24, 0.07, 14)
  disc.translate(0, -0.985, 0)
  const stalk = new CylinderGeometry(0.045, 0.06, 0.08, 8)
  stalk.translate(0, -1.05, 0)
  const skin = g0.toNonIndexed()
  const parts: BufferGeometry[] = [skin]
  for (const s of [disc, stalk]) {
    s.deleteAttribute('uv')
    parts.push(s.toNonIndexed())
  }
  const g1 = mergeGeometries(parts)
  const part = new Float32Array(g1.attributes.position.count)
  part.fill(1, skin.attributes.position.count)
  g1.setAttribute('aPart', new BufferAttribute(part, 1))
  return g1
}

/** 小果的材质：鲜的深绿带绒，烫过转亮，烘干以后青褐到黄棕（每个果偏向不同），白绒越烘越显 */
export function taiMaterial() {
  const C = (h: string) => new Color(h)
  return procPhysical(
    { roughness: 0.7, metalness: 0, sheen: 1, sheenRoughness: 0.6, sheenColor: new Color('#ffffff'), clearcoat: 1, clearcoatRoughness: 0.3 },
    {
      uniforms: {
        uBlanch: { value: 0 },
        uWet: { value: 0 },
        uDry: { value: 0 },
        uFuzz: { value: 1 },
        cSkin0: { value: C(FRUIT.skin[0]) },
        cSkin1: { value: C(FRUIT.skin[1]) },
        cBl0: { value: C(FRUIT.blanch[0]) },
        cBl1: { value: C(FRUIT.blanch[1]) },
        cGreyBrown0: { value: C('#3F4630') },
        cGreyBrown1: { value: C('#5E6142') },
        cYellowBrown0: { value: C('#6E5532') },
        cYellowBrown1: { value: C('#9A7A48') },
        cFuzz: { value: C('#F1F0E6') },
        cStem: { value: C('#6E7240') },
        cStemDry: { value: C('#6A5634') },
      },
      attributes: 'attribute float aPart; attribute vec2 aVar;',
      varyings: 'varying float vPart; varying vec2 vVar;',
      vertex: `vPart = aPart;
#ifdef USE_INSTANCING
vVar = aVar;
#else
vVar = vec2(0.3, 0.7);
#endif`,
      color: /* glsl */ `
        vec3 rp = vPos + vVar.y * 17.0;
        float mott = snoise(rp * 2.2) * 0.5 + snoise(rp * 6.1) * 0.2;
        float lo = smoothstep(-0.7, 0.4, mott);
        vec3 fresh = mix(cSkin0, cSkin1, lo * 0.8);
        vec3 bl = mix(cBl0, cBl1, lo);
        vec3 col = mix(fresh, bl, uBlanch);
        // 烘干：每个果自己偏青褐还是偏黄棕（vVar.x），同一个果上也有深浅
        vec3 gb = mix(cGreyBrown0, cGreyBrown1, lo);
        vec3 yb = mix(cYellowBrown0, cYellowBrown1, lo);
        vec3 dry = mix(gb, yb, smoothstep(0.25, 0.8, vVar.x));
        col = mix(col, dry, uDry);
        vec3 gl = voronoi3(vPos * 22.0 + vVar.y * 5.0);
        float gland = mix(0.12, 1.0 - smoothstep(0.1, 0.36, gl.x), aaFade3(vPos * 22.0));
        col *= 1.0 - gland * mix(0.12, 0.2, uDry);
        // 顶上那一点凹进去的地方颜色深一点
        float apex = 1.0 - smoothstep(0.0, 0.3, length(vPos.xz)) ;
        apex *= step(0.5, vPos.y);
        col = mix(col, col * 0.62, apex * 0.7);
        // 密白绒：细细的亮点，烘干以后底色暗了更显
        float hair = mix(0.3, step(0.7, hash13(floor(vPos * 220.0 + vVar.y * 31.0))), aaFade3(vPos * 220.0));
        float fz = uFuzz * mix(0.12, 0.2, uDry);
        col = mix(col, cFuzz, hair * fz);
        float outer = 1.0 - step(0.5, vPart);
        if (vPart > 0.5) {
          col = mix(cStem, cStemDry, uDry) * (0.85 + 0.2 * snoise(vPos * 9.0));
        }
        diffuseColor.rgb = col;
        procBump = -gland * 0.006 + mott * 0.004 + hair * 0.002;
      `,
      rough: /* glsl */ `roughnessFactor = mix(mix(0.62, 0.36, uWet), 0.8, uDry);`,
      physical: /* glsl */ `
        #ifdef USE_SHEEN
          material.sheenColor = cFuzz * uFuzz * outer * mix(0.28, 0.2, uDry);
          material.sheenRoughness = 0.6;
        #endif
        #ifdef USE_CLEARCOAT
          material.clearcoat = outer * uWet * 0.7;
          material.clearcoatRoughness = 0.3;
        #endif
      `,
      bump: true,
    },
  )
}

export interface TaiLook {
  blanch: number
  wet: number
  dry: number
  fuzz: number
}
export function setTaiLook(mat: MeshPhysicalMaterial, k: Partial<TaiLook>) {
  const u = (mat.userData.proc as { uniforms: Record<string, { value: number }> }).uniforms
  if (k.blanch !== undefined) u.uBlanch.value = k.blanch
  if (k.wet !== undefined) u.uWet.value = k.wet
  if (k.dry !== undefined) u.uDry.value = k.dry
  if (k.fuzz !== undefined) u.uFuzz.value = k.fuzz
}

/**
 * 一批小果。0 是主角（单独一个网格，好跟镜头），其余的分两组画：烫过的一组、直接烘的一组（外观不一样）。
 * 每个果：半径、长圆、颜色偏向、自己固定的朝向都按种子定好。
 */
export class TaiBatch implements FruitSet {
  readonly group = new Group()
  readonly count: number
  readonly radius: number[] = []
  readonly stretch: number[] = []
  readonly rots: Quaternion[] = []
  /** 哪几个烫（主角总在里面） */
  readonly blanched: boolean[] = []
  readonly heroGroup = new Group()
  readonly heroMesh: InstancedMesh
  /** 主角的绒毛（特写看得见） */
  readonly fur: Group
  readonly matBlanched: MeshPhysicalMaterial
  readonly matRaw: MeshPhysicalMaterial
  readonly matHero: MeshPhysicalMaterial
  private meshB: InstancedMesh
  private meshR: InstancedMesh
  /** 第 i 个果在哪一组的第几个 */
  private slot: { mesh: InstancedMesh; k: number }[] = []
  /** 烘干缩了多少（1 是原大） */
  shrink = 1
  private d = new Object3D()

  constructor(count: number, blanchedCount: number, seed = 61) {
    this.count = count
    const r = rng(seed)
    for (let i = 0; i < count; i++) {
      this.radius.push(i === 0 ? 2.1 : 1.65 + r() * 0.6)
      this.stretch.push(1 + r() * r() * 0.14)
      // 侧躺着：果蒂朝旁边（朝下会把果柄扎进竹筛里），绕竖轴随便转
      const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.25 + r() * 0.9)
      this.rots.push(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), r() * Math.PI * 2).multiply(tilt))
    }
    // 烫哪几个：主角 + 单数号的（两组混在篮里）
    let n = 0
    for (let i = 0; i < count; i++) {
      const b = i === 0 || (i % 2 === 1 && n < blanchedCount)
      if (b) n++
      this.blanched.push(b)
    }
    const geo = taiGeometry()
    this.matBlanched = taiMaterial()
    this.matRaw = taiMaterial()
    this.matHero = taiMaterial()
    const nB = this.blanched.filter((b, i) => b && i > 0).length
    const nR = count - 1 - nB
    const mk = (n: number, mat: MeshPhysicalMaterial) => {
      const g = geo.clone()
      g.setAttribute('aVar', new InstancedBufferAttribute(new Float32Array(n * 2), 2))
      const m = new InstancedMesh(g, mat, Math.max(1, n))
      m.count = n
      m.castShadow = true
      m.receiveShadow = true
      m.frustumCulled = false
      this.group.add(m)
      return m
    }
    this.meshB = mk(nB, this.matBlanched)
    this.meshR = mk(nR, this.matRaw)
    this.heroMesh = mk(1, this.matHero)
    this.group.remove(this.heroMesh)
    this.heroGroup.add(this.heroMesh)
    this.fur = furShells(geo)
    this.heroGroup.add(this.fur)
    let kb = 0
    let kr = 0
    for (let i = 0; i < count; i++) {
      if (i === 0) this.slot.push({ mesh: this.heroMesh, k: 0 })
      else if (this.blanched[i]) this.slot.push({ mesh: this.meshB, k: kb++ })
      else this.slot.push({ mesh: this.meshR, k: kr++ })
      const s = this.slot[i]
      const a = s.mesh.geometry.attributes.aVar as InstancedBufferAttribute
      a.setXY(s.k, r(), r())
    }
    this.setHeroLocal()
  }

  /** 主角网格在主角组里：果心就在组的原点 */
  setHeroLocal() {
    const R = this.radius[0] * this.shrink
    this.d.position.set(0, 0, 0)
    this.d.quaternion.identity()
    this.d.scale.set(R, R * this.stretch[0], R)
    this.d.updateMatrix()
    this.heroMesh.setMatrixAt(0, this.d.matrix)
    this.heroMesh.instanceMatrix.needsUpdate = true
    this.fur.scale.copy(this.d.scale)
  }

  /** 果心离底多高（放在平面上时） */
  lift(i: number) {
    return this.radius[i] * this.shrink * this.stretch[i]
  }

  /** 第 i 个（≥1）果：果心、朝向 */
  setFruit(i: number, center: Vector3, q: Quaternion) {
    const s = this.slot[i]
    const R = this.radius[i] * this.shrink
    this.d.position.copy(center)
    this.d.quaternion.copy(q)
    this.d.scale.set(R, R * this.stretch[i], R)
    this.d.updateMatrix()
    s.mesh.setMatrixAt(s.k, this.d.matrix)
  }
  rot(i: number) {
    return this.rots[i]
  }
  show(on: boolean) {
    this.meshB.visible = on
    this.meshR.visible = on
    this.meshB.instanceMatrix.needsUpdate = true
    this.meshR.instanceMatrix.needsUpdate = true
  }
}

/**
 * 绒毛：在主角外面套几层壳，每层只留下一根根细毛的截面（越往外越细），近看就是一层白绒。
 * 只给主角加（特写看得见），一批里别的果靠材质里的绒光。
 */
export function furShells(geo: BufferGeometry, layers = 8, len = 0.03) {
  const g = new Group()
  for (let k = 1; k <= layers; k++) {
    const h = k / layers
    const mat = procStandard(
      { roughness: 0.8, metalness: 0, color: '#DCDACB' },
      {
        uniforms: { uH: { value: h }, uLen: { value: len } },
        vertex: /* glsl */ `transformed += normal * uLen * uH;`,
        discard: /* glsl */ `
          vec3 hp = vPos * 150.0 + vec3(0.0, 0.0, uH * 0.6);
          vec3 cell = floor(hp);
          vec3 jit = vec3(hash13(cell), hash13(cell + 3.1), hash13(cell + 7.7)) * 0.5 + 0.25;
          float rnd = hash13(cell + 11.0);
          float d = length(fract(hp) - jit);
          // 毛比像素还细（离得远）就不画，靠材质里的绒光（不然远看一闪一闪）
          vec3 fw = fwidth(hp);
          // 有的毛长有的短；越往外越细
          if (max(max(fw.x, fw.y), fw.z) > 0.45 || rnd < 0.5 || uH > 0.3 + 0.7 * (rnd - 0.5) * 2.0 || d > 0.17 * (1.0 - uH * 0.8)) discard;
        `,
        color: /* glsl */ `diffuseColor.rgb *= 0.82 + 0.25 * uH;`,
      },
    )
    const m = new Mesh(geo, mat)
    m.castShadow = false
    m.receiveShadow = true
    m.renderOrder = 1
    g.add(m)
  }
  return g
}

/** 装橘红胎的玻璃罐：厚底、口沿翻一圈，木盖另放（lid） */
export class Jar {
  readonly group = new Group()
  readonly lid = new Group()
  /** 罐里能放东西的半径、罐底内面高度 */
  readonly innerR = 6.5
  readonly floorY = 0.9
  readonly height = 19

  constructor() {
    const R = 7.0
    const H = this.height
    const prof = [
      [0.0001, 0],
      [R - 0.6, 0],
      [R, 0.5],
      [R, H - 1.4],
      [R - 0.3, H - 0.9],
      [R - 0.3, H - 0.4],
      [R + 0.25, H - 0.25],
      [R + 0.25, H],
      [R - 0.65, H],
      [R - 0.65, H - 0.9],
      [this.innerR, H - 1.5],
      [this.innerR, this.floorY + 0.4],
      [this.innerR - 0.4, this.floorY],
      [0.0001, this.floorY],
    ].map(([r, y]) => new Vector2(r, y))
    const glass = new MeshPhysicalMaterial({
      color: '#E6EFE8',
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      opacity: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      side: DoubleSide,
      depthWrite: false,
    })
    const body = new Mesh(new LatheGeometry(prof, 64), glass)
    body.renderOrder = 3
    this.group.add(body)
    // 木盖：一块圆木板加一个提钮
    const wood = woodMat({ axis: 'x', light: '#9C7A56', dark: '#5E4632', seed: 31 })
    const disk = new Mesh(new CylinderGeometry(R + 0.6, R + 0.6, 1.4, 48), wood)
    disk.position.y = 0.7
    const plug = new Mesh(new CylinderGeometry(R - 0.75, R - 0.8, 1.2, 40), wood)
    plug.position.y = -0.55
    const knob = new Mesh(new CylinderGeometry(1.2, 1.5, 1.6, 20), wood)
    knob.position.y = 2.2
    for (const m of [disk, plug, knob]) {
      m.castShadow = true
      m.receiveShadow = true
      this.lid.add(m)
    }
  }
}
