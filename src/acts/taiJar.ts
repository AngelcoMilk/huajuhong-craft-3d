import { Quaternion, Vector2, Vector3 } from 'three'
import type { AddSound } from '../audio/sound'
import type { AddShot } from '../camera'
import type { LightName } from '../gfx/env'
import type { Stage } from '../stage'
import { hop, rng, seg, smooth, smoother } from '../util'
import { drop } from '../world/fruitset'
import { Act } from './act'

// 结尾（橘红胎）：烘干的小果装进案上的玻璃罐。先把最后一个（主角）拿在罐口上方转着看——
// 一层密白绒、果蒂明显、顶上微凹；再放进罐里、盖上木盖，镜头拉远。

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
const UP = new Vector3(0, 1, 0)
const SIDEWAYS = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
const DROP0 = 9.4
const DROP1 = 10.6
const LID0 = 11.2
const LID1 = 12.6

export class TaiJar extends Act {
  /** 罐里每个果的果心（罐本地坐标） */
  private pile: Vector3[] = []
  private q = new Quaternion()

  constructor(s: Stage, id = 'jar') {
    super(s, id, 26)
  }

  private get jar() {
    return this.s.w.jar!
  }

  /** 罐里怎么堆：一个个落下去，挤不下就搁在别的上面（烘干缩过的大小） */
  private layoutPile() {
    if (this.pile.length) return
    const s = this.s
    const j = this.jar
    const r = rng(101)
    const placed: { p: Vector3; r: number }[] = []
    const order = Array.from({ length: s.fruits.count - 1 }, (_, i) => i + 1)
    for (const i of [...order, 0]) {
      const rr = s.layout.lift(i)
      const cands: Vector2[] = []
      for (let k = 0; k < 120; k++) cands.push(new Vector2((r() * 2 - 1) * j.innerR, (r() * 2 - 1) * j.innerR))
      const p = drop(placed, rr, cands, j.floorY, (x, z) => Math.hypot(x, z) + rr < j.innerR - 0.15)
      if (!p) throw new Error('罐里放不下')
      placed.push({ p, r: rr })
      this.pile[i] = p
    }
  }

  shots(add: AddShot) {
    const s = this.s
    const J = () => this.jar.group.position
    const jarMid = (_T: number, out: Vector3) => out.copy(J()).add(v(0, 9, 0))
    // 绒毛特写：离得很近，景深浅
    add(0, 9.6, { target: s.fruitCenter, dist: 9.5, az: 18, el: 10, fov: 28, ap: 0.5, shake: 0.4 }, { target: s.fruitCenter, dist: 7.4, az: 58, el: 18, fov: 28, ap: 0.56, shake: 0.4 })
    add(9.6, 15, { target: jarMid, dist: 52, az: 24, el: 26, fov: 30, ap: 0.24 }, { target: jarMid, dist: 44, az: 32, el: 22, fov: 30, ap: 0.28 }, 1.0)
    add(15, this.dur + 2, { target: jarMid, dist: 46, az: 34, el: 22, fov: 30, ap: 0.26 }, { target: (_T: number, out: Vector3) => out.copy(J()).add(v(14, 30, -30)), dist: 170, az: 66, el: 16, fov: 34, ap: 0.12 }, 1.6, smooth)
  }

  lights(): [number, LightName][] {
    return [
      [0, 'forenoon'],
      [12, 'afternoon'],
      [25, 'golden'],
    ]
  }

  sounds(add: AddSound) {
    add(DROP1 - 0.02, 'glass', { gain: 0.65 })
    add(LID0 + 0.05, 'tap', { gain: 0.14, pitch: 1.3 })
    add(LID1 - 0.03, 'clink', { gain: 0.55 })
  }

  pose(t: number) {
    const s = this.s
    const j = this.jar
    this.layoutPile()
    j.group.visible = true
    j.lid.visible = true
    j.group.updateMatrixWorld()
    const base = j.group.position
    const f = s.fruits
    const p = new Vector3()
    for (let i = 1; i < f.count; i++) {
      p.copy(this.pile[i]).add(base)
      f.setFruit(i, p, s.fruitRot(i))
    }
    f.show(true)

    // 主角：罐口上方慢慢转着给人看 → 放进罐里
    const above = v(base.x, base.y + j.height + 9, base.z)
    const inJar = this.pile[0].clone().add(base)
    // 横过来：果蒂朝右、凹顶朝左，慢慢转，两头都看得见
    const spin = t < DROP0 ? this.q.setFromAxisAngle(UP, -0.5 + t * 0.09).multiply(SIDEWAYS) : this.q.copy(s.fruitRot(0))
    if (t < DROP0) p.copy(above)
    else if (t < DROP1) hop(p, above, inJar, seg(t, DROP0, DROP1), 2)
    else p.copy(inJar)
    s.setHeroByCenter(p, spin)
    s.applyHero()

    // 木盖：放在罐旁边 → 直着提起来、挪到罐口上方、落下盖上（不碰罐沿）
    const lidSide = v(base.x, base.y + 1.2, base.z + 17)
    const lidOn = v(base.x, base.y + j.height + 0.02, base.z)
    const hi = base.y + j.height + 6
    const L = j.lid.position
    if (t < LID0) L.copy(lidSide)
    else {
      const u = seg(t, LID0, LID1)
      if (u < 0.4) L.lerpVectors(lidSide, v(lidSide.x, hi, lidSide.z), smoother(u / 0.4))
      else if (u < 0.8) L.lerpVectors(v(lidSide.x, hi, lidSide.z), v(lidOn.x, hi, lidOn.z), smoother((u - 0.4) / 0.4))
      else L.lerpVectors(v(lidOn.x, hi, lidOn.z), lidOn, smoother((u - 0.8) / 0.2))
    }
    j.lid.rotation.set(0, 0.3 * (1 - smoother(seg(t, LID0, LID1))), 0)
  }
}
