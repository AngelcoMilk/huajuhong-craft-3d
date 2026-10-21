import { Vector3 } from 'three'
import type { AddSound } from '../audio/sound'
import type { AddShot } from '../camera'
import type { LightName } from '../gfx/env'
import type { Stage } from '../stage'
import { clamp, seg, smooth, smoother, smoothstep } from '../util'
import { LAYOUT } from '../world/layout'
import { Act } from './act'

// 十片一扎：九片一片片落在竹盘上码齐，主角最后放在最上面，红头绳从根上的结拉出四股、卡进瓣缝捆好。天黑了，屋檐下的灯亮起来。

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)

export class Bundle extends Act {
  constructor(s: Stage, id = 'bundle') {
    super(s, id, 30)
  }

  shots(add: AddShot) {
    const L = LAYOUT
    const tray = v(L.tray.x, L.tableTop + 4, L.tray.z)
    // 从斜上方看一摞：看得出是一片片叠起来、绳子怎么捆
    add(0, 12, { target: tray, dist: 46, az: -4, el: 56, fov: 30, ap: 0.3 }, { target: tray, dist: 38, az: 14, el: 48, fov: 30, ap: 0.34 })
    add(12, this.dur + 2, { target: v(tray.x, tray.y + 2, tray.z), dist: 40, az: 16, el: 46, fov: 30, ap: 0.3 }, { target: v(tray.x + 10, tray.y + 30, tray.z - 30), dist: 170, az: 70, el: 18, fov: 34, ap: 0.14 }, 1.6, smooth)
  }

  lights(): [number, LightName][] {
    return [
      [10, 'dusk'],
      [24, 'evening'],
    ]
  }

  carry(t: number) {
    const c = this.s.carry
    c.bulb = Math.max(c.bulb, smoothstep(11.2, 11.5, t))
    c.interior = Math.max(c.interior, smoothstep(11.4, 12.6, t))
  }

  sounds(add: AddSound) {
    const L = LAYOUT
    const at = v(L.tray.x, L.tableTop + 2, L.tray.z)
    // 九片一片片落下码齐，主角放在最上面
    for (let i = 0; i < 9; i++) add(0.6 + (i + 1) * 0.42 - 0.03, 'tap', { gain: 0.3, pitch: 0.7 + 0.03 * i, at })
    add(5.27, 'tap', { gain: 0.35, pitch: 0.75, at })
    // 一圈一圈绕绳，最后勒紧打结（绕绳 5.8～11 秒，前 84% 是四圈，后面打结）
    const n = this.s.w.bundle.loops.length
    for (let i = 0; i < n; i++) add(5.8 + (5.2 * 0.84 * i) / n + 0.05, 'rope', { dur: ((5.2 * 0.84) / n) * 0.9, gain: 0.6, at })
    add(5.8 + 5.2 * 0.86, 'cinch', { gain: 0.6, at })
    add(5.8 + 5.2 * 0.96, 'cinch', { gain: 0.45, at })
    // 天黑了，檐下拉亮电灯
    add(11.2, 'click', { gain: 0.5, at: L.bulb })
  }

  pose(t: number) {
    const s = this.s
    const b = s.w.bundle
    const topY = b.group.position.y + b.heroY
    const d = smoother(seg(t, 4.5, 5.3))
    s.heroPos.set(LAYOUT.tray.x, topY + (1 - d) * 18, LAYOUT.tray.z)
    s.heroQuat.setFromAxisAngle(new Vector3(0, 1, 0), (1 - d) * 0.9)
    s.applyHero()
    b.update(clamp((t - 0.6) / 0.42, 0, 9), seg(t, 5.8, 11), null)
    b.group.visible = true
  }
}
