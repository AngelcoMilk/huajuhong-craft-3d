import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { AddSound } from '../audio/sound'
import type { AddShot } from '../camera'
import type { LightName } from '../gfx/env'
import type { Stage } from '../stage'
import { clamp, easeOut, hash1, hop, lerp, seg, smooth, smoother, smoothstep, TAU } from '../util'
import { LAYOUT } from '../world/layout'
import { PEEL } from '../world/peel'
import { Act } from './act'

// 割皮去瓤：从果顶往下割 N 道（底下留一截连着），掰开成花，掏出果瓤，用铲刀把白瓤一瓣瓣刮掉，刮下来的屑落在瓣与瓣的空当里。
// 一个一个做的活，只拍主角的特写；另外九个在案上的篮子里等着。

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
const AC = PEEL.ALPHA_C
/** 刮下来的屑：落地后搁这么久（秒）还看得见，再用这么久化没 —— 按每片自己的年龄算 */
const SHAVING_HOLD = 1.6
const SHAVING_FADE = 2.4

// 声音该响的时刻：数字只写在这里，声音只引用名字。
// 割皮、刮瓤那些成批的时刻已经由 cutWindow / scrapeStart 算出来，不在这张表里。
const AT = {
  open: 16.2, // 掰开
  knifeBack: 16.76, // 刀放回刀架
  pulpOut: 18.2, // 掏瓤
  pulpRustle: 20.4, // 摊平那几下
  pulpBowl: 20.78, // 瓤落进碗里
  scraperBack: 37.36, // 刮刀放回
} as const

export class Cut extends Act {
  /** 割皮时，第 k 道口转到刀这一边：刀固定在 phiK 方位 */
  private readonly phiK = 0.5
  private readonly n: number
  private readonly dth: number
  /** 一道口、一瓣刮多久：七爪照原来的节奏，瓣少的每瓣慢一点，总长不变 */
  private readonly cutDur: number
  private readonly scrapeStep: number
  private e = new Euler()
  private m = new Matrix4()
  private a = new Vector3()
  private b = new Vector3()

  constructor(s: Stage, id = 'cut') {
    super(s, id, 50)
    this.n = s.w.hero.n
    this.dth = TAU / this.n
    this.cutDur = this.n === 7 ? 1.6 : 9.6 / (this.n - 1)
    this.scrapeStep = this.n === 7 ? 1.55 : 10.85 / this.n
  }

  shots(add: AddShot) {
    const board = LAYOUT.board
    const bt = v(board.x, board.y + 3.6, board.z)
    add(0, 15.6, { target: bt, dist: 40, az: 22, el: 20, fov: 30, ap: 0.36 }, { target: bt, dist: 35, az: 34, el: 26, fov: 30, ap: 0.4 })
    add(15.6, 22.6, { target: v(board.x, board.y + 2.5, board.z), dist: 42, az: 40, el: 40, fov: 32, ap: 0.32 }, { target: v(board.x, board.y + 1.5, board.z), dist: 46, az: 52, el: 54, fov: 32, ap: 0.3 }, 1.2)
    add(22.6, 37, { target: v(board.x, board.y + 0.5, board.z), dist: 40, az: 30, el: 64, fov: 32, ap: 0.26 }, { target: v(board.x, board.y + 0.5, board.z), dist: 38, az: 10, el: 68, fov: 32, ap: 0.26 }, 1.2)
    add(37, 50, { target: v(board.x, board.y + 0.4, board.z), dist: 30, az: -24, el: 26, fov: 28, ap: 0.4 }, { target: v(board.x, board.y + 0.4, board.z), dist: 26, az: -58, el: 18, fov: 28, ap: 0.44 }, 1.6)
  }

  lights(): [number, LightName][] {
    return [[0, 'forenoon']]
  }

  private cutYaw(k: number) {
    return k * this.dth + this.dth / 2 - this.phiK
  }
  private cutWindow(k: number) {
    const start = 3.6 + (k === 0 ? 0 : 2.1 + (k - 1) * this.cutDur)
    const dur = k === 0 ? 2.1 : this.cutDur
    return { start, sliceA: start + 0.3, sliceB: start + dur - 0.65, outB: start + dur - 0.4, end: start + dur }
  }
  private scrapeStart(k: number) {
    return 23.8 + k * this.scrapeStep
  }
  /** 刮完最后一瓣，刮中间那块 */
  private get hubAt() {
    return this.scrapeStart(this.n) + 0.15
  }

  carry(t: number) {
    const st = this.s.w.hero.state
    for (let k = 0; k < this.n; k++) {
      const w = this.cutWindow(k)
      st.cut[k] = smoothstep(w.sliceA, w.sliceB, t)
      // 先掰开一半，掏了瓤再摊平
      const a = smoothstep(16.2 + k * 0.1, 17.9 + k * 0.1, t)
      const b = smoothstep(20.4 + k * 0.06, 22.4 + k * 0.06, t)
      st.open[k] = easeOut(a) * 0.58 + smooth(b) * 0.42
      st.scrape[k] = smoothstep(this.scrapeStart(k), this.scrapeStart(k) + 1.25, t)
    }
    st.cap = smoothstep(16.2, 22.4, t)
    st.hub = smoothstep(this.hubAt, this.hubAt + 1, t)
    // 割开以后皮上的水慢慢干了
    this.s.look.wet *= 1 - smoothstep(2, 20, t)
  }

  sounds(add: AddSound) {
    const L = LAYOUT
    // 一道道割
    for (let k = 0; k < this.n; k++) {
      const w = this.cutWindow(k)
      add(w.sliceA, 'slice', { dur: w.sliceB - w.sliceA, gain: 0.75, pitch: 0.95 + 0.04 * ((k * 3) % 4) })
    }
    add(AT.knifeBack, 'tap', { gain: 0.3, pitch: 1.4, at: L.knifeRest })
    // 掰开、掏瓤、摊平
    add(AT.open, 'rustle', { dur: 1.6, gain: 0.25, pitch: 0.6 })
    add(AT.pulpOut, 'squish', { gain: 0.65 })
    add(AT.pulpBowl, 'bowl', { gain: 0.55, at: L.bowl })
    add(AT.pulpRustle, 'rustle', { dur: 1.8, gain: 0.18, pitch: 0.55 })
    // 一瓣一瓣刮，刮下来的屑落在砧板上，最后刮中间
    for (let k = 0; k < this.n; k++) {
      const s0 = this.scrapeStart(k)
      add(s0, 'scrape', { dur: 1.25, gain: 0.75, pitch: 0.9 + 0.03 * ((k * 5) % 7) })
      for (let j = 0; j < 4; j++) add(s0 + ((j + 0.5) / 4) * 1.25 + 0.55, 'tap', { gain: 0.1, pitch: 1.6 })
    }
    add(this.hubAt, 'scrape', { dur: 1.0, gain: 0.55, pitch: 0.85 })
    add(AT.scraperBack, 'tap', { gain: 0.3, pitch: 1.3, at: L.scraperRest })
  }

  /** 主角在砧板上：每割完一道转一下，刮好以后慢慢转一点给人看 */
  private heroPose(t: number, pos: Vector3, q: Quaternion) {
    const L = LAYOUT
    pos.set(L.board.x, L.board.y, L.board.z)
    let yaw = this.cutYaw(0)
    for (let k = 0; k < this.n; k++) {
      const w = this.cutWindow(k)
      if (t >= w.outB) yaw = this.cutYaw(Math.min(k + 1, this.n)) - (1 - smoother(seg(t, w.outB, w.end))) * this.dth
    }
    yaw += smoother(seg(t, 37, 50)) * 0.5
    this.e.set(0, yaw, 0)
    q.setFromEuler(this.e)
  }

  /** 第 k 道割口时刀在果子本地坐标里的姿势 */
  private knifeLocal(t: number) {
    const R = this.s.R
    const p = new Vector3()
    const q = new Quaternion()
    const th = (k: number) => k * this.dth + this.dth / 2
    let k = 0
    for (let i = 0; i < this.n; i++) if (t >= this.cutWindow(i).start) k = i
    const w = this.cutWindow(k)
    const pose = (kk: number, a: number, out: number) => {
      const tt = th(kk)
      const sa = Math.sin(a)
      const ca = Math.cos(a)
      const nOut = this.a.set(sa * Math.cos(tt), -ca, sa * Math.sin(tt))
      const tUp = this.b.set(ca * Math.cos(tt), sa, ca * Math.sin(tt))
      const e = new Vector3(-Math.sin(tt), 0, Math.cos(tt)).negate()
      const x = new Vector3().addScaledVector(tUp, 0.55).addScaledVector(nOut, 0.83).normalize()
      const y = new Vector3().crossVectors(e, x).normalize()
      this.m.makeBasis(x, y, e)
      q.setFromRotationMatrix(this.m)
      const r = R - PEEL.TH0 * 0.6 + out
      p.set(r * sa * Math.cos(tt), R - r * ca, r * sa * Math.sin(tt))
      p.addScaledVector(x, out * 0.4)
    }
    const last = this.n - 1
    if (t < w.sliceA) {
      // 从上面落到果顶
      const s = smoother(seg(t, w.start, w.sliceA))
      pose(k, Math.PI - 0.02, (1 - s) * 4 + 0.0)
    } else if (t < w.sliceB) {
      const c = smoothstep(w.sliceA, w.sliceB, t)
      pose(k, Math.PI - (Math.PI - AC) * c, 0)
    } else if (t < w.outB) {
      const s = smoother(seg(t, w.sliceB, w.outB))
      pose(k, AC + s * 0.25, s * 5)
    } else {
      // 果子在转，刀回到果顶上方等下一刀
      const s = smoother(seg(t, w.outB, w.end))
      const k2 = Math.min(k + 1, last)
      pose(k2, lerp(AC + 0.25, Math.PI - 0.02, s), lerp(5, 4, s) + Math.sin(Math.PI * s) * 3)
      if (k === last) pose(last, AC + 0.25 + s * 0.3, 5 + s * 6)
    }
    return { p, q }
  }

  /** 刮第 k 瓣时铲刀在本地坐标里的姿势：铲口贴着内表面，柄朝后上方 */
  private scraperLocal(t: number) {
    const hero = this.s.w.hero
    const p = new Vector3()
    const q = new Quaternion()
    let k = 0
    for (let i = 0; i < this.n; i++) if (t >= this.scrapeStart(i) - 0.3) k = i
    const s0 = this.scrapeStart(k)
    const sp = clamp(hero.state.scrape[k])
    const front = lerp(AC * 0.85, Math.PI + 0.25, sp)
    let a = clamp(front - 0.08, AC * 0.8, Math.PI - 0.15)
    let lift = 0
    if (t < s0) {
      // 从上一瓣的尖挪到这一瓣的根
      const s = smoother(seg(t, s0 - 0.3, s0))
      a = AC * 0.85
      lift = 1.6 * (1 - s)
    } else if (sp >= 1) {
      lift = smoother(seg(t, s0 + 1.25, s0 + this.scrapeStep)) * 1.6
      a = Math.PI - 0.15
    }
    let kk = k
    const hubAt = this.hubAt
    if (t > hubAt - 0.2) {
      // 最后刮中间那块
      kk = 0
      const h = seg(t, hubAt, hubAt + 1)
      a = lerp(0.1, AC * 0.95, h)
      lift = (1 - smoother(seg(t, hubAt - 0.3, hubAt))) * 1.5
    }
    hero.innerCenter(kk, a, p)
    p.y += 0.04 + lift
    const dir = kk * this.dth
    // 柄朝瓣根方向（铲口朝瓣尖推）；铲头再翘一点，只有铲口贴着皮（铁颈本身已经往上弯了）
    this.e.set(0, -(dir + Math.PI), 0.2, 'YZX')
    q.setFromEuler(this.e)
    return { p, q }
  }

  /** 把本地姿势转到世界，和放回去的位置之间来回 */
  private toolPose(obj: { position: Vector3; quaternion: Quaternion }, local: { p: Vector3; q: Quaternion }, restP: Vector3, restQ: Quaternion, inT: number, outT: number, h: number) {
    this.m.compose(local.p, local.q, this.a.set(1, 1, 1))
    this.m.premultiply(this.s.w.hero.group.matrixWorld)
    const wp = new Vector3()
    const wq = new Quaternion()
    this.m.decompose(wp, wq, this.a)
    if (inT < 1) {
      hop(obj.position, restP, wp, inT, h)
      obj.quaternion.slerpQuaternions(restQ, wq, smoother(inT))
    } else if (outT > 0) {
      hop(obj.position, wp, restP, outT, h)
      obj.quaternion.slerpQuaternions(wq, restQ, smoother(outT))
    } else {
      obj.position.copy(wp)
      obj.quaternion.copy(wq)
    }
  }

  pose(t: number) {
    const s = this.s
    const w = s.w
    const L = LAYOUT
    const R = s.R
    const hero = w.hero
    const tb = w.table

    this.heroPose(t, s.heroPos, s.heroQuat)
    s.applyHero()
    s.fruitsInBasket()

    // 小刀
    if (t >= 1.4 && t <= 16.8) this.toolPose(tb.knife, this.knifeLocal(t), tb.knifeRest.pos, tb.knifeRest.quat, smoothstep(1.4, 3.4, t), smoothstep(15.4, 16.8, t), 10)
    // 铲刀
    if (t >= 22.4 && t <= 37.4) this.toolPose(tb.scraper, this.scraperLocal(t), tb.scraperRest.pos, tb.scraperRest.quat, smoothstep(22.4, 23.7, t), smoothstep(36.0, 37.4, t), 8)

    // 果瓤：在果子里 → 拎出来放进碗里
    const pulp = hero.pulp
    const inFruit = new Vector3(0, R, 0).applyMatrix4(hero.group.matrixWorld)
    const bowlSpot = v(L.bowl.x, L.bowl.y + 4.4, L.bowl.z)
    const pt = seg(t, 18.2, 20.8)
    if (t < 18.2) pulp.position.copy(inFruit)
    else if (pt < 1) {
      const up = inFruit.clone().add(v(0, 6, 0))
      if (pt < 0.3) pulp.position.lerpVectors(inFruit, up, smoother(pt / 0.3))
      else hop(pulp.position, up, bowlSpot, (pt - 0.3) / 0.7, 6)
    } else pulp.position.copy(bowlSpot)
    pulp.visible = t > 12
    pulp.rotation.set(0, pt * 2, pt * 0.6)

    // 刮下来的白瓤屑：从铲口那里拨出去，落在旁边两瓣之间的空当里（落在砧板上，不压在瓣上），搁一会儿再慢慢化掉
    if (t > this.scrapeStart(0)) {
      const sh = w.shavings
      const AC0 = AC
      // 按刮的时候果皮的朝向算（后面果皮慢慢转给人看，砧板上的屑不跟着转）
      const hp = new Vector3()
      const hq = new Quaternion()
      this.heroPose(30, hp, hq)
      const mScrape = new Matrix4().compose(hp, hq, new Vector3(1, 1, 1))
      const yawS = 2 * Math.atan2(hq.y, hq.w)
      const startP = new Vector3()
      const lp = new Vector3()
      for (let k = 0; k < this.n; k++) {
        const s0 = this.scrapeStart(k)
        for (let j = 0; j < 4; j++) {
          const ts = s0 + ((j + 0.5) / 4) * 1.25
          const age = t - ts
          if (age < 0) continue
          // 落地搁一会儿再慢慢化掉；化完的就不再提交，省得留一个看不见却还在的空壳
          const fade = 1 - smoothstep(SHAVING_HOLD, SHAVING_HOLD + SHAVING_FADE, age)
          if (fade <= 0.002) continue
          const f = (j + 0.5) / 4
          hero.innerCenter(k, lerp(AC0 * 0.9, Math.PI * 0.92, f), startP)
          startP.y += 0.2
          const side = hash1(k * 13 + j) < 0.5 ? -1 : 1
          const gap = k * this.dth + side * this.dth * 0.5 + (hash1(k * 7 + j * 3) - 0.5) * 0.12
          const rho = 7.6 + 3.0 * hash1(k * 5 + j)
          const m = smoother(clamp(age / 0.6))
          lp.set(lerp(startP.x, Math.cos(gap) * rho, m), lerp(startP.y, 0.32, m) + Math.sin(Math.PI * m) * 1.2, lerp(startP.z, Math.sin(gap) * rho, m))
          lp.applyMatrix4(mScrape)
          // 落下来就顺着空当躺着：只在水平面里转，不立起来
          sh.add(lp, (hash1(j + k * 9) - 0.5) * 0.3, yawS - gap + (hash1(k + j) - 0.5) * 0.5, (hash1(j * 3 + k) - 0.5) * 0.3, 0.75 + 0.4 * hash1(k * 31 + j), fade)
        }
      }
    }
  }
}
