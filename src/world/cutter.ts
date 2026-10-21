import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, LatheGeometry, Mesh, MeshPhysicalMaterial, Shape, Vector2, type BufferGeometry, type Material } from 'three'
import { procPhysical } from '../gfx/proc'
import { bambooMat, ironMat, woodMat } from './materials'

// 切药刀：一块长木座，刀在木座前沿一头用铁销铰住，另一头是木柄；刀往下一压，贴着木座前沿把伸出去的那一截切下来（像铡刀）。
// 本地坐标：木座顶面在 y = 0，前沿在 z = 0（东西放在 z < 0 那边，往 +z 推出去），木座沿 x，铰在 -x 头。
// 簸箕：竹编，后面和两边有沿，前面敞口。

function mesh(geo: BufferGeometry, mat: Material, cast = true) {
  const m = new Mesh(geo, mat)
  m.castShadow = cast
  m.receiveShadow = true
  return m
}

/** 刀身的钢：刃口一条磨亮的边 */
function bladeMat() {
  return procPhysical(
    { color: '#8E8A84', roughness: 0.4, metalness: 0.85 },
    {
      color: /* glsl */ `
        float n = fbm3(vPos * vec3(0.4, 2.0, 2.0)) * 0.5 + 0.5;
        diffuseColor.rgb *= 0.7 + 0.35 * n;
        float edge = 1.0 - smoothstep(0.0, 0.7, vPos.y + 2.5);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.85, 0.82), edge * 0.8);
        float rust = smoothstep(0.62, 0.82, fbm3(vPos * 0.5 + 4.0) * 0.5 + 0.5) * (1.0 - edge);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.22, 0.14), rust * 0.6);
      `,
      rough: /* glsl */ `roughnessFactor = mix(0.42, 0.22, edge) + rust * 0.3;`,
    },
  )
}

export const CUTTER = {
  /** 木座长、深、高 */
  len: 46,
  depth: 9,
  height: 6,
  /** 铰的位置（x）和高度 */
  pinX: -21,
  pinY: 2.2,
  /** 刀面离木座前沿多远 */
  bladeZ: 0.45,
}

export class Cutter {
  readonly group = new Group()
  /** 绕铰转的刀（转 rotation.z，正的是抬起来） */
  readonly blade = new Group()

  constructor() {
    const C = CUTTER
    const wood = woodMat({ axis: 'x', light: '#9A7656', dark: '#5C4130', seed: 51, worn: 0.5 })
    const bed = mesh(new BoxGeometry(C.len, C.height, C.depth), wood)
    bed.position.set(0, -C.height / 2, -C.depth / 2)
    this.group.add(bed)
    // 木座前沿包一条铁皮（刀贴着它切）
    const strip = mesh(new BoxGeometry(C.len - 4, 1.2, 0.3), ironMat({ rust: 0.3, polish: 0.4 }))
    strip.position.set(1, -0.6, 0.15)
    this.group.add(strip)
    // 铰座：两块铁板夹着刀根，一根铁销
    const iron = ironMat({ rust: 0.4 })
    for (const dz of [-0.1, 1.0]) {
      const plate = mesh(new BoxGeometry(3.2, 8.5, 0.35), iron)
      plate.position.set(C.pinX, C.pinY - 2.4, dz)
      this.group.add(plate)
    }
    const pin = mesh(new CylinderGeometry(0.42, 0.42, 1.9, 12), iron)
    pin.rotation.x = Math.PI / 2
    pin.position.set(C.pinX, C.pinY, 0.45)
    this.group.add(pin)

    // 刀：铁的刀身（刃口朝下，前头略宽），刀背一条厚边，后头接木柄
    this.blade.position.set(C.pinX, C.pinY, C.bladeZ)
    this.group.add(this.blade)
    const s = new Shape()
    s.moveTo(-1.2, 1.0)
    s.lineTo(34, 1.3)
    s.lineTo(34.5, -1.2)
    s.quadraticCurveTo(18, -3.4, 1.5, -2.8)
    s.lineTo(-1.2, -1.6)
    s.lineTo(-1.2, 1.0)
    const bladeGeo = new ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1, curveSegments: 12 })
    bladeGeo.translate(0, 0, -0.15)
    const bm = mesh(bladeGeo, bladeMat())
    this.blade.add(bm)
    const spine = mesh(new BoxGeometry(33, 0.5, 0.55), iron)
    spine.position.set(16.5, 1.05, 0)
    this.blade.add(spine)
    const handle = mesh(new CylinderGeometry(1.15, 1.35, 14, 14), woodMat({ axis: 'y', light: '#8A6444', dark: '#4E3828', seed: 52 }))
    handle.rotation.z = -Math.PI / 2 + 0.06
    handle.position.set(34 + 7, 0.6, 0)
    this.blade.add(handle)
    const ferrule = mesh(new CylinderGeometry(1.4, 1.4, 1.2, 14), iron)
    ferrule.rotation.z = -Math.PI / 2
    ferrule.position.set(34.4, 0.3, 0)
    this.blade.add(ferrule)
    this.setOpen(0.6)
  }

  /** 刀抬起多少（弧度，0 是压到底：刃口低过木座顶面一点） */
  setOpen(a: number) {
    this.blade.rotation.set(0, 0, a - 0.035)
  }
}

/** 簸箕：前面敞口、后面和两边起沿的竹编浅斗 */
export class Winnow {
  readonly group = new Group()
  /** 底面里能堆东西的范围（本地 xz）：半宽、前、后 */
  readonly halfW = 22
  readonly front = 20
  readonly back = -18

  constructor() {
    const mat = bambooMat({ w: 1.1, mode: 'flat', color: '#BE9A62', dark: '#7E6040' })
    // 底：一块平的竹编（前沿薄）
    const bottom = mesh(new BoxGeometry(48, 0.6, 42), mat)
    bottom.position.set(0, 0.3, 0)
    this.group.add(bottom)
    // 后沿和两边：从后往前渐低的弧形围子（半个碗转出来，压扁）
    const prof = [new Vector2(23.5, 0.2), new Vector2(24.2, 4), new Vector2(24.8, 9), new Vector2(24.4, 9.6), new Vector2(23.6, 8.8), new Vector2(23.0, 4), new Vector2(22.8, 0.6)]
    const wall = mesh(new LatheGeometry(prof, 48, Math.PI / 2, Math.PI), mat)
    wall.scale.set(1, 1, 0.9)
    wall.position.z = -1
    this.group.add(wall)
    // 两边往前越来越矮的围子
    for (const side of [-1, 1]) {
      const t = new Shape()
      t.moveTo(0, 0)
      t.lineTo(0, 9.4)
      t.lineTo(20.5, 1.2)
      t.lineTo(20.5, 0)
      t.lineTo(0, 0)
      const g = new ExtrudeGeometry(t, { depth: 0.7, bevelEnabled: false })
      g.rotateY(-Math.PI / 2)
      const m = mesh(g, mat)
      m.position.set(side * 23.6 + (side > 0 ? 0.35 : 0.35), 0.2, -1)
      this.group.add(m)
    }
    // 前沿压一根竹条
    const lip = mesh(new CylinderGeometry(0.5, 0.5, 46, 10), new MeshPhysicalMaterial({ color: '#B08A55', roughness: 0.6 }))
    lip.rotation.z = Math.PI / 2
    lip.position.set(0, 0.6, 20.6)
    this.group.add(lip)
  }
}
