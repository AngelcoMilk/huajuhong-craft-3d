import { Group, InstancedMesh, Mesh, Object3D, Quaternion, Vector2, Vector3, type BufferGeometry, type MeshPhysicalMaterial } from 'three'
import { rng } from '../util'
import type { FruitSet } from './fruitset'
import { copyLook, PEEL, peelMaterial, wholeFruitGeometry } from './peel'

// 一批十个：从篮子里的青果到最后捆成一扎，数量始终是十（十片一扎）。
// 主角是第 0 个（world.hero），其余九个在这里。
// 一个一个做的步骤（割皮去瓤、对折）只拍主角的特写，其余的在一旁等着或已经做好；
// 一起做的步骤（烫、晒、润、压、焙、捆）十个都在画面里，前后对得上。

export const BATCH = 10
const R = PEEL.R
const deg = (d: number) => (d * Math.PI) / 180

/**
 * 篮子里十个果的果心（篮子本地坐标）：底下中间一个、周围一圈六个，上面三个卡在隔一个的凹处。
 * 0 是主角（靠镜头那个凹处，60°）。圆心距都大于两个半径之和。
 */
export const BASKET_SLOTS: Vector3[] = (() => {
  const y0 = R + 0.06
  const ring = 8
  const hollowR = ((ring * Math.cos(deg(30))) * 2) / 3
  const topY = y0 + 6.5
  const s: Vector3[] = []
  for (const a of [60, 180, 300]) s.push(new Vector3(Math.cos(deg(a)) * hollowR, topY, Math.sin(deg(a)) * hollowR))
  s.push(new Vector3(0, y0, 0))
  for (let k = 0; k < 6; k++) {
    const a = deg(30 + 60 * k)
    s.push(new Vector3(Math.cos(a) * ring, y0, Math.sin(a) * ring))
  }
  return s
})()

/** 倒进锅里的先后：篮子朝 -x 倒，上面的、靠 -x 的先出来 */
export const POUR_ORDER = [1, 6, 7, 0, 2, 3, 5, 8, 4, 9]

/**
 * 一批果平摊开的位置（xz）：中间一个、内圈六个（半径 9）、外圈三个（半径 17）。
 * 浮在锅里、摊在焙炉竹筛上沥水，都用这一套。0 是主角（正中）。
 */
export const SPREAD_SLOTS: Vector2[] = (() => {
  // 每个位置错开一点点（不超过 0.6 厘米，相邻两个的间距仍大于两个半径），不像摆出来的格子
  const r = rng(29)
  const j = () => new Vector2((r() - 0.5) * 1.2, (r() - 0.5) * 1.2)
  const s = [new Vector2(0, 0)]
  for (let k = 0; k < 6; k++) s.push(new Vector2(Math.cos(deg(60 * k + 8)) * 9, Math.sin(deg(60 * k + 8)) * 9).add(j()))
  for (const a of [38, 158, 278]) s.push(new Vector2(Math.cos(deg(a)) * 17.5, Math.sin(deg(a)) * 17.5).add(j()))
  return s
})()

/** 三勺捞完：第一勺带上主角 */
export const SCOOPS = [
  [0, 1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
]

/** 笊篱兜里的位置（笊篱本地坐标，兜底在原点）：四个一勺按正方形，三个一勺按三角 */
export const STRAINER_SLOTS: Record<number, Vector3[]> = {
  4: [45, 135, 225, 315].map((a) => new Vector3(Math.cos(deg(a)) * 5.4, 4.8, Math.sin(deg(a)) * 5.4)),
  3: [90, 210, 330].map((a) => new Vector3(Math.cos(deg(a)) * 4.6, 4.6, Math.sin(deg(a)) * 4.6)),
}

/**
 * 对折以后的十片在一块平面上怎么摆（压板、焙炉竹筛都用这一套）：两行，每行五片，一片开口朝前、一片开口朝后，
 * 扇形的直边（折痕）对着中线，正好一片嵌一片、谁也不压着谁。x 是片的原点（折痕中点），yaw 是绕 y 转多少。
 * 同一行里开口朝前（+z）的折痕线比朝后的高 0.8 厘米，折痕那一点鼓起来的地方才不会碰到相邻的那片。
 */
export function fanSlots(n: number): { x: number; z: number; yaw: number }[] {
  const psi = (Math.PI * 2) / n / 4 // 和 peel.ts 的折线方向一致
  const all: { x: number; z: number; yaw: number }[] = []
  for (const row of [1, -1]) {
    for (let k = 0; k < 5; k++) {
      const plusZ = row > 0 ? k % 2 === 0 : k % 2 === 1
      const line = row > 0 ? (plusZ ? 9.6 : 8.8) : plusZ ? -8.8 : -9.6
      all.push({ x: (k - 2) * 9.6, z: line, yaw: plusZ ? psi + Math.PI : psi })
    }
  }
  // 主角：前排正中、开口朝前（朝镜头）
  const hero = all.findIndex((s) => s.x === 0 && s.z > 0)
  const [h] = all.splice(hero, 1)
  return [h, ...all]
}
export const FAN_SLOTS = fanSlots(PEEL.N)

/** 晒的竹匾上：主角在正中，其余九片一圈（半径 35） */
export const DRY_SLOTS: { x: number; z: number; rot: number }[] = (() => {
  const r = rng(8)
  const s = [{ x: 0, z: 0, rot: 0.3 }]
  for (let k = 0; k < 9; k++) {
    const a = deg(20 + 40 * k)
    s.push({ x: Math.cos(a) * 35, z: Math.sin(a) * 35, rot: r() * Math.PI * 2 })
  }
  return s
})()

/** 主角以外的九个：前半段是整果（一个实例化网格），后半段是九片皮（和主角同形或用快照） */
export class Batch implements FruitSet {
  readonly count = BATCH
  readonly group = new Group()
  readonly fruits: InstancedMesh
  readonly fruitMat: MeshPhysicalMaterial
  /** 每个整果自己固定的朝向（看起来不一样） */
  readonly fruitRot: Quaternion[] = []
  readonly pieces: Mesh[] = []
  private dummy = new Object3D()

  constructor(heroGeometry: BufferGeometry) {
    this.fruitMat = peelMaterial(4)
    this.fruits = new InstancedMesh(wholeFruitGeometry(R), this.fruitMat, BATCH - 1)
    this.fruits.castShadow = true
    this.fruits.receiveShadow = true
    this.fruits.frustumCulled = false
    this.group.add(this.fruits)
    const r = rng(17)
    for (let i = 0; i < BATCH - 1; i++) {
      this.fruitRot.push(new Quaternion().setFromAxisAngle(new Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), r() * Math.PI * 2))
      const m = new Mesh(heroGeometry, peelMaterial(10 + i * 7))
      m.castShadow = true
      m.receiveShadow = true
      m.frustumCulled = false
      m.visible = false
      this.pieces.push(m)
      this.group.add(m)
    }
  }

  /** 第 i 个（1～9）整果：果心位置、朝向 */
  setFruit(i: number, pos: Vector3, q: Quaternion) {
    const d = this.dummy
    d.position.copy(pos)
    d.quaternion.copy(q)
    d.scale.setScalar(1)
    d.updateMatrix()
    this.fruits.setMatrixAt(i - 1, d.matrix)
  }
  rot(i: number) {
    return this.fruitRot[i - 1]
  }
  show(on: boolean) {
    this.showFruits(on)
  }
  showFruits(on: boolean) {
    this.fruits.visible = on
    this.fruits.instanceMatrix.needsUpdate = true
  }

  /** 第 i 片（1～9）皮：原点（蒂）位置、绕 y 转多少；geo 换成这一段该用的形状 */
  setPiece(i: number, geo: BufferGeometry, pos: Vector3, yaw: number) {
    const m = this.pieces[i - 1]
    if (m.geometry !== geo) m.geometry = geo
    m.position.copy(pos)
    m.rotation.set(0, yaw, 0)
    m.visible = true
  }
  hidePieces() {
    for (const m of this.pieces) m.visible = false
  }

  /** 九个的样子（烫、干、润、成品色）跟着主角走 */
  syncLook(hero: MeshPhysicalMaterial) {
    copyLook(this.fruitMat, hero)
    for (const m of this.pieces) copyLook(m.material as MeshPhysicalMaterial, hero)
  }
}
