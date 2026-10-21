import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  QuadraticBezierCurve3,
  Quaternion,
  Shape,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { procPhysical, procStandard } from '../gfx/proc'
import { P } from '../palette'
import { LAYOUT } from './layout'
import { bambooMat, bambooPlainMat, ceramicMat, ironMat, stoneMat, woodMat } from './materials'
import { BASKET_SLOTS } from './batch'
import { roundSieve } from './stove'

// 院子中间的案台，和台面上的东西：砧板、小刀、铲刀、碗、压板、压石、竹篮、成品竹盘、红头绳。
// 台面上每样东西的位置见 layout.ts，彼此不重叠；刀和铲刀平放时按模型的最低点贴着台面。

function mesh(geo: ConstructorParameters<typeof Mesh>[0], mat: Material, cast = true) {
  const m = new Mesh(geo, mat)
  m.castShadow = cast
  m.receiveShadow = true
  return m
}

/** 车出来的圆柄：profile 是 [离起点的距离, 半径]，沿 dir 从 start 长出去 */
function turned(profile: [number, number][], start: Vector3, dir: Vector3, mat: Material, segs = 18) {
  const pts = profile.map(([d, r]) => new Vector2(Math.max(r, 0.0001), d))
  const geo = new LatheGeometry(pts, segs)
  // Lathe 绕 y 轴转出来，先把 y 轴转到 dir 上
  geo.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize()))
  geo.translate(start.x, start.y, start.z)
  return mesh(geo, mat)
}

/** 端面年轮的木头（砧板）：一圈圈细年轮、心材深边材浅、几道放射状的干裂、满面的刀痕；侧面是树皮色 */
function endGrainMat() {
  return procStandard(
    { roughness: 0.78, metalness: 0 },
    {
      uniforms: {
        uA: { value: new Color('#C29B74') },
        uB: { value: new Color('#86613F') },
        uHeart: { value: new Color('#8A5E3F') },
        uBark: { value: new Color('#4E3A2E') },
      },
      color: /* glsl */ `
        vec3 p = vPos;
        float r = length(p.xz);
        float a = atan(p.z, p.x);
        // 年轮：两三毫米一圈，圈有点歪、宽窄不一
        float warp = snoise(vec3(p.xz * 0.06, 1.0)) * 0.9 + snoise(vec3(p.xz * 0.25, 4.0)) * 0.12;
        float rr = (r + warp) * 3.4;
        float ring = fract(rr + 0.3 * snoise(vec3(floor(rr) * 0.37, 2.0, 0.0)));
        float late = mix(0.22, smoothstep(0.55, 0.85, ring) * (1.0 - smoothstep(0.9, 1.0, ring)), aaFade(vec2(rr * 3.0)));
        vec3 col = mix(uA, uB, late * 0.5);
        // 心材深一点，往外过渡到浅的边材
        col = mix(uHeart, col, smoothstep(5.0, 14.0, r + warp * 2.0));
        // 放射状的干裂：只有两三道，从边上往里裂
        float crack = 0.0;
        for (int i = 0; i < 3; i++) {
          float ca = float(i) * 2.1 + 0.6;
          float da = abs(mod(a - ca + 3.14159, 6.28318) - 3.14159) * r;
          float w = 0.05 + 0.07 * smoothstep(12.0, 21.0, r);
          crack = max(crack, (1.0 - smoothstep(0.0, w, da + snoise(vec3(r * 0.3, float(i), 1.0)) * 0.08)) * smoothstep(9.0 + float(i) * 2.0, 18.0, r));
        }
        col *= 1.0 - crack * 0.6;
        // 刀痕：很多短短的细划痕，两三个方向
        float cut = 0.0;
        for (int i = 0; i < 3; i++) {
          float ang = float(i) * 1.05 + 0.3;
          vec2 d = vec2(cos(ang), sin(ang));
          vec2 q = vec2(dot(p.xz, d), dot(p.xz, vec2(-d.y, d.x)));
          float lane = q.y * 1.6 + float(i) * 7.0;
          float seg = hash12(vec2(floor(lane), floor(q.x * 0.25 + hash12(vec2(floor(lane), 3.0)) * 4.0)));
          cut = max(cut, step(0.82, seg) * (1.0 - smoothstep(0.0, 0.06, abs(fract(lane) - 0.5))) * aaFade(vec2(lane * 8.0)));
        }
        cut *= 1.0 - smoothstep(14.0, 20.0, r);
        col *= 1.0 - cut * 0.2;
        col *= 0.9 + 0.12 * (fbm3(p * 0.3) * 0.5 + 0.5);
        // 中间用得多，颜色发暗发亮
        col *= 1.0 - 0.08 * (1.0 - smoothstep(0.0, 12.0, r));
        if (abs(vNrm.y) < 0.5) {
          float n = fbm3(vec3(a * 6.0, p.y * 0.8, 0.0)) * 0.5 + 0.5;
          col = mix(uBark, uB, 0.3) * (0.7 + 0.5 * n);
        }
        diffuseColor.rgb = col;
        procBump = -late * 0.01 - crack * 0.25 - cut * 0.03;
      `,
      rough: /* glsl */ `roughnessFactor = mix(0.82, 0.62, 1.0 - smoothstep(0.0, 12.0, r));`,
      bump: true,
    },
  )
}

/** 刀身的钢：中间有磨痕，靠刀背发暗 */
const steel = () =>
  procPhysical(
    { color: '#B9B6B0', roughness: 0.32, metalness: 0.9 },
    {
      uniforms: {},
      color: /* glsl */ `
        float n = fbm3(vPos * vec3(0.3, 3.0, 3.0)) * 0.5 + 0.5;
        diffuseColor.rgb *= 0.82 + 0.25 * n;
        float stain = smoothstep(0.55, 0.8, fbm3(vPos * 0.6 + 3.0) * 0.5 + 0.5);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 0.4, 0.36), stain * 0.5);
        // 顺着刀身的细磨痕
        float brush = snoise(vec3(vPos.x * 0.4, vPos.y * 40.0, vPos.z * 40.0)) * 0.5 + 0.5;
      `,
      rough: /* glsl */ `roughnessFactor = 0.22 + n * 0.18 + stain * 0.25 + brush * 0.08;`,
    },
  )

const brass = () => new MeshPhysicalMaterial({ color: '#B08D57', metalness: 1, roughness: 0.38 })

/**
 * 小刀：窄刃、尖头、木柄，刃长约一掌（docs/14：割皮刀主形制）。
 * 刀尖在原点，刀身沿 +x，刃口朝 -y，刀面是 xy 平面；刀柄和刀身在同一条中线（y = KNIFE_AXIS）上。
 */
const KNIFE_AXIS = -0.32
export function knife() {
  const g = new Group()
  const s = new Shape()
  s.moveTo(0, 0)
  s.quadraticCurveTo(2.8, -1.05, 7, -1.12) // 刃口：从刀尖弯下来，后面是直的
  s.lineTo(13, -1.15)
  s.lineTo(13, 0.5) // 刀根
  s.lineTo(7, 0.5) // 刀背
  s.quadraticCurveTo(2.6, 0.46, 0, 0)
  const bladeGeo = new ExtrudeGeometry(s, { depth: 0.09, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.04, bevelSegments: 1, curveSegments: 16 })
  bladeGeo.translate(0, 0, -0.045)
  const blade = mesh(bladeGeo, steel())
  g.add(blade)
  const dir = new Vector3(1, 0, 0)
  // 刀根的铜箍
  g.add(turned([[0, 0.5], [0.15, 0.56], [0.75, 0.56], [0.9, 0.52]], new Vector3(12.9, KNIFE_AXIS, 0), dir, brass(), 20))
  // 木柄：车出来的，中间略鼓，尾端收圆
  const handleMat = woodMat({ axis: 'x', light: '#8E6A4C', dark: '#5A3E2C', seed: 21, ring: 3 })
  const handle = turned(
    [[0, 0.5], [0.6, 0.6], [3.5, 0.7], [7, 0.74], [9.4, 0.68], [10.2, 0.52], [10.5, 0.2], [10.55, 0]],
    new Vector3(13.75, KNIFE_AXIS, 0),
    dir,
    handleMat,
    20,
  )
  handle.scale.set(1, 1, 0.82) // 刀柄略扁，握着顺手
  handle.position.z = 0
  g.add(handle)
  // 两颗铆钉
  for (const x of [16.2, 21.4]) {
    const rivet = mesh(new CylinderGeometry(0.16, 0.16, 1.24, 10), brass(), false)
    rivet.rotation.x = Math.PI / 2
    rivet.position.set(x, KNIFE_AXIS, 0)
    g.add(rivet)
  }
  return g
}

/**
 * 去瓤铲刀（形制无权威记载，按"薄铁片弯成浅弧"推演）：
 * 一片薄铁铲头（横向微微弯成浅弧）→ 焊在铲头上、往上弯起的铁颈 → 铜箍 → 车出来的木柄，四段沿同一条曲线接着。
 * 原点在铲口中点，铲面大致在 xz 平面（法线 +y），柄朝 +x 斜向上。
 */
export const SCRAPER_RISE = 0.32 // 铁颈弯起来的角度（弧度），柄就顺着这个方向
export function scraper() {
  const g = new Group()
  // 铲头：铲口 2.6 宽，往后收窄到 0.56
  const s = new Shape()
  s.moveTo(0, -1.15)
  s.quadraticCurveTo(0, -1.3, 0.2, -1.3)
  s.lineTo(2.0, -1.22)
  s.quadraticCurveTo(3.8, -0.62, 4.6, -0.28)
  s.lineTo(4.6, 0.28)
  s.quadraticCurveTo(3.8, 0.62, 2.0, 1.22)
  s.lineTo(0.2, 1.3)
  s.quadraticCurveTo(0, 1.3, 0, 1.15)
  s.lineTo(0, -1.15)
  const bladeGeo = new ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: false, curveSegments: 10 })
  bladeGeo.rotateX(Math.PI / 2) // 形状的 y → 世界 z，挤出方向 → -y
  bladeGeo.translate(0, 0.07, 0)
  // 横向弯一点：两边比中间高
  const bp = bladeGeo.attributes.position
  for (let i = 0; i < bp.count; i++) {
    const z = bp.getZ(i)
    bp.setY(i, bp.getY(i) + 0.16 * (z / 1.3) ** 2)
  }
  bladeGeo.computeVertexNormals()
  const ironM = steel()
  const blade = mesh(bladeGeo, ironM)
  g.add(blade)
  // 铁颈：从铲头后半截的背上起，先平着走，再顺着 SCRAPER_RISE 往上弯，切线连续
  const dir = new Vector3(Math.cos(SCRAPER_RISE), Math.sin(SCRAPER_RISE), 0)
  const S0 = new Vector3(3.6, 0.2, 0)
  const C0 = new Vector3(5.6, 0.2, 0)
  const E0 = C0.clone().addScaledVector(dir, 1.7)
  const neck = mesh(new TubeGeometry(new QuadraticBezierCurve3(S0, C0, E0), 24, 0.19, 10, false), ironMat({ polish: 0.4, rust: 0.25, polishR: 8 }))
  g.add(neck)
  // 颈根和铲头之间焊的一小块
  const weld = mesh(new IcosahedronGeometry(0.26, 2), ironM)
  weld.scale.set(1.6, 0.6, 1)
  weld.position.set(3.75, 0.12, 0)
  g.add(weld)
  // 铜箍 + 木柄，接在颈的末端、沿同一个方向
  const ferrule = turned([[0, 0.3], [0.1, 0.42], [1.05, 0.42], [1.15, 0.46]], E0.clone().addScaledVector(dir, -0.15), dir, brass(), 18)
  g.add(ferrule)
  const handle = turned(
    [[0, 0.46], [0.5, 0.56], [3, 0.62], [6.5, 0.66], [9, 0.6], [9.8, 0.46], [10.1, 0.18], [10.15, 0]],
    E0.clone().addScaledVector(dir, 1.0),
    dir,
    woodMat({ axis: 'y', light: '#9A7656', dark: '#634631', seed: 23, ring: 3 }),
    18,
  )
  g.add(handle)
  return g
}

/** 压板：一块方木板 */
export function board(w: number, h: number, d: number, seed: number) {
  return mesh(new BoxGeometry(w, h, d), woodMat({ axis: 'x', plank: 11.5, seed, light: '#A58260', dark: '#634632', worn: 0.4 }))
}

/** 压石：河里捡的扁圆卵石 */
export function stone() {
  // 二十面体是非索引的：先把重合的顶点并起来，算出来的法线才是圆滑的
  const ico = new IcosahedronGeometry(7, 6)
  ico.deleteAttribute('normal') // 法线、uv 不同的点并不起来，先去掉
  ico.deleteAttribute('uv')
  const geo = mergeVertices(ico)
  const p = geo.attributes.position
  const v = new Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const n = 1 + 0.06 * Math.sin(v.x * 0.9 + 1) * Math.cos(v.z * 0.8) + 0.04 * Math.sin(v.y * 1.7 + v.x)
    v.multiplyScalar(n)
    v.y *= 0.55
    v.x *= 1.15
    p.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  geo.translate(0, -geo.boundingBox!.min.y, 0) // 底贴着原点
  return mesh(geo, stoneMat({ color: '#8C877F', river: true }))
}

const _v = new Vector3()
const _q = new Quaternion()

/** 一组物件在姿态 q 下，所有顶点里最低的 y（相对物件原点）；按 x 分成左右两半各算一个 */
function lowest(obj: Object3D, q: Quaternion, splitX: number) {
  obj.position.set(0, 0, 0)
  obj.quaternion.copy(q)
  obj.updateMatrixWorld(true)
  let lo = Infinity
  let left = Infinity
  let right = Infinity
  obj.traverse((m) => {
    if (!(m instanceof Mesh)) return
    const pos = (m.geometry as BufferGeometry).attributes.position
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)
      lo = Math.min(lo, _v.y)
      if (_v.x < splitX) left = Math.min(left, _v.y)
      else right = Math.min(right, _v.y)
    }
  })
  return { lo, left, right }
}

/**
 * 长条工具平放在台面上的姿态：先按 base 摆（工具长轴沿 +x），再绕 z 轴微微倾一点，
 * 让两头（刀尖和柄尾）都贴着台面，最后整体抬到最低点刚好碰到 y = surface，再绕 y 转 yaw。
 */
export function restPose(obj: Object3D, base: Quaternion, splitX: number, at: Vector3, surface: number, yaw = 0) {
  let best = 0
  let bestErr = Infinity
  for (let i = 0; i <= 80; i++) {
    const tilt = -0.4 + (0.8 * i) / 80
    _q.setFromAxisAngle(new Vector3(0, 0, 1), tilt).multiply(base)
    const { left, right } = lowest(obj, _q, splitX)
    const err = Math.abs(left - right)
    if (err < bestErr) {
      bestErr = err
      best = tilt
    }
  }
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), best).multiply(base)
  q.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw))
  const { lo } = lowest(obj, q, splitX)
  const pos = new Vector3(at.x, surface - lo + 0.01, at.z)
  obj.position.copy(pos)
  obj.quaternion.copy(q)
  return { pos, quat: q }
}

export class Table {
  readonly group = new Group()
  readonly knife = knife()
  readonly scraper = scraper()
  readonly bottomBoard: Mesh
  readonly topBoard: Mesh
  readonly stone: Mesh
  readonly basket = new Group()
  readonly heroSlot = new Vector3() // 篮子里主角那个果子的位置（果心，世界坐标）
  readonly tray: Group
  readonly spool = new Group()
  readonly bowl: Mesh
  /** 刀、铲刀平放在台面上的姿态（导演从这里拿起、放回） */
  readonly knifeRest: { pos: Vector3; quat: Quaternion }
  readonly scraperRest: { pos: Vector3; quat: Quaternion }
  /** 顶板、压石平放时的位置 */
  readonly boardRest: Vector3
  readonly stoneRest: Vector3

  constructor() {
    const g = this.group
    const T = LAYOUT.table
    const top = LAYOUT.tableTop
    const tw = LAYOUT.tableW
    const td = LAYOUT.tableD
    const wood = woodMat({ axis: 'x', plank: 22.5, light: '#9C7656', dark: '#5C4231', worn: 0.45, seed: 1 })
    const legWood = woodMat({ axis: 'y', light: '#8A6548', dark: '#523A2B', seed: 2 })
    const topMesh = mesh(new BoxGeometry(tw, 5.5, td), wood)
    topMesh.position.set(T.x, top - 2.75, T.z)
    g.add(topMesh)
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = mesh(new BoxGeometry(6.5, top - 5.5, 6.5), legWood)
      leg.position.set(T.x + sx * (tw / 2 - 9), (top - 5.5) / 2, T.z + sz * (td / 2 - 8))
      g.add(leg)
    }
    for (const sz of [-1, 1]) {
      const apron = mesh(new BoxGeometry(tw - 20, 9, 2.5), legWood)
      apron.position.set(T.x, top - 10, T.z + sz * (td / 2 - 8))
      g.add(apron)
      const low = mesh(new BoxGeometry(tw - 20, 4, 3), legWood)
      low.position.set(T.x, 16, T.z + sz * (td / 2 - 8))
      g.add(low)
    }
    for (const sx of [-1, 1]) {
      const apron = mesh(new BoxGeometry(2.5, 9, td - 18), legWood)
      apron.position.set(T.x + sx * (tw / 2 - 9), top - 10, T.z)
      g.add(apron)
    }

    // 砧板
    const cb = mesh(new CylinderGeometry(21, 21.5, 5, 64), endGrainMat())
    cb.position.set(LAYOUT.board.x, LAYOUT.board.y - 2.5, LAYOUT.board.z)
    g.add(cb)

    // 小刀、铲刀平放在案前沿：刀面朝上（刃口朝南），两头贴着台面
    this.knifeRest = restPose(this.knife, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2), 12, LAYOUT.knifeRest, top)
    g.add(this.knife)
    this.scraperRest = restPose(this.scraper, new Quaternion(), 6, LAYOUT.scraperRest, top)
    g.add(this.scraper)

    // 碗（装果瓤）
    const bowlProf = [
      new Vector2(0, 0.6),
      new Vector2(3.6, 0.6),
      new Vector2(3.8, 0),
      new Vector2(4.6, 0),
      new Vector2(4.6, 0.9),
      new Vector2(7.2, 2.6),
      new Vector2(9, 5.2),
      new Vector2(9.6, 6.6),
      new Vector2(9.3, 6.8),
      new Vector2(8.6, 5.6),
      new Vector2(6.8, 3.0),
      new Vector2(4.0, 1.6),
      new Vector2(0, 1.4),
    ]
    this.bowl = mesh(new LatheGeometry(bowlProf, 48), ceramicMat({ bandY: [5.9, 1.2], footY: 0.8 }))
    this.bowl.position.copy(LAYOUT.bowl)
    this.bowl.position.y = top + 0.01
    g.add(this.bowl)

    // 压板：底板一直放在案上（十片对折的摆两行，所以要 60×42）；顶板和压石平时放在案子右边的地上
    this.bottomBoard = board(60, 2, 42, 31)
    this.bottomBoard.position.set(LAYOUT.press.x, LAYOUT.press.y - 1, LAYOUT.press.z)
    g.add(this.bottomBoard)
    this.topBoard = board(62, 2.4, 44, 32)
    this.boardRest = new Vector3(LAYOUT.boardRest.x, 1.2 + 0.01, LAYOUT.boardRest.z)
    this.topBoard.position.copy(this.boardRest)
    g.add(this.topBoard)
    this.stone = stone()
    this.stoneRest = new Vector3(LAYOUT.stoneRest.x, 0.01, LAYOUT.stoneRest.z)
    this.stone.position.copy(this.stoneRest)
    g.add(this.stone)

    // 竹篮：一篮刚摘的青果，带几片叶
    const bprof = [new Vector2(0, 0), new Vector2(13, 0), new Vector2(14.6, 1.5), new Vector2(17.2, 9), new Vector2(18, 12)]
    const bowlB = mesh(new LatheGeometry(bprof, 56), bambooMat({ w: 1.25, radius: 16, rot: 0.785 }))
    this.basket.add(bowlB)
    const hoop = mesh(new TorusGeometry(18.2, 0.8, 8, 64), bambooPlainMat({ axis: 'x' }))
    hoop.rotation.x = Math.PI / 2
    hoop.position.y = 12
    this.basket.add(hoop)
    const handle = mesh(new TorusGeometry(17.5, 0.9, 8, 48, Math.PI), bambooPlainMat({ axis: 'x' }))
    handle.position.y = 12
    handle.rotation.y = 0.3
    this.basket.add(handle)
    this.basket.position.copy(LAYOUT.basket)
    this.basket.position.y = top + 0.15 // 篮底和案面错开一点，免得闪
    g.add(this.basket)

    // 篮里的十个果由 Batch 摆（主角是 BASKET_SLOTS[0]）
    const hs = BASKET_SLOTS[0]
    this.heroSlot.set(this.basket.position.x + hs.x, this.basket.position.y + hs.y, this.basket.position.z + hs.z)
    // 几片柚子叶：搭在篮沿上，压在没放果的凹处
    const leafShape = new Shape()
    leafShape.moveTo(0, 0)
    leafShape.quadraticCurveTo(2.6, 3, 0, 8.5)
    leafShape.quadraticCurveTo(-2.6, 3, 0, 0)
    const leafGeo = new ExtrudeGeometry(leafShape, { depth: 0.05, bevelEnabled: false, curveSegments: 8 })
    const leafMat = procPhysical(
      { roughness: 0.38, metalness: 0, clearcoat: 0.4, side: 2 },
      {
        uniforms: { uLeaf: { value: new Color(P.leaf) } },
        color: /* glsl */ `
          float mid = 1.0 - smoothstep(0.0, 0.18, abs(vPos.x));
          float vein = smoothstep(0.9, 1.0, abs(sin((vPos.y - abs(vPos.x) * 1.2) * 2.4))) * 0.4;
          diffuseColor.rgb = uLeaf * (0.95 + 0.35 * mid + 0.15 * vein);
        `,
      },
    )
    for (const deg of [0, 120, 240]) {
      const a = (deg * Math.PI) / 180
      const lf = mesh(leafGeo, leafMat)
      // 叶柄朝里、叶尖探出篮沿，斜搭着
      lf.position.set(Math.cos(a) * 6.5, 10.6, Math.sin(a) * 6.5)
      lf.rotation.set(0, -Math.PI / 2 - a, 0, 'YXZ')
      lf.rotateX(-1.25)
      this.basket.add(lf)
    }

    // 结尾放成品的竹盘
    this.tray = roundSieve(15, 2.6, { w: 1.1 })
    this.tray.position.copy(LAYOUT.tray)
    this.tray.position.y = top + 0.15
    g.add(this.tray)

    // 一小卷红头绳：横躺着
    const spoolCore = mesh(new CylinderGeometry(1.6, 1.6, 3.4, 20), woodMat({ axis: 'y', seed: 40 }))
    spoolCore.position.y = 1.7
    this.spool.add(spoolCore)
    const wound = mesh(
      new CylinderGeometry(2.6, 2.6, 2.6, 28),
      procStandard(
        { roughness: 0.7, metalness: 0 },
        {
          uniforms: { uRed: { value: new Color(P.red) } },
          color: /* glsl */ `
            float th = sin(vPos.y * 22.0 + atan(vPos.z, vPos.x) * 0.6) * 0.5 + 0.5;
            diffuseColor.rgb = uRed * (0.78 + 0.3 * th);
            procBump = th * 0.02;
          `,
          bump: true,
        },
      ),
    )
    wound.position.y = 1.7
    this.spool.add(wound)
    this.spool.position.copy(LAYOUT.spool)
    this.spool.rotation.z = Math.PI / 2
    this.spool.position.y = top + 2.6 + 0.01
    g.add(this.spool)
  }
}
