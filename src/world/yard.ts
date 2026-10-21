import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Path,
  PlaneGeometry,
  PointLight,
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { procStandard, procPhysical } from '../gfx/proc'
import { P } from '../palette'
import { rng } from '../util'
import { LAYOUT } from './layout'
import { brickMat, cementMat, clayMat, plasterMat, stoneMat, tileMat, woodMat } from './materials'

// 院子：水泥地、老屋正面（灰墙、石门框、木门、木窗、青瓦屋檐）、两边的矮砖墙、水缸、花盆、
// 屋檐下的灯泡，远处的树和山。

function box(w: number, h: number, d: number, mat: Material, x: number, y: number, z: number, cast = true) {
  const m = new Mesh(new BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  m.castShadow = cast
  m.receiveShadow = true
  return m
}

export class Yard {
  readonly group = new Group()
  readonly bulb: Mesh
  readonly bulbLight: PointLight
  readonly bulbMat: MeshStandardMaterial
  readonly interiorLight: PointLight

  constructor() {
    const g = this.group
    const W = LAYOUT.wallZ

    // 地
    const ground = new Mesh(new PlaneGeometry(9000, 9000), cementMat())
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    g.add(ground)

    // 正面的墙：一整块挤出来，挖出门洞和窗洞
    const s = new Shape()
    s.moveTo(-470, 0)
    s.lineTo(470, 0)
    s.lineTo(470, 345)
    s.lineTo(-470, 345)
    s.closePath()
    const door = LAYOUT.door
    const dw = 110
    const dh = 228
    const hole = new Path()
    hole.moveTo(door.x - dw / 2, 14)
    hole.lineTo(door.x + dw / 2, 14)
    hole.lineTo(door.x + dw / 2, 14 + dh)
    hole.lineTo(door.x - dw / 2, 14 + dh)
    hole.closePath()
    s.holes.push(hole)
    const win = LAYOUT.window
    const ww = 104
    const wy0 = 108
    const wy1 = 208
    const wh = new Path()
    wh.moveTo(win.x - ww / 2, wy0)
    wh.lineTo(win.x + ww / 2, wy0)
    wh.lineTo(win.x + ww / 2, wy1)
    wh.lineTo(win.x - ww / 2, wy1)
    wh.closePath()
    s.holes.push(wh)
    const wallGeo = new ExtrudeGeometry(s, { depth: 34, bevelEnabled: false, curveSegments: 4 })
    const wall = new Mesh(wallGeo, plasterMat({ color: '#E0D3BE', dampH: 70 }))
    wall.position.z = W - 34
    wall.castShadow = true
    wall.receiveShadow = true
    g.add(wall)

    // 墙脚一圈青砖勒脚，门口断开
    const plinthMat = brickMat({ brick: '#7F8086', mortar: '#B9B4AA', whitewash: 0.15 })
    const px0 = -470
    const px1 = door.x - dw / 2 - 18
    const px2 = door.x + dw / 2 + 18
    g.add(box(px1 - px0, 48, 6, plinthMat, (px0 + px1) / 2, 24, W + 2))
    g.add(box(470 - px2, 48, 6, plinthMat, (px2 + 470) / 2, 24, W + 2))

    // 石门框 + 门槛 + 门里的暗屋
    const granite = stoneMat({ color: '#9A958C' })
    g.add(box(18, dh + 32, 12, granite, door.x - dw / 2 - 9, (dh + 32) / 2 - 2, W + 4))
    g.add(box(18, dh + 32, 12, granite, door.x + dw / 2 + 9, (dh + 32) / 2 - 2, W + 4))
    g.add(box(dw + 54, 22, 14, granite, door.x, dh + 14 + 11, W + 5))
    g.add(box(dw + 30, 14, 40, granite, door.x, 7, W + 4))
    const leafMat = woodMat({ axis: 'y', light: '#7C5A43', dark: '#4A3427', plank: 9, seed: 3, worn: 0.5 })
    for (const side of [-1, 1]) {
      const leaf = box(dw / 2, dh - 4, 5, leafMat, 0, 0, 0)
      leaf.position.set(side * dw / 4, (dh - 4) / 2, 0)
      const hinge = new Group()
      hinge.position.set(door.x + side * dw / 2, 14, W - 20)
      hinge.rotation.y = side * 1.25
      hinge.add(leaf)
      leaf.position.x = -side * dw / 4
      g.add(hinge)
    }
    // 屋里：暗，一张八仙桌、一条长凳的轮廓
    const roomMat = plasterMat({ color: '#6A6056', damp: '#4E463F' })
    const room = new Mesh(new BoxGeometry(900, 360, 420), roomMat)
    ;(room.material as Material).side = BackSide
    // 屋里的地比院子的地高一点点，两个面不重合（不然从门口看进去地面会闪）
    room.position.set(0, 180.3, W - 34 - 210)
    room.receiveShadow = true
    g.add(room)
    const darkWood = woodMat({ axis: 'x', light: '#5E4535', dark: '#3A2A22', seed: 7 })
    const tableIn = new Group()
    tableIn.add(box(90, 5, 90, darkWood, 0, 82, 0))
    for (const [x, z] of [[-40, -40], [40, -40], [-40, 40], [40, 40]]) tableIn.add(box(6, 80, 6, darkWood, x, 40, z))
    tableIn.position.set(door.x + 40, 0, W - 34 - 230)
    g.add(tableIn)
    g.add(box(120, 4, 26, darkWood, door.x - 70, 46, W - 34 - 160))
    // 屋里一盏暖光，结尾时亮起
    this.interiorLight = new PointLight('#FFB56E', 0, 0, 2)
    this.interiorLight.position.set(door.x + 20, 210, W - 34 - 200)
    g.add(this.interiorLight)

    // 木窗：框 + 九根直棂
    const winWood = woodMat({ axis: 'y', light: '#6B4C38', dark: '#40302A', seed: 5 })
    const wg = new Group()
    wg.add(box(ww + 14, 8, 14, winWood, 0, wy0 - 4, 0))
    wg.add(box(ww + 14, 8, 14, winWood, 0, wy1 + 4, 0))
    wg.add(box(8, wy1 - wy0 + 16, 14, winWood, -ww / 2 - 3, (wy0 + wy1) / 2, 0))
    wg.add(box(8, wy1 - wy0 + 16, 14, winWood, ww / 2 + 3, (wy0 + wy1) / 2, 0))
    for (let i = 1; i <= 9; i++) wg.add(box(3.2, wy1 - wy0, 3.2, winWood, -ww / 2 + (ww * i) / 10, (wy0 + wy1) / 2, 0))
    wg.position.set(win.x, 0, W - 17)
    g.add(wg)
    g.add(box(ww + 30, 5, 18, granite, win.x, wy0 - 9, W + 2))

    // 屋檐：一整面坡瓦，带瓦垄；下面是椽子和封檐板
    const roof = this.roof()
    g.add(roof)

    // 两边矮院墙
    const sideWall = brickMat({ whitewash: 0.45 })
    g.add(box(24, 190, 760, sideWall, -482, 95, 70))
    g.add(box(24, 190, 760, sideWall, 482, 95, 70))
    const coping = tileMat()
    g.add(box(36, 8, 764, coping, -482, 194, 70))
    g.add(box(36, 8, 764, coping, 482, 194, 70))

    // 水缸 + 木盖 + 水瓢
    const jar = new Mesh(
      new LatheGeometry(
        [
          new Vector2(0, 0),
          new Vector2(24, 0),
          new Vector2(30, 6),
          new Vector2(37, 26),
          new Vector2(38, 44),
          new Vector2(34, 62),
          new Vector2(31, 68),
          new Vector2(33, 70),
          new Vector2(32.5, 72),
          new Vector2(29, 71),
          new Vector2(28, 64),
        ],
        40,
      ),
      procPhysical(
        { roughness: 0.3, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25, side: 2 },
        {
          uniforms: { uGlaze: { value: new Color('#5A3A2A') } },
          color: /* glsl */ `
            float n = fbm3(vPos * 0.08) * 0.5 + 0.5;
            vec3 col = uGlaze * (0.75 + 0.45 * n);
            float drip = smoothstep(0.55, 0.75, fbm3(vec3(vPos.x * 0.1, vPos.y * 0.02, vPos.z * 0.1)) * 0.5 + 0.5);
            col = mix(col, col * 1.5, drip * step(30.0, vPos.y));
            col = mix(col, vec3(0.62, 0.48, 0.36), 1.0 - smoothstep(14.0, 16.0, vPos.y));
            diffuseColor.rgb = col;
          `,
        },
      ),
    )
    jar.position.copy(LAYOUT.jar)
    jar.castShadow = jar.receiveShadow = true
    g.add(jar)
    const water = new Mesh(new CylinderGeometry(28.5, 28.5, 0.2, 40), new MeshStandardMaterial({ color: '#25302F', roughness: 0.03, metalness: 0.2 }))
    water.position.set(LAYOUT.jar.x, 64, LAYOUT.jar.z)
    g.add(water)
    const lid = new Mesh(new CylinderGeometry(36, 36, 3, 40), woodMat({ axis: 'x', plank: 12, seed: 9 }))
    lid.position.set(LAYOUT.jar.x + 6, 73.5, LAYOUT.jar.z + 4)
    lid.rotation.set(0.04, 0, -0.03)
    lid.scale.set(1, 1, 0.55)
    lid.castShadow = lid.receiveShadow = true
    g.add(lid)

    // 花盆：几盆绿植靠墙
    this.pots(g)

    // 灯泡：电线 + 灯头 + 灯泡
    const b = LAYOUT.bulb
    const wire = new Mesh(new CylinderGeometry(0.25, 0.25, 30, 6), new MeshStandardMaterial({ color: '#2F2A2B', roughness: 0.6 }))
    wire.position.set(b.x, b.y + 18, b.z)
    g.add(wire)
    const socket = new Mesh(new CylinderGeometry(1.6, 1.8, 5, 12), new MeshStandardMaterial({ color: '#3A3433', roughness: 0.5 }))
    socket.position.set(b.x, b.y + 2.5, b.z)
    g.add(socket)
    this.bulbMat = new MeshStandardMaterial({ color: '#F4EBDD', roughness: 0.15, emissive: new Color('#FFB46A'), emissiveIntensity: 0, transparent: true, opacity: 0.92 })
    this.bulb = new Mesh(new SphereGeometry(3.2, 20, 14), this.bulbMat)
    this.bulb.scale.set(1, 1.25, 1)
    this.bulb.position.set(b.x, b.y - 3, b.z)
    g.add(this.bulb)
    this.bulbLight = new PointLight('#FFB066', 0, 0, 2)
    this.bulbLight.position.set(b.x, b.y - 6, b.z)
    this.bulbLight.castShadow = false
    g.add(this.bulbLight)

    // 远景：院墙外的树冠、远山
    this.backdrop(g)
  }

  private roof() {
    const g = new Group()
    const W = LAYOUT.wallZ
    const z0 = LAYOUT.eaveZ // 檐口
    const y0 = 302
    const z1 = -470 // 屋脊
    const y1 = 520
    const len = Math.hypot(z0 - z1, y1 - y0)
    const ang = Math.atan2(y1 - y0, z0 - z1)
    // 瓦面：沿 x 做瓦垄起伏
    const geo = new PlaneGeometry(960, len, 240, 40)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const ph = (x / 22) * Math.PI
      pos.setZ(i, Math.pow(Math.abs(Math.sin(ph)), 0.7) * 4.2)
    }
    geo.computeVertexNormals()
    const tiles = new Mesh(geo, tileMat())
    tiles.castShadow = true
    tiles.receiveShadow = true
    // 平面默认朝 +z；转成从檐口往屋脊爬的坡
    tiles.rotation.x = -Math.PI / 2 + ang
    tiles.position.set(0, (y0 + y1) / 2, (z0 + z1) / 2)
    // 让瓦面的 vPos.z 沿坡方向变化（瓦行）
    tiles.rotation.order = 'XYZ'
    g.add(tiles)
    // 瓦面底下垫一层，防止从檐下看穿
    const underMat = woodMat({ axis: 'x', light: '#6E5442', dark: '#463429', plank: 16, seed: 2 })
    underMat.shadowSide = 2
    const under = new Mesh(new PlaneGeometry(960, len), underMat)
    under.rotation.x = Math.PI / 2 + ang
    under.position.set(0, (y0 + y1) / 2 - 3, (z0 + z1) / 2)
    under.receiveShadow = true
    under.castShadow = true
    g.add(under)
    // 封檐板
    const fascia = new Mesh(new BoxGeometry(964, 12, 3), woodMat({ axis: 'x', light: '#5C4434', dark: '#3A2B22', seed: 4 }))
    fascia.position.set(0, y0 - 2, z0 + 1)
    fascia.castShadow = true
    g.add(fascia)
    // 椽子：从墙到檐口
    const rafterMat = woodMat({ axis: 'z', light: '#5E4636', dark: '#3C2C23', seed: 6 })
    const rl = (z0 - W) / Math.cos(ang)
    const rafterGeo = new BoxGeometry(6, 7, rl)
    for (let x = -460; x <= 460; x += 34) {
      const r = new Mesh(rafterGeo, rafterMat)
      r.position.set(x, y0 - 6 + ((z0 - W) / 2) * Math.tan(ang), (z0 + W) / 2)
      r.rotation.x = ang
      r.castShadow = true
      g.add(r)
    }
    // 檐下的横梁
    g.add(box(940, 14, 14, rafterMat, 0, y0 + ((z0 - W) * 0.25) * Math.tan(ang) - 14, W + (z0 - W) * 0.25))
    // 屋脊
    const ridge = new Mesh(new BoxGeometry(970, 16, 22), tileMat())
    ridge.position.set(0, y1 + 6, z1)
    g.add(ridge)
    return g
  }

  private pots(g: Group) {
    const potMat = clayMat({ color: '#9B5B40' })
    const leafMat = procStandard(
      { roughness: 0.5, metalness: 0, side: 2 },
      {
        uniforms: { uLeaf: { value: new Color(P.leaf) } },
        color: /* glsl */ `
          float n = hash13(floor(vWPos * 0.2));
          diffuseColor.rgb = uLeaf * (0.75 + 0.5 * n) * vec3(1.0, 1.05, 0.9);
        `,
      },
    )
    const leafGeo = new SphereGeometry(1, 6, 4)
    leafGeo.scale(1, 0.18, 2.6)
    const spots = [
      new Vector3(330, 0, -272),
      new Vector3(372, 0, -268),
      new Vector3(290, 0, -276),
      new Vector3(-420, 0, -150),
    ]
    const r = rng(11)
    const dummy = new Object3D()
    const total = spots.length * 26
    const leaves = new InstancedMesh(leafGeo, leafMat, total)
    let n = 0
    for (const sp of spots) {
      const h = 22 + r() * 10
      const pot = new Mesh(
        new LatheGeometry([new Vector2(0, 0), new Vector2(11, 0), new Vector2(15, h), new Vector2(16.5, h + 0.5), new Vector2(16, h + 2.4), new Vector2(14, h + 2)], 24),
        potMat,
      )
      pot.position.copy(sp)
      pot.castShadow = pot.receiveShadow = true
      g.add(pot)
      for (let i = 0; i < 26; i++) {
        const a = r() * Math.PI * 2
        const up = 0.3 + r() * 1.0
        const L = 7 + r() * 6
        dummy.position.set(sp.x + Math.cos(a) * 3, h + 2 + r() * 6, sp.z + Math.sin(a) * 3)
        dummy.rotation.set(-up, a + Math.PI / 2, 0, 'YXZ')
        dummy.rotation.y = -a + Math.PI / 2
        dummy.rotation.x = -up
        dummy.scale.set(L * 0.38, L * 0.4, L)
        dummy.position.x += Math.cos(a) * L * 0.8
        dummy.position.z += Math.sin(a) * L * 0.8
        dummy.position.y += Math.sin(up) * L * 0.6
        dummy.updateMatrix()
        leaves.setMatrixAt(n++, dummy.matrix)
      }
    }
    leaves.castShadow = true
    leaves.receiveShadow = true
    g.add(leaves)
  }

  private backdrop(g: Group) {
    // 墙外的树冠：一团团变形的二十面体
    const r = rng(5)
    const blobs: BufferGeometry[] = []
    const addTree = (x: number, z: number, s: number) => {
      const trunk = new CylinderGeometry(s * 0.06, s * 0.09, s * 0.7, 6)
      trunk.translate(x, s * 0.35, z)
      blobs.push(trunk)
      for (let i = 0; i < 4; i++) {
        const b = new IcosahedronGeometry(s * (0.32 + r() * 0.18), 2)
        const p = b.attributes.position
        for (let k = 0; k < p.count; k++) {
          const v = new Vector3().fromBufferAttribute(p, k)
          const n = 1 + 0.18 * Math.sin(v.x * 0.07 + i) * Math.cos(v.z * 0.06 + v.y * 0.05)
          v.multiplyScalar(n)
          p.setXYZ(k, v.x, v.y, v.z)
        }
        b.translate(x + (r() - 0.5) * s * 0.6, s * (0.75 + r() * 0.35), z + (r() - 0.5) * s * 0.5)
        blobs.push(b)
      }
    }
    for (let i = 0; i < 14; i++) addTree(-1600 + i * 240 + r() * 80, -900 - r() * 500, 380 + r() * 260)
    for (let i = 0; i < 6; i++) addTree(-1200 - r() * 600, -300 + i * 260, 360 + r() * 200)
    for (let i = 0; i < 6; i++) addTree(1200 + r() * 600, -300 + i * 260, 360 + r() * 200)
    const geo = mergeGeometries(blobs.map((b) => (b.index ? b.toNonIndexed() : b)))
    geo.computeVertexNormals()
    const treeMat = procStandard(
      { roughness: 0.9, metalness: 0, flatShading: true },
      {
        uniforms: { uA: { value: new Color('#4F7A3A') }, uB: { value: new Color('#7A9A4A') } },
        color: /* glsl */ `
          float n = fbm3(vWPos * 0.01) * 0.5 + 0.5;
          diffuseColor.rgb = mix(uA, uB, n) * (vWPos.y < 200.0 ? 0.55 : 1.0);
        `,
      },
    )
    const trees = new Mesh(geo, treeMat)
    trees.castShadow = false
    trees.receiveShadow = true
    g.add(trees)

    // 远山：一圈起伏的带子，颜色交给雾
    const seg = 180
    const pa = new Float32Array((seg + 1) * 2 * 3)
    const idx: number[] = []
    for (let i = 0; i <= seg; i++) {
      const a = Math.PI * (1.04 + (0.92 * i) / seg)
      const R = 9000
      const x = Math.cos(a) * R
      const z = Math.sin(a) * R
      const h = 950 + 650 * Math.sin(i * 0.09) * Math.sin(i * 0.031 + 1) + 300 * Math.sin(i * 0.27 + 2) + 120 * Math.sin(i * 0.9)
      pa.set([x, -60, z, x, h, z], i * 6)
      if (i < seg) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3)
    }
    const hillGeo = new BufferGeometry()
    hillGeo.setAttribute('position', new BufferAttribute(pa, 3))
    hillGeo.setIndex(idx)
    const hills = new Mesh(hillGeo, new MeshBasicMaterial({ color: '#7F9A98', side: 2 }))
    g.add(hills)
  }
}
