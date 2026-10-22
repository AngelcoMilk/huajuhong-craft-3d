import { Vector3 } from 'three'
import type { AddSound } from '../audio/sound'
import type { AddShot } from '../camera'
import type { LightName } from '../gfx/env'
import type { Stage } from '../stage'
import { rng, seg, smoother, smoothstep, TAU } from '../util'
import { BATCH, fanSlots } from '../world/batch'
import { LAYOUT } from '../world/layout'
import { Act } from './act'
import { placePress, pressSounds, type PressCue } from './press'

// 润、折、压：晒干的皮发脆，先在竹匾上十片一起洒水润透；切到案上，九片已经对折好摆在底板上，
// 折最后一片（主角），放进前排正中那格，十片一起用木板压平，压石压上，过一会儿搬开。

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
const UP = new Vector3(0, 1, 0)

// 声音该响的时刻：数字只写在这里，声音只引用名字。
const AT = {
  turnOver: 9.6, // 整片翻过来
  tipFold: 9.7, // 五爪先折瓣尖（只有五爪走这条路）
  foldIn: 10.4, // 对折压下去
  toPress: 14.35, // 搬到压板上
} as const

export class Fold extends Act {
  /** 五爪先折瓣尖再对折：折瓣尖的时候推近看 */
  private tips: boolean
  private slots: { x: number; z: number; yaw: number }[]

  constructor(s: Stage, id = 'fold') {
    super(s, id, 37)
    this.tips = s.w.hero.tipFold
    this.slots = fanSlots(s.w.hero.n)
  }

  shots(add: AddShot) {
    const L = LAYOUT
    const s = this.s
    const pr = v(L.press.x, L.press.y + 0.5, L.press.z)
    const dryC = v(L.dry.x, L.dryY, L.dry.z)
    add(0, 8.6, { target: dryC, dist: 120, az: 46, el: 54, fov: 32, ap: 0.07 }, { target: dryC, dist: 104, az: 56, el: 50, fov: 32, ap: 0.08 })
    if (this.tips) {
      // 瓣尖只折回 3 毫米：先推到一个瓣尖上看，再拉开看整片对折
      const w = s.w
      const tip = (_T: number, out: Vector3) => w.hero.outerCenter(0, Math.PI * 0.96, out).applyMatrix4(w.hero.group.matrixWorld)
      add(8.6, 9.4, { target: s.follow(1.0), dist: 32, az: 24, el: 44, fov: 30, ap: 0.28 }, { target: s.follow(1.0), dist: 30, az: 20, el: 46, fov: 30, ap: 0.3 })
      add(9.4, 11.6, { target: tip, dist: 13, az: 30, el: 36, fov: 30, ap: 0.42 }, { target: tip, dist: 11, az: 16, el: 40, fov: 30, ap: 0.46 }, 0.6)
      add(11.6, 16, { target: s.follow(1.5), dist: 46, az: 20, el: 38, fov: 30, ap: 0.26 }, { target: s.follow(1.5), dist: 42, az: 6, el: 42, fov: 30, ap: 0.28 }, 0.9)
    } else add(8.6, 16, { target: s.follow(1.5), dist: 48, az: 24, el: 36, fov: 30, ap: 0.26 }, { target: s.follow(1.5), dist: 42, az: 6, el: 42, fov: 30, ap: 0.28 })
    // 压板、压石起落都在这个中景里；等顶板挪开了再推近看压平的十片
    add(16, 30.4, { target: v(L.press.x, L.press.y + 4, L.press.z), dist: 96, az: 34, el: 26, fov: 30, ap: 0.12 }, { target: v(L.press.x, L.press.y + 4, L.press.z), dist: 84, az: 46, el: 30, fov: 30, ap: 0.14 }, 1.0)
    add(30.4, 37, { target: pr, dist: 66, az: 10, el: 58, fov: 30, ap: 0.16 }, { target: pr, dist: 58, az: -10, el: 62, fov: 30, ap: 0.18 }, 1.2)
  }

  lights(): [number, LightName][] {
    return [
      [19, 'afternoon'],
      [27, 'golden'],
    ]
  }

  carry(t: number) {
    const s = this.s
    const st = s.w.hero.state
    const soak = smoothstep(2, 8, t)
    st.soak = soak
    s.look.soak = soak
    // 整片对折：一边掀起来、翻过去搭在另一边上（两边的瓣错开）
    st.fold = smoother(seg(t, 9.6, 12.8))
    // 压板落下来那一下压平（比板子略早一点，板子碰到的时候已经平了，不穿过去）
    st.press = smoothstep(17.0, 17.9, t)
    s.look.press = st.press
  }

  private press: PressCue = { board: [15.6, 17.2, 18.0, 28.2, 29.0, 30.4], stone: [18.2, 19.6, 27, 28.2], gap: 0.62 }

  sounds(add: AddSound) {
    const L = LAYOUT
    const rack = v(L.dry.x, L.dryY, L.dry.z)
    // 三把水洒在竹匾上
    for (let b = 0; b < 3; b++) add(1.8 + b * 1.15 + 0.35, 'sprinkle', { gain: 0.65, at: rack })
    // 折：五爪先折瓣尖，再整片翻过来对折
    if (this.tips) add(AT.tipFold, 'crinkle', { dur: 0.6, gain: 0.22 })
    add(AT.turnOver, 'flip', { gain: 0.45 })
    add(AT.foldIn, 'rustle', { dur: 1.6, gain: 0.2, pitch: 0.6 })
    add(AT.toPress, 'tap', { gain: 0.3, pitch: 0.7, at: v(L.press.x, L.press.y, L.press.z) })
    pressSounds(add, this.press)
  }

  pose(t: number) {
    const s = this.s
    const w = s.w
    const L = LAYOUT
    if (t < 8.6) {
      // 先在竹匾上：十片一起洒水润透
      s.heroOnRack()
      s.applyHero()
      s.piecesOnRack()
    } else {
      const geo = t < 16.9 ? w.foldedGeo : w.hero.geometry
      const p = new Vector3()
      const lift = 10 * (1 - smoother(seg(t, 13.2, 14.4)))
      // 其余九片已经对折好摆在压板上；主角拿在手上折（离板 10 厘米，不碰旁边的），折好放进前排正中那格
      const sl = this.slots[0]
      s.heroPos.set(L.press.x + sl.x, L.press.y + 0.02, L.press.z + sl.z)
      s.heroPos.y += lift
      s.heroQuat.setFromAxisAngle(UP, sl.yaw)
      s.applyHero()
      // 压板落下来那一刻起和主角一起被压平（共用主角的形状）
      for (let i = 1; i < BATCH; i++) {
        const f = this.slots[i]
        w.batch.setPiece(i, geo, p.set(L.press.x + f.x, L.press.y + 0.02, L.press.z + f.z), f.yaw)
      }
    }

    placePress(s, t, this.press)

    // 洒水润皮：三把水，洒在整面竹匾上
    if (t > 1.5 && t < 6) {
      const d = w.drops
      const tmp = new Vector3()
      for (let burst = 0; burst < 3; burst++) {
        const tb = 1.8 + burst * 1.15
        const r = rng(30 + burst)
        for (let i = 0; i < 26; i++) {
          const delay = r() * 0.15
          const age = t - tb - delay
          const ra = r() * TAU
          const rr = Math.sqrt(r()) * 44
          const tx = Math.cos(ra) * rr
          const tz = Math.sin(ra) * rr
          const dur = 0.5 + r() * 0.14
          if (age < 0 || age > dur) continue
          const start = v(L.dry.x + 40 + (burst - 1) * 14, L.dryY + 52, L.dry.z + 34)
          const end = v(L.dry.x + tx, L.dryY + 0.4, L.dry.z + tz)
          const k = age / dur
          tmp.lerpVectors(start, end, k)
          tmp.y += Math.sin(Math.PI * k) * 6 * (1 - k)
          d.add(tmp, 0.22 + r() * 0.16, 1.2)
        }
      }
    }
  }
}
