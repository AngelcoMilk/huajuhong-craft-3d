import { Quaternion, Vector3 } from 'three'
import type { AddSound } from '../audio/sound'
import type { AddShot } from '../camera'
import type { LightName } from '../gfx/env'
import type { Stage } from '../stage'
import { smoother, smoothstep } from '../util'
import { LAYOUT } from '../world/layout'
import { Act } from './act'

// 连烘几天（橘红胎）：三十个小果摊在焙炉的竹筛上，一半烫过、一半没烫，焙炉生火日夜不断。
// 延时：白天、黄昏、夜里、天亮转两轮。果子慢慢变成青褐到黄棕、缩一点，白绒越来越显；中间翻两回。
// 不割、不压，什么都不加，只是烘。

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
/** 翻的时刻：每个果绕自己果蒂那条轴滚四分之一圈（果蒂一直朝旁边，不扎进竹筛） */
const TURNS = [17.2, 33.4]

// 声音该响的时刻：数字只写在这里，声音只引用名字。翻/滚的时刻已经由 TURNS 给出。
const AT = {
  hiss: 0.6, // 刚摆进焙炉，湿热的一激
} as const
/** 两夜：夜里多亮（0～1） */
const NIGHTS: [number, number][] = [
  [13.2, 21.6],
  [32.2, 40.2],
]

export class TaiOven extends Act {
  private q = new Quaternion()
  private r = new Quaternion()
  private c = new Vector3()

  constructor(s: Stage, id = 'oven') {
    super(s, id, 44)
  }

  /** 夜深的程度 */
  private night(t: number) {
    let n = 0
    for (const [a, b] of NIGHTS) n = Math.max(n, smoothstep(a - 1.5, a + 1, t) * (1 - smoothstep(b - 1.5, b + 0.5, t)))
    return n
  }

  lights(): [number, LightName][] {
    return [
      [1, 'forenoon'],
      [6, 'noon'],
      [9.5, 'afternoon'],
      [11.6, 'dusk'],
      [14, 'night'],
      [20.4, 'night'],
      [23.2, 'morning'],
      [26.4, 'noon'],
      [29.6, 'golden'],
      [31.2, 'dusk'],
      [33.2, 'night'],
      [39, 'night'],
      [41.6, 'morning'],
      [44, 'forenoon'],
    ]
  }

  carry(t: number) {
    const s = this.s
    const c = s.carry
    if (t < 0) return
    // 焙炉一直烧着；灶火压小
    c.ovenOn = Math.max(c.ovenOn, smoothstep(0, 1.8, t) * (t < this.dur ? 1 : 0.6))
    c.fireLow = true
    c.bloom = 0.32
    if (t < this.dur) c.haze = Math.max(c.haze, smoothstep(0.5, 2.5, t) * (1 - smoothstep(this.dur - 1, this.dur, t)) * 0.8)
    // 延时：云飞快地走
    c.lapse = 2400 * smoothstep(0, this.dur, t)
    // 夜里屋檐下的灯亮着
    if (t < this.dur) c.bulb = Math.max(c.bulb, this.night(t))
    // 皮上的水先干，颜色慢慢变
    s.look.wet *= 1 - smoothstep(0, 5, t)
    s.look.dry = Math.max(s.look.dry, smoothstep(3, 40, t))
  }

  shots(add: AddShot) {
    const s = this.s
    const O = LAYOUT.oven
    const top = LAYOUT.ovenTop
    const mid = v(O.x, top + 2, O.z)
    add(0, 8.6, { target: mid, dist: 124, az: 20, el: 30, fov: 32, ap: 0.08 }, { target: mid, dist: 106, az: 28, el: 33, fov: 32, ap: 0.09 })
    add(8.6, 19.4, { target: v(O.x + 3, top + 1, O.z + 2), dist: 64, az: 12, el: 54, fov: 32, ap: 0.14 }, { target: v(O.x + 3, top + 1, O.z + 2), dist: 56, az: 2, el: 58, fov: 32, ap: 0.16 }, 1.2)
    add(19.4, 31.4, { target: s.fruitCenter, dist: 19, az: 22, el: 28, fov: 28, ap: 0.4 }, { target: s.fruitCenter, dist: 14.5, az: 46, el: 22, fov: 28, ap: 0.48 }, 1.4)
    add(31.4, this.dur, { target: v(O.x, top + 1, O.z), dist: 66, az: -8, el: 46, fov: 32, ap: 0.12 }, { target: v(O.x, top + 1, O.z), dist: 82, az: 10, el: 40, fov: 32, ap: 0.1 }, 1.4)
  }

  sounds(add: AddSound) {
    const at = v(LAYOUT.oven.x, LAYOUT.ovenTop, LAYOUT.oven.z)
    add(AT.hiss, 'hiss', { dur: 5, gain: 0.45, at })
    for (const a of TURNS) {
      add(a, 'rustle', { dur: 1.3, gain: 0.55, pitch: 0.7, at })
      for (let k = 0; k < 6; k++) add(a + 0.9 + k * 0.06, 'tap', { gain: 0.14, pitch: 0.7, at })
    }
  }

  /** 第 i 个果此刻的朝向：落定的朝向，再绕果蒂那条轴滚几回 */
  private orient(i: number, t: number, out: Quaternion) {
    const s = this.s
    const base = s.layout.restRot ? s.layout.restRot(i) : s.fruitRot(i)
    let roll = 0
    TURNS.forEach((a, k) => (roll += smoother(smoothstep(a + (i % 7) * 0.05, a + 0.9 + (i % 7) * 0.05, t)) * (Math.PI / 2) * (k % 2 ? -1 : 1) * (i % 2 ? 1 : -1)))
    const axis = this.c.set(0, -1, 0).applyQuaternion(base)
    return out.copy(base).premultiply(this.r.setFromAxisAngle(axis, roll))
  }

  pose(t: number) {
    const s = this.s
    const L = LAYOUT
    const f = s.fruits
    const p = new Vector3()
    for (let i = 0; i < f.count; i++) {
      const sl = s.layout.sieve[i]
      // 翻的时候稍微跳一下
      let hopY = 0
      for (const a of TURNS) {
        const u = (t - a - (i % 7) * 0.05) / 0.9
        if (u > 0 && u < 1) hopY = Math.sin(Math.PI * u) * 0.6
      }
      p.set(L.oven.x + sl.x, L.ovenTop + s.layout.lift(i) + 0.03 + hopY, L.oven.z + sl.y)
      this.orient(i, t, this.q)
      if (i === 0) {
        s.setHeroByCenter(p, this.q)
        s.applyHero()
      } else f.setFruit(i, p, this.q)
    }
    f.show(true)
    // 刚上筛的湿果冒一点热气
    s.w.batchSteam.set(v(L.oven.x, L.ovenTop + 3, L.oven.z), 0.5 * smoothstep(0.5, 2.5, t) * (1 - smoothstep(5, 9, t)))
  }
}
