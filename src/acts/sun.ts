import { Vector3 } from 'three'
import type { AddSound } from '../audio/sound'
import type { AddShot } from '../camera'
import type { LightName } from '../gfx/env'
import type { Stage } from '../stage'
import { smoothstep } from '../util'
import { LAYOUT } from '../world/layout'
import { Act } from './act'

// 晒：十片摊在竹匾上，太阳从上午走到下午（延时），皮的颜色暗下来、边卷起来。

export class Sun extends Act {
  constructor(s: Stage, id = 'sun') {
    super(s, id, 28)
  }

  shots(add: AddShot) {
    const L = LAYOUT
    const s = this.s
    const dryT = new Vector3(L.dry.x, L.dryY, L.dry.z)
    // 先给全景交代在哪晒，再推近看颜色变暗、边卷起来（变化主要在这一段）
    add(0, 6, { target: dryT, dist: 170, az: 40, el: 50, fov: 34, ap: 0.06 }, { target: dryT, dist: 150, az: 50, el: 47, fov: 34, ap: 0.07 }, 0, (t) => t)
    add(6, 18, { target: s.heroFlat, dist: 66, az: 56, el: 50, fov: 32, ap: 0.16 }, { target: s.heroFlat, dist: 50, az: 70, el: 44, fov: 32, ap: 0.2 }, 1.8)
    add(18, 28, { target: s.heroFlat, dist: 34, az: 70, el: 36, fov: 30, ap: 0.36 }, { target: s.heroFlat, dist: 28, az: 88, el: 30, fov: 30, ap: 0.4 }, 2.2)
  }

  lights(): [number, LightName][] {
    return [
      [2, 'forenoon'],
      [8, 'noon'],
      [14, 'afternoon'],
    ]
  }

  carry(t: number) {
    const s = this.s
    const d = smoothstep(3, 17.5, t)
    const st = s.w.hero.state
    st.dry = d
    st.shrink = d
    s.look.dry = d
    // 灶上的火压小了；云跑得飞快（延时摄影）
    if (t >= 0) s.carry.fireLow = true
    s.carry.lapse = 260 * smoothstep(1.5, 17, t)
  }

  sounds(add: AddSound) {
    const at = new Vector3(LAYOUT.dry.x, LAYOUT.dryY, LAYOUT.dry.z)
    for (const [t, d] of [
      [6.5, 0.5],
      [9.2, 0.4],
      [11.8, 0.6],
      [14.1, 0.4],
      [16.3, 0.5],
    ]) add(t, 'crinkle', { dur: d, gain: 0.3, at })
  }

  pose() {
    const s = this.s
    s.heroOnRack()
    s.applyHero()
    s.piecesOnRack()
  }
}
