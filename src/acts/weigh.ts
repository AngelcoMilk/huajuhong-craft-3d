import { Quaternion, Vector3 } from 'three'
import type { AddSound } from '../audio/sound'
import type { AddShot } from '../camera'
import type { Stage } from '../stage'
import { clamp, hop, keys, seg, smoother } from '../util'
import { LAYOUT } from '../world/layout'
import { Act } from './act'

// 称果：摘回来的一篮放在灶前地上，挑一个放进墙上杆秤的秤盘里——秤盘一沉、秤杆翘，
// 秤砣往秤尾挪，挪过头一点再退回来，秤杆晃几下停平；镜头推近看秤砣绳压着的那颗星。称完放回篮里。
// 大果、小果用同一段，只是读数不同（liang：几两）。

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
const UP = new Vector3(0, 1, 0)

const IN0 = 1.0 // 从篮里拿起来
const LAND = 2.2 // 落进秤盘
const SLIDE0 = 2.9 // 开始挪秤砣
const OUT0 = 6.6 // 拿出来放回篮里
const OUT1 = 7.7

export class Weigh extends Act {
  /** 秤杆的角度、角速度，按时间从头算一遍（每帧都从 0 算到 t，固定步长，所以拖进度也一样） */
  private sim: { t: number; a: number }[] = []
  private p = new Vector3()
  private q = new Quaternion()

  constructor(
    s: Stage,
    /** 读数：几两 */
    private liang: number,
    id = 'weigh',
  ) {
    super(s, id, 8.4)
    this.simulate()
  }

  /** 秤砣挪到第几两 */
  private weightAt(t: number) {
    const over = Math.max(0.25, this.liang * 0.12)
    return keys(t, [
      [SLIDE0, 0],
      [4.0, this.liang + over],
      [4.7, this.liang],
    ])
  }

  /** 秤杆：盘里重、秤砣轻就秤头往下沉（角度为负），一放上去先沉到底，挪秤砣慢慢抬起来，晃几下停平 */
  private simulate() {
    const dt = 1 / 120
    let a = 0
    let w = 0
    const K = 62
    const C = 2.6
    const LIM = 0.2
    for (let i = 0; i <= Math.ceil(this.dur / dt); i++) {
      const t = i * dt
      const load = t >= LAND ? this.liang : 0
      const imb = load - this.weightAt(t)
      const target = clamp(-imb * 0.06, -LIM, LIM)
      const acc = -K * (a - target) - C * w
      w += acc * dt
      a += w * dt
      if (a < -LIM) {
        a = -LIM
        w = -w * 0.25
      } else if (a > LIM) {
        a = LIM
        w = -w * 0.25
      }
      this.sim.push({ t, a })
    }
  }
  private angleAt(t: number) {
    const i = clamp(Math.floor(t * 120), 0, this.sim.length - 1)
    return this.sim[i].a
  }

  shots(add: AddShot) {
    const S = LAYOUT.steelyard
    const sy = this.s.w.steelyard
    const mid = v(S.x - 16, S.y - 17, S.z)
    const read = (_T: number, out: Vector3) => sy.readWorld(out).add(v(0, -3.2, 0))
    // 先给全景：灶、锅、墙上的秤；放上秤以后近一点看秤杆翘、挪秤砣；最后推到秤星上看读数
    add(0, 2.6, { target: v(S.x - 18, 138, S.z + 14), dist: 175, az: 14, el: 9, fov: 34, ap: 0.08 }, { target: v(S.x - 16, 140, S.z + 12), dist: 158, az: 18, el: 10, fov: 34, ap: 0.09 })
    add(2.6, 4.8, { target: mid, dist: 80, az: 12, el: 6, fov: 32, ap: 0.14 }, { target: v(mid.x - 2, mid.y, mid.z), dist: 70, az: 16, el: 8, fov: 32, ap: 0.16 }, 0.8)
    add(4.8, this.dur, { target: read, dist: 36, az: 18, el: 12, fov: 28, ap: 0.34 }, { target: read, dist: 29, az: 24, el: 14, fov: 28, ap: 0.38 }, 1.1)
  }

  sounds(add: AddSound) {
    const S = LAYOUT.steelyard
    const pan = v(S.x - 16, S.y - 40, S.z)
    const basket = LAYOUT.basketFloor
    add(IN0 - 0.05, 'rustle', { dur: 0.4, gain: 0.45, at: basket })
    add(LAND - 0.01, 'thud', { gain: 0.7, pitch: 1.1, at: pan })
    add(LAND, 'tap', { gain: 0.22, pitch: 0.7, at: pan })
    // 秤砣的绳顺着秤杆挪过去，挪过头再退回来
    add(SLIDE0, 'slide', { dur: 1.1, gain: 0.6, at: pan })
    add(4.02, 'slide', { dur: 0.6, gain: 0.4, pitch: 0.95, at: pan })
    add(OUT0, 'rustle', { dur: 0.3, gain: 0.25, at: pan })
    add(OUT1 - 0.02, 'thud', { gain: 0.55, pitch: 0.9, at: basket })
    add(OUT1, 'rustle', { dur: 0.35, gain: 0.3, at: basket })
  }

  pose(t: number) {
    const s = this.s
    const sy = s.w.steelyard
    // 篮子放在灶前地上（下一段烫果就从这儿拎起来）
    s.basketPos.copy(LAYOUT.basketFloor)
    s.basketQuat.identity()
    s.fruitsInBasket()

    // 秤
    const land = t - LAND
    const sway = land > 0 && t < OUT0 ? 0.07 * Math.exp(-2.4 * land) * Math.sin(8 * land) : 0
    sy.set(this.angleAt(t), this.weightAt(t), sway)
    sy.group.updateMatrixWorld()

    // 主角：篮里 → 秤盘 → 篮里
    const inBasket = new Vector3()
    const qBasket = new Quaternion()
    s.fruitInBasket(0, inBasket, qBasket)
    const lift = s.layout.lift(0)
    const onPan = sy.panFloorWorld(new Vector3()).add(v(0, lift, 0))
    const p = this.p
    const q = this.q
    if (t < IN0 || t >= OUT1) {
      p.copy(inBasket)
      q.copy(qBasket)
    } else if (t < LAND) {
      // 落点按落下那一刻秤盘的位置（那一刻秤杆还平着）
      const at = new Vector3()
      sy.set(this.angleAt(LAND - 0.01), 0, 0)
      sy.panFloorWorld(at).add(v(0, lift, 0))
      sy.set(this.angleAt(t), this.weightAt(t), sway)
      sy.group.updateMatrixWorld()
      const f = seg(t, IN0, LAND)
      hop(p, inBasket, at, f, 40)
      q.copy(qBasket).premultiply(new Quaternion().setFromAxisAngle(UP, smoother(f) * 1.2))
    } else if (t < OUT0) {
      p.copy(onPan)
      q.copy(qBasket).premultiply(new Quaternion().setFromAxisAngle(UP, 1.2))
    } else {
      const f = seg(t, OUT0, OUT1)
      hop(p, onPan, inBasket, f, 30)
      q.copy(qBasket).premultiply(new Quaternion().setFromAxisAngle(UP, 1.2 * (1 - smoother(f))))
    }
    s.setHeroByCenter(p, q)
    s.applyHero()
  }
}
