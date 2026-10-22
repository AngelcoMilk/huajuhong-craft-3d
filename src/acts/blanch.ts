import { Euler, Quaternion, Vector3, type Vector4 } from 'three'
import type { AddSound } from '../audio/sound'
import type { AddShot } from '../camera'
import type { LightName } from '../gfx/env'
import type { Stage } from '../stage'
import { easeInOut, easeOut, hash1, hop, keys, lerp, rng, seg, setCast, smoother, smoothstep, TAU } from '../util'
import { LAYOUT } from '../world/layout'
import { RELEASE0, RELEASE_SPAN } from '../world/leaves'
import { Act } from './act'

// 烫果：篮子从灶前地上拎起来，十个果一起倒进滚水锅里，浮着打转；一烫就用竹笊篱分三勺捞到焙炉的大竹筛上，摊开放凉沥水。

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
const G = 980 // 重力，厘米每二次方秒
const UP = new Vector3(0, 1, 0)
const ZAX = new Vector3(0, 0, 1)
const XAX = new Vector3(1, 0, 0)

const LIFT_AT = 6.8 // 篮子从灶前地上拎起来
const POUR_AT = 8.65 // 篮子倾到一半，第一个果开始滚出来
const POUR_GAP = 0.07 // 一个接一个
const FALL = 0.45 // 落进锅里要多久
const SCOOP0 = 12.4 // 第一勺
const SCOOP_LEN = 3.0 // 一勺从伸下去到倒在竹筛上
const BASKET_FLOOR = LAYOUT.basketFloor // 篮子放在灶前地上
/** 笊篱放在灶面上时柄朝哪（朝灶前伸出去，不在焙炉上方） */
export const STRAINER_REST_YAW = -Math.PI / 2 + 0.25

// 声音该响的时刻：数字只写在这里，声音只引用名字。
const AT = {
  tilt: 8.25, // 篮子倾到锅上方，果开始往下滚（第一个果在 POUR_AT）
  basketDown: 10.76, // 篮子放回灶前地上
  basketTap: 10.78, // 篮底磕到地面
} as const

export class Blanch extends Act {
  private sp = new Vector3()
  private sq = new Quaternion()
  private e = new Euler()

  constructor(s: Stage, id = 'blanch') {
    super(s, id, 30)
  }

  shots(add: AddShot) {
    const L = LAYOUT
    const wok = L.wok
    const oven = L.oven
    const s = this.s
    add(0, 7.6, { target: v(wok.x + 18, 86, wok.z + 6), dist: 170, az: 22, el: 30, fov: 34, ap: 0.1 }, { target: v(wok.x + 18, 84, wok.z + 8), dist: 152, az: 28, el: 34, fov: 34, ap: 0.12 })
    add(7.6, 12.4, { target: v(wok.x + 4, 84, wok.z + 2), dist: 96, az: 28, el: 42, fov: 32, ap: 0.16 }, { target: v(wok.x + 2, 80, wok.z + 2), dist: 84, az: 34, el: 46, fov: 32, ap: 0.18 }, 1.0)
    add(12.4, 15.4, { target: s.fruitCenter, dist: 44, az: 18, el: 30, fov: 30, ap: 0.3 }, { target: s.fruitCenter, dist: 38, az: 28, el: 34, fov: 30, ap: 0.32 }, 1.0)
    add(15.4, 21.6, { target: v(-190, 86, -252), dist: 205, az: 6, el: 32, fov: 34, ap: 0.06 }, { target: v(-188, 84, -252), dist: 190, az: 12, el: 35, fov: 34, ap: 0.07 }, 1.2)
    add(21.6, 30, { target: v(oven.x, L.ovenTop + 5, oven.z + 2), dist: 74, az: 10, el: 46, fov: 32, ap: 0.16 }, { target: v(oven.x, L.ovenTop + 4, oven.z + 2), dist: 58, az: 22, el: 40, fov: 30, ap: 0.2 }, 1.6)
  }

  lights(): [number, LightName][] {
    return [[8, 'morning']]
  }

  carry(t: number) {
    const s = this.s
    // 锅里的水：开头就在烧，这一段里烧滚，捞完火小一点
    if (t >= 0) s.carry.boil = keys(t, [[0, 0.2], [1, 0.25], [7, 1.0], [22, 1.0], [26, 0.55]])
    const k = s.look
    k.blanch = smoothstep(9.4, 11.4, t)
    k.wet = k.blanch
    k.wet *= 1 - 0.65 * smoothstep(14, 30, t)
  }

  sounds(add: AddSound) {
    const L = LAYOUT
    const wok = v(L.wok.x, L.stoveTop, L.wok.z)
    const oven = v(L.oven.x, L.ovenTop, L.oven.z)
    const lay = this.s.layout
    // 篮子拎起来，倾过去，果在篮里滚出来，一个个扑通落进滚水
    add(LIFT_AT, 'rustle', { dur: 0.7, gain: 0.4, at: BASKET_FLOOR })
    add(AT.tilt, 'rustle', { dur: 0.8, gain: 0.45, pitch: 0.85, at: wok })
    // 叶子也被倒出去：每片脱离的精确时刻由叶子自己按种子抖，这里按这条线实际片数错开近似排；
    // 比上面那声果滚落更脆、更轻（叶尖擦过篮口的一下）
    const leafN = this.s.w.leaves.count
    for (let i = 0; i < leafN; i++)
      add(RELEASE0 + 0.05 + i * (RELEASE_SPAN / leafN), 'rustle', {
        dur: 0.22,
        gain: 0.16 - 0.03 * i,
        pitch: 1.35 + 0.08 * i,
        at: BASKET_FLOOR,
      })
    lay.pour.forEach((_, j) => add(POUR_AT + j * POUR_GAP + FALL - 0.01, 'plop', { gain: 0.5 - 0.12 * (j % 3), pitch: 0.9 + 0.05 * ((j * 7) % 5), at: wok }))
    add(AT.basketDown, 'thud', { gain: 0.4, pitch: 0.8, at: BASKET_FLOOR })
    add(AT.basketTap, 'tap', { gain: 0.25, pitch: 0.75, at: BASKET_FLOOR })
    // 一勺：笊篱伸进水里、捞起来沥水、倒在焙炉竹筛上
    lay.scoops.forEach((sc, k) => {
      const a = SCOOP0 + k * SCOOP_LEN
      add(a + 0.72, 'swish', { dur: 0.4, gain: 0.65, at: wok })
      add(a + 1.0, 'pour', { dur: 1.3, gain: 0.6, at: wok })
      add(a + 2.24, 'rustle', { dur: 0.35, gain: 0.3, at: oven })
      sc.forEach((_, g) => add(a + 2.28 + g * 0.06 + 0.47, 'tap', { gain: 0.4, pitch: 0.75 + 0.08 * (g % 3), at: oven }))
    })
    // 笊篱放回灶面
    add(SCOOP0 + lay.scoops.length * SCOOP_LEN + 0.58, 'tap', { gain: 0.35, pitch: 0.65, at: v(-171, L.stoveTop, -246) })
  }

  // ———— 轨迹 ————

  /** 锅里那一圈果转了多少（水在翻，果跟着慢慢打转） */
  private swirl(t: number) {
    return 0.25 * Math.max(0, t - 9.0)
  }
  /** 第 i 个果浮在锅里时的果心 */
  private floatPos(i: number, t: number, out: Vector3) {
    const L = LAYOUT
    const a = this.swirl(t)
    const sl = this.s.layout.float[i]
    const c = Math.cos(a)
    const sn = Math.sin(a)
    // 每个果各漂各的（幅度不超过摆位时留的空当的一半，不会撞到一起）
    const amp = 0.55 + 0.3 * Math.sin(i * 3.7)
    const wx = amp * Math.sin(t * (0.9 + 0.13 * (i % 4)) + i * 2.3)
    const wz = amp * Math.cos(t * (0.75 + 0.11 * (i % 3)) + i * 1.9)
    return out.set(L.wok.x + sl.x * c - sl.y * sn + wx, this.s.w.stove.waterY + 0.5 + 0.25 * Math.sin(t * 2.1 + i * 1.7), L.wok.z + sl.x * sn + sl.y * c + wz)
  }
  /** 第 i 个果摊在焙炉竹筛上的果心 */
  private sievePos(i: number, out: Vector3) {
    const L = LAYOUT
    const sl = this.s.layout.sieve[i]
    return out.set(L.oven.x + sl.x, L.ovenTop + this.s.layout.lift(i) + 0.03, L.oven.z + sl.y)
  }
  /** 第几勺、在勺里排第几 */
  private scoopOf(i: number) {
    const S = this.s.layout.scoops
    for (let s = 0; s < S.length; s++) {
      const g = S[s].indexOf(i)
      if (g >= 0) return { s, g, n: S[s].length }
    }
    return { s: 0, g: 0, n: 4 }
  }

  /** 摊在竹筛上的朝向 */
  private restQ(i: number, landQ: Quaternion) {
    const r = this.s.layout.restRot
    return r ? r(i) : new Quaternion().setFromAxisAngle(UP, i * 1.3).multiply(landQ)
  }

  /** 篮子：放在灶前地上，拎起来往锅里倒，再放回地上 */
  basketPose(t: number, outP: Vector3, outQ: Quaternion) {
    const L = LAYOUT
    const P1 = v(L.wok.x + 16, 112, L.wok.z + 6)
    if (t < LIFT_AT) outP.copy(BASKET_FLOOR)
    else if (t < 8.4) hop(outP, BASKET_FLOOR, P1, seg(t, LIFT_AT, 8.4), 22)
    else if (t < 9.4) outP.copy(P1)
    else if (t < 10.8) hop(outP, P1, BASKET_FLOOR, seg(t, 9.4, 10.8), 10)
    else outP.copy(BASKET_FLOOR)
    // 往 -x（锅心那边）倾倒，倒完扶正
    const tilt = 2.0 * smoother(seg(t, 8.2, 9.1)) * (1 - smoother(seg(t, 9.4, 10.3)))
    outQ.setFromAxisAngle(ZAX, tilt)
  }

  /** 竹笊篱：三勺把十个果捞到焙炉的大竹筛上 */
  private strainerAt(t: number, p: Vector3, q: Quaternion) {
    const L = LAYOUT
    const rest = v(-171, L.stoveTop + 0.05, -246)
    const dropPos = v(L.oven.x, L.ovenTop + 21, L.oven.z)
    const waterY = this.s.w.stove.waterY
    let tilt = 0
    // 放在灶面上时柄朝灶前（不伸到焙炉上方）；捞的时候柄转向右后
    let yaw = -0.35
    const scoops = this.s.layout.scoops
    const last = SCOOP0 + scoops.length * SCOOP_LEN
    if (t < 0 || t >= this.dur || t < SCOOP0 || t > last + 1.2) {
      p.copy(rest)
      yaw = STRAINER_REST_YAW
    } else if (t >= last - 0.5) {
      // 最后一勺倒完，放回灶面
      const f = seg(t, last - 0.5, last + 0.6)
      hop(p, dropPos, rest, f, 8)
      yaw = lerp(-0.35, STRAINER_REST_YAW, smoother(f))
      tilt = 0.8 * (1 - smoother(seg(t, last - 0.5, last)))
    } else {
      const s = Math.floor((t - SCOOP0) / SCOOP_LEN)
      const a = SCOOP0 + s * SCOOP_LEN
      const u = t - a
      // 这一勺对准它那几个果的中心（按伸下去那一刻的位置）
      const cen = new Vector3()
      const fp = new Vector3()
      for (const i of scoops[s]) cen.add(this.floatPos(i, a + 0.85, fp))
      cen.multiplyScalar(1 / scoops[s].length)
      const hover = v(cen.x, waterY + 16, cen.z)
      const dip = v(cen.x, waterY - 3.0, cen.z)
      const lift = v(cen.x, waterY + 18, cen.z)
      const from = s === 0 ? rest : dropPos
      if (u < 0.7) hop(p, from, hover, smoother(seg(u, 0, 0.7)), s === 0 ? 8 : 14)
      if (s === 0 && u < 0.7) yaw = lerp(STRAINER_REST_YAW, -0.35, smoother(seg(u, 0, 0.7)))
      else if (u < 1.0) p.lerpVectors(hover, dip, easeInOut(seg(u, 0.7, 1.0)))
      else if (u < 1.4) p.lerpVectors(dip, lift, easeOut(seg(u, 1.0, 1.4)))
      else if (u < 2.2) hop(p, lift, dropPos, seg(u, 1.4, 2.2), 10)
      else p.copy(dropPos)
      tilt = 0.8 * smoother(seg(u, 2.2, 2.5)) * (1 - smoother(seg(u, 2.55, 3.0)))
    }
    this.e.set(0, yaw, tilt, 'YXZ')
    q.setFromEuler(this.e)
  }

  /** 第 i 个果（0 是主角）的果心和朝向：在篮里 → 倒进锅 → 浮着打转 → 被一勺勺捞到焙炉竹筛上 */
  private fruit(t: number, i: number, outP: Vector3, outQ: Quaternion) {
    const s = this.s
    const j = s.layout.pour.indexOf(i)
    if (j < 0) {
      // 不烫的：一开始就摊在焙炉竹筛上
      this.sievePos(i, outP)
      outQ.copy(this.restQ(i, s.fruitRot(i)))
      return
    }
    const tRel = POUR_AT + j * POUR_GAP
    const tLand = tRel + FALL
    const bp = new Vector3()
    const bq = new Quaternion()
    if (t < tRel) {
      // 还在篮里（篮子拎起来、倾过去）
      this.basketPose(t, bp, bq)
      s.fruitInBasket(i, outP, outQ, bp, bq)
      return
    }
    // 滚出来那一刻的位置
    this.basketPose(tRel, bp, bq)
    const p0 = new Vector3()
    const q0 = new Quaternion()
    s.fruitInBasket(i, p0, q0, bp, bq)
    const landQ = new Quaternion().setFromAxisAngle(XAX, 2.5 + i).premultiply(q0)
    if (t < tLand) {
      const f = seg(t, tRel, tLand)
      const p1 = this.floatPos(i, tLand, new Vector3())
      outP.set(lerp(p0.x, p1.x, f), p0.y + (p1.y - p0.y) * f * f, lerp(p0.z, p1.z, f))
      outQ.copy(q0).slerp(landQ, f)
      return
    }
    const { s: sc, g, n } = this.scoopOf(i)
    const a = SCOOP0 + sc * SCOOP_LEN
    const floatQ = new Quaternion().setFromAxisAngle(UP, this.swirl(t)).multiply(landQ)
    const cap = smoothstep(a + 0.8, a + 1.1, t)
    const tR = a + 2.28 + g * 0.06
    const stP = new Vector3()
    const stQ = new Quaternion()
    if (t < tR) {
      this.strainerAt(t, stP, stQ)
      const fp = this.floatPos(i, t, new Vector3())
      const sp = s.layout.strainer(n, g, i, new Vector3()).applyQuaternion(stQ).add(stP)
      outP.lerpVectors(fp, sp, cap)
      outQ.copy(floatQ)
      if (cap > 0) outQ.slerp(new Quaternion().copy(stQ).multiply(landQ), cap)
      return
    }
    // 从勺里倒到竹筛上它的位置
    this.strainerAt(tR, stP, stQ)
    const sp = s.layout.strainer(n, g, i, new Vector3()).applyQuaternion(stQ).add(stP)
    const dest = this.sievePos(i, new Vector3())
    const restQ = this.restQ(i, landQ)
    const f = seg(t, tR, tR + 0.5)
    hop(outP, sp, dest, f, 3)
    outQ.copy(stQ).multiply(landQ).slerp(restQ, smoother(f))
  }

  // ———— 每帧 ————

  pose(t: number, time: number) {
    const s = this.s
    const w = s.w
    const L = LAYOUT
    const R = s.R

    this.basketPose(t, s.basketPos, s.basketQuat)
    this.strainerAt(t, this.sp, this.sq)
    w.stove.strainer.position.copy(this.sp)
    w.stove.strainer.quaternion.copy(this.sq)
    setCast(w.stove.strainer, true)

    // 主角和另外九个
    const p = new Vector3()
    const q = new Quaternion()
    this.fruit(t, 0, p, q)
    s.setHeroByCenter(p, q)
    s.applyHero()
    const b = s.fruits
    for (let i = 1; i < b.count; i++) {
      this.fruit(t, i, p, q)
      b.setFruit(i, p, q)
    }
    b.show(true)

    // 主角落水（落在锅心）那一圈水花
    const pour = s.layout.pour
    const splashT = POUR_AT + pour.indexOf(0) * POUR_GAP + FALL
    ;(w.stove.waterU.uSplash.value as Vector4).set(0, 0, time - (t - splashT), t > splashT - 0.1 && t < splashT + 4 ? 1 : 0)

    // 烫完的果子冒热气：捞起来的主角冒一点，摊在竹筛上那一批一起冒
    const hs = smoothstep(SCOOP0 + 1.0, SCOOP0 + 1.6, t) * (1 - smoothstep(SCOOP0 + 2.2, SCOOP0 + 3.2, t))
    const bs = smoothstep(SCOOP0 + 2.2, SCOOP0 + 4, t) * (1 - smoothstep(24, 30, t))
    w.batchSteam.set(v(L.oven.x, L.ovenTop + R * 1.5, L.oven.z), bs)
    w.heroSteam.set(p.set(0, R * 1.6, 0).applyQuaternion(s.heroQuat).add(s.heroPos), hs)

    // 水珠
    const d = w.drops
    const tmp = new Vector3()
    // 下锅溅起：十个果落水，各溅起几滴
    for (const i of [...pour].sort((a, c) => a - c)) {
      const tl = POUR_AT + pour.indexOf(i) * POUR_GAP + FALL
      const u = t - tl
      if (u < 0 || u > 0.7) continue
      const land = this.floatPos(i, tl, new Vector3())
      const r = rng(5 + i)
      for (let k = 0; k < 7; k++) {
        const a = r() * TAU
        const sp = 30 + r() * 55
        const vy = 110 + r() * 140
        tmp.set(land.x + Math.cos(a) * 3, w.stove.waterY, land.z + Math.sin(a) * 3)
        tmp.x += Math.cos(a) * sp * u
        tmp.z += Math.sin(a) * sp * u
        tmp.y += vy * u - 0.5 * G * u * u
        if (tmp.y > w.stove.waterY - 0.2) d.add(tmp, 0.2 + r() * 0.18, 1.3)
      }
    }
    // 捞起来往下滴：三勺，每勺从出水到倒在竹筛上
    const stP = new Vector3()
    const stQ = new Quaternion()
    for (let sc = 0; sc < s.layout.scoops.length; sc++) {
      const a = SCOOP0 + sc * SCOOP_LEN
      if (t < a + 1.0 || t > a + 2.9) continue
      for (let i = 0; i < 28; i++) {
        const ts = a + 1.0 + (i / 28) * 1.3 + hash1(i + sc * 31) * 0.05
        const age = t - ts
        if (age < 0 || age > 0.6) continue
        this.strainerAt(ts, stP, stQ)
        const rr = 6 * Math.sqrt(hash1(i * 3.1 + sc))
        const ang = hash1(i * 7.7 + sc) * TAU
        tmp.set(Math.cos(ang) * rr, 0.2, Math.sin(ang) * rr).applyQuaternion(stQ).add(stP)
        tmp.y -= 0.5 * G * age * age
        const overSieve = Math.hypot(tmp.x - L.oven.x, tmp.z - L.oven.z) < L.ovenSieveR
        const floor = overSieve ? L.ovenTop : Math.hypot(tmp.x - L.wok.x, tmp.z - L.wok.z) < L.wokR ? w.stove.waterY : L.stoveTop
        if (tmp.y > floor) d.add(tmp, 0.2 + 0.1 * hash1(i), 1 + Math.min(1.5, age * 4))
      }
    }
  }
}

