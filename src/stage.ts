import { Euler, Quaternion, Vector3, type Object3D } from 'three'
import { BATCH, DRY_SLOTS } from './world/batch'
import { bigLayout, taiLayout, type FruitLayout, type FruitSet } from './world/fruitset'
import { LAYOUT } from './world/layout'
import { PEEL } from './world/peel'
import type { World } from './world/world'

// 舞台：各段共用的东西——主角此刻在哪、篮子在哪、从前面几段带下来的状态（锅开没开、炉子点没点、皮烫没烫）。
// 每一帧先把带下来的状态清回默认，再按段的先后让每一段往上叠（见 Act.carry），最后由正在演的那一段摆东西（Act.pose）。

/** 跨段带下去的院子状态 */
export interface Carry {
  /** 锅里的水开到什么程度（0.15 是灶上一直温着） */
  boil: number
  /** 灶火压小了 */
  fireLow: boolean
  /** 焙炉点着没有 */
  ovenOn: number
  /** 云多走了多少秒（晒的那一段延时） */
  lapse: number
  bloom: number
  /** 焙炉上的热浪 */
  haze: number
  /** 屋檐下的灯泡、屋里的灯 */
  bulb: number
  interior: number
}
const carry0 = (): Carry => ({ boil: 0.15, fireLow: false, ovenOn: 0, lapse: 0, bloom: 0.2, haze: 0, bulb: 0, interior: 0 })

/** 主角果皮的外观（进着色器之前） */
export interface Look {
  blanch: number
  wet: number
  dry: number
  soak: number
  product: number
  press: number
}
const look0 = (): Look => ({ blanch: 0, wet: 0, dry: 0, soak: 0, product: 0, press: 0 })

const tmp = new Vector3()
const tmpE = new Euler()

export class Stage {
  readonly heroPos = new Vector3()
  readonly heroQuat = new Quaternion()
  readonly basketPos = new Vector3()
  readonly basketQuat = new Quaternion()
  carry: Carry = carry0()
  look: Look = look0()
  /** 主角在篮里的朝向（斜一点） */
  readonly heroBaseQ = new Quaternion().setFromEuler(new Euler(0.35, 0.8, 0.15))
  /** 主角的原点到果心有多高（果皮的原点在果蒂，小果的原点就在果心） */
  readonly R: number
  /** 这一批怎么摆、谁来画 */
  readonly layout: FruitLayout
  readonly fruits: FruitSet
  /** 主角（摆它的位置） */
  readonly heroGroup: Object3D

  constructor(readonly w: World) {
    if (w.tai) {
      this.R = 0
      this.layout = taiLayout(w.tai)
      this.fruits = w.tai
      this.heroGroup = w.tai.heroGroup
      this.heroBaseQ.copy(w.tai.rot(0))
    } else if (w.cakes) {
      this.R = 0
      this.layout = bigLayout(PEEL.R)
      this.fruits = w.cakes
      this.heroGroup = w.cakes.heroGroup
    } else {
      this.R = PEEL.R
      this.layout = bigLayout(PEEL.R)
      this.fruits = w.batch
      this.heroGroup = w.hero.group
    }
    this.restBasket()
  }

  /** 每帧开头：带下来的状态清回默认，主角的形状也从头算 */
  reset() {
    this.carry = carry0()
    this.look = look0()
    const st = this.w.hero.state
    st.cut.fill(0)
    st.open.fill(0)
    st.scrape.fill(0)
    st.cap = 0
    st.hub = 0
    st.dry = 0
    st.soak = 0
    st.fold = 0
    st.press = 0
    st.shrink = 0
    this.restBasket()
  }

  // ———— 镜头盯着主角 ————

  /** 果心 */
  readonly fruitCenter = (_T: number, out: Vector3) => out.set(0, this.R, 0).applyQuaternion(this.heroQuat).add(this.heroPos)
  /** 摊平的皮：原点稍上 */
  readonly heroFlat = (_T: number, out: Vector3) => out.copy(this.heroPos).add(tmp.set(0, 0.6, 0))
  follow(dy = 0, dx = 0, dz = 0) {
    return (_T: number, out: Vector3) => out.copy(this.heroPos).add(tmp.set(dx, dy, dz))
  }

  // ———— 篮子和篮里的果 ————

  /** 篮子平时放在案上 */
  restBasket() {
    const L = LAYOUT
    this.basketPos.set(L.basket.x, L.tableTop + 0.15, L.basket.z)
    this.basketQuat.identity()
  }
  /** 第 i 个果（0 是主角）自己固定的朝向 */
  fruitRot(i: number) {
    return i === 0 ? this.heroBaseQ : this.fruits.rot(i)
  }
  /** 第 i 个果在篮里的果心和朝向（篮子在 bp、转了 bq） */
  fruitInBasket(i: number, outP: Vector3, outQ: Quaternion, bp: Vector3 = this.basketPos, bq: Quaternion = this.basketQuat) {
    outP.copy(this.layout.basket[i]).applyQuaternion(bq).add(bp)
    outQ.copy(bq).multiply(this.fruitRot(i))
  }
  /** 主角以外的都在篮里 */
  fruitsInBasket() {
    const b = this.fruits
    const p = new Vector3()
    const q = new Quaternion()
    for (let i = 1; i < b.count; i++) {
      this.fruitInBasket(i, p, q)
      b.setFruit(i, p, q)
    }
    b.show(true)
  }

  /** 皮摊在晒的竹匾上：主角在正中，九片一圈 */
  heroOnRack() {
    const sl = this.w.dry.heroSlot
    this.heroPos.copy(sl.pos)
    this.heroQuat.setFromEuler(tmpE.set(0, sl.rot, 0))
  }
  piecesOnRack() {
    const L = LAYOUT
    const b = this.w.batch
    for (let i = 1; i < BATCH; i++) {
      const sl = DRY_SLOTS[i]
      b.setPiece(i, this.w.hero.geometry, tmp.set(L.dry.x + sl.x, L.dryY, L.dry.z + sl.z), sl.rot)
    }
  }

  // ———— 主角 ————

  /** 按果心摆主角（主角的原点在果蒂，果心在本地 (0, R, 0)） */
  setHeroByCenter(center: Vector3, q: Quaternion) {
    this.heroQuat.copy(q)
    this.heroPos.copy(center).sub(tmp.set(0, this.R, 0).applyQuaternion(q))
  }
  /** 把算好的主角位置交给网格（刀、铲要按主角的矩阵算，所以摆完主角马上调） */
  applyHero() {
    const g = this.heroGroup
    g.position.copy(this.heroPos)
    g.quaternion.copy(this.heroQuat)
    g.updateMatrixWorld()
  }
}
