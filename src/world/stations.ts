import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  Object3D,
  Path,
  PointLight,
  Shape,
  Vector3,
  Vector4,
} from 'three'
import { procStandard } from '../gfx/proc'
import { rng } from '../util'
import { Motes } from './fx'
import { LAYOUT } from './layout'
import { brickMat, woodMat } from './materials'
import { DRY_SLOTS } from './batch'
import { roundSieve, SOOT_INSET, sootMat } from './stove'

// 晒的地方（两张矮凳架一面大竹匾）和焙炉（砖砌小烘炉，炉口炭火，上面隔一面大竹筛：烫完沥水、再焙都用它）。

function stool(seed: number) {
  const g = new Group()
  const w = woodMat({ axis: 'x', seed, light: '#94704F', dark: '#5A3F2D', plank: 10 })
  const wl = woodMat({ axis: 'y', seed: seed + 1, light: '#8A6447', dark: '#4E372A' })
  const top = new Mesh(new BoxGeometry(34, 3.5, 22), w)
  top.position.y = 44 - 1.75
  top.castShadow = top.receiveShadow = true
  g.add(top)
  for (const [x, z] of [[-13, -7], [13, -7], [-13, 7], [13, 7]]) {
    const leg = new Mesh(new CylinderGeometry(1.6, 1.9, 42.5, 8), wl)
    leg.position.set(x, 42.5 / 2, z)
    leg.rotation.set(z > 0 ? -0.06 : 0.06, 0, x > 0 ? 0.08 : -0.08)
    leg.castShadow = leg.receiveShadow = true
    g.add(leg)
  }
  const bar = new Mesh(new BoxGeometry(26, 2.5, 2.5), wl)
  bar.position.y = 14
  bar.castShadow = true
  g.add(bar)
  return g
}

export class DryingRack {
  readonly group = new Group()
  readonly sieve: Group
  /** 主角在竹匾正中；其余九片的位置见 batch.ts 的 DRY_SLOTS */
  readonly heroSlot = { pos: new Vector3(), rot: DRY_SLOTS[0].rot }

  constructor() {
    const D = LAYOUT.dry
    const s1 = stool(51)
    // 凳面比竹匾底略低一点，免得凳面从竹匾底透上来（同一高度会闪）
    s1.position.set(D.x - 26, -0.6, D.z)
    s1.rotation.y = 0.05
    const s2 = stool(53)
    s2.position.set(D.x + 26, -0.6, D.z + 2)
    s2.rotation.y = -0.04
    this.group.add(s1, s2)
    this.sieve = roundSieve(50, 5, { w: 1.5 })
    this.sieve.position.set(D.x, 44, D.z)
    this.group.add(this.sieve)
    this.heroSlot.pos.set(D.x + DRY_SLOTS[0].x, LAYOUT.dryY, D.z + DRY_SLOTS[0].z)
  }
}

export class Oven {
  readonly group = new Group()
  readonly sieve: Group
  readonly glowI = { value: 1 }
  readonly light: PointLight
  readonly upLight: PointLight
  readonly sparks: Motes
  private coalMat

  constructor() {
    const g = this.group
    const O = LAYOUT.oven
    const w = 66
    const d = 58
    // 炉顶砖沿（挤出 5.2 + 倒角 0.8）比竹筛底低 0.15，两个面不能在同一高度，不然会闪
    const h = LAYOUT.ovenTop - 6.15
    const front = O.z + d / 2
    const brick = brickMat({ plasterTop: true, whitewash: 0.2, soot: new Vector4(O.x, 18, front, 30) })
    const fs = new Shape()
    fs.moveTo(-w / 2, 0)
    fs.lineTo(w / 2, 0)
    fs.lineTo(w / 2, h)
    fs.lineTo(-w / 2, h)
    fs.closePath()
    const mouth = new Path()
    mouth.moveTo(-12, 6)
    mouth.lineTo(12, 6)
    mouth.lineTo(12, 16)
    mouth.absarc(0, 16, 12, 0, Math.PI, false)
    mouth.lineTo(-12, 6)
    fs.holes.push(mouth)
    const fw = new Mesh(new ExtrudeGeometry(fs, { depth: 9, bevelEnabled: false, curveSegments: 12 }), brick)
    fw.position.set(O.x, 0, front - 9)
    fw.castShadow = fw.receiveShadow = true
    g.add(fw)
    const wall = (bw: number, bd: number, x: number, z: number) => {
      const m = new Mesh(new BoxGeometry(bw, h, bd), brick)
      m.position.set(x, h / 2, z)
      m.castShadow = m.receiveShadow = true
      g.add(m)
    }
    wall(9, d - 9, O.x - w / 2 + 4.5, O.z - 4.5)
    wall(9, d - 9, O.x + w / 2 - 4.5, O.z - 4.5)
    wall(w - 18, 9, O.x, O.z - d / 2 + 4.5)
    // 炉膛：和灶膛一样往里缩、离地抬一点，不和墙、地、炉顶砖沿底面重在一起
    const inH = h - 0.8 - 2 * SOOT_INSET
    const inside = new Mesh(new BoxGeometry(w - 18 - 2 * SOOT_INSET, inH, d - 18 - 2 * SOOT_INSET), sootMat())
    inside.position.set(O.x, SOOT_INSET + inH / 2, O.z)
    g.add(inside)
    // 顶：一圈砖沿，中间圆口
    const ts = new Shape()
    ts.moveTo(-w / 2 - 1, -d / 2 - 1)
    ts.lineTo(w / 2 + 1, -d / 2 - 1)
    ts.lineTo(w / 2 + 1, d / 2 + 1)
    ts.lineTo(-w / 2 - 1, d / 2 + 1)
    ts.closePath()
    const hole = new Path()
    hole.absarc(0, 0, 19, 0, Math.PI * 2, true)
    ts.holes.push(hole)
    const slab = new Mesh(new ExtrudeGeometry(ts, { depth: 5.2, bevelEnabled: true, bevelSize: 0.8, bevelThickness: 0.8, bevelSegments: 1, curveSegments: 40 }), brick)
    slab.rotation.x = -Math.PI / 2
    slab.position.set(O.x, h, O.z)
    slab.castShadow = slab.receiveShadow = true
    g.add(slab)

    // 炭：一堆变形的二十面体，裂缝里透红光，亮度是稳的（一起伏，从炉口照出来就像闪屏）
    this.coalMat = procStandard(
      { roughness: 0.95, metalness: 0, color: '#2a2424' },
      {
        uniforms: { uGlow: this.glowI },
        color: /* glsl */ `
          vec3 v = voronoi3(vPos * 0.55 + 3.0);
          float crack = 1.0 - smoothstep(0.0, 0.12, v.y);
          float n = fbm3(vPos * 0.3) * 0.5 + 0.5;
          diffuseColor.rgb = mix(vec3(0.09, 0.08, 0.08), vec3(0.32, 0.3, 0.29), smoothstep(0.4, 0.8, n) * 0.6);
          float glow = (crack * 0.9 + smoothstep(0.55, 0.9, n) * 0.5) * uGlow;
        `,
        emissive: /* glsl */ `totalEmissiveRadiance += vec3(1.0, 0.36, 0.08) * glow * 3.2;`,
      },
    )
    const coal = new InstancedMesh(new IcosahedronGeometry(3, 0), this.coalMat, 26)
    const dummy = new Object3D()
    const r = rng(4)
    for (let i = 0; i < 26; i++) {
      dummy.position.set(O.x + (r() - 0.5) * 34, 4 + r() * 7, O.z + (r() - 0.5) * 30)
      dummy.rotation.set(r() * 6, r() * 6, r() * 6)
      dummy.scale.set(0.8 + r() * 0.8, 0.6 + r() * 0.6, 0.8 + r() * 0.7)
      dummy.updateMatrix()
      coal.setMatrixAt(i, dummy.matrix)
    }
    coal.castShadow = true
    g.add(coal)

    this.light = new PointLight('#FF8A3A', 3000, 0, 2)
    this.light.position.set(O.x, 18, front + 6)
    g.add(this.light)
    this.upLight = new PointLight('#FF9A4E', 2500, 0, 2)
    this.upLight.position.set(O.x, h - 6, O.z)
    g.add(this.upLight)

    // 竹筛搁在炉口上：隔着筛焙
    this.sieve = roundSieve(LAYOUT.ovenSieveR, 3.4, { w: 1.2 })
    this.sieve.position.set(O.x, LAYOUT.ovenTop, O.z)
    g.add(this.sieve)

    this.sparks = new Motes({ count: 26, life: 2.6, box: new Vector3(26, 2, 26), rise: 46, size: 0.7, color: '#FFB060', seed: 12, jitter: 2.5 })
    this.sparks.set(new Vector3(O.x, h + 8, O.z), 1)
    g.add(this.sparks.mesh)
  }
}
