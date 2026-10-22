import { Quaternion, Vector3 } from 'three'
import type { AddSound } from '../audio/sound'
import type { AddShot } from '../camera'
import type { LightName } from '../gfx/env'
import type { Stage } from '../stage'
import { lerp, seg, smoother, smoothstep } from '../util'
import { BATCH, fanSlots } from '../world/batch'
import { LAYOUT } from '../world/layout'
import { PRESSED_THICKNESS } from '../world/peel'
import { Act } from './act'

// 再焙：压平的十片铺满焙炉的竹筛，细火隔着筛焙；翻一次面；焙好拿起一片，转着看。

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
const UP = new Vector3(0, 1, 0)
const XAX = new Vector3(1, 0, 0)
const ZAX = new Vector3(0, 0, 1)

// 声音该响的时刻：数字只写在这里，声音只引用名字。
// 括号里是它对应的画面动作 —— 改动画节奏时一起改这张表。
const AT = {
  hiss: 0.8, // 刚放上焙炉，湿热的一激
  flipA: 9.15, // 第一次翻面（pose 里 seg(9.0, 10.6)）
  flipALand: 10.55, // 翻完落回原来那一格
  lift: 18.05, // 拿起来给人看（pose 里 seg(18, 19.8)）
} as const

export class Bake extends Act {
  private q = new Quaternion()

  /** 竹筛上十片扇形怎么摆（按瓣数算折线方向） */
  private slots: { x: number; z: number; yaw: number }[]

  constructor(s: Stage, id = 'bake') {
    super(s, id, 26)
    this.slots = fanSlots(s.w.hero.n)
  }

  shots(add: AddShot) {
    const L = LAYOUT
    const s = this.s
    const ov = v(L.oven.x, L.ovenTop + 1, L.oven.z)
    const heroOven = v(L.oven.x + this.slots[0].x, L.ovenTop + 1, L.oven.z + this.slots[0].z)
    // 先看整面竹筛（十片铺满），再推近看主角翻面
    add(0, 12, { target: v(ov.x, ov.y - 6, ov.z), dist: 118, az: 18, el: 30, fov: 32, ap: 0.1 }, { target: v(ov.x, ov.y - 4, ov.z), dist: 100, az: 28, el: 34, fov: 32, ap: 0.12 })
    add(12, 18, { target: heroOven, dist: 44, az: 30, el: 44, fov: 30, ap: 0.3 }, { target: heroOven, dist: 40, az: 12, el: 48, fov: 30, ap: 0.32 }, 1.2)
    // 拿起来转着看：镜头高一点，看得到正面（太低只看到一条边）
    add(18, 26, { target: s.follow(0.5), dist: 32, az: 34, el: 32, fov: 30, ap: 0.46 }, { target: s.follow(0.5), dist: 28, az: 58, el: 28, fov: 30, ap: 0.48 }, 1.4)
  }

  lights(): [number, LightName][] {
    return [[0, 'dusk']]
  }

  carry(t: number) {
    const s = this.s
    s.look.soak *= 1 - smoothstep(2, 15, t)
    s.look.product = smoothstep(3, 17, t)
    // 焙炉：上一段末点起来，一直烧着
    const c = s.carry
    c.ovenOn = Math.max(c.ovenOn, smoothstep(-1, 0, t))
    c.bloom = lerp(0.2, 0.42, smoothstep(-2, 2, t))
    c.haze = Math.max(c.haze, smoothstep(-1, 1, t) * (1 - smoothstep(this.dur - 0.5, this.dur, t)))
  }

  sounds(add: AddSound) {
    const L = LAYOUT
    const at = v(L.oven.x + this.slots[0].x, L.ovenTop, L.oven.z + this.slots[0].z)
    add(AT.hiss, 'hiss', { dur: 5, gain: 0.55, at })
    add(AT.flipA, 'flip', { gain: 0.45, at })
    add(AT.flipALand, 'tap', { gain: 0.35, pitch: 0.75, at })
    add(AT.lift, 'flip', { gain: 0.3, at })
  }

  pose(t: number) {
    const s = this.s
    const w = s.w
    const L = LAYOUT
    const sl = this.slots[0]
    const pos = s.heroPos
    const q = s.heroQuat
    pos.set(L.oven.x + sl.x, L.ovenTop + 0.02, L.oven.z + sl.z)
    // 翻面：绕扇形自己的对称轴（朝前那条）翻，还落回原来那一格；中途抬高，转的时候碰不到旁边的
    const flip = smoother(seg(t, 9.0, 10.6))
    pos.y += Math.sin(Math.PI * flip) * 10 + flip * (PRESSED_THICKNESS + 0.02)
    // 焙好拿起来，悬着慢慢转、朝镜头斜过来给人看
    const off = smoother(seg(t, 18, 19.8))
    pos.y += off * 14
    const spin = off * (t - 18) * 0.08
    q.setFromAxisAngle(UP, sl.yaw)
    q.premultiply(this.q.setFromAxisAngle(ZAX, flip * Math.PI))
    q.premultiply(this.q.setFromAxisAngle(UP, spin))
    q.premultiply(this.q.setFromAxisAngle(XAX, off * 0.55))
    s.applyHero()

    // 十片铺满焙炉的竹筛
    const p = new Vector3()
    for (let i = 1; i < BATCH; i++) {
      const f = this.slots[i]
      w.batch.setPiece(i, w.hero.geometry, p.set(L.oven.x + f.x, L.ovenTop + 0.02, L.oven.z + f.z), f.yaw)
    }

    // 刚放上去的湿皮冒一点热气
    const ovenSteam = smoothstep(1, 3, t) * (1 - smoothstep(8, 16, t)) * 0.5
    w.heroSteam.set(p.set(0, 0.8, 0).applyQuaternion(q).add(pos), ovenSteam)
  }
}
