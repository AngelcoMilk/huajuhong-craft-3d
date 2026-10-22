import { Quaternion, Vector3 } from 'three'
import type { AddShot } from '../camera'
import type { LightName } from '../gfx/env'
import type { Stage } from '../stage'
import { Act } from './act'

// 青果：仰看树冠，摇下来到案上那一篮刚摘的青果。

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)

export class Pick extends Act {
  private p = new Vector3()
  private q = new Quaternion()

  constructor(
    s: Stage,
    /** 篮里是小果的时候镜头推得近一点（< 1） */
    private zoom = 1,
    id = 'pick',
  ) {
    super(s, id, 15)
  }

  shots(add: AddShot) {
    const s = this.s
    const canopy = v(-322, 318, 52)
    add(0, 7.4, { target: canopy, dist: 250, az: 38, el: -36, fov: 46, ap: 0.08 }, { target: v(-318, 300, 50), dist: 228, az: 22, el: -28, fov: 44, ap: 0.08 })
    const z = this.zoom
    // 篮里是小果时，篮沿相对果子高得多：机位要跟着抬高往下看，不然近侧篮壁把果全挡住（大果仍照原样 30°/26°）
    const elA = 30 + 34 * (1 - z)
    const elB = 26 + 32 * (1 - z)
    add(7.4, 15, { target: s.fruitCenter, dist: 56 * z, az: 24, el: elA, fov: 30, ap: 0.35 }, { target: s.fruitCenter, dist: 40 * z, az: 34, el: elB, fov: 28, ap: 0.42 }, 2.6)
  }

  lights(): [number, LightName][] {
    return [[0, 'morning']]
  }

  pose() {
    const s = this.s
    // 主角和另外九个都在案上的篮子里
    s.fruitInBasket(0, this.p, this.q)
    s.setHeroByCenter(this.p, this.q)
    s.applyHero()
    s.fruitsInBasket()
  }
}
