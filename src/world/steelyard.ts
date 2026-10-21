import {
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three'
import { procStandard } from '../gfx/proc'
import { ironMat, woodMat } from './materials'

// 杆秤：挂在灶边墙上一根木楔上，就挂着称。
// 秤杆（红褐色的硬木，头粗尾细）、铜秤星、铜秤头，提绳挂在木楔上；秤头下三根绳吊一只铜秤盘；铁秤砣用绳圈套在秤杆上，能来回挪。
// 秤按一斤十两刻：定盘星离提绳 3 厘米，往秤尾每两 2 厘米；半两一颗小星，一两一颗，五两三颗、十两五颗。
//
// 本地坐标：原点是提绳吊着秤杆的那一点（支点），秤杆沿 x，秤头（挂秤盘）在 +x，秤尾在 -x；+z 朝外（离墙）。
// 秤杆绕支点、绕 z 轴转（正的角度秤头往上翘）；秤盘、秤砣总是竖直吊着。

const HEAD = 9 // 秤头离支点
const HOOK = 7.4 // 秤盘绳挂在哪
const TAIL = -49 // 秤尾
const ZERO = 3 // 定盘星离支点（往秤尾）
const UNIT = 2 // 每两多少厘米
export const PAN_DROP = 17 // 秤盘绳长（挂钩到盘沿）
const PAN_R = 9
const HANG = 9 // 提绳：木楔到支点

function mesh(geo: BufferGeometry, mat: Material, cast = true) {
  const m = new Mesh(geo, mat)
  m.castShadow = cast
  m.receiveShadow = true
  return m
}

/** 秤杆半径：头粗尾细 */
function beamR(x: number) {
  const t = (HEAD - x) / (HEAD - TAIL)
  return 0.85 - 0.4 * t
}

function cordMat(color = '#8C7558') {
  return procStandard(
    { roughness: 0.85, metalness: 0 },
    {
      uniforms: { uC: { value: new Color(color) } },
      varyings: 'varying vec2 vTubeUv;',
      vertex: 'vTubeUv = uv;',
      color: /* glsl */ `
        float tw = mix(0.5, sin(vTubeUv.x * 600.0 + vTubeUv.y * 6.2832 * 2.0) * 0.5 + 0.5, aaFade(vec2(vTubeUv.x * 600.0 / 6.2832, vTubeUv.y * 2.0)));
        diffuseColor.rgb = uC * (0.75 + 0.35 * tw);
        procBump = tw * 0.012;
      `,
      bump: true,
    },
  )
}

const brass = () => new MeshPhysicalMaterial({ color: '#B58E4E', metalness: 1, roughness: 0.34, clearcoat: 0.2 })
/** 用旧了的铜盘：有点发暗、边上磨亮 */
function panMat() {
  return procStandard(
    { roughness: 0.42, metalness: 0.9, color: '#A98448' },
    {
      uniforms: { uB: { value: new Color('#A98448') } },
      color: /* glsl */ `
        float n = fbm3(vPos * 0.5) * 0.5 + 0.5;
        float rim = smoothstep(7.5, 9.0, length(vPos.xz));
        vec3 col = mix(uB * 0.62, uB * 1.08, n * 0.6 + rim * 0.5);
        col = mix(col, vec3(0.33, 0.36, 0.28), smoothstep(0.62, 0.8, fbm3(vPos * 0.9 + 7.0) * 0.5 + 0.5) * 0.35);
        diffuseColor.rgb = col;
      `,
      rough: /* glsl */ `roughnessFactor = 0.34 + n * 0.2;`,
    },
  )
}

export class Steelyard {
  /** 挂在墙上的整杆秤（位置是木楔伸出来的那头） */
  readonly group = new Group()
  /** 绕支点转的秤杆 */
  readonly beam = new Group()
  readonly pan = new Group()
  readonly weight = new Group()
  /** 秤盘里放东西的那一点（盘底中心，秤盘本地坐标） */
  readonly panFloor = new Vector3(0, -PAN_DROP - 1.7, 0)
  private pivot = new Vector3(0, -HANG, 0)
  private loop: Mesh

  constructor() {
    const g = this.group
    const wood = woodMat({ axis: 'x', light: '#8C5034', dark: '#4A2718', ring: 3.2, rough: 0.42, worn: 0.15, seed: 21 })
    const cord = cordMat()

    // 木楔：斜插进墙里，伸出来 12 厘米，往上翘一点，绳挂在头上
    const peg = mesh(new CylinderGeometry(0.62, 0.8, 13, 12), woodMat({ axis: 'y', light: '#7A5A40', dark: '#4E3828', seed: 22 }))
    peg.rotation.x = Math.PI / 2 - 0.12
    peg.position.set(0, 0.6, -6)
    g.add(peg)

    // 提绳：从木楔垂到支点，绕秤杆一圈
    const hang = new CatmullRomCurve3([new Vector3(-0.5, 0.9, -0.2), new Vector3(0, -1.2, 0), new Vector3(0, -HANG + 1.2, 0)])
    g.add(mesh(new TubeGeometry(hang, 16, 0.14, 6, false), cord))
    const hang2 = new CatmullRomCurve3([new Vector3(0.5, 0.9, 0.2), new Vector3(0.05, -1.2, 0.05), new Vector3(0.05, -HANG + 1.2, 0.05)])
    g.add(mesh(new TubeGeometry(hang2, 16, 0.14, 6, false), cord))
    // 提纽：一只铜环
    const ring = mesh(new TorusGeometry(1.05, 0.16, 8, 20), brass())
    ring.position.copy(this.pivot)
    ring.rotation.y = Math.PI / 2
    g.add(ring)

    // 秤杆：车出来的硬木，沿 x
    this.beam.position.copy(this.pivot)
    g.add(this.beam)
    const prof: Vector2[] = []
    const n = 24
    for (let i = 0; i <= n; i++) {
      const x = TAIL + ((HEAD - TAIL) * i) / n
      prof.push(new Vector2(beamR(x), x))
    }
    prof.unshift(new Vector2(0.0001, TAIL))
    prof.push(new Vector2(0.0001, HEAD))
    const beamGeo = new LatheGeometry(prof, 20)
    beamGeo.rotateZ(-Math.PI / 2)
    const beamMesh = mesh(beamGeo, wood)
    this.beam.add(beamMesh)
    // 秤头、秤尾的铜箍
    const capH = mesh(new CylinderGeometry(beamR(HEAD) + 0.08, beamR(HEAD) + 0.08, 2.0, 20), brass())
    capH.rotation.z = Math.PI / 2
    capH.position.x = HEAD - 1.0
    this.beam.add(capH)
    const capT = mesh(new CylinderGeometry(beamR(TAIL) + 0.07, beamR(TAIL) + 0.07, 1.4, 16), brass())
    capT.rotation.z = Math.PI / 2
    capT.position.x = TAIL + 0.7
    this.beam.add(capT)
    // 挂秤盘的小铜钩环（秤头底下）
    const eye = mesh(new TorusGeometry(0.45, 0.1, 6, 14), brass())
    eye.position.set(HOOK, -beamR(HOOK) - 0.35, 0)
    this.beam.add(eye)

    // 秤星：嵌在秤杆朝外偏上的那一面
    const stars: { x: number; s: number; dy: number }[] = [{ x: -ZERO, s: 1.3, dy: 0 }]
    for (let h = 1; h <= 44; h++) {
      const w = h / 2 // 两
      const x = -(ZERO + w * UNIT)
      if (x < TAIL + 1.6) break
      if (w % 10 === 0) for (const [dx, dy] of [[0, 0], [0.32, 0.28], [-0.32, 0.28], [0.32, -0.28], [-0.32, -0.28]]) stars.push({ x: x + dx, s: 0.9, dy })
      else if (w % 5 === 0) for (const [dx, dy] of [[0, 0.3], [0.3, -0.18], [-0.3, -0.18]]) stars.push({ x: x + dx, s: 0.9, dy })
      else stars.push({ x, s: Number.isInteger(w) ? 1 : 0.7, dy: 0 })
    }
    const starMesh = new InstancedMesh(new SphereGeometry(0.1, 8, 6), new MeshPhysicalMaterial({ color: '#E2C88A', metalness: 1, roughness: 0.22 }), stars.length)
    const d = new Object3D()
    const phi = 0.55 // 从 +z 往上转多少
    stars.forEach((st, i) => {
      const r = beamR(st.x)
      const a = phi + st.dy / r
      d.position.set(st.x, Math.sin(a) * r, Math.cos(a) * r)
      d.scale.setScalar(st.s)
      d.updateMatrix()
      starMesh.setMatrixAt(i, d.matrix)
    })
    this.beam.add(starMesh)

    // 秤盘：三根绳吊着的浅铜盘
    const panProf = [new Vector2(0.0001, -1.9), new Vector2(5.5, -1.9), new Vector2(7.6, -1.3), new Vector2(PAN_R, 0), new Vector2(PAN_R + 0.15, 0.12), new Vector2(PAN_R - 0.1, 0.1), new Vector2(7.5, -1.15), new Vector2(5.4, -1.7), new Vector2(0.0001, -1.7)]
    const panMesh = mesh(new LatheGeometry(panProf, 48), panMat())
    panMesh.position.y = -PAN_DROP
    this.pan.add(panMesh)
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.3
      const top = new Vector3(0, -0.2, 0)
      const bot = new Vector3(Math.cos(a) * (PAN_R - 0.4), -PAN_DROP + 0.15, Math.sin(a) * (PAN_R - 0.4))
      const c = new CatmullRomCurve3([top, top.clone().lerp(bot, 0.5), bot])
      this.pan.add(mesh(new TubeGeometry(c, 8, 0.08, 5, false), cord))
      const hole = mesh(new TorusGeometry(0.22, 0.06, 5, 10), brass())
      hole.position.copy(bot)
      this.pan.add(hole)
    }
    const knot = mesh(new SphereGeometry(0.3, 10, 8), cord)
    knot.position.y = -0.1
    this.pan.add(knot)
    g.add(this.pan)

    // 秤砣：铁铸的，上小下大带一圈腰，顶上一个鼻子；用绳圈套在秤杆上
    const wProf = [
      [0.0001, -7.6],
      [1.5, -7.6],
      [1.9, -7.2],
      [1.95, -6.2],
      [1.6, -5.2],
      [1.1, -4.7],
      [1.25, -4.4],
      [1.0, -3.9],
      [0.6, -3.7],
      [0.0001, -3.7],
    ].map(([r, y]) => new Vector2(r, y))
    const wMesh = mesh(new LatheGeometry(wProf, 24), ironMat({ rust: 0.35 }))
    this.weight.add(wMesh)
    const nose = mesh(new TorusGeometry(0.45, 0.16, 6, 12), ironMat({ rust: 0.2 }))
    nose.position.y = -3.35
    this.weight.add(nose)
    const wc = new CatmullRomCurve3([new Vector3(0, 0, 0), new Vector3(0, -1.5, 0), new Vector3(0, -3.0, 0)])
    this.weight.add(mesh(new TubeGeometry(wc, 6, 0.09, 5, false), cord))
    g.add(this.weight)
    // 套在秤杆上的绳圈（跟着秤杆转）
    this.loop = mesh(new TorusGeometry(1.0, 0.1, 6, 16), cord)
    this.loop.rotation.y = Math.PI / 2
    this.beam.add(this.loop)

    this.set(0, 0)
  }

  /** 第 w 两在秤杆上的位置（本地 x） */
  static armX(w: number) {
    return -(ZERO + w * UNIT)
  }

  /**
   * angle：秤杆转多少（正的秤头翘），w：秤砣挪到第几两（0 是定盘星），sway：秤盘前后晃（弧度）
   */
  set(angle: number, w: number, sway = 0) {
    this.beam.rotation.set(0, 0, angle)
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    // 秤盘：挂在秤头底下那一点，竖直吊着（只跟着晃一点）
    const hx = HOOK
    const hy = -beamR(HOOK) - 0.7
    this.pan.position.set(this.pivot.x + hx * c - hy * s, this.pivot.y + hx * s + hy * c, 0)
    this.pan.rotation.set(sway, 0, sway * 0.4)
    // 秤砣：绳圈在秤杆上 x 处，砣竖直吊着
    const x = Steelyard.armX(w)
    const ly = -beamR(x) + 0.05
    this.loop.position.set(x, 0, 0)
    this.loop.scale.setScalar((beamR(x) + 0.12) / 1.0)
    this.weight.position.set(this.pivot.x + x * c - ly * s, this.pivot.y + x * s + ly * c, 0)
    this.weight.rotation.set(0, 0, 0)
  }

  /** 秤盘底（放东西的那一点）在世界里的位置 */
  panFloorWorld(out: Vector3) {
    this.group.updateMatrixWorld()
    return out.copy(this.panFloor).applyMatrix4(this.pan.matrixWorld)
  }
  /** 秤砣绳圈在世界里的位置（镜头推近看读数用） */
  readWorld(out: Vector3) {
    this.group.updateMatrixWorld()
    return out.copy(this.loop.position).applyMatrix4(this.beam.matrixWorld)
  }
}
