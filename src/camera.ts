import { Vector3 } from 'three'
import { lerp, seg, smoother } from './util'

// 镜头：每个镜头是两个机位（起、止）之间的推拉摇移，机位用"看哪儿、多远、方位、俯仰、视角、景深"描述。
// 镜头可以和上一个镜头叠化（blend 秒）；章节之间有纸色遮罩，直接切。

export type Target = Vector3 | ((T: number, out: Vector3) => Vector3)
export interface Spec {
  target: Target
  dist: number
  az: number // 度，从 +z 往 +x 转
  el: number // 度
  fov: number
  ap: number // 景深强度
  shake?: number
}
export interface Shot {
  t0: number
  t1: number
  a: Spec
  b: Spec
  blend: number
  ease?: (t: number) => number
}
export interface CamState {
  target: Vector3
  dist: number
  az: number
  el: number
  fov: number
  ap: number
  shake: number
}
/** 加一个镜头（时间是这一段自己的本地时间） */
export type AddShot = (t0: number, t1: number, a: Spec, b: Spec, blend?: number, ease?: (t: number) => number) => void

export const newCam = (): CamState => ({ target: new Vector3(), dist: 100, az: 0, el: 20, fov: 35, ap: 0.1, shake: 1 })

function evalSpec(s: Spec, T: number, out: CamState) {
  if (typeof s.target === 'function') s.target(T, out.target)
  else out.target.copy(s.target)
  out.dist = s.dist
  out.az = s.az
  out.el = s.el
  out.fov = s.fov
  out.ap = s.ap
  out.shake = s.shake ?? 1
  return out
}
function mixCam(out: CamState, a: CamState, b: CamState, t: number) {
  out.target.lerpVectors(a.target, b.target, t)
  out.dist = Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), t))
  out.az = lerp(a.az, b.az, t)
  out.el = lerp(a.el, b.el, t)
  out.fov = lerp(a.fov, b.fov, t)
  out.ap = lerp(a.ap, b.ap, t)
  out.shake = lerp(a.shake, b.shake, t)
  return out
}

export class ShotList {
  readonly shots: Shot[] = []
  private camA = newCam()
  private camB = newCam()
  private camP = newCam()

  /** 把一段的镜头按它在时间线上的起点挪过来 */
  adder(start: number): AddShot {
    return (t0, t1, a, b, blend = 0, ease) => this.shots.push({ t0: start + t0, t1: start + t1, a, b, blend, ease })
  }

  at(T: number, out: CamState) {
    const S = this.shots
    let i = S.findIndex((s) => T >= s.t0 && T < s.t1)
    if (i < 0) i = T < S[0].t0 ? 0 : S.length - 1
    const s = S[i]
    const k = (s.ease ?? smoother)(seg(T, s.t0, s.t1))
    mixCam(out, evalSpec(s.a, T, this.camA), evalSpec(s.b, T, this.camB), k)
    if (s.blend > 0 && i > 0 && T < s.t0 + s.blend) {
      const p = S[i - 1]
      const pk = (p.ease ?? smoother)(seg(T, p.t0, p.t1))
      const prev = mixCam(this.camP, evalSpec(p.a, T, this.camA), evalSpec(p.b, T, this.camB), pk)
      const bt = smoother(seg(T, s.t0, s.t0 + s.blend))
      const keep = { target: out.target.clone(), dist: out.dist, az: out.az, el: out.el, fov: out.fov, ap: out.ap, shake: out.shake }
      mixCam(out, prev, keep, bt)
    }
    return out
  }
}
